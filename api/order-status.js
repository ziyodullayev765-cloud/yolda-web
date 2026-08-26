/**
 * GET /api/order-status?code=YL-XXXXX&phone=901234567
 *
 * Lets a cargo owner check their own order's status by code + the phone
 * number it was submitted with — a lightweight ownership check since there
 * is no account system tying orders to a login.
 */
import { kvGet } from '../lib/kv.js';
import { STATUS_LABELS } from '../lib/orderMessage.js';

const normalisePhone = (v) => {
  const d = String(v).replace(/\D/g, '');
  if (d.length === 9) return `+998${d}`;
  if (d.length === 12 && d.startsWith('998')) return `+${d}`;
  return '';
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const code = String(req.query.code || '').trim().toUpperCase();
  const phone = normalisePhone(req.query.phone || '');
  if (!code || !phone) return res.status(400).json({ error: 'Kod va telefon kerak' });

  const raw = await kvGet(`order:${code}`);
  if (!raw) return res.status(404).json({ error: 'Topilmadi. Kod yoki telefon raqamini tekshiring' });

  let order;
  try {
    order = JSON.parse(raw);
  } catch {
    return res.status(500).json({ error: 'Xato yuz berdi' });
  }

  if (order.phone !== phone) {
    return res.status(404).json({ error: 'Topilmadi. Kod yoki telefon raqamini tekshiring' });
  }

  const status = order.status || 'NEW';
  return res.status(200).json({
    ok: true,
    code: order.code,
    fromCity: order.fromCity,
    toCity: order.toCity,
    status,
    statusLabel: STATUS_LABELS[status] || status,
    amount: order.amount,
    driverName: order.driver ? order.driver.name : null,
    driverVerified: order.driver ? Boolean(order.driver.verified) : false,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt || order.createdAt,
    canRate: status === 'DELIVERED' && !order.rating,
    rating: order.rating || null,
  });
}
