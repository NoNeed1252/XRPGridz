import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Library Assistant Backend Proxy
 * Handles hex-unwrapping of URIs and IPFS fetching for XRPL NFTs.
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

  const { cid, hex, url } = req.query;

  try {
    let targetUrl = '';

    if (cid) {
      // Direct CID fetching via a reliable gateway
      targetUrl = `https://ipfs.io/ipfs/${cid}`;
    } else if (hex && typeof hex === 'string') {
      // Unwrap Hex URI
      let decoded = '';
      for (let i = 0; i < hex.length; i += 2) {
        decoded += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      }
      
      if (decoded.startsWith('ipfs://')) {
        targetUrl = `https://ipfs.io/ipfs/${decoded.replace('ipfs://', '')}`;
      } else if (decoded.startsWith('http')) {
        targetUrl = decoded;
      } else {
        // Assume it might be a raw CID
        targetUrl = `https://ipfs.io/ipfs/${decoded}`;
      }
    } else if (url && typeof url === 'string') {
      // Direct proxy for external URLs to bypass CORS/Safari issues
      targetUrl = url;
    }

    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing CID, Hex, or URL parameter' });
    }

    const response = await fetch(targetUrl);
    
    if (!response.ok) {
      return res.status(response.status).json({ error: `Target returned ${response.status}` });
    }

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }
    
    // Cache for 1 hour to reduce IPFS traffic
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    return res.status(200).send(buffer);

  } catch (error: any) {
    console.error('Proxy Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
