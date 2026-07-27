const { createClient } = require('@supabase/supabase-js');

// One-time admin endpoint: raises the ceo-site bucket's file size limit so video uploads
// aren't rejected by Supabase Storage itself (separate from the Vercel function body-size
// limit fixed by the signed-upload-URL flow). Delete this file after running it once.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { adminEmail, adminPass } = req.body || {};
  if (
    !adminEmail || !adminPass ||
    adminEmail !== process.env.ADMIN_EMAIL ||
    adminPass  !== process.env.ADMIN_PASS
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(503).json({ error: 'Storage not configured' });

  try {
    const supabase = createClient(url, key);
    const { data: before, error: getErr } = await supabase.storage.getBucket('ceo-site');
    if (getErr) throw getErr;

    const { data, error } = await supabase.storage.updateBucket('ceo-site', {
      public: true,
      fileSizeLimit: 500 * 1024 * 1024, // 500MB
    });
    if (error) throw error;

    const { data: after } = await supabase.storage.getBucket('ceo-site');
    return res.json({ success: true, before, updateResult: data, after });
  } catch (err) {
    console.error('[fix-bucket-limit]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
