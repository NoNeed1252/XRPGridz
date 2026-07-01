import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Library Assistant Backend Proxy - Optimized for Node 24+
 * Uses WHATWG URL API for reliable parameter parsing and improved fetch handling.
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
        return res.status(400).json({ error: 'Invalid hex encoding' });
      }
      
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
      return res.status(400).json({ error: 'Missing CID, Hex, or URL parameter' });
    }

    // Use a Controller to implement a generous timeout for IPFS resolution (15s)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
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
    
    if (buffer.length === 0) {
        return res.status(404).json({ error: 'Empty response from target' });
    }

    return res.status(200).send(buffer);

  } catch (error: any) {
    console.error('Proxy Error:', error.name === 'AbortError' ? 'Fetch Timeout' : error);
    const status = error.name === 'AbortError' ? 504 : 500;
    return res.status(status).json({ error: error.name === 'AbortError' ? 'Gateway Timeout' : error.message });
  }
}
