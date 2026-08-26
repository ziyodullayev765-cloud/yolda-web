/**
 * POST /api/report
 *
 * Structured "report a scam / fake load / fake driver / ..." submission,
 * separate from the freeform support message. Requires Google sign-in so
 * reports are accountable — a ban decision downstream is based on this.
 *
 * Stored as its own key (`report:<id>`) rather than a plain list entry so
 * the admin panel can update a single report's status later without having
 * to rewrite the whole list. `report_ids` is just the ordering index.
 */
import { kvSet, kvPush, kvSismember } from '../lib/kv.js';
import { verifyGoogleEmail } from '../lib/google.js';

const REASONS = ['SCAM', 'FAKE_LOAD', 'FAKE_DRIVER', 'PAYMENT', 'BEHAVIOR', 'DELIVERY', 'OTHER'];

const recent = new Map();
const isThrottled = (key) => {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > 60_000) recent.delete(k);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
};

const generateId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});

  const email = await verifyGoogleEmail(body.googleIdToken);
  if (!email) return res.status(401).json({ error: 'Shikoyat yuborish uchun Google orqali kiring' });

  if (await kvSismember('banned', email.toLowerCase())) {
    return res.status(403).json({ error: 'Sizga xizmatdan foydalanish cheklangan' });
  }

  const reason = String(body.reason || '');
  if (!REASONS.includes(reason)) return res.status(400).json({ error: 'Sababni tanlang' });

  const targetContact = String(body.targetContact || '').trim().slice(0, 80);
  const description = String(body.description || '').trim().slice(0, 500);
  if (!description) return res.status(400).json({ error: 'Nima bo‘lganini tasvirlab bering' });

  if (isThrottled(email)) {
    return res.status(429).json({ error: 'Biroz kuting va qayta urinib ko‘ring' });
  }

  const id = generateId();
  const report = {
    id, reporterEmail: email, reason, targetContact, description,
    status: 'NEW', createdAt: Date.now(),
  };

  const saved = await kvSet(`report:${id}`, JSON.stringify(report));
  if (!saved) return res.status(500).json({ error: 'Yuborilmadi, qayta urinib ko‘ring' });
  await kvPush('report_ids', id);

  return res.status(200).json({ ok: true });
}
