import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Library Assistant Backend Proxy - Optimized for Node 24+
 * Uses WHATWG URL API for reliable parameter parsing and improved fetch handling.
 * Includes enhanced observability for debugging resolution failures.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Use WHATWG URL API for reliable query parsing as per Vercel/Node 24 recommendations
  const protocol = (req.headers['x-forwarded-proto'] as string) || 'http';
  const host = req.headers['host'];
  const fullUrl = new URL(req.url || '', `${protocol}://${host}`);
  
  const cid = fullUrl.searchParams.get('cid');
  const hex = fullUrl.searchParams.get('hex');
  const urlParam = fullUrl.searchParams.get('url');

  console.log(`[Proxy Request] Parameters - cid: ${cid}, hex: ${hex}, url: ${urlParam}`);

  try {
    let targetUrl = '';

    if (cid) {
      targetUrl = `https://ipfs.io/ipfs/${cid}`;
    } else if (hex) {
      // Unwrap Hex URI
      let decoded = '';
      try {
        for (let i = 0; i < hex.length; i += 2) {
          decoded += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        }
      } catch (e) {
        console.error(`[Proxy Error] Hex decoding failed for: ${hex}`);
        return res.status(400).json({ error: 'Invalid hex encoding' });
      }
      
      console.log(`[Proxy Debug] Decoded Hex: ${decoded}`);

      if (decoded.startsWith('ipfs://')) {
        targetUrl = `https://ipfs.io/ipfs/${decoded.replace('ipfs://', '')}`;
      } else if (decoded.startsWith('http')) {
        targetUrl = decoded;
      } else {
        targetUrl = `https://ipfs.io/ipfs/${decoded}`;
      }
    } else if (urlParam) {
      targetUrl = urlParam;
    }

    if (!targetUrl) {
      console.warn('[Proxy Warning] No target URL could be resolved from parameters.');
      return res.status(400).json({ error: 'Missing CID, Hex, or URL parameter' });
    }

    console.log(`[Proxy Fetching] Target URL: ${targetUrl}`);

    // Use a Controller to implement a generous timeout for IPFS resolution (15s)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    console.log(`[Proxy Response] Status: ${response.status}, Content-Type: ${response.headers.get('content-type')}`);

    if (!response.ok) {
      console.error(`[Proxy Error] Target returned error status: ${response.status}`);
      return res.status(response.status).json({ error: `Target returned ${response.status}` });
    }

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    
    // Set robust caching headers
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    console.log(`[Proxy Success] Buffered ${buffer.length} bytes.`);

    if (buffer.length === 0) {
        console.warn('[Proxy Warning] Target returned empty body.');
        return res.status(404).json({ error: 'Empty response from target' });
    }

    return res.status(200).send(buffer);

  } catch (error: any) {
    const isTimeout = error.name === 'AbortError';
    console.error(`[Proxy Critical] ${isTimeout ? 'Fetch Timeout' : 'Exception'}:`, error);
    const status = isTimeout ? 504 : 500;
    return res.status(status).json({ error: isTimeout ? 'Gateway Timeout' : error.message });
  }
}
