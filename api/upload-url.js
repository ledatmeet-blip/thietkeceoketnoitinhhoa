const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'ceo-site';

// Returns a short-lived signed upload URL so the browser can upload large files (videos, etc.)
// directly to Supabase Storage — bypassing Vercel's serverless function request-body limit,
// which rejects anything over a few MB with 413 FUNCTION_PAYLOAD_TOO_LARGE before the function
// even runs. Only JSON (filename) passes through this endpoint, never the file bytes.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { adminEmail, adminPass, filename } = req.body || {};
  if (
    !adminEmail || !adminPass ||
    adminEmail !== process.env.ADMIN_EMAIL ||
    adminPass  !== process.env.ADMIN_PASS
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!filename) return res.status(400).json({ error: 'filename is required' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'Storage not configured' });

  try {
    const supabase = createClient(url, key);
    const cleanName = String(filename).replace(/[^a-z0-9.\-_]/gi, '-').slice(0, 100);

    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(cleanName, { upsert: true });
    if (error) throw error;

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(cleanName);

    return res.json({ path: data.path, token: data.token, publicUrl: pub.publicUrl });
  } catch (err) {
    console.error('[upload-url]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
