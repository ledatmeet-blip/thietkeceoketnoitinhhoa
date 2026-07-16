const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'ceo-site';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// Disable body parser so we receive raw binary stream
module.exports.config = {
  api: { bodyParser: false }
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

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

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({ error: 'Storage not configured' });
  }

  try {
    const filename  = (req.headers['x-filename'] || `upload-${Date.now()}.jpg`)
      .replace(/[^a-z0-9.\-_]/gi, '-')
      .slice(0, 100);
    const contentType = req.headers['content-type'] || 'image/jpeg';

    const body = await readBody(req);

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filename, body, { contentType, upsert: true });

    if (error) throw error;

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filename);

    return res.json({ url: urlData.publicUrl });
  } catch (err) {
    console.error('[upload]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
