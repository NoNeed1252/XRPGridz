import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Library Assistant Backend Proxy - Optimized for Node 24+
 * Implements Recursive Metadata Resolution and CORS Passthrough.
 * Enhanced with Multi-Provider Metadata Racing for maximum reliability.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Force clean CORS headers to satisfy html2canvas and cross-origin pixel reads
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const protocol = (req.headers['x-forwarded-proto'] as string) || 'http';
  const host = req.headers['host'];
  const fullUrl = new URL(req.url || '', `${protocol}://${host}`);
  
  const cid = fullUrl.searchParams.get('cid');
  const hex = fullUrl.searchParams.get('hex');
  const urlParam = fullUrl.searchParams.get('url');
  const nftId = fullUrl.searchParams.get('nftId');

  try {
    let targetUrl = resolveTargetUrl(cid, hex, urlParam);

    // If we have an nftId but no direct image URL yet, start the Metadata Resolution Chain
    if (!targetUrl && nftId) {
      console.log(`[Proxy] Starting Metadata Race for NFT: ${nftId}`);
      targetUrl = await raceMetadataProviders(nftId);
    }

    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing CID, Hex, nftId, or URL parameter' });
    }

    console.log(`[Proxy] Initial Target: ${targetUrl}`);

    // Initial Fetch
    let response = await fetchWithTimeout(targetUrl, 12000);
    let contentType = response.headers.get('content-type') || '';

    // Recursive Resolution: If target is JSON, extract image link and re-fetch
    if (contentType.includes('application/json')) {
      const metadata = await response.json();
      const mediaUrl = metadata.image || metadata.video || metadata.animation_url || metadata.image_url;
      if (mediaUrl) {
        targetUrl = normalizeUrl(mediaUrl);
        console.log(`[Proxy] Re-fetching actual media: ${targetUrl}`);
        response = await fetchWithTimeout(targetUrl, 12000);
        contentType = response.headers.get('content-type') || '';
      }
    }

    if (!response.ok) {
      return res.status(response.status).json({ error: `Target returned ${response.status}` });
    }

    // Set the content type, but override/ensure CORS is preserved for the response
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    
    // Set robust caching headers
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    if (buffer.length === 0) {
        return res.status(404).json({ error: 'Empty response from target' });
    }

    return res.status(200).send(buffer);

  } catch (error: any) {
    const isTimeout = error.name === 'AbortError';
    console.error(`[Proxy Critical] ${isTimeout ? 'Timeout' : 'Error'}:`, error);
    return res.status(isTimeout ? 504 : 500).json({ error: isTimeout ? 'Gateway Timeout' : error.message });
  }
}

async function raceMetadataProviders(nftId: string): Promise<string | null> {
  const controller = new AbortController();
  
  // Resolution strategy: Start several requests in parallel, return the first one that has a valid image URL
  const providers = [
    // XRPScan
    () => fetch(`https://api.xrpscan.com/api/v1/nft/${nftId}`, { signal: controller.signal }).then(r => r.json().then(d => d.meta?.image)),
    // XRPLMeta
    () => fetch(`https://xrplmeta.org/api/v1/nft/${nftId}`, { signal: controller.signal }).then(r => r.json().then(d => d.image)),
    // Bithomp
    () => fetch(`https://bithomp.com/api/v2/nft/${nftId}`, { signal: controller.signal }).then(r => r.json().then(d => d.image)),
    // XRP Cafe
    () => fetch(`https://api.xrp.cafe/api/v1/nft/${nftId}`, { signal: controller.signal }).then(r => r.json().then(d => d.image))
  ];

  try {
    const winner = await Promise.any(providers.map(p => p().then(img => {
      if (img && typeof img === 'string' && img.length > 5) {
        controller.abort(); // Cancel other pending requests
        return normalizeUrl(img);
      }
      throw new Error('invalid');
    })));
    return winner;
  } catch (e) {
    return null;
  }
}

function resolveTargetUrl(cid: string | null, hex: string | null, url: string | null): string | null {
  if (cid) return `https://ipfs.io/ipfs/${cid}`;
  if (url) return url;
  if (hex) {
    let decoded = '';
    try {
      for (let i = 0; i < hex.length; i += 2) {
        decoded += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      }
      return normalizeUrl(decoded);
    } catch (e) { return null; }
  }
  return null;
}

function normalizeUrl(url: string): string {
  if (url.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${url.replace('ipfs://', '')}`;
  }
  if (url.match(/^[a-zA-Z0-9]{46,59}$/)) {
    return `https://ipfs.io/ipfs/${url}`;
  }
  return url;
}

async function fetchWithTimeout(url: string, ms: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}
