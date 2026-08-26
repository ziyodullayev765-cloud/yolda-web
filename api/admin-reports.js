/**
 * GET /api/admin-reports
 *
 * Returns every report (newest first) for the admin panel's Shikoyatlar
 * tab. Requires the signed cookie set by /api/admin-login.
 */
import { kvRange, kvGet } from '../lib/kv.js';
import { isAdminAuthed } from '../lib/adminAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAdminAuthed(req)) return res.status(401).json({ error: 'Kirish kerak' });

  const ids = await kvRange('report_ids', 0, 299);
  const reports = (
    await Promise.all(
      ids.map(async (id) => {
        const raw = await kvGet(`report:${id}`);
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean);

  return res.status(200).json({ reports });
}
