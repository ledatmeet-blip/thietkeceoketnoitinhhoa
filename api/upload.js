const { put } = require('@vercel/blob');

// Disable body parser so we receive raw binary stream
module.exports.config = {
  api: { bodyParser: false }
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-email, x-admin-pass, x-filename');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth check via custom headers
  const adminEmail = req.headers['x-admin-email'];
  const adminPass  = req.headers['x-admin-pass'];
  if (
    !adminEmail || !adminPass ||
    adminEmail !== process.env.ADMIN_EMAIL ||
    adminPass  !== process.env.ADMIN_PASS
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'Blob storage not configured' });
  }

  try {
    const filename  = (req.headers['x-filename'] || `upload-${Date.now()}.jpg`)
      .replace(/[^a-z0-9.\-_]/gi, '-')
      .slice(0, 100);
    const contentType = req.headers['content-type'] || 'image/jpeg';

    // req is a Node.js IncomingMessage (Readable stream) — pass directly to put()
    const blob = await put(`ceo-site/${filename}`, req, {
      access: 'public',
      contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return res.json({ url: blob.url });
  } catch (err) {
    console.error('[upload]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
