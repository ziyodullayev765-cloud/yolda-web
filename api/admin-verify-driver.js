/**
 * POST /api/admin-verify-driver
 *
 * Toggles a driver's "✓ Tasdiqlangan" (verified) badge. Requires the
 * signed cookie set by /api/admin-login. `verified` is intentionally not a
 * field /api/profile will accept from the user themselves — this is the
 * only place it can be set.
 */
import { kvGet, kvSet } from '../lib/kv.js';
import { isAdminAuthed } from '../lib/adminAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAdminAuthed(req)) return res.status(401).json({ error: 'Kirish kerak' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = String(body.email || '').trim();
  const verified = Boolean(body.verified);
  if (!email) return res.status(400).json({ error: 'Email kerak' });

  const raw = await kvGet(`profile:${email}`);
  if (!raw) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  let profile;
  try {
    profile = JSON.parse(raw);
  } catch {
    return res.status(500).json({ error: 'Yozuv buzilgan' });
  }

  profile.verified = verified;
  const saved = await kvSet(`profile:${email}`, JSON.stringify(profile));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi' });

  return res.status(200).json({ ok: true, profile });
}
