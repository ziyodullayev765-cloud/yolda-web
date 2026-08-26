/**
 * POST /api/profile
 *
 * One endpoint doing double duty:
 *   - { googleIdToken }                        → returns the caller's saved profile
 *   - { googleIdToken, username/role/city/... } → updates whichever fields were sent
 *
 * A username can belong to only one Google account at a time. Two keys in
 * Redis track that both ways:
 *   username:<lowercased>  -> owner's email   (who currently holds it)
 *   profile:<email>        -> JSON blob { username, role, city, bio, phone }
 */
import { verifyGoogleEmail } from '../lib/google.js';
import { kvGet, kvSet, kvDel } from '../lib/kv.js';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const ROLES = ['DRIVER', 'OWNER', 'BOTH'];
const CITIES = [
  'Toshkent', 'Samarqand', 'Buxoro', 'Andijon', 'Namangan', 'Nukus', 'Qarshi', 'Urganch',
  'Farg\'ona', 'Jizzax', 'Navoiy', 'Guliston', 'Termiz',
];

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = await verifyGoogleEmail(body.googleIdToken);
  if (!email) return res.status(401).json({ error: 'Avval Google orqali kiring' });

  const profileKey = `profile:${email}`;
  const existing = parseProfile(await kvGet(profileKey));

  const touchesAnyField = ['username', 'role', 'city', 'bio', 'phone'].some((k) => body[k] !== undefined);
  if (!touchesAnyField) {
    return res.status(200).json({ ok: true, profile: existing });
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
    await kvSet(usernameKey, email);
    next.username = username;
  }

  // An empty field means "the user didn't touch this one" — it must never
  // wipe a value that was saved earlier. Only a non-empty value updates it.
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

  await kvSet(profileKey, JSON.stringify(next));
  return res.status(200).json({ ok: true, profile: next });
}
