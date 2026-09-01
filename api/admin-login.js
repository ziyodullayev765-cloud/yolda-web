/**
 * POST /api/admin-login   { password }  → sets the signed admin cookie
 * POST /api/admin-login?action=logout   → clears it
 * GET  /api/admin-login                 → { authed, role } for the current cookie
 *
 * No admin user accounts and no session store: which password you use
 * decides your role, and the cookie's own HMAC signature is what proves
 * it's genuine. See lib/adminAuth.js for the cookie format and the
 * per-role permission table.
 *
 * Roles come from env vars, all optional except the first:
 *   ADMIN_PASSWORD            → SUPER_ADMIN
 *   ADMIN_PASSWORD_ADMIN      → ADMIN
 *   ADMIN_PASSWORD_MODERATOR  → MODERATOR
 */
import crypto from 'node:crypto';
import { isAdminAuthed, makeSessionToken } from '../lib/adminAuth.js';

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Password → role, strongest first. A blank env var is skipped so an
 * empty password can never match one.
 */
const ROLE_PASSWORDS = [
  ['SUPER_ADMIN', process.env.ADMIN_PASSWORD || ''],
  ['ADMIN', process.env.ADMIN_PASSWORD_ADMIN || ''],
  ['MODERATOR', process.env.ADMIN_PASSWORD_MODERATOR || ''],
].filter(([, pw]) => pw);

/** Constant-time compare so a password can't be probed character by character. */
const passwordMatches = (expected, given) => {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(given || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const roleForPassword = (given) => {
  for (const [role, pw] of ROLE_PASSWORDS) {
    if (passwordMatches(pw, given)) return role;
  }
  return null;
};

/**
 * Crude in-memory throttle against password guessing: a handful of tries
 * per IP per minute. It used to allow exactly one attempt per minute,
 * which locked a real admin out for a full minute over a single typo —
 * a few tries still stops guessing but doesn't punish fat fingers.
 *
 * A successful login clears the counter, and the map is per-instance, so
 * this is a speed bump rather than a real rate limiter.
 */
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;
const attempts = new Map();

const isThrottled = (key) => {
  const now = Date.now();
  for (const [k, rec] of attempts) if (now - rec.first > WINDOW_MS) attempts.delete(k);
  const rec = attempts.get(key);
  if (!rec) {
    attempts.set(key, { first: now, count: 1 });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
};
const clearThrottle = (key) => attempts.delete(key);

const COOKIE_FLAGS = 'HttpOnly; Secure; SameSite=Lax; Path=/';

export default async function handler(req, res) {
  // Lets the panel restore its session on refresh, and tells it which role
  // it's operating as, without exposing the cookie itself to JS.
  if (req.method === 'GET') {
    const role = isAdminAuthed(req);
    return res.status(200).json({ authed: Boolean(role), role: role || null });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (String(req.query.action || '') === 'logout') {
    res.setHeader('Set-Cookie', `admin_session=; ${COOKIE_FLAGS}; Max-Age=0`);
    return res.status(200).json({ ok: true });
  }

  if (!ROLE_PASSWORDS.length) {
    return res.status(500).json({ error: 'Server sozlanmagan (ADMIN_PASSWORD yo‘q)' });
  }

  const ip = req.headers['x-forwarded-for'] || 'unknown';
  if (isThrottled(ip)) {
    return res.status(429).json({ error: 'Biroz kuting va qayta urinib ko‘ring' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const role = roleForPassword(body.password);
  if (!role) return res.status(401).json({ error: 'Parol noto‘g‘ri' });

  // Correct password — this IP isn't guessing, so don't hold its budget
  // against the next legitimate sign-in.
  clearThrottle(ip);

  const expires = Date.now() + SESSION_MS;
  res.setHeader(
    'Set-Cookie',
    `admin_session=${makeSessionToken(role, expires)}; ${COOKIE_FLAGS}; Max-Age=${SESSION_MS / 1000}`,
  );
  return res.status(200).json({ ok: true, role });
}
