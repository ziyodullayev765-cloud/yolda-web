/**
 * Admin authentication + role check for the signed cookie /api/admin-login
 * sets. Any admin endpoint (orders, users, ...) calls this instead of
 * re-implementing it.
 *
 * KIRISHNING IKKI YO'LI BOR.
 *
 *   1. Parol bilan. Qaysi parol ishlatilgani rolni belgilaydi
 *      (ADMIN_PASSWORD... server sozlamalari). Hisob yo'q.
 *   2. Ilova hisobi bilan. Odam Google/Telegram/telefon orqali
 *      kirgan bo'lsa va xodimlar ro'yxatida tursa, o'sha yerda
 *      yozilgan rol bilan kiradi.
 *
 * Cookie'ning o'z imzosi uni soxtalashtirishdan saqlaydi: rol
 * imzolangan matn ichida, ya'ni moderator o'z cookie'sini super
 * adminga aylantira olmaydi.
 *
 * Cookie ko'rinishi:
 *   "<expiresMs>.<role>.<hmac>"              — parol bilan kirgan
 *   "<expiresMs>.<role>.<kim>.<hmac>"        — ilova hisobi bilan
 *   "<expiresMs>.<hmac>"                     — eski, rollar yo'q edi
 *
 * `<kim>` — base64url: identifikatorda nuqta bo'lishi mumkin
 * (aziz@example.com), nuqta esa bo'laklarni ajratadi.
 *
 * ENG MUHIMI — RO'YXATDAN CHIQARILSA, DARHOL AMAL QILADI. Ilova
 * hisobi bilan kirilgan har bir so'rovda xodimlar ro'yxati qayta
 * o'qiladi: odam ro'yxatdan chiqarilsa yoki roli pasaytirilsa,
 * cookie muddati tugashini kutmaydi. Parol bilan kirgan sessiya
 * bunga tegishli emas — u hisobga bog'lanmagan.
 */
import crypto from 'node:crypto';
import { staffRole } from './staff.js';

/* ============================================================
   IMZO KALITI — BO'SH BO'LSA, SESSIYA UMUMAN BO'LMAYDI.
   ------------------------------------------------------------
   Cookie'ni soxtalashtirishdan saqlaydigan yagona narsa — shu
   kalit. Ilgari u `TELEGRAM_WEBHOOK_SECRET || ADMIN_PASSWORD`
   edi va ikkalasi ham yo'q bo'lsa BO'SH SATR bo'lib qolardi:
   bo'sh kalit bilan qo'yilgan imzoni har kim hisoblab, o'ziga
   `SUPER_ADMIN` cookie yozib olishi mumkin edi.

   Endi kalit yo'q bo'lsa `makeSessionToken` null qaytaradi va
   `readAdminSession` har qanday cookie'ni rad etadi. Ya'ni
   panelga hech kim kirmaydi — bu to'g'ri xatti-harakat: sozlanmagan
   serverda panel yopiq turishi kerak, ochiq emas.

   Kalit uchun `AUTH_SECRET` birinchi o'rinda: u faqat imzolash
   uchun va hech qanday parol emas. Bo'lmasa — eskisi bilan
   ishlaydi, aks holda hozirgi sessiyalar uzilib ketardi.
   ============================================================ */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.ADMIN_SESSION_SECRET
  || process.env.TELEGRAM_WEBHOOK_SECRET
  || ADMIN_PASSWORD
  || '';

export const sessionsConfigured = () => Boolean(SECRET);

export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'ACCOUNTANT'];

/**
 * What each role may do. Enforced server-side on every endpoint — hiding a
 * button in the UI is a convenience, never the permission itself.
 */
const PERMISSIONS = {
  SUPER_ADMIN: ['*'],
  ADMIN: [
    'orders:read', 'users:read', 'users:write', 'reports:read', 'reports:write',
    /* Pasport/guvohnoma rasmini ochish. Alohida turadi, chunki u
       `users:read` dan ancha maxfiyroq — api/admin-data.js dagi
       `verifydoc` izohiga qarang. Hujjatni ko'rib chiqa oladigan
       rol (`users:write`) ko'rsin, boshqasi yo'q. */
    'users:verify',
    'trucks:read', 'trucks:write', 'messages:read', 'messages:write', 'analytics:read',
    'settings:read', 'settings:write',
    // YO'LDA LIFE mazmuni — tahririyat ishi, moderator faqat ko'radi.
    'life:read', 'life:write',
    // Ikonkalar — ilovaning ko'rinishi. Moderator ko'radi, lekin
    // almashtira olmaydi: bu butun sayt uchun o'zgarish.
    'icons:read', 'icons:write',
    // Hisob-kitob bo'limi — hozircha faqat ko'rish (to'lov tizimi yo'q).
    'payments:read',
  ],
  MODERATOR: [
    'orders:read', 'users:read', 'reports:read', 'reports:write',
    'trucks:read', 'trucks:write', 'messages:read', 'life:read',
    'icons:read',
  ],
  /* Hisobchi — pul tomoni. Moderatsiya ishlariga (shikoyat, e'lon
     tasdiqlash) aralashmaydi, lekin buyurtmalar va hisobotlarni
     ko'radi. */
  ACCOUNTANT: [
    'orders:read', 'users:read', 'analytics:read', 'settings:read',
    'payments:read',
  ],
};

/* Xodimlar ro'yxatini (lib/staff.js) faqat super admin boshqaradi:
   kimning profilida "Administrator" deb yozilishi — eng katta
   ruxsat. Shu sababli `staff:read`/`staff:write` hech bir ro'yxatda
   yo'q, ular faqat SUPER_ADMIN ning `*` i orqali keladi. */

const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');

/** Timing-safe compare so a signature can't be probed byte by byte. */
const signatureMatches = (expected, given) => {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(given || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const encodeWho = (identity) => Buffer.from(String(identity), 'utf8').toString('base64url');
const decodeWho = (b64) => {
  try { return Buffer.from(String(b64), 'base64url').toString('utf8'); } catch { return ''; }
};

/**
 * Builds the cookie value for a freshly authenticated admin.
 * `identity` only for an app-account login; a password login has none.
 */
export const makeSessionToken = (role, expiresMs, identity) => {
  if (!SECRET) return null;
  const payload = identity
    ? `${expiresMs}.${role}.${encodeWho(identity)}`
    : `${expiresMs}.${role}`;
  return `${payload}.${sign(payload)}`;
};

/**
 * Returns the admin's role when the cookie is valid and unexpired, else
 * null. Truthy/falsy either way, so older `if (!isAdminAuthed(req))` call
 * sites keep working unchanged.
 */
export const readAdminSession = (req) => {
  /* Kalit yo'q — imzoni tekshirib bo'lmaydi, demak hech qanday
     cookie'ga ishonilmaydi. Yuqoridagi izohga qarang. */
  if (!SECRET) return null;
  const cookieHeader = (req.headers || {}).cookie || '';
  const match = cookieHeader.match(/admin_session=([^;]+)/);
  if (!match) return null;

  /* Buzuq %-kodlash `decodeURIComponent` dan URIError tashlaydi.
     Ilgari u ushlanmasdi va javob 401 o'rniga 500 bo'lardi —
     ya'ni noto'g'ri cookie "server xatosi" bo'lib ko'rinardi. */
  let value;
  try {
    value = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  const parts = value.split('.');
  if (parts.length < 2 || parts.length > 4) return null;

  let expiresStr; let role; let who = ''; let sig; let payload;
  if (parts.length === 2) {
    // Eski cookie — rollar qo'shilishidan oldin berilgan.
    [expiresStr, sig] = parts;
    role = 'SUPER_ADMIN';
    payload = expiresStr;
  } else if (parts.length === 3) {
    [expiresStr, role, sig] = parts;
    payload = `${expiresStr}.${role}`;
  } else {
    let whoB64;
    [expiresStr, role, whoB64, sig] = parts;
    who = decodeWho(whoB64);
    payload = `${expiresStr}.${role}.${whoB64}`;
    if (!who) return null;
  }

  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;
  if (!ROLES.includes(role)) return null;
  if (!signatureMatches(sign(payload), sig)) return null;

  return { role, identity: who };
};

/**
 * Returns the admin's role when the cookie is valid and unexpired, else
 * null. Truthy/falsy either way, so older `if (!isAdminAuthed(req))` call
 * sites keep working unchanged.
 *
 * DIQQAT: bu faqat cookie'ni tekshiradi. Ilova hisobi bilan kirgan
 * odam ro'yxatdan chiqarilganini ham bilish uchun `resolveAdmin`
 * ishlatiladi (u bazaga qaraydi, shuning uchun async).
 */
export const isAdminAuthed = (req) => {
  const session = readAdminSession(req);
  return session ? session.role : null;
};

/**
 * Cookie + xodimlar ro'yxati. Ilova hisobi bilan kirilgan bo'lsa,
 * rol HAR SAFAR ro'yxatdan qayta o'qiladi: chiqarilgan odam
 * shu zahoti kira olmay qoladi.
 */
export const resolveAdmin = async (req) => {
  const session = readAdminSession(req);
  if (!session) return null;
  if (!session.identity) return session;          // parol bilan kirgan

  const live = await staffRole(session.identity).catch(() => null);
  if (!live || !ROLES.includes(live)) return null;
  return { role: live, identity: session.identity };
};

/** True if `role` may perform `permission` (e.g. "users:write"). */
export const roleCan = (role, permission) => {
  const granted = PERMISSIONS[role];
  if (!granted) return false;
  return granted.includes('*') || granted.includes(permission);
};

/**
 * Guard for an admin endpoint: returns the role, or writes the 401/403
 * itself and returns null so the caller can just `if (!role) return;`.
 */
export const requireAdmin = async (req, res, permission) => {
  const session = await resolveAdmin(req);
  const role = session && session.role;
  if (!role) {
    res.status(401).json({ error: 'Kirish kerak' });
    return null;
  }
  if (permission && !roleCan(role, permission)) {
    res.status(403).json({ error: 'Bu amal uchun ruxsatingiz yo‘q' });
    return null;
  }
  return role;
};
