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
 *   GET  /api/order?action=detail&code=   — one load's full details page
 *   GET  /api/order?action=backhaul&...   — return-trip load suggestions for a driver
 *   POST /api/order?action=rate           — rate the driver once DELIVERED
 *
 * The bot token never reaches the browser — that is the whole reason this
 * function exists rather than the page calling Telegram directly.
 */

import { kvPush, kvGet, kvSet, kvSismember, kvSmembers, kvRange } from '../lib/kv.js';
import { resolveIdentity, resolveEmail } from '../lib/identity.js';
import {
  CARGO, buildOrderMessage, STATUS_LABELS, formatNum, nextStatus, NEXT_STATUS_BUTTON,
} from '../lib/orderMessage.js';
import { notifyUser, esc } from '../lib/notify.js';
import { ANY_CITY, cityIndexKey, searchesKey, matchesSearch } from '../lib/savedSearch.js';
import {
  OFFERABLE_ORDER_STATUSES, MAX_OFFERS_PER_ORDER, validateOffer,
  offerKey, orderOffersKey, driverOffersKey, publicOfferShape,
} from '../lib/offers.js';
import { validateReview, applyReview, reviewsKey, CRITERIA } from '../lib/reviews.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '';
// Group id is not a secret, so it ships with the code as a fallback.
const GROUP_ID = process.env.TELEGRAM_GROUP_ID || '-1003778958582';

const PRICE_PER_KM = Number(process.env.PRICE_PER_KM || 2500);
const PRICE_PER_KG = Number(process.env.PRICE_PER_KG || 300);
const PRICE_MINIMUM = Number(process.env.PRICE_MINIMUM || 150000);

const CITIES = [
  'Toshkent', 'Samarqand', 'Buxoro', 'Andijon', 'Namangan', 'Nukus', 'Qarshi', 'Urganch',
  'Farg\'ona', 'Jizzax', 'Navoiy', 'Guliston', 'Termiz',
];

/** O'zbekiston chegarasining taxminiy to'rtburchagi — xarita nuqtalari uchun. */
const UZ_BOUNDS = { minLat: 37.1, maxLat: 45.7, minLng: 55.9, maxLng: 73.2 };

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

  /* Aniq olib ketish va yetkazish nuqtalari — ixtiyoriy.
     Ilgari xaritada faqat shahar markazlari turardi: haydovchi
     "Toshkent" ni ko'rardi-yu, shaharning qayeriga borishni bilmasdi
     va telefon qilib so'rashga majbur bo'lardi. Endi manzilni yozish
     va xaritada nuqta belgilash mumkin.

     Chegaradan tashqaridagi koordinata qabul qilinmaydi — bunday
     nuqta xatolikdan boshqa narsa emas, va uni saqlash haydovchini
     yanglish joyga yuborishga olib kelardi. */
  const readPoint = (raw, label) => {
    if (!raw || typeof raw !== 'object') return null;
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < UZ_BOUNDS.minLat || lat > UZ_BOUNDS.maxLat
        || lng < UZ_BOUNDS.minLng || lng > UZ_BOUNDS.maxLng) {
      errors.push(`${label} nuqtasi O‘zbekiston hududidan tashqarida`);
      return null;
    }
    // Besh xona ≈ bir metr aniqlik. Undan ortig'i ma'nosiz.
    return { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 };
  };
  const fromPoint = readPoint(body.fromPoint, 'Olib ketish');
  const toPoint = readPoint(body.toPoint, 'Yetkazish');
  const fromAddress = String(body.fromAddress || '').trim().slice(0, 200);
  const toAddress = String(body.toAddress || '').trim().slice(0, 200);

  /* Hajm va joy soni — ikkalasi ham ixtiyoriy.
     Og'irlik yolg'iz o'zi yetarli emas: bir tonna paxta bilan bir
     tonna sement bir xil mashinaga sig'maydi. Haydovchi yukni
     ko'rmasdan turib mashinasi to'g'ri kelishini bilishi kerak,
     aks holda kelib, ortolmay qaytadi.

     Majburiy qilinmadi: ko'p odam hajmini bilmaydi, va bilmagani
     uchun yukni umuman joylay olmay qolishi kerak emas. */
  let volumeM3 = null;
  if (body.volumeM3 !== undefined && body.volumeM3 !== null && body.volumeM3 !== '') {
    volumeM3 = Math.round(Number(body.volumeM3) * 10) / 10;
    if (!Number.isFinite(volumeM3) || volumeM3 <= 0 || volumeM3 > 200) {
      errors.push('Hajm 0.1 dan 200 m³ gacha bo‘lsin');
      volumeM3 = null;
    }
  }

  let quantity = null;
  if (body.quantity !== undefined && body.quantity !== null && body.quantity !== '') {
    quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100_000) {
      errors.push('Joy soni 1 dan 100000 gacha bo‘lsin');
      quantity = null;
    }
  }

  const QUANTITY_UNITS = ['JOY', 'PALLET', 'QOP', 'QUTI', 'RULON'];
  let quantityUnit = String(body.quantityUnit || '');
  if (quantityUnit && !QUANTITY_UNITS.includes(quantityUnit)) quantityUnit = '';
  if (quantity && !quantityUnit) quantityUnit = 'JOY';

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
      name, phone, note, proposedAmount, volumeM3, quantity, quantityUnit,
      fromPoint, toPoint, fromAddress, toAddress,
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

  const identityResult = await resolveIdentity({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData });
  if (!identityResult) {
    return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });
  }
  const { identity: ownerIdentity, method: ownerMethod, telegramUser: ownerTelegramUser } = identityResult;
  if (await kvSismember('banned', ownerIdentity.toLowerCase())) {
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
  // ownerIdentity is always populated (real email or "tg:<id>") and is what
  // getLoadDetail/getBackhaul use to look the owner's profile back up;
  // googleEmail/telegramOwner are kept as separate, display-only fields so
  // buildOrderHeader can keep showing the exact "✅ Google: x@y.com" line it
  // always has for Google owners, without ever printing a synthetic tg:<id>.
  const order = {
    ...value, code, distanceKm, amount, estimatedAmount, isProposed,
    ownerIdentity,
    googleEmail: ownerMethod === 'google' ? ownerIdentity : null,
    telegramOwner: ownerMethod === 'telegram' ? (ownerTelegramUser.username || null) : null,
    status: 'NEW', driver: null, rating: null,
  };

  try {
    const posted = await telegram('sendMessage', {
      chat_id: GROUP_ID,
      text: buildOrderMessage(order),
      parse_mode: 'MarkdownV2',
      // Guruhdagi tugma endi yukni darrov bermaydi — ilovadagi taklif
      // oynasini ochadi. Telegram kashfiyot kanali bo'lib qoladi,
      // kelishuv esa YO'LDA ichida bo'ladi: yuk beruvchi narx va
      // haydovchini tanlay olsin.
      reply_markup: {
        inline_keyboard: [[
          BOT_USERNAME
            ? { text: '📩 Taklif yuborish', url: `https://t.me/${BOT_USERNAME}?startapp=load_${code}` }
            // Bot username sozlanmagan bo'lsa, eski tezkor oqim ishlayveradi,
            // aks holda guruhda umuman tugma bo'lmasdi.
            : { text: '✅ Men olaman', callback_data: `take:${code}:${value.phone}` },
        ]],
      },
    });

    // Persisted as its own key (not just appended to a list) so /api/telegram
    // can update its status later, and so the owner can track it by code.
    // Best-effort — the order already went to Telegram either way, so a
    // logging hiccup never blocks the customer.
    // groupMessageId — buyurtma bekor qilinganda yoki haydovchi voz
    // kechganda guruhdagi xabarni tahrirlash uchun kerak. Bundan oldin
    // joylangan buyurtmalarda u yo'q: ular baribir bekor qilinadi, faqat
    // guruhdagi eski xabar o'zgarmay qoladi.
    kvSet(`order:${code}`, JSON.stringify({
      ...order,
      createdAt: Date.now(),
      groupMessageId: posted && posted.message_id ? posted.message_id : null,
    })).catch(() => {});
    kvPush('order_codes', code).catch(() => {});

    await notifyMatches({ ...order, createdAt: Date.now() });

    return res.status(200).json({ ok: true, code, amount, distanceKm });
  } catch (err) {
    console.error('Telegram send failed:', err.message);
    return res.status(502).json({ error: 'Hozircha yuborib bo‘lmadi, birozdan keyin urinib ko‘ring' });
  }
};

/**
 * Yangi yuk saqlangan qidiruvlarga mos kelsa, egalariga xabar beradi.
 *
 * Butun foydalanuvchilar ro'yxati ko'rilmaydi: shahar indeksidan faqat
 * shu shahardan (yoki "har qanday shahar") yuk kutayotganlar olinadi.
 *
 * Buyurtma joylash yo'lida turgani uchun ikkita cheklov bor:
 *   - bir yukka ko'pi bilan MAX_MATCH_NOTIFICATIONS ta xabar;
 *   - xato bo'lsa jim o'tiladi — bildirishnoma buyurtmani buzmasin.
 */
const MAX_MATCH_NOTIFICATIONS = 25;

const notifyMatches = async (order) => {
  try {
    const candidates = new Set([
      ...(await kvSmembers(cityIndexKey(order.fromCity))),
      ...(await kvSmembers(cityIndexKey(ANY_CITY))),
    ]);
    // O'z yukining xabari o'ziga kelmasin.
    candidates.delete(order.ownerIdentity);
    if (!candidates.size) return;

    const cargo = CARGO[order.cargoType] || CARGO.OTHER;
    const cargoLabel = order.cargoType === 'OTHER' && order.customCargoLabel
      ? order.customCargoLabel
      : cargo.label;
    const text = `<b>Sizga mos yangi yuk</b>\n\n`
      + `${esc(order.fromCity)} → ${esc(order.toCity)}\n`
      + `${esc(formatNum(order.weightKg))} kg · ${esc(cargoLabel)}\n`
      + `<b>${esc(formatNum(order.amount))} so'm</b>\n\n`
      + `Yuk haydovchilar guruhida — «Men olaman» tugmasini bosgan birinchi haydovchi oladi.`;

    let sent = 0;
    for (const identity of candidates) {
      if (sent >= MAX_MATCH_NOTIFICATIONS) break;
      const searches = JSON.parse((await kvGet(searchesKey(identity))) || '[]');
      if (!Array.isArray(searches) || !searches.some((s) => matchesSearch(order, s))) continue;
      const ok = await notifyUser(identity, { category: 'matches', text });
      if (ok) sent += 1;
    }
  } catch (err) {
    console.error('match notify failed:', err.message);
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
    // Mezonlar server tomondan keladi, shunda ro'yxat bir joyda turadi
    // va sayt bilan tekshiruv qoidasi hech qachon ajralib ketmaydi.
    criteria: CRITERIA.DRIVER,
  });
};

/* ============================================================
   Narx maslahatchisi
   ------------------------------------------------------------
   "Bu yo'nalishda odatda qancha turadi?" — savolga haqiqiy
   buyurtmalar asosida javob. Hech qanday taxmin yoki qo'lda
   kiritilgan tarif yo'q: faqat odamlar aslida e'lon qilgan narxlar.

   Ikkita halollik qoidasi:
     - Yetarli ma'lumot bo'lmasa, hech narsa ko'rsatilmaydi. Ikkita
       buyurtmadan "o'rtacha narx" chiqarish — yolg'on.
     - Bitta raqam emas, oraliq beriladi. Yuk tashishda aniq narx
       yo'q; oraliq esa rost.

   Hisob har so'rovda emas, 15 daqiqada bir marta qilinadi va KV'da
   saqlanadi — aks holda har bir foydalanuvchi 300 ta yozuvni
   o'qishga majbur qilardi.
   ============================================================ */
const PRICE_STATS_KEY = 'price_stats';
const PRICE_STATS_TTL_MS = 15 * 60 * 1000;
/** Shundan kam buyurtma bo'lsa — yo'nalish bo'yicha hech narsa aytmaymiz. */
const MIN_SAMPLE = 5;

const percentile = (sorted, p) => {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const low = Math.floor(idx);
  const high = Math.ceil(idx);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (idx - low);
};

/** Barcha yo'nalishlar bo'yicha tonna-narx taqsimotini qayta hisoblaydi. */
const computePriceStats = async () => {
  const codes = await kvRange('order_codes', 0, 299);
  const perRoute = new Map();

  await Promise.all(
    codes.map(async (code) => {
      const raw = await kvGet(`order:${code}`);
      if (!raw) return;
      let order;
      try {
        order = JSON.parse(raw);
      } catch {
        return;
      }
      const amount = Number(order.amount);
      const weightKg = Number(order.weightKg);
      if (!order.fromCity || !order.toCity) return;
      if (!Number.isFinite(amount) || amount <= 0) return;
      if (!Number.isFinite(weightKg) || weightKg <= 0) return;

      const key = `${order.fromCity}>${order.toCity}`;
      if (!perRoute.has(key)) perRoute.set(key, []);
      perRoute.get(key).push(amount / (weightKg / 1000));
    }),
  );

  const routes = {};
  for (const [key, values] of perRoute) {
    if (values.length < MIN_SAMPLE) continue;
    values.sort((a, b) => a - b);
    routes[key] = {
      count: values.length,
      p25: Math.round(percentile(values, 0.25)),
      p50: Math.round(percentile(values, 0.5)),
      p75: Math.round(percentile(values, 0.75)),
    };
  }

  const stats = { computedAt: Date.now(), routes };
  await kvSet(PRICE_STATS_KEY, JSON.stringify(stats));
  return stats;
};

const readPriceStats = async () => {
  try {
    const cached = JSON.parse((await kvGet(PRICE_STATS_KEY)) || 'null');
    if (cached && Date.now() - cached.computedAt < PRICE_STATS_TTL_MS) return cached;
  } catch {
    // buzilgan kesh — qayta hisoblaymiz
  }
  return computePriceStats();
};

/* ============================================================
   Bosh sahifa statistikasi
   ------------------------------------------------------------
   Faqat bazadagi haqiqiy qiymatlar. Bironta raqam qo'lda
   yozilmagan va "24/7" kabi hech narsa anglatmaydigan ko'rsatkich
   yo'q. Ma'lumot bo'lmasa, raqam umuman qaytarilmaydi va bosh
   sahifa o'sha blokni ko'rsatmaydi.

   price-stats kabi keshlanadi: har bir tashrif buyurtmalarni
   qaytadan sanamasin.
   ============================================================ */
const HOME_STATS_KEY = 'home_stats';
const HOME_STATS_TTL_MS = 10 * 60 * 1000;

const computeHomeStats = async () => {
  const codes = await kvRange('order_codes', 0, 299);
  const orders = (await Promise.all(codes.map((c) => readJson(`order:${c}`, null)))).filter(Boolean);

  const cities = new Set();
  let activeLoads = 0;
  let delivered = 0;
  for (const order of orders) {
    const status = order.status || 'NEW';
    if (status === 'NEW') activeLoads += 1;
    if (status === 'DELIVERED') delivered += 1;
    if (order.fromCity) cities.add(order.fromCity);
    if (order.toCity) cities.add(order.toCity);
  }

  // Haydovchilar: profil yozuvlaridan. kvKeys qimmat, shuning uchun
  // profile_emails indeksidan foydalanamiz (admin paneli ham shuni
  // to'ldirib boradi).
  const identities = await kvSmembers('profile_emails');
  let drivers = 0;
  await Promise.all(identities.map(async (id) => {
    const profile = await readJson(`profile:${id}`, null);
    if (profile && (profile.role === 'DRIVER' || profile.role === 'BOTH')) drivers += 1;
  }));

  const stats = {
    computedAt: Date.now(),
    activeLoads,
    delivered,
    drivers,
    cities: cities.size,
  };
  await kvSet(HOME_STATS_KEY, JSON.stringify(stats));
  return stats;
};

/**
 * GET ?action=stats — bosh sahifadagi raqamlar.
 * Har bir maydon haqiqiy hisob; nol bo'lsa ham rost qaytadi.
 */
const getHomeStats = async (req, res) => {
  let stats = await readJson(HOME_STATS_KEY, null);
  if (!stats || Date.now() - stats.computedAt > HOME_STATS_TTL_MS) {
    stats = await computeHomeStats();
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({
    activeLoads: stats.activeLoads,
    delivered: stats.delivered,
    drivers: stats.drivers,
    cities: stats.cities,
  });
};

/**
 * GET ?action=price-stats&fromCity=&toCity=&weightKg=
 *
 * Ochiq endpoint: javobda faqat yig'ma raqamlar bor, birorta ham
 * buyurtma, ism yoki telefon chiqmaydi.
 */
const getPriceStats = async (req, res) => {
  const fromCity = String(req.query.fromCity || '');
  const toCity = String(req.query.toCity || '');
  const weightKg = Number(req.query.weightKg);
  if (!fromCity || !toCity) return res.status(400).json({ error: 'Yo‘nalish kerak' });

  const stats = await readPriceStats();
  const route = stats.routes[`${fromCity}>${toCity}`];
  if (!route) {
    // Ma'lumot yetarli emas — buni yashirmaymiz, shunchaki aytamiz.
    return res.status(200).json({ enough: false, minSample: MIN_SAMPLE });
  }

  const body = {
    enough: true,
    count: route.count,
    perTon: { low: route.p25, mid: route.p50, high: route.p75 },
  };
  // Og'irlik berilgan bo'lsa, uni shu yukka moslab ko'rsatamiz.
  if (Number.isFinite(weightKg) && weightKg > 0) {
    const tons = weightKg / 1000;
    body.estimate = {
      low: Math.round(route.p25 * tons),
      mid: Math.round(route.p50 * tons),
      high: Math.round(route.p75 * tons),
    };
  }
  return res.status(200).json(body);
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
      volumeM3: o.volumeM3 || null,
      quantity: o.quantity || null,
      quantityUnit: o.quantityUnit || '',
      // Kartochkada nuqta ko'rsatilmaydi, lekin xaritada ko'rsatiladi.
      fromPoint: o.fromPoint || null,
      toPoint: o.toPoint || null,
      amount: o.amount,
      distanceKm: o.distanceKm,
      truckType: o.truckType || '',
      pickupDate: o.pickupDate || '',
      createdAt: o.createdAt,
    }));

  return res.status(200).json({ loads });
};

/**
 * GET ?action=detail&code=XXX — the full-screen load details view.
 * Same privacy rule as listLoads: phone, note, and googleEmail stay hidden
 * from anyone who hasn't claimed the load. The owner's name is shown
 * because it's already broadcast to the whole driver group on Telegram —
 * nothing new is exposed by also showing it here.
 */
const getLoadDetail = async (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Kod kerak' });

  const raw = await kvGet(`order:${code}`);
  if (!raw) return res.status(404).json({ error: 'Topilmadi' });
  let order;
  try {
    order = JSON.parse(raw);
  } catch {
    return res.status(500).json({ error: 'Xato yuz berdi' });
  }

  // The chat "Taklif yuborish" / "Xabar yozish" buttons need a username to
  // address — only resolvable if the owner registered one in their profile.
  // ownerIdentity covers both Google and Telegram owners; older orders
  // (posted before ownerIdentity existed) fall back to googleEmail.
  let ownerUsername = null;
  const ownerKey = order.ownerIdentity || order.googleEmail;
  if (ownerKey) {
    try {
      const praw = await kvGet(`profile:${ownerKey}`);
      if (praw) {
        const profile = JSON.parse(praw);
        ownerUsername = (profile && profile.username) || null;
      }
    } catch {
      // Non-fatal — details still render without a contact button.
    }
  }

  return res.status(200).json({
    ok: true,
    code: order.code,
    fromCity: order.fromCity,
    toCity: order.toCity,
    cargoType: order.cargoType,
    customCargoLabel: order.customCargoLabel || '',
    weightKg: order.weightKg,
    amount: order.amount,
    estimatedAmount: order.estimatedAmount,
    isProposed: Boolean(order.isProposed),
    distanceKm: order.distanceKm,
    volumeM3: order.volumeM3 || null,
    quantity: order.quantity || null,
    quantityUnit: order.quantityUnit || '',
    fromPoint: order.fromPoint || null,
    toPoint: order.toPoint || null,
    fromAddress: order.fromAddress || '',
    toAddress: order.toAddress || '',
    truckType: order.truckType || '',
    pickupDate: order.pickupDate || '',
    status: order.status || 'NEW',
    createdAt: order.createdAt,
    name: order.name,
    ownerUsername,
  });
};

/**
 * GET ?action=backhaul&googleIdToken=... — "Qaytish yuklari": open loads
 * that depart from wherever this driver's most recent DELIVERED order
 * ended, so they don't have to drive back empty. Requires the driver to
 * have linked a Telegram username in their profile — same requirement the
 * verified badge and ratings already have, since that's the only thing
 * connecting "who claimed this in the group" to a registered account.
 */
const getBackhaul = async (req, res) => {
  const myEmail = await resolveEmail({ googleIdToken: req.query.googleIdToken, telegramInitData: req.query.telegramInitData });
  if (!myEmail) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const praw = await kvGet(`profile:${myEmail}`);
  let profile = {};
  try {
    profile = praw ? JSON.parse(praw) : {};
  } catch {
    profile = {};
  }
  const tgUsername = profile.telegramUsername;
  if (!tgUsername) return res.status(200).json({ lastRoute: null, loads: [] });

  const codes = await kvRange('order_codes', 0, 299);
  const allOrders = (await Promise.all(codes.map((code) => kvGet(`order:${code}`))))
    .map((s) => {
      if (!s) return null;
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const delivered = allOrders
    .filter((o) => o.status === 'DELIVERED' && o.driver && o.driver.telegramUsername === tgUsername)
    .sort((a, b) => (b.deliveredAt || 0) - (a.deliveredAt || 0));

  if (!delivered.length) return res.status(200).json({ lastRoute: null, loads: [] });

  const last = delivered[0];
  const returnFrom = last.toCity;

  const loads = allOrders
    .filter((o) => (o.status || 'NEW') === 'NEW' && o.fromCity === returnFrom)
    .slice(0, 20)
    .map((o) => ({
      code: o.code, fromCity: o.fromCity, toCity: o.toCity, cargoType: o.cargoType,
      customCargoLabel: o.customCargoLabel || '', weightKg: o.weightKg, amount: o.amount,
      distanceKm: o.distanceKm, truckType: o.truckType || '', pickupDate: o.pickupDate || '',
      createdAt: o.createdAt,
    }));

  return res.status(200).json({
    lastRoute: { fromCity: last.fromCity, toCity: last.toCity },
    suggestedFrom: returnFrom,
    loads,
  });
};

/**
 * POST ?action=rate — rate the driver once DELIVERED, using the same
 * code+phone ownership check as getOrderStatus. One rating per order — the
 * driver's aggregate is rolled up onto their profile, but only if they
 * linked a Telegram username to a Google account.
 */
/**
 * Baho kimga tegishli ekanini topadi.
 *
 * Haydovchi taklif orqali kelgan bo'lsa uning identity'si buyurtmada
 * turadi. Telegram guruhidan olgan bo'lsa faqat username bor —
 * o'shanda teskari indeksdan qidiramiz. Ilgari faqat ikkinchi yo'l
 * bor edi, ya'ni taklif orqali kelgan haydovchining bahosi
 * profiliga umuman tushmasdi.
 */
const driverIdentityOf = async (order) => {
  if (!order.driver) return null;
  if (order.driver.identity) return order.driver.identity;
  if (!order.driver.telegramUsername) return null;
  return await kvGet(`tgToEmail:${order.driver.telegramUsername.toLowerCase()}`);
};

/** Bahoni profilga va odam o'qiydigan izohlar ro'yxatiga yozadi. */
const recordReview = async (identity, review, side, meta) => {
  if (!identity) return;
  try {
    const key = `profile:${identity}`;
    const profile = await readJson(key, {});
    await kvSet(key, JSON.stringify(applyReview(profile, review, side)));
    // Izoh yoki teg bo'lmasa ro'yxatga yozadigan narsa yo'q —
    // yulduzlar profil raqamlarida allaqachon hisoblangan.
    if (review.comment || review.tags.length) {
      await kvPush(reviewsKey(identity), JSON.stringify({ ...review, ...meta, side }));
    }
  } catch (err) {
    // Baho buyurtmaning o'zida saqlangan; yig'indi keyin ham tiklanadi.
    console.error('recordReview failed:', err.message);
  }
};

/**
 * POST ?action=rate — buyurtma yetkazilgach baho qoldirish.
 *
 * Ikki tomon, ikki yo'l bilan tanaladi:
 *   - yuk beruvchi: kod + telefon (u ikkalasini ham biladi), yoki
 *     kirgan bo'lsa o'z identity'si bilan;
 *   - haydovchi: faqat identity — telefon raqami yuk beruvchiniki,
 *     uni haydovchi ham biladi, demak u tanitish uchun yaramaydi.
 */
const rateOrder = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const code = String(body.code || '').trim().toUpperCase();
  const phone = normalisePhone(body.phone || '');
  const side = body.side === 'OWNER' ? 'OWNER' : 'DRIVER';

  if (!code) return res.status(400).json({ error: 'Buyurtma kodi kerak' });

  const identity = await resolveEmail({
    googleIdToken: body.googleIdToken,
    telegramInitData: body.telegramInitData,
  });

  const order = await readJson(`order:${code}`, null);
  if (!order) return res.status(404).json({ error: 'Topilmadi' });

  const driverIdentity = await driverIdentityOf(order);
  const ownerIdentity = order.ownerIdentity || order.googleEmail || null;

  if (side === 'OWNER') {
    // Haydovchi yuk beruvchini baholaydi.
    if (!identity || !driverIdentity || identity !== driverIdentity) {
      return res.status(403).json({ error: 'Bu buyurtma sizga tegishli emas' });
    }
  } else {
    // Yuk beruvchi haydovchini baholaydi.
    const byPhone = phone && order.phone === phone;
    const bySignIn = identity && ownerIdentity && identity === ownerIdentity;
    if (!byPhone && !bySignIn) return res.status(404).json({ error: 'Topilmadi' });
  }

  if (order.status !== 'DELIVERED') return res.status(400).json({ error: 'Buyurtma hali yetkazilmagan' });

  const field = side === 'OWNER' ? 'ownerRating' : 'rating';
  if (order[field]) return res.status(409).json({ error: 'Bu buyurtma allaqachon baholangan' });

  const { error, value } = validateReview(
    { stars: body.stars, comment: body.comment, tags: body.tags },
    side,
  );
  if (error) return res.status(400).json({ error });

  order[field] = value;
  if (!(await kvSet(`order:${code}`, JSON.stringify(order)))) {
    return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });
  }

  // Profilga ko'chirish — buyurtmadagi baho allaqachon saqlangani
  // uchun bu qadam muvaffaqiyatsiz bo'lsa ham javob 200 qoladi.
  const target = side === 'OWNER' ? ownerIdentity : driverIdentity;
  await recordReview(target, value, side, {
    orderCode: code,
    route: `${order.fromCity} → ${order.toCity}`,
  });

  if (target) {
    await notifyUser(target, {
      category: 'orders',
      text: `<b>Sizga baho qoldirildi</b>\n\n`
        + `<b>${esc(code)}</b>\n${esc(order.fromCity)} → ${esc(order.toCity)}\n\n`
        + `${'★'.repeat(value.stars)}${'☆'.repeat(5 - value.stars)}`
        + (value.comment ? `\n\n«${esc(value.comment)}»` : ''),
    });
  }

  return res.status(200).json({ ok: true, rating: value });
};

/* ============================================================
   Takliflar
   ------------------------------------------------------------
   lib/offers.js dagi izohga qarang: haydovchi narx va yetib borish
   vaqtini taklif qiladi, yuk beruvchi tanlaydi.
   ============================================================ */
const readJson = async (key, fallback) => {
  try {
    const parsed = JSON.parse((await kvGet(key)) || 'null');
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
};

const readOffer = (id) => readJson(offerKey(id), null);

/** Buyurtmaga kelgan barcha takliflar, eng yangisi birinchi. */
const readOrderOffers = async (code) => {
  const ids = await kvRange(orderOffersKey(code), 0, MAX_OFFERS_PER_ORDER - 1);
  const offers = await Promise.all(ids.map((id) => readOffer(id)));
  return offers.filter(Boolean);
};

/** Haydovchi profilidan taklifga ko'chiriladigan ishonch belgilari. */
const driverSnapshot = async (identity) => {
  const profile = await readJson(`profile:${identity}`, {});
  return {
    driverName: profile.displayName || profile.username || 'Haydovchi',
    driverUsername: profile.username || '',
    driverVerified: Boolean(profile.verified),
    driverRatingCount: profile.ratingCount || 0,
    driverRatingSum: profile.ratingSum || 0,
    driverCity: profile.city || '',
    driverVehicleType: profile.vehicleType || '',
    driverPhone: profile.phone || '',
    driverTelegramUsername: profile.telegramUsername || '',
  };
};

/** POST ?action=offer — haydovchi taklif yuboradi. */
const submitOffer = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const identity = await resolveEmail({
    googleIdToken: body.googleIdToken,
    telegramInitData: body.telegramInitData,
  });
  if (!identity) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });
  if (await kvSismember('banned', identity.toLowerCase())) {
    return res.status(403).json({ error: 'Sizga xizmatdan foydalanish cheklangan' });
  }

  const code = String(body.code || '').trim().toUpperCase();
  const order = await readJson(`order:${code}`, null);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });

  const ownerKey = order.ownerIdentity || order.googleEmail;
  if (ownerKey && ownerKey === identity) {
    return res.status(400).json({ error: 'O‘z yukingizga taklif yubora olmaysiz' });
  }
  if (!OFFERABLE_ORDER_STATUSES.includes(order.status || 'NEW')) {
    return res.status(409).json({ error: 'Bu yuk uchun taklif qabul qilinmayapti' });
  }

  const { value, error } = validateOffer(body);
  if (error) return res.status(400).json({ error });

  const existing = await readOrderOffers(code);
  // Bitta haydovchidan bitta kutilayotgan taklif: qayta yuborsa,
  // eskisi yangilanadi — yuk beruvchi bir odamdan ikkita narx ko'rmasin.
  const mine = existing.find((o) => o.driverIdentity === identity && o.status === 'PENDING');
  const snapshot = await driverSnapshot(identity);

  if (mine) {
    const updated = { ...mine, ...value, ...snapshot, updatedAt: Date.now() };
    if (!(await kvSet(offerKey(mine.id), JSON.stringify(updated)))) {
      return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });
    }
    return res.status(200).json({ ok: true, offer: publicOfferShape(updated), updated: true });
  }

  if (existing.length >= MAX_OFFERS_PER_ORDER) {
    return res.status(409).json({ error: 'Bu yukka juda ko‘p taklif kelgan' });
  }

  const id = `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const offer = {
    id, orderCode: code, driverIdentity: identity,
    ...value, ...snapshot,
    status: 'PENDING', createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (!(await kvSet(offerKey(id), JSON.stringify(offer)))) {
    return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });
  }
  await kvPush(orderOffersKey(code), id);
  await kvPush(driverOffersKey(identity), id);

  await notifyUser(ownerKey, {
    category: 'offers',
    text: `<b>Yangi taklif</b>\n\n`
      + `Buyurtma: <b>${esc(code)}</b>\n`
      + `${esc(order.fromCity)} → ${esc(order.toCity)}\n\n`
      + `${esc(snapshot.driverName)}${snapshot.driverVerified ? ' ✓' : ''}\n`
      + `<b>${esc(formatNum(value.price))} so'm</b>`
      + (value.eta ? `\nYetib borish: ${esc(value.eta)}` : '')
      + (value.note ? `\n\n${esc(value.note)}` : '')
      + `\n\nSaytda «Kelgan takliflar» bo'limidan ko'ring.`,
  });

  return res.status(200).json({ ok: true, offer: publicOfferShape(offer) });
};

/** GET ?action=offers&code= — yuk egasi kelgan takliflarni ko'radi. */
const listOffers = async (req, res) => {
  const identity = await resolveEmail({
    googleIdToken: req.query.googleIdToken,
    telegramInitData: req.query.telegramInitData,
  });
  if (!identity) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const code = String(req.query.code || '').trim().toUpperCase();
  const order = await readJson(`order:${code}`, null);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });

  const ownerKey = order.ownerIdentity || order.googleEmail;
  const isOwner = Boolean(ownerKey) && ownerKey === identity;
  const offers = await readOrderOffers(code);

  // Egasi hammasini ko'radi; haydovchi faqat o'zinikini — boshqa
  // haydovchilarning narxi raqobat ma'lumoti, uni ochib bo'lmaydi.
  const visible = isOwner ? offers : offers.filter((o) => o.driverIdentity === identity);

  // Taklifi qabul qilingan haydovchi bosqichni saytdan suradi — Telegram
  // guruhidagi tugma unga tegishli emas (u yukni guruhdan olmagan).
  const isDriver = Boolean(order.driver && order.driver.identity === identity);
  const next = isDriver ? nextStatus(order.status) : null;

  return res.status(200).json({
    ok: true,
    isOwner,
    isDriver,
    orderStatus: order.status || 'NEW',
    nextStatus: next,
    nextLabel: next ? NEXT_STATUS_BUTTON[order.status] || '' : '',
    // Yetkazib bo'lgach haydovchi ham yuk beruvchini baholaydi.
    canRateOwner: isDriver && order.status === 'DELIVERED' && !order.ownerRating,
    ownerRating: isDriver ? order.ownerRating || null : null,
    ownerCriteria: CRITERIA.OWNER,
    offers: visible.map(publicOfferShape),
  });
};

/**
 * GET ?action=my-offers — haydovchi o'zi yuborgan takliflar ro'yxati.
 *
 * Busiz haydovchi taklif yuborgach yukni yo'qotib qo'yardi: yuklar
 * ro'yxatida faqat NEW yuklar turadi, ya'ni taklifi qabul qilingan
 * yukni u boshqa topa olmasdi — demak holatni ham yangilay olmasdi.
 */
const listMyOffers = async (req, res) => {
  const identity = await resolveEmail({
    googleIdToken: req.query.googleIdToken,
    telegramInitData: req.query.telegramInitData,
  });
  if (!identity) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const ids = await kvRange(driverOffersKey(identity), 0, 49);
  const offers = (await Promise.all(ids.map((id) => readOffer(id))))
    .filter((o) => o && o.driverIdentity === identity);

  const items = await Promise.all(offers.map(async (offer) => {
    const order = await readJson(`order:${offer.orderCode}`, null);
    const mine = Boolean(order && order.driver && order.driver.identity === identity);
    const next = mine ? nextStatus(order.status) : null;
    return {
      ...publicOfferShape(offer),
      fromCity: order ? order.fromCity : '',
      toCity: order ? order.toCity : '',
      weightKg: order ? order.weightKg : 0,
      orderStatus: order ? order.status || 'NEW' : '',
      orderStatusLabel: order ? STATUS_LABELS[order.status || 'NEW'] || '' : '',
      // "Men shu yukning haydovchisiman" — taklif qabul qilingan bo'lsa ham,
      // yuk beruvchi keyinchalik meni bo'shatgan bo'lishi mumkin.
      isDriver: mine,
      nextStatus: next,
      nextLabel: next ? NEXT_STATUS_BUTTON[order.status] || '' : '',
    };
  }));

  return res.status(200).json({ ok: true, offers: items });
};

/**
 * POST ?action=advance — biriktirilgan haydovchi buyurtmani bir bosqich
 * oldinga suradi.
 *
 * api/telegram.js dagi `next:` tugmasining sayt tomonidagi ayni o'zi.
 * Ikkalasi ham lib/orderMessage.js dagi bitta zanjirdan foydalanadi.
 */
const advanceOrder = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const identity = await resolveEmail({
    googleIdToken: body.googleIdToken,
    telegramInitData: body.telegramInitData,
  });
  if (!identity) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const code = String(body.code || '').trim().toUpperCase();
  const order = await readJson(`order:${code}`, null);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });

  // Faqat shu buyurtmaga biriktirilgan haydovchi. Kod yetarli emas:
  // uni yukni ko'rgan har kim biladi.
  if (!order.driver || order.driver.identity !== identity) {
    return res.status(403).json({ error: 'Bu buyurtma sizga tegishli emas' });
  }

  const next = nextStatus(order.status);
  if (!next) return res.status(409).json({ error: 'Bu amal endi mavjud emas' });

  order.status = next;
  order.updatedAt = Date.now();
  if (next === 'DELIVERED') order.deliveredAt = Date.now();
  if (!(await kvSet(`order:${code}`, JSON.stringify(order)))) {
    return res.status(500).json({ error: 'Saqlanmadi' });
  }

  if (next === 'DELIVERED') {
    try {
      const key = `profile:${identity}`;
      const profile = JSON.parse((await kvGet(key)) || '{}');
      profile.deliveredCount = (profile.deliveredCount || 0) + 1;
      await kvSet(key, JSON.stringify(profile));
    } catch (err) {
      // Hisoblagich yetkazishning o'zidan muhim emas.
      console.error('deliveredCount update failed:', err.message);
    }
  }

  await editGroupMessage(order, []);

  await notifyUser(order.ownerIdentity || order.googleEmail, {
    category: 'orders',
    text: `<b>${esc(STATUS_LABELS[next] || next)}</b>\n\n`
      + `Buyurtma: <b>${esc(code)}</b>\n`
      + `${esc(order.fromCity)} → ${esc(order.toCity)}\n\n`
      + `Haydovchi: ${esc(order.driver.name)}`
      + (next === 'DELIVERED'
          ? `\n\nSaytdagi «Buyurtmani kuzatish» bo'limida haydovchiga baho qoldirishingiz mumkin.`
          : ''),
  });

  const after = nextStatus(next);
  return res.status(200).json({
    ok: true,
    status: next,
    statusLabel: STATUS_LABELS[next] || next,
    nextStatus: after,
    nextLabel: after ? NEXT_STATUS_BUTTON[next] || '' : '',
  });
};

/** Taklifni qabul qilish yoki rad etish — faqat yuk egasi. */
const decideOffer = async (req, res, accept) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const identity = await resolveEmail({
    googleIdToken: body.googleIdToken,
    telegramInitData: body.telegramInitData,
  });
  if (!identity) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const offer = await readOffer(String(body.id || ''));
  if (!offer) return res.status(404).json({ error: 'Taklif topilmadi' });

  const order = await readJson(`order:${offer.orderCode}`, null);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });
  const ownerKey = order.ownerIdentity || order.googleEmail;
  if (!ownerKey || ownerKey !== identity) {
    return res.status(404).json({ error: 'Taklif topilmadi' });
  }
  if (offer.status !== 'PENDING') {
    return res.status(409).json({ error: 'Bu taklif allaqachon ko‘rib chiqilgan' });
  }

  if (!accept) {
    const rejected = { ...offer, status: 'REJECTED', updatedAt: Date.now() };
    if (!(await kvSet(offerKey(offer.id), JSON.stringify(rejected)))) {
      return res.status(500).json({ error: 'Saqlanmadi' });
    }
    await notifyUser(offer.driverIdentity, {
      category: 'offers',
      text: `<b>Taklifingiz rad etildi</b>\n\n<b>${esc(offer.orderCode)}</b>\n`
        + `${esc(order.fromCity)} → ${esc(order.toCity)}`,
    });
    return res.status(200).json({ ok: true, offer: publicOfferShape(rejected) });
  }

  if (!OFFERABLE_ORDER_STATUSES.includes(order.status || 'NEW')) {
    return res.status(409).json({ error: 'Bu buyurtmada allaqachon haydovchi bor' });
  }

  const accepted = { ...offer, status: 'ACCEPTED', updatedAt: Date.now() };
  if (!(await kvSet(offerKey(offer.id), JSON.stringify(accepted)))) {
    return res.status(500).json({ error: 'Saqlanmadi' });
  }

  order.status = 'DRIVER_FOUND';
  order.driver = {
    name: offer.driverName,
    identity: offer.driverIdentity,
    telegramUsername: offer.driverTelegramUsername || null,
    phone: offer.driverPhone || null,
    verified: Boolean(offer.driverVerified),
    viaOffer: offer.id,
  };
  // Kelishilgan narx alohida saqlanadi — e'lon qilingan narx o'z holicha
  // qoladi, shunda narx statistikasi joylangan narxlarni hisoblayveradi.
  order.agreedAmount = offer.price;
  order.updatedAt = Date.now();
  if (!(await kvSet(`order:${offer.orderCode}`, JSON.stringify(order)))) {
    return res.status(500).json({ error: 'Buyurtma saqlanmadi' });
  }

  // Qolgan kutilayotgan takliflar avtomatik rad etiladi — yuk band.
  const others = (await readOrderOffers(offer.orderCode))
    .filter((o) => o.id !== offer.id && o.status === 'PENDING');
  for (const other of others) {
    await kvSet(offerKey(other.id), JSON.stringify({ ...other, status: 'REJECTED', updatedAt: Date.now() }));
    await notifyUser(other.driverIdentity, {
      category: 'offers',
      text: `<b>Yuk boshqa haydovchiga berildi</b>\n\n<b>${esc(offer.orderCode)}</b>\n`
        + `${esc(order.fromCity)} → ${esc(order.toCity)}`,
    });
  }

  await notifyUser(offer.driverIdentity, {
    category: 'offers',
    text: `<b>Taklifingiz qabul qilindi</b>\n\n<b>${esc(offer.orderCode)}</b>\n`
      + `${esc(order.fromCity)} → ${esc(order.toCity)}\n`
      + `<b>${esc(formatNum(offer.price))} so'm</b>\n\n`
      + (order.phone ? `Mijoz: ${esc(order.phone)}\n\n` : '')
      + `Saytdagi yuk sahifasida holatni bosqichma-bosqich yangilab boring — `
      + `har bosqichda tugma keyingisining nomini yozib turadi.`,
  });

  await editGroupMessage(order, []);
  return res.status(200).json({ ok: true, offer: publicOfferShape(accepted), status: order.status });
};

/** POST ?action=withdraw-offer — haydovchi o'z taklifini qaytarib oladi. */
const withdrawOffer = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const identity = await resolveEmail({
    googleIdToken: body.googleIdToken,
    telegramInitData: body.telegramInitData,
  });
  if (!identity) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const offer = await readOffer(String(body.id || ''));
  if (!offer || offer.driverIdentity !== identity) {
    return res.status(404).json({ error: 'Taklif topilmadi' });
  }
  if (offer.status !== 'PENDING') {
    return res.status(409).json({ error: 'Bu taklifni qaytarib bo‘lmaydi' });
  }

  const withdrawn = { ...offer, status: 'WITHDRAWN', updatedAt: Date.now() };
  if (!(await kvSet(offerKey(offer.id), JSON.stringify(withdrawn)))) {
    return res.status(500).json({ error: 'Saqlanmadi' });
  }
  return res.status(200).json({ ok: true, offer: publicOfferShape(withdrawn) });
};

/* ============================================================
   Bekor qilish va haydovchini bo'shatish
   ------------------------------------------------------------
   Ilgari haydovchi yukni olib, keyin g'oyib bo'lsa, buyurtma
   "Haydovchi topildi" holatida abadiy qotib qolardi: yuk beruvchi
   hech narsa qila olmasdi va boshqa haydovchi ham ololmasdi.

   Ikkita chiqish yo'li:
     - bekor qilish  — yuk endi kerak emas (CANCELLED, oxirgi holat);
     - bo'shatish     — yuk kerak, lekin bu haydovchi javob bermayapti
                        (NEW ga qaytadi va guruhda yana ko'rinadi).

   Ikkalasini ham yuk egasi qiladi; haydovchi o'zi voz kechishi
   api/telegram.js dagi tugma orqali.
   ============================================================ */
const CANCELLABLE = ['NEW', 'DRIVER_FOUND', 'PICKING_UP', 'LOADED', 'ON_THE_WAY'];
const RELEASABLE = ['DRIVER_FOUND', 'PICKING_UP', 'LOADED', 'ON_THE_WAY'];

/** Guruhdagi xabarni yangilaydi. Xabar id'si yo'q bo'lsa — jim o'tadi. */
const editGroupMessage = async (order, keyboard) => {
  if (!order.groupMessageId || !GROUP_ID || !BOT_TOKEN) return;
  try {
    await telegram('editMessageText', {
      chat_id: GROUP_ID,
      message_id: order.groupMessageId,
      text: buildOrderMessage(order),
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (err) {
    // Guruh xabari yangilanmasa ham buyurtma holati to'g'ri saqlangan.
    console.error('group message edit failed:', err.message);
  }
};

/** Yukni yana guruhga chiqaradigan "Men olaman" tugmasi. */
const claimKeyboard = (order) => [[
  { text: '✅ Men olaman', callback_data: `take:${order.code}:${order.phone}` },
]];

/**
 * Buyurtmani faqat egasi o'zgartira oladi. Telefon raqami yetarli emas:
 * haydovchi guruhda uni ko'rgan bo'ladi, ya'ni u boshqa odamning
 * buyurtmasini bekor qila olardi.
 */
const loadOwnOrder = async (req, res, allowedStatuses) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const identity = await resolveEmail({
    googleIdToken: body.googleIdToken,
    telegramInitData: body.telegramInitData,
  });
  if (!identity) {
    res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });
    return null;
  }

  const code = String(body.code || '').trim().toUpperCase();
  if (!code) {
    res.status(400).json({ error: 'Buyurtma kodi kerak' });
    return null;
  }

  const raw = await kvGet(`order:${code}`);
  if (!raw) {
    res.status(404).json({ error: 'Buyurtma topilmadi' });
    return null;
  }
  let order;
  try {
    order = JSON.parse(raw);
  } catch {
    res.status(500).json({ error: 'Yozuv buzilgan' });
    return null;
  }

  const ownerKey = order.ownerIdentity || order.googleEmail;
  if (!ownerKey || ownerKey !== identity) {
    // Egasi emasligini "topilmadi" deb aytamiz: shu kod umuman bor-yo'qligini
    // begonaga bildirmaslik kerak.
    res.status(404).json({ error: 'Buyurtma topilmadi' });
    return null;
  }

  const status = order.status || 'NEW';
  if (!allowedStatuses.includes(status)) {
    res.status(409).json({ error: `Bu buyurtma uchun bu amal mavjud emas (${STATUS_LABELS[status] || status})` });
    return null;
  }

  return { order, code, reason: String(body.reason || '').trim().slice(0, 200) };
};

/** POST ?action=cancel — yuk endi kerak emas. */
const cancelOrder = async (req, res) => {
  const found = await loadOwnOrder(req, res, CANCELLABLE);
  if (!found) return;
  const { order, code, reason } = found;

  const hadDriver = order.driver;
  order.status = 'CANCELLED';
  order.cancelledAt = Date.now();
  order.cancelledBy = 'OWNER';
  if (reason) order.cancelReason = reason;
  order.updatedAt = Date.now();

  const saved = await kvSet(`order:${code}`, JSON.stringify(order));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });

  await editGroupMessage(order, []);
  if (hadDriver && hadDriver.telegramId) {
    await notifyUser(`tg:${hadDriver.telegramId}`, {
      category: 'orders',
      text: `<b>Buyurtma bekor qilindi</b>\n\n<b>${esc(code)}</b>\n`
        + `${esc(order.fromCity)} → ${esc(order.toCity)}\n\n`
        + `Yuk beruvchi buyurtmani bekor qildi.`
        + (reason ? `\n\nSabab: ${esc(reason)}` : ''),
    });
  }

  return res.status(200).json({ ok: true, status: order.status });
};

/** POST ?action=release — haydovchi javob bermayapti, yuk yana guruhga chiqsin. */
const releaseDriver = async (req, res) => {
  const found = await loadOwnOrder(req, res, RELEASABLE);
  if (!found) return;
  const { order, code, reason } = found;

  const previousDriver = order.driver;
  // Kim va nechchi marta bo'shatilgani yozib boriladi — bu keyinchalik
  // ishonchsiz haydovchilarni ko'rish uchun yagona manba.
  order.releases = Array.isArray(order.releases) ? order.releases : [];
  order.releases.push({
    at: Date.now(),
    by: 'OWNER',
    driverName: previousDriver ? previousDriver.name : null,
    driverTelegramId: previousDriver ? previousDriver.telegramId : null,
    reason: reason || null,
  });
  order.status = 'NEW';
  order.driver = null;
  order.updatedAt = Date.now();

  const saved = await kvSet(`order:${code}`, JSON.stringify(order));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });

  await editGroupMessage(order, claimKeyboard(order));
  if (previousDriver && previousDriver.telegramId) {
    await notifyUser(`tg:${previousDriver.telegramId}`, {
      category: 'orders',
      text: `<b>Buyurtma sizdan olindi</b>\n\n<b>${esc(code)}</b>\n`
        + `${esc(order.fromCity)} → ${esc(order.toCity)}\n\n`
        + `Yuk beruvchi buyurtmani boshqa haydovchiga ochdi.`
        + (reason ? `\n\nSabab: ${esc(reason)}` : ''),
    });
  }

  return res.status(200).json({ ok: true, status: order.status });
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const action = String(req.query.action || '');
    if (action === 'list') return listLoads(req, res);
    if (action === 'detail') return getLoadDetail(req, res);
    if (action === 'backhaul') return getBackhaul(req, res);
    if (action === 'price-stats') return getPriceStats(req, res);
    if (action === 'offers') return listOffers(req, res);
    if (action === 'my-offers') return listMyOffers(req, res);
    if (action === 'stats') return getHomeStats(req, res);
    return getOrderStatus(req, res);
  }
  if (req.method === 'POST') {
    const action = String(req.query.action || '');
    if (action === 'rate') return rateOrder(req, res);
    if (action === 'cancel') return cancelOrder(req, res);
    if (action === 'release') return releaseDriver(req, res);
    if (action === 'offer') return submitOffer(req, res);
    if (action === 'accept-offer') return decideOffer(req, res, true);
    if (action === 'reject-offer') return decideOffer(req, res, false);
    if (action === 'withdraw-offer') return withdrawOffer(req, res);
    if (action === 'advance') return advanceOrder(req, res);
    return createOrder(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
