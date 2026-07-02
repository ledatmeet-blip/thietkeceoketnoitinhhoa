export const config = { runtime: 'edge' };

const AE = process.env.ADMIN_EMAIL;
const AP = process.env.ADMIN_PASS;
const HOOK = process.env.VERCEL_DEPLOY_HOOK_URL;

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try { body = await req.json(); } catch { return new Response('Bad Request', { status: 400 }); }

  if (!body.adminEmail || !body.adminPass || body.adminEmail !== AE || body.adminPass !== AP) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!HOOK) {
    return new Response(JSON.stringify({ error: 'Deploy hook not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    });
  }

  const r = await fetch(HOOK, { method: 'POST' });
  const data = await r.json().catch(() => ({}));
  return new Response(JSON.stringify({ ok: r.ok, job: data.job }), {
    status: r.ok ? 200 : 502,
    headers: { 'Content-Type': 'application/json' }
  });
}
