/**
 * GET /api/admin-users
 *
 * Returns every registered profile for the admin panel. Requires the
 * signed cookie set by /api/admin-login.
 */
import { kvGet, kvSmembers } from '../lib/kv.js';
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

  const emails = await kvSmembers('profile_emails');

  const users = await Promise.all(
    emails.map(async (email) => {
      const profile = parseProfile(await kvGet(`profile:${email}`));
      return { email, ...profile };
    }),
  );

  // Newest-looking first is nice, but there's no timestamp on profiles —
  // alphabetical by username (falling back to email) keeps the list stable.
  users.sort((a, b) => (a.username || a.email).localeCompare(b.username || b.email));

  return res.status(200).json({ users, count: users.length });
}
