/**
 * /api/order — order creation, status lookup, and rating, in one function.
 *
 * Folded into one file (from three: order.js, order-status.js, order-rate.js)
 * because Vercel's Hobby plan caps a deployment at 12 serverless functions,
 * and this app had grown past that. Dispatch is by HTTP method, plus an
 * `?action=rate` query param to tell a POST apart from creating an order:
 *
 *   POST /api/order                       — create an order (unchanged body/behavior)
 *   GET  /api/order?code=&phone=          — look up an order's status by code+phone
 *   GET  /api/order?action=list&...       — browse open loads (the "Yuklar" tab)
 *   POST /api/order?action=rate           — rate the driver once DELIVERED
 *
 * The bot token never reaches the browser — that is the whole reason this
 * function exists rather than the page calling Telegram directly.
 */

import { kvPush, kvGet, kvSet, kvSismember, kvRange } from '../lib/kv.js';
import { verifyGoogleEmail } from '../lib/google.js';
import { CARGO, buildOrderMessage, STATUS_LABELS } from '../lib/orderMessage.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// Group id is not a secret, so it ships with the code as a fallback.
const GROUP_ID = process.env.TELEGRAM_GROUP_ID || '-1003778958582';

const PRICE_PER_KM = Number(process.env.PRICE_PER_KM || 2500);
const PRICE_PER_KG = Number(process.env.PRICE_PER_KG || 300);
const PRICE_MINIMUM = Number(process.env.PRICE_MINIMUM || 150000);

const CITIES = [
  'Toshkent', 'Samarqand', 'Buxoro', 'Andijon', 'Namangan', 'Nukus', 'Qarshi', 'Urganch',
  'Farg\'ona', 'Jizzax', 'Navoiy', 'Guliston', 'Termiz',
];

const DISTANCE = {
  'Andijon|Buxoro': 700, 'Andijon|Farg\'ona': 75, 'Andijon|Guliston': 350,
  'Andijon|Jizzax': 420, 'Andijon|Namangan': 90, 'Andijon|Navoiy': 600,
  'Andijon|Nukus': 1450, 'Andijon|Qarshi': 750, 'Andijon|Samarqand': 480,
  'Andijon|Termiz': 950, 'Andijon|Toshkent': 320, 'Andijon|Urganch': 1300,
  'Buxoro|Farg\'ona': 730, 'Buxoro|Guliston': 450, 'Buxoro|Jizzax': 350,
  'Buxoro|Namangan': 650, 'Buxoro|Navoiy': 120, 'Buxoro|Nukus': 550,
  'Buxoro|Qarshi': 280, 'Buxoro|Samarqand': 270, 'Buxoro|Termiz': 530,
  'Buxoro|Toshkent': 450, 'Buxoro|Urganch': 450, 'Farg\'ona|Guliston': 380,
  'Farg\'ona|Jizzax': 420, 'Farg\'ona|Namangan': 110, 'Farg\'ona|Navoiy': 650,
  'Farg\'ona|Nukus': 1470, 'Farg\'ona|Qarshi': 780, 'Farg\'ona|Samarqand': 500,
  'Farg\'ona|Termiz': 950, 'Farg\'ona|Toshkent': 330, 'Farg\'ona|Urganch': 1320,
  'Guliston|Jizzax': 120, 'Guliston|Namangan': 320, 'Guliston|Navoiy': 330,
  'Guliston|Nukus': 950, 'Guliston|Qarshi': 400, 'Guliston|Samarqand': 200,
  'Guliston|Termiz': 600, 'Guliston|Toshkent': 120, 'Guliston|Urganch': 800,
  'Jizzax|Namangan': 380, 'Jizzax|Navoiy': 200, 'Jizzax|Nukus': 850,
  'Jizzax|Qarshi': 330, 'Jizzax|Samarqand': 100, 'Jizzax|Termiz': 500,
  'Jizzax|Toshkent': 200, 'Jizzax|Urganch': 700, 'Namangan|Navoiy': 570,
  'Namangan|Nukus': 1400, 'Namangan|Qarshi': 700, 'Namangan|Samarqand': 440,
  'Namangan|Termiz': 900, 'Namangan|Toshkent': 280, 'Namangan|Urganch': 1250,
  'Navoiy|Nukus': 430, 'Navoiy|Qarshi': 230, 'Navoiy|Samarqand': 150,
  'Navoiy|Termiz': 450, 'Navoiy|Toshkent': 430, 'Navoiy|Urganch': 330,
  'Nukus|Qarshi': 700, 'Nukus|Samarqand': 950, 'Nukus|Termiz': 1150,
  'Nukus|Toshkent': 1200, 'Nukus|Urganch': 180, 'Qarshi|Samarqand': 220,
  'Qarshi|Termiz': 280, 'Qarshi|Toshkent': 520, 'Qarshi|Urganch': 750,
  'Samarqand|Termiz': 420, 'Samarqand|Toshkent': 300, 'Samarqand|Urganch': 800,
  'Termiz|Toshkent': 700, 'Termiz|Urganch': 1000, 'Toshkent|Urganch': 1050
};

// Matches the driver-profile field of the same name in api/profile.js —
// kept as a duplicate literal rather than a shared import, same pattern
// already used for CITIES across these serverless files.
const VEHICLE_TYPES = ['ISUZU', 'GAZEL', 'FURGON', 'YARIM_TREYLER', 'SAMOSVAL', 'BOSHQA'];

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const generateCode = () => {
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `YL-${out}`;
};

const normalisePhone = (v) => {
  const d = String(v).replace(/\D/g, '');
  if (d.length === 9) return `+998${d}`;
  if (d.length === 12 && d.startsWith('998')) return `+${d}`;
  return '';
};

/**
 * Crude in-memory throttle. Serverless instances are ephemeral, so this only
 * blunts a burst from one warm instance — put a real WAF rule in front for
 * anything serious.
 */
const recent = new Map();
const isThrottled = (key) => {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > 60_000) recent.delete(k);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
};

const validate = (body) => {
  const errors = [];

  const fromCity = String(body.fromCity || '');
  const toCity = String(body.toCity || '');
  if (!CITIES.includes(fromCity)) errors.push('Noto‘g‘ri shahar (qayerdan)');
  if (!CITIES.includes(toCity)) errors.push('Noto‘g‘ri shahar (qayerga)');
  if (fromCity && fromCity === toCity) errors.push('Shaharlar bir xil bo‘lmasin');

  const weightKg = Number(body.weightKg);
  if (!Number.isInteger(weightKg) || weightKg < 1 || weightKg > 50_000) {
    errors.push('Og‘irlik 1 dan 50000 kg gacha bo‘lsin');
  }

  const cargoType = String(body.cargoType || 'GENERAL');
  if (!CARGO[cargoType]) errors.push('Noto‘g‘ri yuk turi');

  let customCargoLabel = '';
  if (cargoType === 'OTHER') {
    customCargoLabel = String(body.customCargoLabel || '').trim().slice(0, 60);
    if (!customCargoLabel) errors.push('Yuk turini yozing');
  }

  const name = String(body.name || '').trim().slice(0, 80);
  if (name.length < 2) errors.push('Ismni kiriting');

  const phone = normalisePhone(body.phone);
  if (!phone) errors.push('Telefon raqam noto‘g‘ri');

  const note = String(body.note || '').trim().slice(0, 300);

  // Both optional — shown on the "Yuklar" browse cards and used as filters
  // there, but never required to post a load.
  const truckType = String(body.truckType || '');
  if (truckType && !VEHICLE_TYPES.includes(truckType)) errors.push('Noto‘g‘ri mashina turi');

  let pickupDate = String(body.pickupDate || '');
  if (pickupDate && !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
    errors.push('Yuklash sanasi noto‘g‘ri');
    pickupDate = '';
  }

  // Optional: the cargo owner can propose their own price instead of the
  // auto-calculated one. Empty/absent means "use the calculated price".
  let proposedAmount = null;
  if (body.proposedAmount !== undefined && body.proposedAmount !== null && body.proposedAmount !== '') {
    proposedAmount = Number(body.proposedAmount);
    if (!Number.isInteger(proposedAmount) || proposedAmount < 10_000 || proposedAmount > 100_000_000) {
      errors.push('Taklif qilingan narx noto‘g‘ri');
      proposedAmount = null;
    }
  }

  return {
    errors,
    value: {
      fromCity, toCity, weightKg, cargoType, customCargoLabel, truckType, pickupDate,
      name, phone, note, proposedAmount,
    },
  };
};

const quote = ({ fromCity, toCity, weightKg, cargoType }) => {
  const distanceKm = DISTANCE[[fromCity, toCity].sort().join('|')] ?? 400;
  const mult = CARGO[cargoType].mult;
  const rounded = Math.round(((distanceKm * PRICE_PER_KM + weightKg * PRICE_PER_KG) * mult) / 1000) * 1000;
  return { distanceKm, amount: Math.max(PRICE_MINIMUM, rounded) };
};

const telegram = async (method, payload) => {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || 'Telegram API error');
  return json.result;
};

const createOrder = async (req, res) => {
  if (!BOT_TOKEN || !GROUP_ID) {
    return res.status(500).json({ error: 'Server sozlanmagan' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});

  const googleEmail = await verifyGoogleEmail(body.googleIdToken);
  if (!googleEmail) {
    return res.status(401).json({ error: 'Avval Google orqali kiring' });
  }
  if (await kvSismember('banned', googleEmail.toLowerCase())) {
    return res.status(403).json({ error: 'Sizga xizmatdan foydalanish cheklangan' });
  }

  const { errors, value } = validate(body);
  if (errors.length) {
    return res.status(400).json({ error: errors[0], errors });
  }
  if (value.phone && (await kvSismember('banned', value.phone.toLowerCase()))) {
    return res.status(403).json({ error: 'Sizga xizmatdan foydalanish cheklangan' });
  }

  if (isThrottled(value.phone)) {
    return res.status(429).json({ error: 'Biroz kuting va qayta urinib ko‘ring' });
  }

  const { distanceKm, amount: estimatedAmount } = quote(value);
  const code = generateCode();
  const isProposed = value.proposedAmount != null;
  const amount = isProposed ? value.proposedAmount : estimatedAmount;
  // status/driver/rating are the fields /api/telegram updates as the order
  // moves through its lifecycle — see lib/orderMessage.js for the states.
  const order = {
    ...value, code, distanceKm, amount, estimatedAmount, isProposed, googleEmail,
    status: 'NEW', driver: null, rating: null,
  };

  try {
    await telegram('sendMessage', {
      chat_id: GROUP_ID,
      text: buildOrderMessage(order),
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [[
          {
            text: '✅ Men olaman',
            // The phone rides in callback_data so the bot can reveal it to
            // whoever taps first, even if the KV write below never lands.
            callback_data: `take:${code}:${value.phone}`,
          },
        ]],
      },
    });

    // Persisted as its own key (not just appended to a list) so /api/telegram
    // can update its status later, and so the owner can track it by code.
    // Best-effort — the order already went to Telegram either way, so a
    // logging hiccup never blocks the customer.
    kvSet(`order:${code}`, JSON.stringify({ ...order, createdAt: Date.now() })).catch(() => {});
    kvPush('order_codes', code).catch(() => {});

    return res.status(200).json({ ok: true, code, amount, distanceKm });
  } catch (err) {
    console.error('Telegram send failed:', err.message);
    return res.status(502).json({ error: 'Hozircha yuborib bo‘lmadi, birozdan keyin urinib ko‘ring' });
  }
};

/** GET ?code=&phone= — a cargo owner checking their own order's status. */
const getOrderStatus = async (req, res) => {
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
};

/**
 * GET ?action=list&fromCity=&toCity=&cargoType=&truckType=&minWeight=&
 * maxWeight=&when=today|tomorrow — the "Yuklar" tab's browse list.
 *
 * Public, no sign-in required to browse (only to post or claim a load).
 * The response deliberately omits phone, name, note and googleEmail — the
 * same "only the driver who claims it sees the contact info" rule the FAQ
 * already promises applies here too.
 */
const listLoads = async (req, res) => {
  const q = req.query;
  const fromCity = String(q.fromCity || '');
  const toCity = String(q.toCity || '');
  const cargoType = String(q.cargoType || '');
  const truckType = String(q.truckType || '');
  const minWeight = q.minWeight ? Number(q.minWeight) : null;
  const maxWeight = q.maxWeight ? Number(q.maxWeight) : null;
  const when = String(q.when || '');

  const todayIso = new Date().toISOString().slice(0, 10);
  const tomorrowIso = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const codes = await kvRange('order_codes', 0, 299);
  const raw = await Promise.all(codes.map((code) => kvGet(`order:${code}`)));

  const loads = raw
    .map((s) => {
      if (!s) return null;
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    })
    .filter((o) => o && (o.status || 'NEW') === 'NEW')
    .filter((o) => !fromCity || o.fromCity === fromCity)
    .filter((o) => !toCity || o.toCity === toCity)
    .filter((o) => !cargoType || o.cargoType === cargoType)
    .filter((o) => !truckType || o.truckType === truckType)
    .filter((o) => minWeight == null || o.weightKg >= minWeight)
    .filter((o) => maxWeight == null || o.weightKg <= maxWeight)
    .filter((o) => {
      if (when === 'today') return !o.pickupDate || o.pickupDate === todayIso;
      if (when === 'tomorrow') return o.pickupDate === tomorrowIso;
      return true;
    })
    .slice(0, 60)
    .map((o) => ({
      code: o.code,
      fromCity: o.fromCity,
      toCity: o.toCity,
      cargoType: o.cargoType,
      customCargoLabel: o.customCargoLabel || '',
      weightKg: o.weightKg,
      amount: o.amount,
      distanceKm: o.distanceKm,
      truckType: o.truckType || '',
      pickupDate: o.pickupDate || '',
      createdAt: o.createdAt,
    }));

  return res.status(200).json({ loads });
};

/**
 * POST ?action=rate — rate the driver once DELIVERED, using the same
 * code+phone ownership check as getOrderStatus. One rating per order — the
 * driver's aggregate is rolled up onto their profile, but only if they
 * linked a Telegram username to a Google account.
 */
const rateOrder = async (req, res) => {
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
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (String(req.query.action || '') === 'list') return listLoads(req, res);
    return getOrderStatus(req, res);
  }
  if (req.method === 'POST') {
    if (String(req.query.action || '') === 'rate') return rateOrder(req, res);
    return createOrder(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
