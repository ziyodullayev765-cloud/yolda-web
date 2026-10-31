/**
 * POST /api/admin-login   { password }               → parol bilan
 * POST /api/admin-login   { googleIdToken | telegramInitData | phoneToken }
 *                                                    → ilova hisobi bilan
 * POST /api/admin-login?action=logout                → chiqish
 * GET  /api/admin-login                              → { authed, role }
 *
 * KIRISHNING IKKI YO'LI.
 *
 * 1. PAROL. Qaysi parol ishlatilgani rolni belgilaydi. Hisob yo'q.
 *      ADMIN_PASSWORD            → SUPER_ADMIN
 *      ADMIN_PASSWORD_ADMIN      → ADMIN
 *      ADMIN_PASSWORD_MODERATOR  → MODERATOR
 *      ADMIN_PASSWORD_ACCOUNTANT → ACCOUNTANT (Hisobchi)
 *
 * 2. ILOVA HISOBI. Odam ilovaga qanday kirgan bo'lsa (Google,
 *    Telegram yoki telefon), o'sha ma'lumot shu yerga yuboriladi va
 *    SERVERDA qayta tekshiriladi — ilovaning o'zidagi bilan bir xil
 *    yo'l bilan. Keyin xodimlar ro'yxatiga qaraladi: odam o'sha
 *    yerda bo'lsa, yozilgan roli bilan kiradi.
 *
 *    YA'NI "ADMIN QILISH" ENDI HAQIQATAN KIRISH HUQUQI BERADI.
 *    Ro'yxatdan chiqarilsa — shu zahoti kira olmay qoladi
 *    (lib/adminAuth.js: har so'rovda ro'yxat qayta o'qiladi).
 *
 * Cookie'ning o'z imzosi uni soxtalashtirishdan saqlaydi —
 * lib/adminAuth.js ga qarang.
 */
import crypto from 'node:crypto';
import {
  makeSessionToken, resolveAdmin, sessionsConfigured, ROLES,
} from '../lib/adminAuth.js';
import { resolveIdentity } from '../lib/identity.js';
import { staffRole } from '../lib/staff.js';

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Password → role, strongest first. A blank env var is skipped so an
 * empty password can never match one.
 */
const ROLE_PASSWORDS = [
  ['SUPER_ADMIN', process.env.ADMIN_PASSWORD || ''],
  ['ADMIN', process.env.ADMIN_PASSWORD_ADMIN || ''],
  ['MODERATOR', process.env.ADMIN_PASSWORD_MODERATOR || ''],
  ['ACCOUNTANT', process.env.ADMIN_PASSWORD_ACCOUNTANT || ''],
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
    /* `resolveAdmin`, `readAdminSession` emas: ilova hisobi bilan
       kirgan odam xodimlar ro'yxatidan chiqarilgan bo'lsa, panel
       "kirgansiz" deb ko'rsatmasligi kerak. Ma'lumot baribir
       berilmaydi (har bir resource o'zi tekshiradi), lekin yarim
       ochiq panel odamni chalg'itadi: tugmalar ko'rinadi, bosilsa
       hammasi 401 qaytaradi. */
    const session = await resolveAdmin(req);
    const role = session && session.role;
    return res.status(200).json({
      authed: Boolean(role),
      role: role || null,
      /* Panel kim bo'lib turganini ko'rsatsin. Parol bilan
         kirilgan bo'lsa — bo'sh. */
      identity: (session && session.identity) || null,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (String(req.query.action || '') === 'logout') {
    res.setHeader('Set-Cookie', `admin_session=; ${COOKIE_FLAGS}; Max-Age=0`);
    return res.status(200).json({ ok: true });
  }

  const ip = req.headers['x-forwarded-for'] || 'unknown';
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});

  /* ---------- 2. Ilova hisobi bilan ---------- */
  const hasAccount = body.googleIdToken || body.telegramInitData || body.phoneToken;
  if (hasAccount) {
    if (isThrottled(ip)) {
      return res.status(429).json({ error: 'Biroz kuting va qayta urinib ko‘ring' });
    }
    /* Ma'lumot SERVERDA tekshiriladi: Google tokeni Google'dan,
       Telegram ma'lumoti imzosidan, telefon tokeni bizning
       imzomizdan. Mijozga ishonilmaydi. */
    const who = await resolveIdentity({
      googleIdToken: body.googleIdToken,
      telegramInitData: body.telegramInitData,
      phoneToken: body.phoneToken,
    });
    if (!who || !who.identity) {
      return res.status(401).json({ error: 'Hisob tasdiqlanmadi. Ilovaga qaytadan kiring.' });
    }

    const accRole = await staffRole(who.identity).catch(() => null);
    if (!accRole || !ROLES.includes(accRole)) {
      /* Ataylab bir xil javob: begona odam o'zining ro'yxatda
         yo'qligini bilsa ham, boshqa narsa bilmaydi. */
      return res.status(403).json({ error: 'Bu hisob xodimlar ro‘yxatida yo‘q' });
    }

    clearThrottle(ip);
    const accExpires = Date.now() + SESSION_MS;
    const accToken = makeSessionToken(accRole, accExpires, who.identity);
    if (!accToken) return res.status(500).json({ error: 'Server sozlanmagan (imzo kaliti yo‘q)' });
    res.setHeader(
      'Set-Cookie',
      `admin_session=${accToken}; ${COOKIE_FLAGS}; Max-Age=${SESSION_MS / 1000}`,
    );
    return res.status(200).json({ ok: true, role: accRole, identity: who.identity });
  }

  /* ---------- 1. Parol bilan ---------- */
  if (!sessionsConfigured()) {
    return res.status(500).json({ error: 'Server sozlanmagan (imzo kaliti yo‘q)' });
  }
  if (!ROLE_PASSWORDS.length) {
    return res.status(500).json({ error: 'Server sozlanmagan (ADMIN_PASSWORD yo‘q)' });
  }

  if (isThrottled(ip)) {
    return res.status(429).json({ error: 'Biroz kuting va qayta urinib ko‘ring' });
  }

  const role = roleForPassword(body.password);
  if (!role) return res.status(401).json({ error: 'Parol noto‘g‘ri' });

  // Correct password — this IP isn't guessing, so don't hold its budget
  // against the next legitimate sign-in.
  clearThrottle(ip);

  const expires = Date.now() + SESSION_MS;
  const token = makeSessionToken(role, expires);
  if (!token) return res.status(500).json({ error: 'Server sozlanmagan (imzo kaliti yo‘q)' });
  res.setHeader(
    'Set-Cookie',
    `admin_session=${token}; ${COOKIE_FLAGS}; Max-Age=${SESSION_MS / 1000}`,
  );
  return res.status(200).json({ ok: true, role });
}
