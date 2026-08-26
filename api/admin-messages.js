/**
 * GET /api/admin-messages
 *
 * Returns the most recent support messages submitted from the Aloqa tab's
 * "Muammo bormi? Yozing" form. Requires the signed cookie set by
 * /api/admin-login.
 */
import { kvRange } from '../lib/kv.js';
import { isAdminAuthed } from '../lib/adminAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAdminAuthed(req)) return res.status(401).json({ error: 'Kirish kerak' });

  const raw = await kvRange('support_messages', 0, 199);
  const messages = raw
    .map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return res.status(200).json({ messages });
}
