import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { id } = req.query;
  
  if (!id) {
    return res.redirect('/');
  }

  const imageUrl = typeof id === 'string' && id.startsWith('http') ? id : `https://public.blob.vercel-storage.com/${id}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>XRPGridz • NFT Grid</title>
    <meta property="og:title" content="XRPGridz • NFT Grid">
    <meta property="og:description" content="Check out my XRP NFT Grid! Created with XRPGridz.">
    <meta property="og:image" content="\${imageUrl}">
    <meta property="og:url" content="https://xrpgridz.vercel.app/share/\${id}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="\${imageUrl}">
    <meta http-equiv="refresh" content="0; url=/">
</head>
<body style="background: #0a0f1e; color: white; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh;">
    <p>Redirecting to XRPGridz...</p>
</body>
</html>\`;

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
}
