import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Library Assistant Backend Proxy - Optimized for Node 24+
 * Implements Recursive Metadata Resolution: If the target is JSON, it extracts the 'image' field
 * and fetches the actual media asset.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  try {
    let targetUrl = resolveTargetUrl(cid, hex, urlParam);
    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing CID, Hex, or URL parameter' });
    }

    console.log(`[Proxy] Initial Target: ${targetUrl}`);

    // Initial Fetch
    let response = await fetchWithTimeout(targetUrl, 12000);
    let contentType = response.headers.get('content-type') || '';

    // Recursive Resolution: If target is JSON, extract image link and re-fetch
    if (contentType.includes('application/json')) {
      const metadata = await response.json();
      console.log(`[Proxy] Metadata detected. Parsing JSON...`);
      
      const mediaUrl = metadata.image || metadata.video || metadata.animation_url;
      if (mediaUrl) {
        console.log(`[Proxy] Media found in metadata: ${mediaUrl}`);
        targetUrl = normalizeUrl(mediaUrl);
        console.log(`[Proxy] Re-fetching actual media: ${targetUrl}`);
        response = await fetchWithTimeout(targetUrl, 12000);
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
  // Handle case where CID is provided without protocol
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
