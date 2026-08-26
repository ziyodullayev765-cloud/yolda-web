/**
 * /api/admin-data — one function serving every admin-panel data endpoint.
 *
 * Vercel's Hobby plan caps a deployment at 12 serverless functions; this app
 * had grown to 15 one-route-per-file endpoints and started failing to
 * deploy. Folding the six admin-only endpoints (orders/users/messages/
 * reports list, report-update, verify-driver) into one file dispatched by
 * a query param buys back headroom without changing any behavior.
 *
 *   GET  /api/admin-data?resource=orders
 *   GET  /api/admin-data?resource=users
 *   GET  /api/admin-data?resource=messages
 *   GET  /api/admin-data?resource=reports
 *   POST /api/admin-data?action=update-report   { id, status }
 *   POST /api/admin-data?action=verify-driver   { email, verified }
 *
 * All of these require the signed cookie set by /api/admin-login.
 */
import { kvGet, kvSet, kvSadd, kvKeys, kvRange } from '../lib/kv.js';
import { isAdminAuthed } from '../lib/adminAuth.js';

const REPORT_STATUSES = ['NEW', 'INVESTIGATING', 'CONTACTED', 'RESOLVED', 'BANNED'];

/** profile:<email> used to just be the plain username string — read old and new shapes. */
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

const getOrders = async (res) => {
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
};

const getUsers = async (res) => {
  // Scans profile:* directly rather than trusting the profile_emails index
  // alone — that index only started being written once this endpoint
  // existed, so this is what makes profiles saved before it show up too.
  const keys = await kvKeys('profile:*');
  const emails = keys.map((k) => k.slice('profile:'.length));

  const users = await Promise.all(
    emails.map(async (email) => {
      kvSadd('profile_emails', email).catch(() => {});
      const profile = parseProfile(await kvGet(`profile:${email}`));
      return { email, ...profile };
    }),
  );
  users.sort((a, b) => (a.username || a.email).localeCompare(b.username || b.email));
  return res.status(200).json({ users, count: users.length });
};

const getMessages = async (res) => {
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
};

const getReports = async (res) => {
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
};

const updateReport = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const id = String(body.id || '');
  const status = String(body.status || '');
  if (!id || !REPORT_STATUSES.includes(status)) return res.status(400).json({ error: 'Noto‘g‘ri so‘rov' });

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

  // /api/order and /api/profile check the `banned` set going forward. This
  // only blocks *future* order submissions / profile saves made with that
  // exact phone number or email — there's no driver login system to revoke.
  if (status === 'BANNED' && report.targetContact) {
    await kvSadd('banned', report.targetContact.trim().toLowerCase());
  }

  return res.status(200).json({ ok: true, report });
};

const verifyDriver = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = String(body.email || '').trim();
  const verified = Boolean(body.verified);
  if (!email) return res.status(400).json({ error: 'Email kerak' });

  const raw = await kvGet(`profile:${email}`);
  if (!raw) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  let profile;
  try {
    profile = JSON.parse(raw);
  } catch {
    return res.status(500).json({ error: 'Yozuv buzilgan' });
  }

  profile.verified = verified;
  const saved = await kvSet(`profile:${email}`, JSON.stringify(profile));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi' });

  return res.status(200).json({ ok: true, profile });
};

export default async function handler(req, res) {
  if (!isAdminAuthed(req)) return res.status(401).json({ error: 'Kirish kerak' });

  if (req.method === 'GET') {
    const resource = String(req.query.resource || '');
    if (resource === 'orders') return getOrders(res);
    if (resource === 'users') return getUsers(res);
    if (resource === 'messages') return getMessages(res);
    if (resource === 'reports') return getReports(res);
    return res.status(400).json({ error: 'Noto‘g‘ri resource' });
  }

  if (req.method === 'POST') {
    const action = String(req.query.action || '');
    if (action === 'update-report') return updateReport(req, res);
    if (action === 'verify-driver') return verifyDriver(req, res);
    return res.status(400).json({ error: 'Noto‘g‘ri action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
