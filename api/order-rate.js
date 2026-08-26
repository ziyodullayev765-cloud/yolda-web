/**
 * POST /api/order-rate
 *
 * Lets a cargo owner rate the driver once an order is DELIVERED, using the
 * same code+phone ownership check as /api/order-status. One rating per
 * order — the driver's aggregate is rolled up onto their profile, but only
 * if they linked a Telegram username to a Google account (there's no other
 * way to connect "who claimed this in the group" to a registered profile).
 */
import { kvGet, kvSet } from '../lib/kv.js';

const normalisePhone = (v) => {
  const d = String(v).replace(/\D/g, '');
  if (d.length === 9) return `+998${d}`;
  if (d.length === 12 && d.startsWith('998')) return `+${d}`;
  return '';
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const code = String(body.code || '').trim().toUpperCase();
  const phone = normalisePhone(body.phone || '');
  const stars = Number(body.stars);
  const comment = String(body.comment || '').trim().slice(0, 300);

  if (!code || !phone) return res.status(400).json({ error: 'Kod va telefon kerak' });
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'Baho 1 dan 5 gacha bo‘lsin' });
  }

  const raw = await kvGet(`order:${code}`);
  if (!raw) return res.status(404).json({ error: 'Topilmadi' });
  let order;
  try {
    order = JSON.parse(raw);
  } catch {
    return res.status(500).json({ error: 'Xato yuz berdi' });
  }

  if (order.phone !== phone) return res.status(404).json({ error: 'Topilmadi' });
  if (order.status !== 'DELIVERED') return res.status(400).json({ error: 'Buyurtma hali yetkazilmagan' });
  if (order.rating) return res.status(409).json({ error: 'Bu buyurtma allaqachon baholangan' });

  order.rating = { stars, comment, ratedAt: Date.now() };
  const saved = await kvSet(`order:${code}`, JSON.stringify(order));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });

  // Best-effort rollup onto the driver's profile — never blocks the rating
  // itself, which is already safely stored on the order above.
  if (order.driver && order.driver.telegramUsername) {
    try {
      const email = await kvGet(`tgToEmail:${order.driver.telegramUsername.toLowerCase()}`);
      if (email) {
        const praw = await kvGet(`profile:${email}`);
        const profile = praw ? JSON.parse(praw) : {};
        profile.ratingCount = (profile.ratingCount || 0) + 1;
        profile.ratingSum = (profile.ratingSum || 0) + stars;
        await kvSet(`profile:${email}`, JSON.stringify(profile));
      }
    } catch {
      // Non-fatal.
    }
  }

  return res.status(200).json({ ok: true });
}
