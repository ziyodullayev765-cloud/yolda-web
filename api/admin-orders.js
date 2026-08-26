/**
 * GET /api/admin-orders
 *
 * Returns the most recent orders (newest first) for the admin panel.
 * Requires the signed cookie set by /api/admin-login.
 */
import { kvRange, kvGet } from '../lib/kv.js';
import { isAdminAuthed } from '../lib/adminAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAdminAuthed(req)) return res.status(401).json({ error: 'Kirish kerak' });

  const codes = await kvRange('order_codes', 0, 299);
  const orders = (
    await Promise.all(
      codes.map(async (code) => {
        const raw = await kvGet(`order:${code}`);
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean);

  return res.status(200).json({ orders });
}
