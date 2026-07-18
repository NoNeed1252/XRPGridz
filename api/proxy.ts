import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url, hex, cid } = req.query as { url?: string; hex?: string; cid?: string };

  let target: string | null = null;

  if (cid) {
    target = `https://ipfs.io/ipfs/${cid}`;
  } else if (url) {
    target = decodeURIComponent(url);
  } else if (hex) {
    try {
      target = Buffer.from(hex, 'hex').toString('utf8');
    } catch {
      target = null;
    }
  }

  if (!target) {
    return res.status(400).json({ error: 'Missing url, hex, or cid parameter' });
  }

  try {
    const response = await fetch(target, {
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      return res.status(response.status).end();
    }

    const contentType = response.headers.get('content-type') || '';
    const buffer = await response.arrayBuffer();

    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

    return res.status(200).send(Buffer.from(buffer));

  } catch (error: any) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Proxy request failed' });
  }
}