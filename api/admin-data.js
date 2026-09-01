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
 *   GET  /api/admin-data?resource=trucks
 *   GET  /api/admin-data?resource=truck&id=<id>   (one listing, with photos)
 *   POST /api/admin-data?action=update-report   { id, status }
 *   POST /api/admin-data?action=verify-driver   { email, verified }
 *   POST /api/admin-data?action=update-user     { email, ...any profile field }
 *   POST /api/admin-data?action=update-truck    { id, verified?, promoted?, status?, rejectionReason? } | { id, remove: true }
 *   GET  /api/admin-data?resource=settings
 *   POST /api/admin-data?action=update-settings { platformName?, supportPhone?, ... }
 *
 * All of these require the signed cookie set by /api/admin-login, and each
 * one is gated on the caller's role — see READ_PERMISSIONS /
 * WRITE_PERMISSIONS below and the permission table in lib/adminAuth.js.
 */
import { kvGet, kvSet, kvDel, kvSadd, kvSrem, kvSmembers, kvKeys, kvRange } from '../lib/kv.js';
import { requireAdmin } from '../lib/adminAuth.js';

const REPORT_STATUSES = ['NEW', 'INVESTIGATING', 'CONTACTED', 'RESOLVED', 'BANNED'];
/**
 * Every listing status — see the lifecycle comment in api/trucks.js. The
 * admin can set any of them; a seller is limited to ACTIVE/PAUSED/SOLD on
 * an already-approved listing, which is what makes approval meaningful.
 */
const TRUCK_STATUSES = ['PENDING', 'ACTIVE', 'PAUSED', 'SOLD', 'REJECTED'];

// Mirrors the same lists in api/profile.js and api/order.js — kept as a
// duplicate literal rather than a shared import, same pattern already used
// for CITIES across these serverless files.
const ROLES = ['DRIVER', 'OWNER', 'BOTH'];
const CITIES = [
  'Toshkent', 'Samarqand', 'Buxoro', 'Andijon', 'Namangan', 'Nukus', 'Qarshi', 'Urganch',
  'Farg\'ona', 'Jizzax', 'Navoiy', 'Guliston', 'Termiz',
];
const VEHICLE_TYPES = ['ISUZU', 'GAZEL', 'FURGON', 'YARIM_TREYLER', 'SAMOSVAL', 'BOSHQA'];

const normalisePhone = (v) => {
  const d = String(v).replace(/\D/g, '');
  if (d.length === 9) return `+998${d}`;
  if (d.length === 12 && d.startsWith('998')) return `+${d}`;
  return '';
};

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
  // One SMEMBERS for the whole banned set, not one SISMEMBER per user —
  // O(1) extra KV round trip no matter how many users there are.
  const bannedSet = new Set((await kvSmembers('banned')).map((s) => s.toLowerCase()));

  const users = await Promise.all(
    emails.map(async (email) => {
      kvSadd('profile_emails', email).catch(() => {});
      const profile = parseProfile(await kvGet(`profile:${email}`));
      return { email, ...profile, banned: bannedSet.has(email.toLowerCase()) };
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

/** Every Mashinalar listing, any status — see api/trucks.js for the shape. */
const getTrucks = async (res) => {
  const ids = await kvSmembers('truck_ids');
  const trucks = (
    await Promise.all(
      ids.map(async (id) => {
        const raw = await kvGet(`truck:${id}`);
        if (!raw) return null;
        try {
          const t = JSON.parse(raw);
          // Photos are inline data: URLs and would bloat this response
          // enormously across hundreds of listings — the admin list only
          // needs to know whether a listing has any.
          const { photos, ...rest } = t;
          return { ...rest, photoCount: Array.isArray(photos) ? photos.length : 0 };
        } catch {
          return null;
        }
      }),
    )
  ).filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return res.status(200).json({ trucks });
};

/**
 * One listing *with* its photos — the list above strips them because
 * hundreds of inline data: URLs would be a multi-megabyte response, but
 * approving a listing without looking at its photos isn't moderation, so
 * the detail screen fetches the full record for the single listing open.
 */
const getTruck = async (req, res) => {
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'E’lon topilmadi' });
  const raw = await kvGet(`truck:${id}`);
  if (!raw) return res.status(404).json({ error: 'E’lon topilmadi' });
  try {
    return res.status(200).json({ truck: JSON.parse(raw) });
  } catch {
    return res.status(500).json({ error: 'Yozuv buzilgan' });
  }
};

/**
 * POST ?action=update-truck — the admin-only side of a Mashinalar listing.
 * Deliberately narrow: only the trust/moderation flags an admin owns
 * (`verified`, `promoted`, `status`) plus outright removal. Listing content
 * stays the seller's to edit through /api/trucks?action=update — those are
 * exactly the fields api/trucks.js refuses to let a seller set on themselves.
 */
const updateTruck = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const id = String(body.id || '');
  if (!id) return res.status(400).json({ error: 'E’lon topilmadi' });

  if (body.remove) {
    await kvDel(`truck:${id}`);
    await kvSrem('truck_ids', id);
    return res.status(200).json({ ok: true, removed: true });
  }

  const raw = await kvGet(`truck:${id}`);
  if (!raw) return res.status(404).json({ error: 'E’lon topilmadi' });
  let truck;
  try {
    truck = JSON.parse(raw);
  } catch {
    return res.status(500).json({ error: 'Yozuv buzilgan' });
  }

  if (body.verified !== undefined) truck.verified = Boolean(body.verified);
  if (body.promoted !== undefined) truck.promoted = Boolean(body.promoted);
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!TRUCK_STATUSES.includes(status)) return res.status(400).json({ error: 'Noto‘g‘ri holat' });
    truck.status = status;
    // A rejection reason only makes sense while the listing is rejected —
    // clear it on any other transition so an approved listing never
    // carries a stale "why we turned this down" note.
    if (status !== 'REJECTED') delete truck.rejectionReason;
  }
  if (body.rejectionReason !== undefined) {
    const reason = String(body.rejectionReason).trim().slice(0, 300);
    if (reason) truck.rejectionReason = reason;
    else delete truck.rejectionReason;
  }

  const saved = await kvSet(`truck:${id}`, JSON.stringify(truck));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi' });
  const { photos, ...rest } = truck;
  return res.status(200).json({ ok: true, truck: { ...rest, photoCount: Array.isArray(photos) ? photos.length : 0 } });
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
  // Reviewed either way — a pending self-serve request (see api/profile.js's
  // request-verification) shouldn't keep showing as "waiting" once an admin
  // has actually looked at it.
  delete profile.verificationRequestedAt;
  const saved = await kvSet(`profile:${email}`, JSON.stringify(profile));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi' });

  return res.status(200).json({ ok: true, profile });
};

/**
 * POST ?action=update-user — full admin override of any field on any
 * chosen user's profile, including the rating (ratingCount/ratingSum
 * directly, not just the verified flag verifyDriver above handles) and
 * a ban toggle. Unlike /api/profile, this trusts the admin session
 * (requireAdmin, lib/adminAuth.js), not the target user's own Google/Telegram
 * identity — `email` in the body is just the profile:<email> key to
 * edit, taken from whatever ?resource=users already listed.
 *
 * Every field is optional and independent: omit a key to leave it
 * untouched, send "" (or false, for booleans) to clear/unset it. That's
 * different from /api/profile's "empty means don't touch" convention —
 * an admin editing a specific person needs to be able to blank a field
 * out on purpose, not just add to it.
 */
const updateUser = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = String(body.email || '').trim();
  if (!email) return res.status(400).json({ error: 'Email kerak' });

  const raw = await kvGet(`profile:${email}`);
  if (!raw) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  let profile;
  try {
    profile = JSON.parse(raw);
  } catch {
    return res.status(500).json({ error: 'Yozuv buzilgan' });
  }

  const next = { ...profile };

  if (body.username !== undefined) {
    const username = String(body.username).trim();
    if (username) {
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return res.status(400).json({ error: 'Username 3-20 belgidan, faqat lotin harflari, raqam va pastki chiziq (_) bo‘lishi kerak' });
      }
      const usernameKey = `username:${username.toLowerCase()}`;
      const owner = await kvGet(usernameKey);
      if (owner && owner !== email) return res.status(409).json({ error: 'Bu username band' });
      if (next.username && next.username.toLowerCase() !== username.toLowerCase()) {
        await kvDel(`username:${next.username.toLowerCase()}`);
      }
      const claimed = await kvSet(usernameKey, email);
      if (!claimed) return res.status(502).json({ error: 'Username saqlab bo‘lmadi' });
      next.username = username;
    } else if (next.username) {
      await kvDel(`username:${next.username.toLowerCase()}`);
      delete next.username;
    }
  }

  if (body.displayName !== undefined) {
    const v = String(body.displayName).trim().slice(0, 60);
    if (v) next.displayName = v; else delete next.displayName;
  }

  if (body.role !== undefined) {
    const v = String(body.role);
    if (!v) delete next.role;
    else if (ROLES.includes(v)) next.role = v;
    else return res.status(400).json({ error: 'Noto‘g‘ri rol' });
  }

  if (body.city !== undefined) {
    const v = String(body.city);
    if (!v) delete next.city;
    else if (CITIES.includes(v)) next.city = v;
    else return res.status(400).json({ error: 'Noto‘g‘ri shahar' });
  }

  if (body.phone !== undefined) {
    const v = String(body.phone).trim();
    if (!v) delete next.phone;
    else {
      const phone = normalisePhone(v);
      if (!phone) return res.status(400).json({ error: 'Telefon raqam noto‘g‘ri' });
      next.phone = phone;
    }
  }

  if (body.vehicleType !== undefined) {
    const v = String(body.vehicleType);
    if (!v) delete next.vehicleType;
    else if (VEHICLE_TYPES.includes(v)) next.vehicleType = v;
    else return res.status(400).json({ error: 'Noto‘g‘ri mashina turi' });
  }

  if (body.plateNumber !== undefined) {
    const v = String(body.plateNumber).trim().toUpperCase().slice(0, 12);
    if (v) next.plateNumber = v; else delete next.plateNumber;
  }

  if (body.telegramUsername !== undefined) {
    const v = String(body.telegramUsername).trim().replace(/^@/, '').toLowerCase();
    if (v) {
      if (!/^[a-zA-Z0-9_]{5,32}$/.test(v)) return res.status(400).json({ error: 'Telegram username noto‘g‘ri' });
      next.telegramUsername = v;
      await kvSet(`tgToEmail:${v}`, email);
    } else {
      delete next.telegramUsername;
    }
  }

  if (body.bio !== undefined) {
    const v = String(body.bio).trim().slice(0, 200);
    if (v) next.bio = v; else delete next.bio;
  }

  if (body.verified !== undefined) {
    next.verified = Boolean(body.verified);
    // Same reasoning as verifyDriver above — an admin touching this field
    // at all counts as reviewing the pending request, if there was one.
    delete next.verificationRequestedAt;
  }

  if (body.ratingCount !== undefined || body.ratingSum !== undefined) {
    const ratingCount = Math.round(Number(body.ratingCount ?? next.ratingCount ?? 0));
    const ratingSum = Math.round(Number(body.ratingSum ?? next.ratingSum ?? 0));
    if (!Number.isFinite(ratingCount) || ratingCount < 0 || !Number.isFinite(ratingSum) || ratingSum < 0) {
      return res.status(400).json({ error: 'Reyting qiymati noto‘g‘ri' });
    }
    next.ratingCount = ratingCount;
    next.ratingSum = ratingSum;
  }

  const saved = await kvSet(`profile:${email}`, JSON.stringify(next));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });

  if (body.banned !== undefined) {
    if (body.banned) await kvSadd('banned', email.toLowerCase());
    else await kvSrem('banned', email.toLowerCase());
  }

  return res.status(200).json({ ok: true, profile: next });
};

/**
 * Platform settings, stored as one JSON blob. Read by the admin panel and
 * — for the two public ones — by /api/config, so changing them here really
 * does change the public site rather than just this screen.
 */
const SETTINGS_KEY = 'admin_settings';
const DEFAULT_SETTINGS = {
  platformName: "YO'LDA",
  supportPhone: '',
  supportTelegram: '',
  commissionPercent: 0,
  maintenanceMode: false,
  maintenanceMessage: '',
};

const readSettings = async () => {
  const raw = await kvGet(SETTINGS_KEY);
  let stored = {};
  try {
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object') stored = parsed;
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_SETTINGS, ...stored };
};

const getSettings = async (res) => res.status(200).json({ settings: await readSettings() });

const updateSettings = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const next = await readSettings();

  if (body.platformName !== undefined) next.platformName = String(body.platformName).trim().slice(0, 60) || DEFAULT_SETTINGS.platformName;
  if (body.supportPhone !== undefined) next.supportPhone = String(body.supportPhone).trim().slice(0, 30);
  if (body.supportTelegram !== undefined) next.supportTelegram = String(body.supportTelegram).trim().replace(/^@/, '').slice(0, 40);
  if (body.maintenanceMessage !== undefined) next.maintenanceMessage = String(body.maintenanceMessage).trim().slice(0, 200);
  if (body.maintenanceMode !== undefined) next.maintenanceMode = Boolean(body.maintenanceMode);
  if (body.commissionPercent !== undefined) {
    const pct = Number(body.commissionPercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: 'Komissiya 0–100 oralig‘ida bo‘lishi kerak' });
    }
    next.commissionPercent = Math.round(pct * 100) / 100;
  }

  const saved = await kvSet(SETTINGS_KEY, JSON.stringify(next));
  if (!saved) return res.status(502).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });
  return res.status(200).json({ ok: true, settings: next });
};

/** Read permission required per GET resource. */
const READ_PERMISSIONS = {
  orders: 'orders:read',
  users: 'users:read',
  messages: 'messages:read',
  reports: 'reports:read',
  trucks: 'trucks:read',
  truck: 'trucks:read',
  settings: 'settings:read',
};

/** Write permission required per POST action. */
const WRITE_PERMISSIONS = {
  'update-report': 'reports:write',
  'verify-driver': 'users:write',
  'update-user': 'users:write',
  'update-truck': 'trucks:write',
  'update-settings': 'settings:write',
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const resource = String(req.query.resource || '');
    const permission = READ_PERMISSIONS[resource];
    if (!permission) {
      // Still require a session before saying anything about the request.
      if (!requireAdmin(req, res)) return;
      return res.status(400).json({ error: 'Noto‘g‘ri resource' });
    }
    if (!requireAdmin(req, res, permission)) return;

    if (resource === 'orders') return getOrders(res);
    if (resource === 'users') return getUsers(res);
    if (resource === 'messages') return getMessages(res);
    if (resource === 'reports') return getReports(res);
    if (resource === 'trucks') return getTrucks(res);
    if (resource === 'truck') return getTruck(req, res);
    if (resource === 'settings') return getSettings(res);
  }

  if (req.method === 'POST') {
    const action = String(req.query.action || '');
    const permission = WRITE_PERMISSIONS[action];
    if (!permission) {
      if (!requireAdmin(req, res)) return;
      return res.status(400).json({ error: 'Noto‘g‘ri action' });
    }
    if (!requireAdmin(req, res, permission)) return;

    if (action === 'update-report') return updateReport(req, res);
    if (action === 'verify-driver') return verifyDriver(req, res);
    if (action === 'update-user') return updateUser(req, res);
    if (action === 'update-truck') return updateTruck(req, res);
    if (action === 'update-settings') return updateSettings(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
