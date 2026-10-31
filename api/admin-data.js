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
 *   POST /api/admin-data?action=requeue-legacy  { confirm: true }
 *   GET  /api/admin-data?resource=life
 *   POST /api/admin-data?action=save-life       { id?, kind, category, title, url, ... }
 *   POST /api/admin-data?action=delete-life     { id }
 *   GET  /api/admin-data?resource=staff
 *   POST /api/admin-data?action=save-staff      { identity, role, title? }
 *   POST /api/admin-data?action=delete-staff    { identity }
 *
 * All of these require the signed cookie set by /api/admin-login, and each
 * one is gated on the caller's role — see READ_PERMISSIONS /
 * WRITE_PERMISSIONS below and the permission table in lib/adminAuth.js.
 */
import { kvGet, kvSet, kvDel, kvSadd, kvSrem, kvSmembers, kvKeys, kvRange, kvLrem,
  kvDbSize, kvUsedMemory, kvMonthCommands } from '../lib/kv.js';
import { requireAdmin } from '../lib/adminAuth.js';
import { listInvoices, activeProviders } from '../lib/payments.js';
import { grantPremium, revokePremium, premiumState, premiumMembers } from '../lib/premium.js';
import { notifyUser, esc } from '../lib/notify.js';
import { REVIEWED_KINDS, KIND_LABELS, setVerification, docKey } from '../lib/verification.js';
import { normalise as normaliseLife, sortItems as sortLifeItems } from '../lib/life.js';
import { uploadImage, keyFromUrl, deleteObject, storageConfigured, storageMissing } from '../lib/storage.js';
import { fetchRemoteImage } from '../lib/remoteImage.js';
import { normalizeIcons, iconUrl, iconIsPlain, iconEntry } from '../lib/icons.js';
import { listStaff, saveStaff, removeStaff, countByRole, STAFF_ROLES, STAFF_ROLE_LABELS }
  from '../lib/staff.js';
/* Ro'yxat bitta joyda — lib/deleteAccount.js da. Nusxa olinsa,
   ikkisidan biri albatta ortda qolardi. */
import { deleteAccount, activeOrdersFor, ACTIVE_ORDER_STATUSES } from '../lib/deleteAccount.js';
import { invalidateLoadsCache } from '../lib/loadsCache.js';

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
  /* Premium ham xuddi "bloklangan" kabi: butun to'plam bir marta
     o'qiladi, har bir odam uchun alohida so'rov qilinmaydi. */
  const premiumSet = new Set(await premiumMembers());

  const users = await Promise.all(
    emails.map(async (email) => {
      kvSadd('profile_emails', email).catch(() => {});
      const profile = parseProfile(await kvGet(`profile:${email}`));
      return {
        email,
        ...profile,
        banned: bannedSet.has(email.toLowerCase()),
        premium: premiumSet.has(email),
      };
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

  const previousStatus = truck.status || 'ACTIVE';
  if (body.verified !== undefined) truck.verified = Boolean(body.verified);
  if (body.promoted !== undefined) truck.promoted = Boolean(body.promoted);
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!TRUCK_STATUSES.includes(status)) return res.status(400).json({ error: 'Noto‘g‘ri holat' });
    truck.status = status;
    // Records that a human actually looked at this listing. Before this
    // existed there was no way to tell an admin-approved listing from one
    // that auto-published in the pre-moderation days — see requeueLegacy.
    truck.moderatedAt = Date.now();
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

  // Moderatsiya natijasini sotuvchiga aytamiz — aks holda u e'loni
  // tasdiqlanganini yoki nega rad etilganini bilmay qoladi. Faqat holat
  // haqiqatan o'zgarganda; verified/promoted almashtirilganda emas.
  const nextStatus = truck.status || 'ACTIVE';
  if (nextStatus !== previousStatus && (nextStatus === 'ACTIVE' || nextStatus === 'REJECTED')) {
    const name = esc(truck.brand || "E'lon");
    await notifyUser(truck.sellerIdentity, {
      category: 'listings',
      text: nextStatus === 'ACTIVE'
        ? `<b>E'loningiz tasdiqlandi</b>\n\n${name}\n\nEndi u saytda ko'rinadi.`
        : `<b>E'loningiz rad etildi</b>\n\n${name}`
          + (truck.rejectionReason ? `\n\nSabab: ${esc(truck.rejectionReason)}` : '')
          + `\n\nTuzatib, qaytadan yuborishingiz mumkin.`,
    });
  }

  const { photos, ...rest } = truck;
  return res.status(200).json({ ok: true, truck: { ...rest, photoCount: Array.isArray(photos) ? photos.length : 0 } });
};

/**
 * Listings created before listing moderation shipped went straight to
 * ACTIVE — nobody ever reviewed them. This puts exactly those back in the
 * queue, once, when an admin asks for it.
 *
 * A listing is only touched when all three hold:
 *   - it is ACTIVE right now (PAUSED/SOLD/REJECTED are left alone),
 *   - it was created before moderation shipped,
 *   - it carries no moderatedAt stamp, so no admin has ruled on it.
 *
 * The stamp only started being written in this same change, so a listing
 * an admin approved during the few hours in between will come back for
 * one more look. That is the safe direction to be wrong in.
 */
const MODERATION_LAUNCHED_AT = Date.parse('2026-09-01T06:18:58Z');

const requeueLegacy = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  // Deliberately explicit: this rewrites many records at once, so it must
  // never fire from a stray request.
  if (body.confirm !== true) return res.status(400).json({ error: 'Tasdiqlash kerak' });

  const ids = await kvSmembers('truck_ids');
  let requeued = 0;
  let skipped = 0;
  let failed = 0;

  for (const id of ids) {
    const raw = await kvGet(`truck:${id}`);
    if (!raw) { skipped += 1; continue; }
    let truck;
    try {
      truck = JSON.parse(raw);
    } catch {
      failed += 1;
      continue;
    }
    const isLegacy =
      (truck.status || 'ACTIVE') === 'ACTIVE' &&
      !truck.moderatedAt &&
      Number(truck.createdAt || 0) < MODERATION_LAUNCHED_AT;
    if (!isLegacy) { skipped += 1; continue; }

    truck.status = 'PENDING';
    delete truck.rejectionReason;
    const saved = await kvSet(`truck:${id}`, JSON.stringify(truck));
    if (saved) requeued += 1;
    else failed += 1;
  }

  return res.status(200).json({ ok: true, requeued, skipped, failed });
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

  // Ko'k belgi — shaxs tasdig'i, shuning uchun bu tugma ham
  // IDENTITY ni o'zgartiradi. `verified` va `verificationRequestedAt`
  // ni setVerification o'zi moslab qo'yadi, ya'ni eski va yangi
  // shakl bir-biriga qarama-qarshi tushib qolmaydi.
  setVerification(profile, 'IDENTITY', {
    status: verified ? 'VERIFIED' : 'REJECTED',
    reviewedAt: Date.now(),
    reason: '',
  });
  const saved = await kvSet(`profile:${email}`, JSON.stringify(profile));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi' });
  await kvDel(docKey(email, 'IDENTITY')).catch(() => {});
  await kvSrem('verify_queue', `${email}|IDENTITY`).catch(() => {});

  return res.status(200).json({ ok: true, profile });
};

/** GET ?resource=verifydoc&email=&kind= — moderator ko'radigan hujjat. */
const getVerifyDoc = async (req, res) => {
  const email = String(req.query.email || '').trim();
  const kind = String(req.query.kind || '');
  if (!email || !REVIEWED_KINDS.includes(kind)) {
    return res.status(400).json({ error: 'Email va tur kerak' });
  }
  const doc = await kvGet(docKey(email, kind));
  if (!doc) return res.status(404).json({ error: 'Hujjat topilmadi' });
  return res.status(200).json({ ok: true, doc });
};

/**
 * POST ?action=verify-review — moderator hujjatni ko'rib qaror qiladi.
 *
 * Qaror chiqishi bilan hujjat o'chiriladi. Ko'rib bo'lingan pasport
 * rasmini saqlab turishning sababi yo'q, xavfi esa bor.
 */
const reviewVerification = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = String(body.email || '').trim();
  const kind = String(body.kind || '');
  const approve = Boolean(body.approve);
  const reason = String(body.reason || '').trim().slice(0, 200);

  if (!email) return res.status(400).json({ error: 'Email kerak' });
  if (!REVIEWED_KINDS.includes(kind)) return res.status(400).json({ error: 'Noto‘g‘ri tur' });
  if (!approve && !reason) return res.status(400).json({ error: 'Rad etish sababini yozing' });

  const raw = await kvGet(`profile:${email}`);
  if (!raw) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  let profile;
  try {
    profile = JSON.parse(raw);
  } catch {
    return res.status(500).json({ error: 'Yozuv buzilgan' });
  }

  setVerification(profile, kind, {
    status: approve ? 'VERIFIED' : 'REJECTED',
    reviewedAt: Date.now(),
    reason: approve ? '' : reason,
  });
  if (!(await kvSet(`profile:${email}`, JSON.stringify(profile)))) {
    return res.status(500).json({ error: 'Saqlanmadi' });
  }
  await kvDel(docKey(email, kind)).catch(() => {});
  await kvSrem('verify_queue', `${email}|${kind}`).catch(() => {});

  await notifyUser(email, {
    category: 'listings',
    text: approve
      ? `<b>${esc(KIND_LABELS[kind])} tasdiqlandi</b>\n\nProfilingizda belgisi ko'rinadi.`
      : `<b>${esc(KIND_LABELS[kind])} tasdiqlanmadi</b>\n\n${esc(reason)}\n\n`
        + `Bir kundan keyin qaytadan yuborishingiz mumkin.`,
  });

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
    // verifyDriver bilan bir xil yo'l: ko'k belgi — shaxs tasdig'i,
    // va admin bu maydonga tegishi so'rovni ko'rib chiqqani hisoblanadi.
    setVerification(next, 'IDENTITY', {
      status: body.verified ? 'VERIFIED' : 'REJECTED',
      reviewedAt: Date.now(),
      reason: '',
    });
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

  /* Premium — yagona imtiyozi vaqt: yangi yuk xabari unga darhol,
     qolganlarga bir soatdan keyin boradi (lib/premium.js).

     Profil yozuviga emas, alohida kalitga saqlanadi: yangi yuk
     kelganda "kim premium" degan savolga bitta so'rov bilan javob
     berish kerak, har bir odamning yozuvini o'qib chiqish emas.

     To'lov tizimi hali yo'q, shuning uchun premiumni faqat shu
     yerdan — admin qo'lda beradi. Ilovada "sotib olish" tugmasi
     yo'q va ataylab yo'q: ishlamaydigan tugmadan ko'ra tugmasiz
     qolgani yaxshi. */
  if (body.premium !== undefined) {
    if (body.premium) {
      const days = Number(body.premiumDays);
      const until = Number.isFinite(days) && days > 0 ? Date.now() + days * 86400000 : 0;
      if (!(await grantPremium(email, until))) {
        return res.status(502).json({ error: 'Premium berilmadi, qayta urinib ko‘ring' });
      }
    } else if (!(await revokePremium(email))) {
      return res.status(502).json({ error: 'Premium olib tashlanmadi' });
    }
  }

  const saved = await kvSet(`profile:${email}`, JSON.stringify(next));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });

  if (body.banned !== undefined) {
    if (body.banned) await kvSadd('banned', email.toLowerCase());
    else await kvSrem('banned', email.toLowerCase());
  }

  return res.status(200).json({ ok: true, profile: { ...next, ...(await premiumState(email)) } });
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
  /* Premium narxlari. Bo'sh (0) bo'lsa — o'sha muddat umuman
     sotuvga chiqmaydi. Narxni EGASI belgilaydi: kodda hech
     qanday raqam yo'q. */
  premiumPrice1m: 0,
  premiumPrice3m: 0,
  premiumPrice12m: 0,
  maintenanceMode: false,
  maintenanceMessage: '',
  /* Panel sarlavhasidagi belgi. Bo'sh bo'lsa harfdan yasalgan
     belgi chiziladi — ya'ni logo majburiy emas. */
  adminLogoUrl: '',
  /* Kirish ekranidagi rasm. Bo'sh bo'lsa ilovaning o'z chizmasi
     qoladi — ya'ni rasm majburiy emas. */
  welcomeImageUrl: '',
  /* Yordamchi (mascot) rasmi. Shunday ham ishlaydi. */
  mascotImageUrl: '',
  /* Kompaniya ma'lumotlari — hujjatlarda va yordam oynasida
     ko'rinadi. Hech biri majburiy emas. */
  companyLegalName: '',
  companyAddress: '',
  companyEmail: '',
  /* Panelda ko'rinadigan ism. Panelga kirish parol bilan, ya'ni
     hisob yo'q — shuning uchun ism shu yerda qo'lda yoziladi.
     Bo'sh bo'lsa rol nomi ko'rinadi, o'ylab topilgan ism emas. */
  adminDisplayName: '',
  region: "O'zbekiston",
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
  if (body.companyLegalName !== undefined) next.companyLegalName = String(body.companyLegalName).trim().slice(0, 120);
  if (body.companyAddress !== undefined) next.companyAddress = String(body.companyAddress).trim().slice(0, 200);
  if (body.companyEmail !== undefined) next.companyEmail = String(body.companyEmail).trim().slice(0, 120);
  if (body.adminDisplayName !== undefined) next.adminDisplayName = String(body.adminDisplayName).trim().slice(0, 60);
  if (body.region !== undefined) next.region = String(body.region).trim().slice(0, 60) || DEFAULT_SETTINGS.region;
  if (body.commissionPercent !== undefined) {
    const pct = Number(body.commissionPercent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: 'Komissiya 0–100 oralig‘ida bo‘lishi kerak' });
    }
    next.commissionPercent = Math.round(pct * 100) / 100;
  }

  /* Premium narxlari. 0 — sotuvda yo'q (xato emas). Manfiy yoki
     haddan tashqari katta raqam qabul qilinmaydi: noldan ortiq
     xato terilgan narx odamdan haqiqiy pul so'raydi. */
  for (const field of ['premiumPrice1m', 'premiumPrice3m', 'premiumPrice12m']) {
    if (body[field] === undefined) continue;
    const som = Number(body[field]);
    if (!Number.isFinite(som) || som < 0 || som > 100_000_000) {
      return res.status(400).json({ error: 'Narx noto‘g‘ri' });
    }
    next[field] = Math.round(som);
  }

  const saved = await kvSet(SETTINGS_KEY, JSON.stringify(next));
  if (!saved) return res.status(502).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });
  return res.status(200).json({ ok: true, settings: next });
};

/* ---------- YO'LDA LIFE mazmuni ----------
   Media faylning o'zi bu yerda saqlanmaydi (sabab lib/life.js da
   yozilgan) — bazada faqat havola va tavsif turadi. */
const getLife = async (res) => {
  const ids = await kvSmembers('life_ids');
  const items = (await Promise.all(ids.map(async (id) => {
    const raw = await kvGet(`life:${id}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }))).filter(Boolean);
  return res.status(200).json({ ok: true, life: sortLifeItems(items) });
};

const saveLife = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const id = String(body.id || '').trim();

  let existing = null;
  if (id) {
    const raw = await kvGet(`life:${id}`);
    if (!raw) return res.status(404).json({ error: 'Yozuv topilmadi' });
    try { existing = JSON.parse(raw); } catch { existing = null; }
    if (!existing) return res.status(500).json({ error: 'Yozuv o‘qilmadi' });
  }

  const { item, error } = normaliseLife(body, existing);
  if (error) return res.status(400).json({ error });

  if (!(await kvSet(`life:${item.id}`, JSON.stringify(item)))) {
    return res.status(500).json({ error: 'Saqlanmadi' });
  }
  await kvSadd('life_ids', item.id).catch(() => {});

  // Faqat bittasi asosiy bo'lishi mumkin: yangisi belgilanganda
  // eskisidan belgi olinadi, aks holda bannerda qaysi biri chiqishi
  // tasodifga qolardi.
  if (item.featured) {
    const ids = await kvSmembers('life_ids');
    await Promise.all(ids.map(async (other) => {
      if (other === item.id) return;
      const raw = await kvGet(`life:${other}`);
      if (!raw) return;
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { return; }
      if (!parsed || !parsed.featured) return;
      parsed.featured = false;
      await kvSet(`life:${other}`, JSON.stringify(parsed)).catch(() => {});
    }));
  }

  return res.status(200).json({ ok: true, item });
};

const deleteLife = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const id = String(body.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id kerak' });
  if (!(await kvGet(`life:${id}`))) return res.status(404).json({ error: 'Yozuv topilmadi' });
  await kvDel(`life:${id}`).catch(() => {});
  await kvSrem('life_ids', id).catch(() => {});
  return res.status(200).json({ ok: true });
};

/* ---------- Eski buyurtmalarni tozalash ----------
   Faqat bosh administrator uchun: bu amalni qaytarib bo'lmaydi va
   bir bosishda butun tarixni o'chirib yuborishi mumkin. Shuning
   uchun ruxsati ro'yxatdagi hech bir rolga berilmagan — faqat
   SUPER_ADMIN dagi "*" uni qamrab oladi (lib/adminAuth.js).

   Tanlov kun bilan beriladi: 1, 7, 30 yoki 0 (hammasi). Oraliq
   qiymat ham ishlaydi, lekin ekranda shu to'rttasi turadi. */
const PURGE_MAX_DAYS = 3650;

const purgeOrders = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  // Tasdiqsiz o'chirilmaydi: tasodifiy so'rov butun tarixni
  // yo'q qilib yuborishi mumkin edi.
  if (body.confirm !== true) return res.status(400).json({ error: 'Tasdiqlash kerak' });

  const days = Number(body.olderThanDays);
  if (!Number.isFinite(days) || days < 0 || days > PURGE_MAX_DAYS) {
    return res.status(400).json({ error: 'Muddat noto‘g‘ri' });
  }
  // 0 — "hammasi". Boshqa holatda shu muddatdan eskilari.
  const cutoff = days === 0 ? Infinity : Date.now() - days * 24 * 60 * 60 * 1000;

  const codes = await kvRange('order_codes', 0, -1);
  let removed = 0;
  let kept = 0;

  for (const code of codes) {
    const raw = await kvGet(`order:${code}`);
    if (!raw) {
      // Yozuvi yo'q, kodi ro'yxatda qolib ketgan — baribir tozalaymiz.
      await kvLrem('order_codes', code).catch(() => {});
      continue;
    }
    let order = null;
    try { order = JSON.parse(raw); } catch { order = null; }
    // O'qib bo'lmaydigan yozuvni "eski" deb hisoblamaymiz: sanasi
    // noma'lum narsani o'chirish — ma'lumotni tavakkaliga yo'qotish.
    const at = order && Number(order.createdAt);
    if (!Number.isFinite(at)) { kept += 1; continue; }
    if (at >= cutoff) { kept += 1; continue; }

    await kvDel(`order:${code}`).catch(() => {});
    await kvLrem('order_codes', code).catch(() => {});
    removed += 1;
  }

  return res.status(200).json({ ok: true, removed, kept });
};

/* ---------- O'chirish ----------
   Panelda ko'rinadigan har bir ro'yxatdan yozuvni olib tashlash.

   UCHTA QOIDA HAMMASIGA BIR XIL:

   1. Tasdiqsiz hech narsa o'chmaydi (`confirm: true`). Tasodifiy
      so'rov butun ro'yxatni yo'q qilib yuborishi mumkin edi.
   2. Butun ro'yxatni tozalash faqat super adminda: u qaytarib
      bo'lmaydigan ish.
   3. Natijada nechta yozuv o'chgani qaytariladi — "o'chirildi"
      deyish yetarli emas, odam nima bo'lganini bilishi kerak.
---------------------------------------------------------------- */

/**
 * Bitta murojaat. Ro'yxatda id yo'q (u oddiy ro'yxat), shuning
 * uchun o'rni (`index`) va yozilgan vaqti birga yuboriladi:
 * ro'yxat o'zgargan bo'lsa vaqt mos kelmaydi va hech narsa
 * o'chmaydi. Aks holda yangi murojaat kelgan payt bosilgan
 * tugma BOSHQA yozuvni o'chirib yuborardi.
 */
const deleteMessage = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const index = Number(body.index);
  const createdAt = Number(body.createdAt);
  if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: 'Noto‘g‘ri so‘rov' });

  const raw = await kvRange('support_messages', 0, 199);
  const row = raw[index];
  if (!row) return res.status(404).json({ error: 'Murojaat topilmadi' });

  let parsed = null;
  try { parsed = JSON.parse(row); } catch { parsed = null; }
  if (!parsed || Number(parsed.createdAt) !== createdAt) {
    return res.status(409).json({ error: 'Ro‘yxat o‘zgargan — yangilab, qaytadan urinib ko‘ring' });
  }

  await kvLrem('support_messages', row);
  return res.status(200).json({ ok: true, removed: 1 });
};

/** Hamma murojaatlar. Faqat super admin. */
const purgeMessages = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.confirm !== true) return res.status(400).json({ error: 'Tasdiqlash kerak' });
  const before = (await kvRange('support_messages', 0, -1)).length;
  await kvDel('support_messages');
  return res.status(200).json({ ok: true, removed: before });
};

/** Bitta shikoyat. */
const deleteReport = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const id = String(body.id || '').trim();
  if (!id) return res.status(400).json({ error: 'ID kerak' });
  if (!(await kvGet(`report:${id}`))) return res.status(404).json({ error: 'Shikoyat topilmadi' });

  await kvDel(`report:${id}`);
  await kvLrem('report_ids', id).catch(() => {});
  return res.status(200).json({ ok: true, removed: 1 });
};

/** Hamma shikoyatlar. Faqat super admin. */
const purgeReports = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.confirm !== true) return res.status(400).json({ error: 'Tasdiqlash kerak' });

  const ids = await kvRange('report_ids', 0, -1);
  for (const id of ids) await kvDel(`report:${id}`).catch(() => {});
  await kvDel('report_ids');
  return res.status(200).json({ ok: true, removed: ids.length });
};

/**
 * Bitta buyurtma.
 *
 * Yo'ldagi yukni o'chirish — haydovchi bilan yuk beruvchi
 * o'rtasidagi kelishuvni ikkala tomondan ham yo'q qilish degani.
 * Shuning uchun u avval BEKOR qilinishi kerak: panelda sabab
 * ham shu yerda yoziladi.
 */
const deleteOrder = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.confirm !== true) return res.status(400).json({ error: 'Tasdiqlash kerak' });
  const code = String(body.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Kod kerak' });

  const raw = await kvGet(`order:${code}`);
  if (!raw) return res.status(404).json({ error: 'Buyurtma topilmadi' });

  let order = null;
  try { order = JSON.parse(raw); } catch { order = null; }
  const status = (order && order.status) || 'NEW';
  if (ACTIVE_ORDER_STATUSES.includes(status) && body.force !== true) {
    return res.status(409).json({
      error: 'Bu yuk hozir yo‘lda. Avval bekor qiling yoki «baribir o‘chirish»ni tanlang',
      status,
    });
  }

  await kvDel(`order:${code}`);
  await kvLrem('order_codes', code).catch(() => {});
  await invalidateLoadsCache().catch(() => {});
  return res.status(200).json({ ok: true, removed: 1, status });
};

/**
 * Foydalanuvchi hisobi.
 *
 * Bu yerda ham odamning o'zi o'chirgandagi AYNI yo'l yuradi
 * (lib/deleteAccount.js): shaxsiy ma'lumot o'chadi, buyurtma va
 * e'lonlar esa anonim bo'ladi — ular ikkinchi tomonga ham
 * tegishli va ularning tarixi yo'qolib qolmasligi kerak.
 * Ikkita yo'l bo'lsa, ulardan biri albatta ortda qolardi.
 */
const deleteUser = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.confirm !== true) return res.status(400).json({ error: 'Tasdiqlash kerak' });
  const identity = String(body.email || body.identity || '').trim();
  if (!identity) return res.status(400).json({ error: 'Foydalanuvchi ko‘rsatilmagan' });
  if (!(await kvGet(`profile:${identity}`))) {
    return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  }

  const orderCodes = await kvRange('order_codes', 0, 299);
  const active = await activeOrdersFor(identity, orderCodes);
  if (active.length && body.force !== true) {
    return res.status(409).json({
      error: `Bu odamda ${active.length} ta yo‘ldagi yuk bor. Avval ularni yakunlang yoki «baribir o‘chirish»ni tanlang`,
      activeOrders: active,
    });
  }

  const truckIds = await kvSmembers('truck_ids');
  const result = await deleteAccount(identity, { orderCodes, truckIds });
  // Xodimlar ro'yxatida qolib ketmasin.
  await removeStaff(identity).catch(() => {});
  return res.status(200).json({ ok: true, anonymised: result.anonymised });
};

/* ---------- Ikonkalar ----------
   Ilovadagi har bir ikonka (SVG sprite'dagi `<symbol>`) o'z rasmi
   bilan almashtirilishi mumkin. Bazada faqat {id: havola} jadvali
   turadi; rasmning o'zi R2'da.

   Nega base64 qabul qilinmaydi: bu jadval har bir tashrifchiga
   /api/config orqali boradi. Rasmlar uning ichiga kirsa, har
   ochilishda yuz kilobaytlab ortiqcha ma'lumot ketardi — ya'ni
   ikonka almashtirish saytni sekinlashtirardi. Shuning uchun
   saqlash sozlanmagan bo'lsa, sabab ochiq aytiladi. */
const ICONS_KEY = 'icon_overrides';
const ICON_ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const MAX_ICON_BYTES = 200 * 1024;
/* Kirish ekranidagi rasm — butun ekran kengligida, shuning uchun
   chegarasi kattaroq. Lekin baribir chegarasi bor: u ilovaning
   eng birinchi ekranida yuklanadi. */
const MAX_WELCOME_BYTES = 600 * 1024;
const MAX_ICONS = 200;

const readIcons = async () => {
  try {
    const parsed = JSON.parse((await kvGet(ICONS_KEY)) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const getIcons = async (res) => {
  const { urls, plain } = normalizeIcons(await readIcons());
  return res.status(200).json({
    ok: true,
    icons: urls,
    // O'z rangida chiziladiganlar; qolgani ilova rangini oladi.
    iconsPlain: plain,
    storage: storageConfigured(),
    // Sozlanmagan bo'lsa — aynan qaysi o'zgaruvchi yetishmayotgani.
    // Faqat nomlari; qiymatlar hech qachon chiqarilmaydi.
    missing: storageMissing(),
  });
};

/**
 * Panel belgisi (logo). Ikonkalardan farqi: bu ilovaning
 * belgilaridan biri emas, faqat admin panelning sarlavhasida
 * turadi — shuning uchun ikonkalar jadvaliga qo'shilmaydi,
 * sozlamalarga yoziladi.
 *
 * Rasm ikki yo'l bilan keladi — tanlangan fayl (`dataUrl`) yoki
 * Chrome'dan sudrab tashlangan manzil (`url`). Ikkinchisini
 * server olib keladi, sababi saveIcon izohida yozilgan.
 */
/* Qaysi rasm almashtirilyapti. Ikkalasi ham bir xil yo'l bilan
   yuklanadi, faqat sozlamalardagi kaliti boshqa. */
const LOGO_SLOTS = {
  logo: { key: 'adminLogoUrl', folder: 'logo' },
  welcome: { key: 'welcomeImageUrl', folder: 'welcome' },
  /* Yordamchi (mascot). Qo'yilmasa ilovaning o'z chizmasi
     qoladi — u chizma qismlarga bo'lingani uchun ko'zi ham,
     boshi ham alohida harakatlanadi. Rasm qo'yilsa butun
     tanasi harakatlanadi. */
  bot: { key: 'mascotImageUrl', folder: 'bot' },
};

const saveLogo = async (req, res) => {
  if (!storageConfigured()) {
    const missing = storageMissing();
    return res.status(503).json({
      error: `Fayl saqlash sozlanmagan. Yetishmayapti: ${missing.join(', ')}`,
      missing,
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const slot = LOGO_SLOTS[String(body.slot || 'logo')];
  if (!slot) return res.status(400).json({ error: 'Noto‘g‘ri rasm turi' });

  // Bo'shatish: o'rniga ilovaning o'z rasmi qaytadi.
  if (body.remove) {
    const next = await readSettings();
    const oldKey = keyFromUrl(next[slot.key]);
    next[slot.key] = '';
    if (!(await kvSet(SETTINGS_KEY, JSON.stringify(next)))) {
      return res.status(500).json({ error: 'Saqlanmadi' });
    }
    if (oldKey) deleteObject(oldKey).catch(() => {});
    return res.status(200).json({ ok: true, settings: next });
  }

  let source = body.dataUrl;
  if (!source && body.url) {
    const slotName = String(body.slot || 'logo');
    const got = await fetchRemoteImage(body.url,
      (slotName === 'welcome' || slotName === 'bot') ? MAX_WELCOME_BYTES : MAX_ICON_BYTES);
    if (got.error) return res.status(400).json({ error: got.error });
    source = got.dataUrl;
  }
  if (!source) return res.status(400).json({ error: 'Rasm berilmadi' });

  /* Kirish ekranidagi rasm belgidan ancha katta bo'lishi tabiiy —
     u butun ekran kengligida turadi. */
  const limit = (slot.folder === 'welcome' || slot.folder === 'bot')
    ? MAX_WELCOME_BYTES : MAX_ICON_BYTES;
  const uploaded = await uploadImage(source, slot.folder, limit);
  if (!uploaded || uploaded.error) {
    return res.status(400).json({ error: (uploaded && uploaded.error) || 'Rasm yuklanmadi' });
  }

  const next = await readSettings();
  const previousUrl = next[slot.key];
  next[slot.key] = uploaded.url;
  if (!(await kvSet(SETTINGS_KEY, JSON.stringify(next)))) {
    return res.status(500).json({ error: 'Saqlanmadi' });
  }

  const oldKey = keyFromUrl(previousUrl);
  if (oldKey && previousUrl !== uploaded.url) deleteObject(oldKey).catch(() => {});

  return res.status(200).json({ ok: true, settings: next });
};

const saveIcon = async (req, res) => {
  if (!storageConfigured()) {
    const missing = storageMissing();
    return res.status(503).json({
      error: `Fayl saqlash sozlanmagan. Yetishmayapti: ${missing.join(', ')}`,
      missing,
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const id = String(body.id || '').trim();
  if (!ICON_ID_RE.test(id)) return res.status(400).json({ error: 'Ikonka nomi noto‘g‘ri' });

  const icons = await readIcons();
  if (!icons[id] && Object.keys(icons).length >= MAX_ICONS) {
    return res.status(400).json({ error: 'Juda ko‘p ikonka almashtirilgan' });
  }

  /* Rasm ikki yo'l bilan kelishi mumkin:
       dataUrl — fayl tanlangan yoki qo'yilgan (paste);
       url     — Chrome'dan to'g'ridan tortib tashlangan.

     Ikkinchi holatda brauzer rasmning o'zini bermaydi, faqat
     manzilini beradi — va o'sha manzilni brauzerning o'zi
     yuklab olishi ham ishlamaydi (CORS). Shuning uchun uni
     server olib keladi; tekshiruvlar lib/remoteImage.js da. */
  let source = body.dataUrl;
  if (!source && body.url) {
    const got = await fetchRemoteImage(body.url, MAX_ICON_BYTES);
    if (got.error) return res.status(400).json({ error: got.error });
    source = got.dataUrl;
  }

  const uploaded = await uploadImage(source, 'icon', MAX_ICON_BYTES);
  if (!uploaded || uploaded.error) {
    return res.status(400).json({ error: (uploaded && uploaded.error) || 'Rasm yuklanmadi' });
  }

  const previous = icons[id];
  /* Rasm odatda ilova rangida chiziladi — shunda u qorong'u va
     yorug' rejimda, tanlangan bo'lim ustida ham to'g'ri ko'rinadi.
     `plain` — rangli belgilar uchun (Telegram, tasdiq nishoni). */
  const plain = body.plain === undefined ? iconIsPlain(previous) : Boolean(body.plain);
  icons[id] = iconEntry(uploaded.url, plain);
  if (!(await kvSet(ICONS_KEY, JSON.stringify(icons)))) {
    return res.status(500).json({ error: 'Saqlanmadi' });
  }

  // Eski rasm endi hech qayerda ishlatilmaydi.
  const previousUrl = iconUrl(previous);
  const oldKey = keyFromUrl(previousUrl);
  if (oldKey && previousUrl !== uploaded.url) deleteObject(oldKey).catch(() => {});

  return res.status(200).json({ ok: true, id, url: uploaded.url, plain });
};

/**
 * Rasmni qayta yuklamasdan faqat rejimini almashtirish:
 * ilova rangida chizilsinmi yoki o'z rangida.
 */
const setIconMode = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const id = String(body.id || '').trim();
  if (!ICON_ID_RE.test(id)) return res.status(400).json({ error: 'Ikonka nomi noto‘g‘ri' });

  const icons = await readIcons();
  const url = iconUrl(icons[id]);
  if (!url) return res.status(404).json({ error: 'Bu ikonka almashtirilmagan' });

  const plain = Boolean(body.plain);
  icons[id] = iconEntry(url, plain);
  if (!(await kvSet(ICONS_KEY, JSON.stringify(icons)))) {
    return res.status(500).json({ error: 'Saqlanmadi' });
  }
  return res.status(200).json({ ok: true, id, plain });
};

const deleteIcon = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const id = String(body.id || '').trim();
  if (!ICON_ID_RE.test(id)) return res.status(400).json({ error: 'Ikonka nomi noto‘g‘ri' });

  const icons = await readIcons();
  if (!icons[id]) return res.status(404).json({ error: 'Bu ikonka almashtirilmagan' });

  const previous = icons[id];
  delete icons[id];
  if (!(await kvSet(ICONS_KEY, JSON.stringify(icons)))) {
    return res.status(500).json({ error: 'Saqlanmadi' });
  }
  const oldKey = keyFromUrl(iconUrl(previous));
  if (oldKey) deleteObject(oldKey).catch(() => {});

  // Asl (chizilgan) ikonka qaytadi — hech narsa yo'qolmaydi.
  return res.status(200).json({ ok: true, id });
};

/** Read permission required per GET resource. */
/* Upstash bepul tarifidagi chegaralar. Agar tarif o'zgarsa, shu
   ikki qiymatni o'zgartirish kifoya. */
const QUOTA_BYTES = 256 * 1024 * 1024;     // 256 MB
const QUOTA_COMMANDS = 500000;             // oyiga

/**
 * GET ?resource=usage — baza qancha to'lgani.
 *
 * Joy va kalitlar soni Redis'ning o'zidan olinadi, shuning uchun
 * aniq. Buyruqlar sonini Upstash bermaydi — uni lib/kv.js o'zi
 * sanaydi va har 25 tasida bir marta yozadi, shuning uchun u
 * TAXMINIY (lambda to'xtaganda bir nechtasi yo'qoladi). Admin
 * panelda ham shunday yozib qo'yilgan.
 */
const getUsage = async (res) => {
  const [bytes, keys, commands] = await Promise.all([
    kvUsedMemory().catch(() => null),
    kvDbSize().catch(() => null),
    kvMonthCommands().catch(() => null),
  ]);
  const pct = (used, limit) =>
    (used === null || used === undefined) ? null : Math.round((used / limit) * 1000) / 10;
  return res.status(200).json({
    storage: { bytes, limit: QUOTA_BYTES, percent: pct(bytes, QUOTA_BYTES) },
    commands: { count: commands, limit: QUOTA_COMMANDS, percent: pct(commands, QUOTA_COMMANDS), approximate: true },
    keys,
    month: new Date().toISOString().slice(0, 7),
  });
};

/* ---------- Xodimlar ----------
   Nima uchun bu ro'yxat panelga kirish huquqi EMAS — lib/staff.js
   boshida batafsil yozilgan. Qisqasi: kirish hamon parol bilan,
   bu yerdagi yozuv esa odamning profilida "Administrator" degan
   yorliq chiqishi uchun. */
const getStaff = async (res) => {
  const staff = await listStaff();
  return res.status(200).json({
    ok: true,
    staff,
    counts: countByRole(staff),
    roles: STAFF_ROLES,
    roleLabels: STAFF_ROLE_LABELS,
  });
};

/**
 * Yozilgan qiymatdan haqiqiy identifikatorni topadi.
 *
 * Qabul qilinadi:
 *   - identifikatorning o'zi (email yoki `tg:<id>`);
 *   - `@username` yoki shunchaki username;
 *   - telefon raqami (+998... yoki faqat raqamlar).
 *
 * Topilmasa `null`.
 */
const resolveStaffIdentity = async (raw) => {
  const value = String(raw || '').trim();
  if (!value) return null;

  if (await kvGet(`profile:${value}`)) return value;

  /* @username — ilovada odamlar bir-birini shu nom bilan biladi. */
  const uname = value.replace(/^@/, '').toLowerCase();
  if (uname && uname !== value.toLowerCase()) {
    const byAt = await kvGet(`username:${uname}`);
    if (byAt && await kvGet(`profile:${byAt}`)) return byAt;
  }
  if (/^[a-z0-9_]{2,32}$/.test(uname)) {
    const byName = await kvGet(`username:${uname}`);
    if (byName && await kvGet(`profile:${byName}`)) return byName;
  }

  /* Telefon raqami — bo'sh joy, qavs va chiziqlari bilan
     yozilgan bo'lishi mumkin. */
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length >= 9) {
    for (const form of [`+${digits}`, digits, `+998${digits.slice(-9)}`]) {
      const owner = await kvGet(`phoneOwner:${form}`);
      if (owner && await kvGet(`profile:${owner}`)) return owner;
    }
  }
  return null;
};

const saveStaffMember = async (req, res, byRole) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const identity = String(body.identity || body.email || '').trim();
  if (!identity) return res.status(400).json({ error: 'Foydalanuvchi ko‘rsatilmagan' });

  /* Mavjud bo'lmagan hisobni xodim qilib qo'yish — yozuv hech
     kimga tegmaydigan joyda qolib ketishi. Shuning uchun profil
     borligini tekshiramiz.

     ODAM ESLAB QOLGAN NARSANI YOZADI. Ilgari faqat ichki
     identifikator qabul qilinardi va "@ali" yoki telefon raqami
     yozilsa "foydalanuvchi topilmadi" chiqardi — holbuki odam
     bor edi. Endi uchchala shakl ham tanib olinadi. */
  const who = await resolveStaffIdentity(identity);
  if (!who) {
    return res.status(404).json({
      error: 'Bunday foydalanuvchi topilmadi. Email, @username yoki telefon raqamini kiriting.',
    });
  }

  const result = await saveStaff(who, {
    role: String(body.role || ''),
    title: body.title,
    addedBy: byRole,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });

  const staff = await listStaff();
  return res.status(200).json({ ok: true, staff, counts: countByRole(staff) });
};

const removeStaffMember = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const identity = String(body.identity || '').trim();
  if (!identity) return res.status(400).json({ error: 'Foydalanuvchi ko‘rsatilmagan' });
  await removeStaff(identity);
  const staff = await listStaff();
  return res.status(200).json({ ok: true, staff, counts: countByRole(staff) });
};

/** To'lov hisoblari — haqiqiy yozuvlar, hisoblangan jamilari bilan. */
const getInvoices = async (res) => {
  const invoices = await listInvoices(100);
  const paid = invoices.filter((i) => i.state === 'PAID');
  return res.status(200).json({
    invoices,
    totals: {
      paidCount: paid.length,
      paidSum: paid.reduce((a, i) => a + (Number(i.amount) || 0), 0),
      waiting: invoices.filter((i) => i.state === 'NEW' || i.state === 'HOLD').length,
    },
    /* To'lov tizimi ulanganmi — panel buni ochiq ko'rsatsin. */
    providers: activeProviders(),
  });
};

const READ_PERMISSIONS = {
  usage: 'settings:read',
  orders: 'orders:read',
  users: 'users:read',
  messages: 'messages:read',
  reports: 'reports:read',
  trucks: 'trucks:read',
  truck: 'trucks:read',
  settings: 'settings:read',
  /* Pasport/guvohnoma rasmi — eng maxfiy narsa. Shuning uchun
     uning O'Z ruxsati bor va u faqat hujjatni KO'RIB CHIQA
     oladigan rolda bo'ladi.

     Ilgari bu `users:read` edi, ya'ni moderator ham ko'rardi —
     garchi uni tasdiqlab yoki rad etib bo'lmasa ham
     (`verify-review` → `users:write`, moderatorda yo'q). Ya'ni
     u faqat qarab qo'yish uchun begonaning pasportini ochardi:
     foydasi yo'q, zarari bor.

     Agar keyinroq moderator hujjatni oldindan ko'rib chiqishi
     kerak bo'lsa, buni MODERATOR ruxsatlariga `users:verify`
     qo'shib qaytarish mumkin (lib/adminAuth.js) — lekin unda
     `verify-review` ni ham berish kerak, aks holda holat yana
     shunday bo'lib qoladi. */
  verifydoc: 'users:verify',
  life: 'life:read',
  icons: 'icons:read',
  staff: 'staff:read',
  invoices: 'payments:read',
};

/** Write permission required per POST action. */
const WRITE_PERMISSIONS = {
  'update-report': 'reports:write',
  'verify-driver': 'users:write',
  'verify-review': 'users:write',
  'update-user': 'users:write',
  'update-truck': 'trucks:write',
  'update-settings': 'settings:write',
  'requeue-legacy': 'trucks:write',
  'save-life': 'life:write',
  'delete-life': 'life:write',
  'save-icon': 'icons:write',
  'delete-icon': 'icons:write',
  'icon-mode': 'icons:write',
  'save-logo': 'settings:write',
  // Hech bir rolda yo'q — faqat SUPER_ADMIN dagi "*" qamrab oladi.
  'purge-orders': 'orders:purge',
  // Bular ham faqat SUPER_ADMIN da — lib/adminAuth.js dagi izohga qarang.
  'save-staff': 'staff:write',
  'delete-staff': 'staff:write',
  'delete-message': 'messages:write',
  'delete-report': 'reports:write',
  /* Butun ro'yxatni tozalash va hisob o'chirish — faqat
     SUPER_ADMIN dagi "*". Qaytarib bo'lmaydigan ishlar. */
  'purge-messages': 'messages:purge',
  'purge-reports': 'reports:purge',
  'delete-order': 'orders:purge',
  'delete-user': 'users:purge',
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const resource = String(req.query.resource || '');
    const permission = READ_PERMISSIONS[resource];
    if (!permission) {
      // Still require a session before saying anything about the request.
      if (!await requireAdmin(req, res)) return;
      return res.status(400).json({ error: 'Noto‘g‘ri resource' });
    }
    if (!await requireAdmin(req, res, permission)) return;

    if (resource === 'usage') return getUsage(res);
    if (resource === 'orders') return getOrders(res);
    if (resource === 'users') return getUsers(res);
    if (resource === 'messages') return getMessages(res);
    if (resource === 'reports') return getReports(res);
    if (resource === 'trucks') return getTrucks(res);
    if (resource === 'truck') return getTruck(req, res);
    if (resource === 'settings') return getSettings(res);
    if (resource === 'verifydoc') return getVerifyDoc(req, res);
    if (resource === 'life') return getLife(res);
    if (resource === 'icons') return getIcons(res);
    if (resource === 'staff') return getStaff(res);
    if (resource === 'invoices') return getInvoices(res);
  }

  if (req.method === 'POST') {
    const action = String(req.query.action || '');
    const permission = WRITE_PERMISSIONS[action];
    if (!permission) {
      if (!await requireAdmin(req, res)) return;
      return res.status(400).json({ error: 'Noto‘g‘ri action' });
    }
    const byRole = await requireAdmin(req, res, permission);
    if (!byRole) return;

    if (action === 'update-report') return updateReport(req, res);
    if (action === 'verify-driver') return verifyDriver(req, res);
    if (action === 'verify-review') return reviewVerification(req, res);
    if (action === 'update-user') return updateUser(req, res);
    if (action === 'update-truck') return updateTruck(req, res);
    if (action === 'update-settings') return updateSettings(req, res);
    if (action === 'requeue-legacy') return requeueLegacy(req, res);
    if (action === 'save-life') return saveLife(req, res);
    if (action === 'delete-life') return deleteLife(req, res);
    if (action === 'save-icon') return saveIcon(req, res);
    if (action === 'delete-icon') return deleteIcon(req, res);
    if (action === 'icon-mode') return setIconMode(req, res);
    if (action === 'save-logo') return saveLogo(req, res);
    if (action === 'purge-orders') return purgeOrders(req, res);
    if (action === 'save-staff') return saveStaffMember(req, res, byRole);
    if (action === 'delete-staff') return removeStaffMember(req, res);
    if (action === 'delete-message') return deleteMessage(req, res);
    if (action === 'purge-messages') return purgeMessages(req, res);
    if (action === 'delete-report') return deleteReport(req, res);
    if (action === 'purge-reports') return purgeReports(req, res);
    if (action === 'delete-order') return deleteOrder(req, res);
    if (action === 'delete-user') return deleteUser(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
