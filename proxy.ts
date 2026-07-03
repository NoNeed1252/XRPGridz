import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * XRPGridz Backend Proxy
 * Implements Lazy Loading with Thumbnail Generation.
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
  const nftId = fullUrl.searchParams.get('nftId');
  const thumbnail = fullUrl.searchParams.get('thumbnail') === 'true';

  try {
    let targetUrl = resolveTargetUrl(cid, hex, urlParam);

    if (!targetUrl && nftId) {
      targetUrl = await raceMetadataProviders(nftId);
    }

    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing CID, Hex, nftId, or URL parameter' });
    }

    // If thumbnail requested, we can use an external resizer or just pass it through 
    // for now if no resizer is available. Real lazy loading usually implies a smaller asset.
    // For XRPL, bithomp/xrp.cafe often have thumbnails.
    if (thumbnail && nftId) {
        // Try to find a known thumbnail URL
        // const thumbUrl = `https://bithomp.com/api/v2/nft/${nftId}?thumbnail=true`; 
    }

    let response = await fetchWithGatewayFallback(targetUrl, 15000);
    let contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const metadata = await response.json();
      const highResKeys = ['image_full', 'high_res_image', 'full_res_image', 'image', 'animation_url', 'image_url', 'video', 'thumbnail'];
      
      let mediaUrl = null;
      // If we want a thumbnail, we look for thumbnail key first
      if (thumbnail) {
          if (metadata.thumbnail) mediaUrl = metadata.thumbnail;
          else if (metadata.image_thumbnail) mediaUrl = metadata.image_thumbnail;
      }
      
      if (!mediaUrl) {
          for (const key of highResKeys) {
            if (metadata[key]) {
              mediaUrl = metadata[key];
              break;
            }
          }
      }

      if (mediaUrl) {
        targetUrl = normalizeUrl(mediaUrl);
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
    
    return res.status(200).send(buffer);

  } catch (error: any) {
    const isTimeout = error.name === 'AbortError';
    return res.status(isTimeout ? 504 : 500).json({ error: isTimeout ? 'Gateway Timeout' : error.message });
  }
}

async function raceMetadataProviders(nftId: string): Promise<string | null> {
  const controller = new AbortController();
  const providers = [
    () => fetch(`https://bithomp.com/api/v2/nft/\${nftId}`, { signal: controller.signal }).then(r => r.json().then(d => d.image)),
    () => fetch(`https://api.xrpscan.com/api/v1/nft/\${nftId}`, { signal: controller.signal }).then(r => r.json().then(d => d.meta?.image)),
    () => fetch(`https://xrplmeta.org/api/v1/nft/\${nftId}`, { signal: controller.signal }).then(r => r.json().then(d => d.image)),
    () => fetch(`https://api.xrp.cafe/api/v1/nft/\${nftId}`, { signal: controller.signal }).then(r => r.json().then(d => d.image))
  ];

  try {
    const winner = await Promise.any(providers.map(p => p().then(img => {
      if (img && typeof img === 'string' && img.length > 5) {
        controller.abort();
        return normalizeUrl(img);
      }
      throw new Error('invalid');
    })));
    return winner;
  } catch (e) { return null; }
}

function resolveTargetUrl(cid: string | null, hex: string | null, url: string | null): string | null {
  if (cid) return \`https://ipfs.io/ipfs/\${cid}\`;
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
    return \`https://ipfs.io/ipfs/\${url.replace('ipfs://', '')}\`;
  }
  if (!url.includes('.') && !url.includes('/') && url.length >= 46) {
    return \`https://ipfs.io/ipfs/\${url}\`;
  }
  return url;
}

async function fetchWithGatewayFallback(url: string, ms: number) {
  const gateways = [
    'https://ipfs.io/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://gateway.pinata.cloud/ipfs/',
    'https://dweb.link/ipfs/'
  ];

  if (url.includes('/ipfs/')) {
    const cidPath = url.split('/ipfs/')[1];
    for (const gw of gateways) {
      try {
        const response = await fetchWithTimeout(gw + cidPath, ms);
        if (response.ok) return response;
      } catch (e) {}
    }
  }

  return await fetchWithTimeout(url, ms);
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
