/**
 * POST /api/admin-login
 *
 * Checks the admin password and, if correct, sets a signed cookie the
 * admin panel uses to authenticate. No user accounts, no session store —
 * the cookie's own HMAC signature is what proves it's genuine.
 */
import crypto from 'node:crypto';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ADMIN_PASSWORD;
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');

/** Crude in-memory throttle against password guessing. */
const attempts = new Map();
const isThrottled = (key) => {
  const now = Date.now();
  for (const [k, t] of attempts) if (now - t > 60_000) attempts.delete(k);
  if (attempts.has(key)) return true;
  attempts.set(key, now);
  return false;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'Server sozlanmagan (ADMIN_PASSWORD yo‘q)' });

  const ip = req.headers['x-forwarded-for'] || 'unknown';
  if (isThrottled(ip)) {
    return res.status(429).json({ error: 'Biroz kuting va qayta urinib ko‘ring' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  if (body.password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Parol noto‘g‘ri' });
  }

  const expires = Date.now() + SESSION_MS;
  const token = `${expires}.${sign(String(expires))}`;
  res.setHeader(
    'Set-Cookie',
    `admin_session=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MS / 1000}; Path=/`,
  );
  return res.status(200).json({ ok: true });
}
