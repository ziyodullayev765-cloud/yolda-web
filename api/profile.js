/**
 * POST /api/profile
 *
 * One endpoint doing double duty:
 *   - { googleIdToken | telegramInitData }                        → returns the caller's saved profile
 *   - { googleIdToken | telegramInitData, username/role/city/... } → updates whichever fields were sent
 *
 * Plus two actions for the Google<->Telegram account-linking flow
 * (requirement #6 — see lib/identity.js for why it's two steps):
 *   - ?action=link-telegram-start,  { googleIdToken }               → mint a 6-digit code
 *   - ?action=link-telegram-finish, { telegramInitData, code }      → redeem it, completing the link
 *
 * Auth accepts either credential — see lib/identity.js. A caller identified
 * only through Telegram (no linked Google account) is keyed by "tg:<id>"
 * instead of an email; every key below already treats that as an opaque
 * string, so nothing else in this file needs to change for that case.
 *
 * A username can belong to only one account at a time. Two keys in Redis
 * track that both ways:
 *   username:<lowercased>  -> owner's identity   (who currently holds it)
 *   profile:<identity>     -> JSON blob { username, displayName, role, city, bio, phone, ... }
 */
import { resolveEmail, createTelegramLinkCode, redeemTelegramLinkCode } from '../lib/identity.js';
import { kvConfigured, kvGet, kvSet, kvDel, kvSadd, kvSismember } from '../lib/kv.js';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const ROLES = ['DRIVER', 'OWNER', 'BOTH'];
const CITIES = [
  'Toshkent', 'Samarqand', 'Buxoro', 'Andijon', 'Namangan', 'Nukus', 'Qarshi', 'Urganch',
  'Farg\'ona', 'Jizzax', 'Navoiy', 'Guliston', 'Termiz',
];
const VEHICLE_TYPES = ['ISUZU', 'GAZEL', 'FURGON', 'YARIM_TREYLER', 'SAMOSVAL', 'BOSHQA'];

/** profile:<email> used to just be the plain username string — read old and new shapes. */
const parseProfile = (raw) => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // fall through
  }
  return { username: raw };
};

const normalisePhone = (v) => {
  const d = String(v).replace(/\D/g, '');
  if (d.length === 9) return `+998${d}`;
  if (d.length === 12 && d.startsWith('998')) return `+${d}`;
  return '';
};

/** POST ?action=link-telegram-start — step 1, see the file header comment. */
const linkTelegramStart = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const result = await createTelegramLinkCode(body.googleIdToken);
  if (result.error) return res.status(400).json({ error: result.error });
  return res.status(200).json({ ok: true, code: result.code, expiresInSeconds: result.expiresInSeconds });
};

/** POST ?action=link-telegram-finish — step 2, see the file header comment. */
const linkTelegramFinish = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const result = await redeemTelegramLinkCode({ code: body.code, telegramInitData: body.telegramInitData });
  if (result.error) return res.status(400).json({ error: result.error });
  return res.status(200).json({ ok: true });
};

const handleProfile = async (req, res) => {
  if (!kvConfigured) {
    return res.status(500).json({ error: 'Bazacha ulanmagan (KV_REST_API_URL/TOKEN yo‘q) — administratorga xabar bering' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = await resolveEmail({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData });
  if (!email) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const profileKey = `profile:${email}`;
  const existing = parseProfile(await kvGet(profileKey));

  const touchesAnyField = ['username', 'displayName', 'role', 'city', 'bio', 'phone', 'vehicleType', 'plateNumber', 'telegramUsername']
    .some((k) => body[k] !== undefined);
  if (!touchesAnyField) {
    return res.status(200).json({ ok: true, profile: existing });
  }
  if (await kvSismember('banned', email.toLowerCase())) {
    return res.status(403).json({ error: 'Sizga xizmatdan foydalanish cheklangan' });
  }

  const next = { ...existing };

  if (body.username !== undefined && body.username !== null && body.username !== '') {
    const username = String(body.username).trim();
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({
        error: 'Username 3-20 belgidan, faqat lotin harflari, raqam va pastki chiziq (_) bo‘lishi kerak',
      });
    }
    const usernameKey = `username:${username.toLowerCase()}`;
    const owner = await kvGet(usernameKey);
    if (owner && owner !== email) {
      return res.status(409).json({ error: 'Bu username band, boshqasini tanlang' });
    }
    if (existing.username && existing.username.toLowerCase() !== username.toLowerCase()) {
      await kvDel(`username:${existing.username.toLowerCase()}`);
    }
    const claimed = await kvSet(usernameKey, email);
    if (!claimed) {
      return res.status(502).json({ error: 'Username saqlab bo‘lmadi, qayta urinib ko‘ring' });
    }
    next.username = username;
  }

  // An empty field means "the user didn't touch this one" — it must never
  // wipe a value that was saved earlier. Only a non-empty value updates it.
  // displayName overrides the name shown app-wide (profile header, chat, ...)
  // in place of whatever Google/Telegram reported — useful for a Telegram
  // account with no real name set, or anyone who'd rather show something else.
  if (body.displayName !== undefined && body.displayName !== null && body.displayName !== '') {
    next.displayName = String(body.displayName).trim().slice(0, 60);
  }

  if (body.role !== undefined && body.role !== null && body.role !== '') {
    const role = String(body.role);
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Noto‘g‘ri rol' });
    next.role = role;
  }

  if (body.city !== undefined && body.city !== null && body.city !== '') {
    const city = String(body.city);
    if (!CITIES.includes(city)) return res.status(400).json({ error: 'Noto‘g‘ri shahar' });
    next.city = city;
  }

  if (body.bio !== undefined && body.bio !== null && body.bio !== '') {
    next.bio = String(body.bio).trim().slice(0, 200);
  }

  if (body.phone !== undefined && body.phone !== null && body.phone !== '') {
    const phone = normalisePhone(body.phone);
    if (!phone) return res.status(400).json({ error: 'Telefon raqam noto‘g‘ri' });
    next.phone = phone;
  }

  // Driver-only fields — only meaningful once a role is DRIVER or BOTH, but
  // saved as sent so switching role back and forth doesn't lose them.
  if (body.vehicleType !== undefined && body.vehicleType !== null && body.vehicleType !== '') {
    const vehicleType = String(body.vehicleType);
    if (!VEHICLE_TYPES.includes(vehicleType)) return res.status(400).json({ error: 'Noto‘g‘ri mashina turi' });
    next.vehicleType = vehicleType;
  }

  if (body.plateNumber !== undefined && body.plateNumber !== null && body.plateNumber !== '') {
    next.plateNumber = String(body.plateNumber).trim().toUpperCase().slice(0, 12);
  }

  // Links this account to a Telegram @username so /api/telegram can show a
  // "✓ Tasdiqlangan" tag when this driver claims a load, and so a rating
  // left after delivery can be attributed back to this profile.
  if (body.telegramUsername !== undefined && body.telegramUsername !== null && body.telegramUsername !== '') {
    const tg = String(body.telegramUsername).trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-zA-Z0-9_]{5,32}$/.test(tg)) {
      return res.status(400).json({ error: 'Telegram username noto‘g‘ri (masalan: username)' });
    }
    next.telegramUsername = tg;
    await kvSet(`tgToEmail:${tg}`, email);
  }

  const saved = await kvSet(profileKey, JSON.stringify(next));
  if (!saved) {
    return res.status(502).json({ error: 'Saqlab bo‘lmadi (bazachaga yozib bo‘lmadi), qayta urinib ko‘ring' });
  }
  // Registers this identity in the admin panel's user index. Safe to
  // repeat — SADD is a no-op if it's already a member.
  await kvSadd('profile_emails', email);
  return res.status(200).json({ ok: true, profile: next });
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const action = String(req.query.action || '');
  if (action === 'link-telegram-start') return linkTelegramStart(req, res);
  if (action === 'link-telegram-finish') return linkTelegramFinish(req, res);
  return handleProfile(req, res);
}
