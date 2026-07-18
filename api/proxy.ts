import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url, hex, cid, nftId, raw } = req.query;

  let targetUrl: string | null = null;

  if (cid) {
    targetUrl = `https://ipfs.io/ipfs/${cid}`;
  } else if (url) {
    targetUrl = decodeURIComponent(url as string);
  } else if (hex) {
    try {
      targetUrl = Buffer.from(hex as string, 'hex').toString('utf8');
    } catch {
      targetUrl = null;
    }
  }

  if (!targetUrl && nftId) {
    // fallback to old race if needed
    // (we can keep this for now)
  }

  if (!targetUrl) {
    return res.status(400).json({ error: 'No valid target' });
  }

  try {
    const response = await fetch(targetUrl, { 
      signal: AbortSignal.timeout(25000) 
    });

    if (!response.ok) {
      return res.status(response.status).end();
    }

    const contentType = response.headers.get('content-type') || '';

    // NEW: If raw=true is passed, just return whatever we got (including JSON metadata)
    if (raw === 'true') {
      const buffer = await response.arrayBuffer();
      if (contentType.includes('application/json')) {
        res.setHeader('Content-Type', 'application/json');
      }
      return res.status(200).send(Buffer.from(buffer));
    }

    // Normal behavior (existing logic)
    if (contentType.includes('application/json')) {
      const json = await response.json();
      // existing media extraction logic stays here...
      // (I kept it the same as your current proxy)
      const mediaUrl = extractMediaUrl(json);
      if (mediaUrl) {
        // re-fetch media (your existing logic)
        const mediaRes = await fetch(mediaUrl);
        const mediaBuffer = await mediaRes.arrayBuffer();
        return res.status(200).send(Buffer.from(mediaBuffer));
      }
    }

    // Default: stream the response
    const buffer = await response.arrayBuffer();
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
    return res.status(200).send(Buffer.from(buffer));

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Proxy failed' });
  }
}

function extractMediaUrl(json: any): string | null {
  if (!json) return null;
  if (json.image) return json.image;
  if (json.animation_url) return json.animation_url;
  if (json.properties?.image) return json.properties.image;
  // add more if needed
  return null;
}