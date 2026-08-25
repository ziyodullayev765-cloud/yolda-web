/**
 * GET /api/admin-orders
 *
 * Returns the most recent orders for the admin panel. Requires the signed
 * cookie set by /api/admin-login.
 */
import crypto from 'node:crypto';
import { kvRange } from '../lib/kv.js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ADMIN_PASSWORD;

const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');

const isAuthed = (req) => {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/admin_session=([^;]+)/);
  if (!match) return false;

  const [expiresStr, sig] = decodeURIComponent(match[1]).split('.');
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;

  return sig === sign(expiresStr);
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthed(req)) return res.status(401).json({ error: 'Kirish kerak' });

  const raw = await kvRange('orders', 0, 199);
  const orders = raw
    .map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return res.status(200).json({ orders });
}
