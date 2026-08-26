/**
 * POST /api/support
 *
 * Receives a message from the "Muammo bormi? Yozing" form on the Aloqa tab
 * and logs it for the admin panel. No Google sign-in required here on
 * purpose — someone stuck (e.g. can't sign in at all) still needs a way to
 * reach us.
 */
import { kvPush } from '../lib/kv.js';

/**
 * Crude in-memory throttle. Serverless instances are ephemeral, so this only
 * blunts a burst from one warm instance.
 */
const recent = new Map();
const isThrottled = (key) => {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > 60_000) recent.delete(k);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});

  const name = String(body.name || '').trim().slice(0, 80);
  const contact = String(body.contact || '').trim().slice(0, 80);
  const message = String(body.message || '').trim().slice(0, 500);

  if (!message) return res.status(400).json({ error: 'Xabar matnini yozing' });

  const ip = req.headers['x-forwarded-for'] || 'unknown';
  if (isThrottled(ip)) {
    return res.status(429).json({ error: 'Biroz kuting va qayta urinib ko‘ring' });
  }

  const ok = await kvPush('support_messages', JSON.stringify({ name, contact, message, createdAt: Date.now() }));
  if (!ok) return res.status(500).json({ error: 'Yuborilmadi, birozdan keyin urinib ko‘ring' });

  return res.status(200).json({ ok: true });
}
