/**
 * GET /api/admin-users
 *
 * Returns every registered profile for the admin panel. Requires the
 * signed cookie set by /api/admin-login.
 *
 * Looks up profiles by scanning `profile:*` directly rather than trusting
 * the `profile_emails` index alone — that index only started being written
 * once this endpoint existed, so a plain KEYS scan is what makes profiles
 * saved before it show up too. Fine at this app's scale; not a pattern to
 * reach for on a hot path with a large keyspace.
 */
import { kvGet, kvKeys, kvSadd } from '../lib/kv.js';
import { isAdminAuthed } from '../lib/adminAuth.js';

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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAdminAuthed(req)) return res.status(401).json({ error: 'Kirish kerak' });

  const keys = await kvKeys('profile:*');
  const emails = keys.map((k) => k.slice('profile:'.length));

  const users = await Promise.all(
    emails.map(async (email) => {
      // Self-heals the index for next time, in case it's ever used again.
      kvSadd('profile_emails', email).catch(() => {});
      const profile = parseProfile(await kvGet(`profile:${email}`));
      return { email, ...profile };
    }),
  );

  users.sort((a, b) => (a.username || a.email).localeCompare(b.username || b.email));

  return res.status(200).json({ users, count: users.length });
}
