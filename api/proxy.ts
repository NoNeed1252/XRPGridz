import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Library Assistant Backend Proxy - Optimized for Node 24+
 * Implements Recursive Metadata Resolution and CORS Passthrough.
 * Enhanced with Multi-Provider Metadata Racing and IPFS Gateway Failover.
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
  const highRes = fullUrl.searchParams.get('highRes') === 'true';

  try {
    let targetUrl = resolveTargetUrl(cid, hex, urlParam);

    // Metadata Resolution Chain
    if (!targetUrl && nftId) {
      console.log(`[Proxy] Starting Metadata Race for NFT: ${nftId}`);
      targetUrl = await raceMetadataProviders(nftId, highRes);
    }

    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing CID, Hex, nftId, or URL parameter' });
    }

    console.log(`[Proxy] Initial Target: ${targetUrl}`);

    // Initial Fetch with Fallback Logic
    let response = await fetchWithGatewayFallback(targetUrl, 15000);
    let contentType = response.headers.get('content-type') || '';

    // Recursive Resolution: If target is JSON, extract image link and re-fetch
    if (contentType.includes('application/json')) {
      const metadata = await response.json();
      const mediaUrl = extractMediaUrl(metadata);
      
      if (mediaUrl) {
        targetUrl = normalizeUrl(mediaUrl);
        console.log(`[Proxy] Re-fetching actual media: ${targetUrl}`);
        response = await fetchWithGatewayFallback(targetUrl, 15000);
        contentType = response.headers.get('content-type') || '';
      }
    }

    if (!response.ok) {
      return res.status(response.status).json({ error: `Target returned ${response.status}` });
    }

    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    
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

/**
 * Extracts media URL from metadata using a robust set of keys and structures.
 */
function extractMediaUrl(metadata: any): string | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const topLevel = metadata.animation_url || metadata.image || metadata.image_url || metadata.video;
  if (topLevel && typeof topLevel === 'string') return topLevel;

  if (metadata.properties?.image && typeof metadata.properties.image === 'string') {
    return metadata.properties.image;
  }

  if (Array.isArray(metadata.files) && metadata.files.length > 0) {
    const bestFile = metadata.files.find((f: any) => 
      f.uri && (f.type?.startsWith('image/') || f.type?.startsWith('video/') || !f.type)
    ) || metadata.files[0];
    
    if (bestFile?.uri && typeof bestFile.uri === 'string') {
      return bestFile.uri;
    }
  }

  return null;
}

async function raceMetadataProviders(nftId: string, highRes: boolean = false): Promise<string | null> {
  const controller = new AbortController();
  
  const providers = [
    // XRPScan
    () => fetch(`https://api.xrpscan.com/api/v1/nft/${nftId}`, { signal: controller.signal }).then(r => r.json().then(d => {
        // High-res check: some providers have raw/original fields
        return d.meta?.image_original || d.meta?.image;
    })),
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
        controller.abort();
        let url = normalizeUrl(img);
        return url;
      }
      throw new Error('invalid');
    })));
    return winner;
  } catch (e) {
    return null;
  }
}

function resolveTargetUrl(cid: string | null, hex: string | null, url: string | null): string | null {
  if (cid) return `https://ipfs.io/ipfs/${encodeURIComponent(cid)}`;
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
  if (!url) return '';
  if (url.startsWith('ipfs://')) {
    const path = url.replace('ipfs://', '');
    return `https://ipfs.io/ipfs/${path.split('/').map(segment => encodeURIComponent(segment)).join('/')}`;
  }
  if (!url.includes('.') && !url.includes('/') && url.length >= 46) {
    return `https://ipfs.io/ipfs/${encodeURIComponent(url)}`;
  }
  return url;
}

async function fetchWithGatewayFallback(url: string, ms: number) {
  try {
    const response = await fetchWithTimeout(url, ms);
    if (response.ok) return response;
    
    if (url.includes('ipfs.io/ipfs/')) {
      const gateways = ['cloudflare-ipfs.com', 'gateway.pinata.cloud', 'ipfs.infura.io'];
      for (const gw of gateways) {
          const secondaryUrl = url.replace('ipfs.io', gw);
          try {
              const res = await fetchWithTimeout(secondaryUrl, ms);
              if (res.ok) return res;
          } catch(e) {}
      }
    }
    return response;
  } catch (error) {
    if (url.includes('ipfs.io/ipfs/')) {
      const secondaryUrl = url.replace('ipfs.io', 'cloudflare-ipfs.com');
      try {
        return await fetchWithTimeout(secondaryUrl, ms);
      } catch (fallbackError) {
        throw error;
      }
    }
    throw error;
  }
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
