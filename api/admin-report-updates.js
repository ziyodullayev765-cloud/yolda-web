/**
 * POST /api/admin-report-update
 *
 * Moves a report through the admin workflow: NEW → INVESTIGATING →
 * CONTACTED → RESOLVED, or BANNED. Requires the signed cookie set by
 * /api/admin-login.
 *
 * Setting status to BANNED also adds the report's targetContact to the
 * `banned` set, which /api/order and /api/profile check going forward.
 * This only blocks *future* order submissions / profile saves made with
 * that exact phone number or email — there's no driver login system to
 * revoke here, so it isn't a full account suspension.
 */
import { kvGet, kvSet, kvSadd } from '../lib/kv.js';
import { isAdminAuthed } from '../lib/adminAuth.js';

const STATUSES = ['NEW', 'INVESTIGATING', 'CONTACTED', 'RESOLVED', 'BANNED'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAdminAuthed(req)) return res.status(401).json({ error: 'Kirish kerak' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const id = String(body.id || '');
  const status = String(body.status || '');
  if (!id || !STATUSES.includes(status)) return res.status(400).json({ error: 'Noto‘g‘ri so‘rov' });

  const raw = await kvGet(`report:${id}`);
  if (!raw) return res.status(404).json({ error: 'Topilmadi' });

  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    return res.status(500).json({ error: 'Yozuv buzilgan' });
  }

  report.status = status;
  report.updatedAt = Date.now();

  const saved = await kvSet(`report:${id}`, JSON.stringify(report));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });

  if (status === 'BANNED' && report.targetContact) {
    await kvSadd('banned', report.targetContact.trim().toLowerCase());
  }

  return res.status(200).json({ ok: true, report });
}
