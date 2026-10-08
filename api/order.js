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

import {
  kvPush, kvGet, kvSet, kvDel, kvSismember, kvSmembers, kvRange, kvSaddNew, kvExpire,
} from '../lib/kv.js';
import { premiumMembers } from '../lib/premium.js';
import { queueDelayed, drainDue } from '../lib/notifyQueue.js';
import { resolveIdentity, resolveEmail } from '../lib/identity.js';
import {
  CARGO, STATUS_LABELS, formatNum, nextStatus, NEXT_STATUS_BUTTON,
} from '../lib/orderMessage.js';
import { notifyUser, esc } from '../lib/notify.js';
import { searchesKey, matchesSearch } from '../lib/savedSearch.js';
import {
  OFFERABLE_ORDER_STATUSES, MAX_OFFERS_PER_ORDER, validateOffer,
  offerKey, orderOffersKey, driverOffersKey, publicOfferShape,
} from '../lib/offers.js';
import { validateReview, applyReview, reviewsKey, CRITERIA } from '../lib/reviews.js';
import { LOADS_CACHE_KEY, LOADS_CACHE_MS, invalidateLoadsCache } from '../lib/loadsCache.js';
import { loadUrl } from '../lib/appUrl.js';
import { recordDelivery, readLedger, summarise } from '../lib/earnings.js';

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

const createOrder = async (req, res) => {
  /* Ilgari bu yerda Telegram sozlamalari tekshirilardi va ular bo'lmasa
     yuk joylash umuman ishlamasdi. Endi yuk platformaning o'zida
     yashaydi, ya'ni Telegram bo'lmasa ham hammasi ishlaydi. */
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});

  const identityResult = await resolveIdentity({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData, phoneToken: body.phoneToken });
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

  /* Yuk endi faqat shu yerda — bazada — yashaydi. Ilgari u Telegram
     guruhiga yuborilardi va KV yozuvi "qo'shimcha nusxa" edi, shuning
     uchun uning xatosi jimgina o'tkazib yuborilardi.

     Endi yozuv yagona nusxa: saqlanmasa, yuk umuman yo'q. Shuning
     uchun xato endi jim o'tmaydi — aks holda odam "yuk joylandi"
     degan javobni olib, ro'yxatda hech narsa ko'rmasdi. */
  const record = { ...order, createdAt: Date.now() };
  if (!(await kvSet(`order:${code}`, JSON.stringify(record)))) {
    return res.status(500).json({ error: 'Yukni saqlab bo‘lmadi, qayta urinib ko‘ring' });
  }
  await kvPush('order_codes', code).catch(() => {});
  // Yangi yuk ro'yxatda darhol ko'rinsin, 30 soniya kutmasin.
  await invalidateLoadsCache();
  await notifyNewLoad(record);

  return res.status(200).json({ ok: true, code, amount, distanceKm });
};

/* ============================================================
   Yangi yuk haqida xabar
   ------------------------------------------------------------
   ILGARI QANDAY EDI. Xabar faqat SAQLANGAN QIDIRUVI bor odamga
   ketardi. Qidiruv saqlash — ilovaning ichida, "Yuklar"
   bo'limidagi ixtiyoriy amal; deyarli hech kim qilmagan. Natijada
   yangi yuk chiqardi-yu, hech kim bilmasdi. "Haydovchilarga nega
   yuk yuborilmayapdi" degan savolning sababi shu edi.

   ENDI QANDAY. Xabar ikki to'lqinda ketadi:

     1-to'lqin, DARHOL — premium egalariga;
     2-to'lqin, BIR SOATDAN KEYIN — qolganlarga.

   Premiumning imtiyozi shu: u birinchi ko'radi va taklifni
   birinchi yuborishga ulguradi. Yukning o'zi hammaga ochiq,
   hech narsa yopilmaydi.

   KIMGA. Saqlangan qidiruvi bor odam faqat o'sha qidiruvga mos
   yukni oladi — u nima kerakligini aytib qo'ygan, buni hurmat
   qilamiz. Qidiruvi yo'q odam hamma yukni oladi, chunki aks holda
   u hech narsa olmasdi. Yuk egasining o'ziga yuborilmaydi.

   IKKI MARTA YUBORILMASLIGI. Har bir (yuk, odam) juftligi
   `notified:<kod>` to'plamida atomik "band qilinadi"
   (`kvSaddNew`). Bir soat ichida ikkita so'rov navbatni bir
   vaqtda bo'shatsa ham, odam xabarni bir marta oladi.
   ============================================================ */

/** Bir so'rovda ko'pi bilan shuncha xabar — so'rov cho'zilib ketmasin. */
const NOTIFY_CHUNK = 20;
/** Bitta yukka umuman shuncha xabar (ikki to'lqin birga). */
const MAX_LOAD_NOTIFICATIONS = 400;
/** Qolganlar shuncha vaqtdan keyin oladi. */
export const NON_PREMIUM_DELAY_MS = 60 * 60 * 1000;
/** "Yuborildi" belgisi shuncha turadi, keyin o'zi o'chadi. */
const NOTIFIED_TTL_S = 7 * 24 * 60 * 60;

const notifiedKey = (code) => `notified:${code}`;

/** Xabar matni va tugmasi — ikki to'lqin uchun bir xil. */
const newLoadMessage = (order) => {
  const cargo = CARGO[order.cargoType] || CARGO.OTHER;
  const cargoLabel = order.cargoType === 'OTHER' && order.customCargoLabel
    ? order.customCargoLabel
    : cargo.label;
  /* Oxirgi qator ilgari shunday edi:
       «Yuk haydovchilar guruhida — "Men olaman" tugmasini bosgan
        birinchi haydovchi oladi.»
     Haydovchilar guruhi olib tashlanganidan keyin bu gap yolg'on
     bo'lib qoldi: na guruh bor, na o'sha tugma. Haydovchi
     Telegramda guruh izlab, topolmay qolardi. */
  const text = `<b>Yangi yuk</b>\n\n`
    + `${esc(order.fromCity)} → ${esc(order.toCity)}\n`
    + `${esc(formatNum(order.weightKg))} kg · ${esc(cargoLabel)}\n`
    + `<b>${esc(formatNum(order.amount))} so'm</b>\n\n`
    + `Ilovada ochib, taklifingizni yuboring. Yukni egasi takliflardan o'zi tanlaydi.`;
  const button = loadUrl(order.code)
    ? { buttonText: 'Ilovada ochish', buttonUrl: loadUrl(order.code) }
    : {};
  return { text, button };
};

/** Shu odamga shu yuk haqida xabar berish kerakmi. */
const wantsLoad = async (identity, order) => {
  if (!identity || identity === order.ownerIdentity) return false;
  let searches = [];
  try { searches = JSON.parse((await kvGet(searchesKey(identity))) || '[]'); } catch { searches = []; }
  // Qidiruvi yo'q — hammasi keladi. Bor — faqat mosi.
  if (!Array.isArray(searches) || !searches.length) return true;
  return searches.some((s) => matchesSearch(order, s));
};

/**
 * Berilgan odamlarga yuboradi, `NOTIFY_CHUNK` dan oshmaydi.
 * @returns {Promise<{sent:number, left:string[]}>}
 */
const sendLoadTo = async (order, identities) => {
  const { text, button } = newLoadMessage(order);
  const key = notifiedKey(order.code);
  let sent = 0;
  const left = [];
  for (const identity of identities) {
    if (sent >= NOTIFY_CHUNK) { left.push(identity); continue; }
    if (!(await wantsLoad(identity, order))) continue;
    // Atomik band qilish: ikki marta yuborilmaydi.
    if (!(await kvSaddNew(key, identity))) continue;
    await notifyUser(identity, { category: 'matches', text, ...button });
    sent += 1;
  }
  if (sent) await kvExpire(key, NOTIFIED_TTL_S).catch(() => {});
  return { sent, left };
};

/** Yuk joylangan zahoti: premiumga darhol, qolganlarga navbatga. */
const notifyNewLoad = async (order) => {
  try {
    const premium = await premiumMembers();
    if (premium.length) await sendLoadTo(order, premium);
    /* Qolganlar bir soatdan keyin. Ro'yxat hozir olinmaydi — bir
       soat ichida yangi odam qo'shilishi mumkin va u ham olishi
       kerak. */
    await queueDelayed({ kind: 'load', code: order.code }, NON_PREMIUM_DELAY_MS);
  } catch (err) {
    console.error('new load notify failed:', err.message);
  }
};

/**
 * Navbatdagi ishni bajaradi: ikkinchi to'lqin.
 *
 * Odam ko'p bo'lsa bir so'rovda hammasiga yuborilmaydi — qolganlari
 * ishning o'zida qaytariladi va navbat keyingi murojaatda davom
 * etadi.
 */
const runNotifyJob = async (job) => {
  if (!job || job.kind !== 'load' || !job.code) return null;
  const raw = await kvGet(`order:${job.code}`);
  if (!raw) return null;                      // yuk o'chirilgan
  let order;
  try { order = JSON.parse(raw); } catch { return null; }
  /* Yuk allaqachon haydovchi topgan yoki bekor qilingan bo'lsa,
     "yangi yuk" degan xabarning ma'nosi yo'q. */
  if ((order.status || 'NEW') !== 'NEW') return null;
  order.code = job.code;

  const everyone = Array.isArray(job.rest)
    ? job.rest
    : (await kvSmembers('profile_emails')).slice(0, MAX_LOAD_NOTIFICATIONS);
  const { left } = await sendLoadTo(order, everyone);
  return left.length ? { kind: 'load', code: job.code, rest: left } : null;
};

/**
 * Navbatga yo'l-yo'lakay ko'z tashlash.
 *
 * Tez-tez chaqiriladigan endpointlardan chaqiriladi. Navbat bo'sh
 * bo'lsa bitta GET bilan tugaydi va hech qachon xato tashlamaydi —
 * bildirishnoma yuklar ro'yxatini buzmasligi kerak.
 */
export const sweepNotifyQueue = () => drainDue(runNotifyJob).catch(() => 0);

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
/* ------------------------------------------------------------------
   Ochiq yuklar ro'yxati — kesh bilan.

   Ilgari har bir ochilishda 300 ta buyurtma BITTALAB o'qilardi
   (1 LRANGE + 300 GET), ustiga har bir yuk beruvchining profili —
   ya'ni bitta sahifa ochish 300 dan ortiq Redis buyrug'i edi. "Yuklar"
   esa eng ko'p ochiladigan bo'lim.

   Yechim ataylab denormalizatsiya EMAS: buyurtma 12 xil joyda
   yoziladi (api/order.js, api/telegram.js, lib/deleteAccount.js) va
   indeksni hamma joyda qo'lda yangilash — bittasini unutib qo'yish
   degani, ya'ni ro'yxatda yo'q yuk ko'rinib turishi mumkin. Buning
   o'rniga oddiy kesh: u haqiqat manbaidan o'zi qayta quriladi,
   shuning uchun hech qachon chalg'imaydi, faqat eskiradi.

   Eskirish muddati 30 soniya. Yangi yuk joylanganda kesh darhol
   tashlanadi (invalidateLoadsCache), shuning uchun amalda yangi
   e'lon kechikmaydi; 30 soniya esa qolgan barcha yo'llar uchun
   zahira.
   ------------------------------------------------------------------ */
/** Ochiq yuklarni manbadan o'qib, kartochka ko'rinishiga keltiradi. */
const buildOpenLoads = async () => {
  const codes = await kvRange('order_codes', 0, 299);
  const raw = await Promise.all(codes.map((code) => kvGet(`order:${code}`)));

  const open = raw
    .map((s) => {
      if (!s) return null;
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    })
    .filter((o) => o && (o.status || 'NEW') === 'NEW');

  /* Yuk beruvchining ismi va reytingi. Bu yangi ma'lumot ochish emas —
     ism ?action=detail javobida ham, Telegram guruhidagi e'londa ham
     allaqachon ochiq, reyting esa har kimning ommaviy profilida
     ko'rinadi. Telefon, pochta va izoh avvalgidek yopiq.

     Avatar ataylab yuborilmaydi: kartochkalar soni ko'p, javob
     og'irlashib ketardi. Frontend ism harfidan doiracha yasaydi. */
  const ownerKeys = [...new Set(open.map((o) => o.ownerIdentity || o.googleEmail).filter(Boolean))];
  const owners = new Map();
  await Promise.all(ownerKeys.map(async (key) => {
    const rawProfile = await kvGet(`profile:${key}`);
    if (!rawProfile) return;
    try {
      const p = JSON.parse(rawProfile);
      const name = p.displayName || p.username || '';
      if (!name) return;
      owners.set(key, {
        name,
        ratingCount: p.ratingCount || 0,
        ratingSum: p.ratingSum || 0,
        verified: Boolean(p.verified),
      });
    } catch {
      /* buzuq yozuv — kartochka shunchaki ismsiz chiqadi */
    }
  }));

  return open.map((o) => ({
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
    owner: owners.get(o.ownerIdentity || o.googleEmail) || null,
  }));
};

/** Keshdan o'qiydi; eskirgan yoki yo'q bo'lsa qaytadan quradi. */
const openLoads = async () => {
  try {
    const cached = JSON.parse((await kvGet(LOADS_CACHE_KEY)) || 'null');
    if (cached && Array.isArray(cached.items) && Date.now() - Number(cached.at || 0) < LOADS_CACHE_MS) {
      return cached.items;
    }
  } catch {
    /* buzuq kesh — pastda qaytadan quriladi */
  }
  const items = await buildOpenLoads();
  // Saqlanmasa ham javob to'g'ri bo'ladi, shunchaki keyingi so'rov
  // yana sekin ketadi — shuning uchun xatosi jim o'tadi.
  await kvSet(LOADS_CACHE_KEY, JSON.stringify({ at: Date.now(), items })).catch(() => {});

  /* Kechiktirilgan bildirishnomalarga yo'l-yo'lakay ko'z tashlanadi.
     Jadval (cron) ishlatilmaydi: Vercel Hobby'da u kuniga bir
     martagina ishga tushadi, ya'ni soatlik aniqlik bermaydi.

     Nega aynan SHU yerda — keshni qayta qurish yo'lida? Chunki bu
     yo'l allaqachon uch yuzdan ortiq KV buyrug'ini talab qiladi,
     bitta qo'shimcha o'qish unda sezilmaydi. Keshdan o'qish yo'li
     esa bitta buyruqda tugaydi va u ilovaning eng ko'p
     chaqiriladigan joyi — unga bitta buyruq qo'shish narxni ikki
     barobar oshirardi (test/quota.test.mjs aynan shuni qo'riqlaydi).

     Kesh har o'ttiz soniyada eskiradi, ya'ni navbat ham shu
     oraliqda ko'rib turiladi. */
  sweepNotifyQueue();
  return items;
};

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

  // Filtrlash avvalgidek shu yerda — kesh filtrlanmagan ro'yxatni
  // saqlaydi, shuning uchun har xil filtr uchun alohida kesh kerak emas.
  const shaped = (await openLoads())
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
    .slice(0, 60);

  return res.status(200).json({ loads: shaped });
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
  const myEmail = await resolveEmail({ googleIdToken: req.query.googleIdToken, telegramInitData: req.query.telegramInitData, phoneToken: req.query.phoneToken });
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
    telegramInitData: body.telegramInitData, phoneToken: body.phoneToken,
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
  await invalidateLoadsCache();

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
    telegramInitData: body.telegramInitData, phoneToken: body.phoneToken,
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

  // Haydovchi kim ekani darhol ko'rinsin: sayt username'i, va bor bo'lsa
  // bosilganda uning Telegram profiliga olib boradigan @handle hamda
  // telefon raqami — hammasi shu bitta xabarda, saytga kirmasdan turib.
  const driverLine = [
    `${esc(snapshot.driverName)}${snapshot.driverVerified ? ' ✓' : ''}`,
    snapshot.driverUsername ? `@${esc(snapshot.driverUsername)}` : '',
  ].filter(Boolean).join('  ·  ');
  const contactLines = [
    snapshot.driverTelegramUsername
      ? `Telegram: <a href="https://t.me/${esc(snapshot.driverTelegramUsername)}">@${esc(snapshot.driverTelegramUsername)}</a>`
      : '',
    snapshot.driverPhone ? `Tel: ${esc(snapshot.driverPhone)}` : '',
  ].filter(Boolean).join('\n');

  await notifyUser(ownerKey, {
    category: 'offers',
    text: `<b>Yangi taklif</b>\n\n`
      + `Buyurtma: <b>${esc(code)}</b>\n`
      + `${esc(order.fromCity)} → ${esc(order.toCity)}\n\n`
      + `${driverLine}\n`
      + (contactLines ? `${contactLines}\n` : '')
      + `\n<b>${esc(formatNum(value.price))} so'm</b>`
      + (value.eta ? `\nYetib borish: ${esc(value.eta)}` : '')
      + (value.note ? `\n\n${esc(value.note)}` : '')
      + `\n\nTaklifni ilovada ko'rib chiqing.`,
    /* Ilgari shu yerda "Qabul qilish / Rad etish" tugmalari turardi va
       xabar "saytga kirish shart emas" deb yozardi. Ya'ni kelishuv
       Telegramda bo'lardi, holbuki yuk egasi haydovchining reytingini,
       mashinasini va boshqa takliflarni ko'rib tanlashi kerak — bularning
       hammasi ilovada. Endi bildirishnoma faqat xabar beradi, ish esa
       ilovada bajariladi. */
    buttonText: 'Ilovada ochish',
    buttonUrl: loadUrl(offer.orderCode),
  });

  return res.status(200).json({ ok: true, offer: publicOfferShape(offer) });
};

/** GET ?action=offers&code= — yuk egasi kelgan takliflarni ko'radi. */
const listOffers = async (req, res) => {
  const identity = await resolveEmail({
    googleIdToken: req.query.googleIdToken,
    telegramInitData: req.query.telegramInitData, phoneToken: req.query.phoneToken,
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
    telegramInitData: req.query.telegramInitData, phoneToken: req.query.phoneToken,
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

/* ============================================================
   "Mening yukim" — haydovchining bitta faol yuki
   ------------------------------------------------------------
   Haydovchi bir vaqtda faqat BITTA yukni olib ketadi. Shuning
   uchun uning faol yuki alohida kalitda turadi: shu kalit ham
   "Mening yukim" bo'limini bir o'qishda to'ldiradi, ham ikkinchi
   yukni olishga yo'l qo'ymaydi.

   Kalit yo'q bo'lsa (taklif bu o'zgarishdan oldin qabul qilingan
   bo'lsa) haydovchining takliflari bo'yicha qidiriladi va kalit
   o'sha joyda tiklanadi — ya'ni eski yozuvlar uchun alohida
   ko'chirish ishi kerak emas.
   ============================================================ */
const ACTIVE_DRIVER_STATUSES = ['DRIVER_FOUND', 'PICKING_UP', 'LOADED', 'ON_THE_WAY'];
const activeLoadKey = (identity) => `driverLoad:${identity}`;

/** Yuk haqiqatda shu haydovchida va hali yo'ldami? */
const stillDriving = (order, identity) => Boolean(
  order && order.driver && order.driver.identity === identity
  && ACTIVE_DRIVER_STATUSES.includes(order.status || 'NEW'),
);

/**
 * Haydovchining faol yuki: `{ code, order }` yoki `null`.
 * Eskirgan kalitni o'zi tozalaydi, yo'qolganini o'zi tiklaydi.
 */
const findActiveLoad = async (identity) => {
  const pointed = await kvGet(activeLoadKey(identity));
  if (pointed) {
    const order = await readJson(`order:${pointed}`, null);
    if (stillDriving(order, identity)) return { code: pointed, order };
    // Yuk yakunlangan yoki boshqasiga o'tgan — kalit eskirgan.
    await kvDel(activeLoadKey(identity)).catch(() => {});
  }

  // Zaxira yo'l: haydovchining o'z takliflari bo'yicha qidirish.
  const ids = await kvRange(driverOffersKey(identity), 0, 49);
  const offers = (await Promise.all(ids.map((id) => readOffer(id))))
    .filter((o) => o && o.driverIdentity === identity && o.status === 'ACCEPTED');
  for (const offer of offers) {
    const order = await readJson(`order:${offer.orderCode}`, null);
    if (stillDriving(order, identity)) {
      await kvSet(activeLoadKey(identity), offer.orderCode).catch(() => {});
      return { code: offer.orderCode, order };
    }
  }
  return null;
};

/**
 * GET ?action=my-load — "Mening yukim" bo'limining yagona manbasi.
 *
 * Bir so'rovda hammasi qaytadi: yo'nalish, yuk, kelishilgan narx,
 * hozirgi bosqich, keyingi tugmaning nomi va yuk beruvchining
 * aloqasi. Shuning uchun bo'lim ochilganda ikkinchi so'rov kerak
 * emas va ekranda "yuklanmoqda" uzoq turmaydi.
 *
 * Yuk beruvchining telefon raqami faqat SHU yerda va faqat
 * biriktirilgan haydovchiga beriladi — `?action=detail` uni umuman
 * qaytarmaydi, ya'ni yukni ko'rgan boshqa odam raqamni ko'rmaydi.
 */
const getMyLoad = async (req, res) => {
  const identity = await resolveEmail({
    googleIdToken: req.query.googleIdToken,
    telegramInitData: req.query.telegramInitData, phoneToken: req.query.phoneToken,
  });
  if (!identity) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const found = await findActiveLoad(identity);
  if (!found) return res.status(200).json({ ok: true, load: null });

  const { code, order } = found;
  const ownerKey = order.ownerIdentity || order.googleEmail;
  let owner = { name: order.name || '', phone: order.phone || '', username: null, verified: false };
  if (ownerKey) {
    const profile = await readJson(`profile:${ownerKey}`, null);
    if (profile) {
      owner = {
        name: profile.displayName || order.name || '',
        phone: order.phone || profile.phone || '',
        username: profile.username || null,
        verified: Boolean(profile.verified),
      };
    }
  }

  const next = nextStatus(order.status);
  return res.status(200).json({
    ok: true,
    load: {
      code,
      fromCity: order.fromCity,
      toCity: order.toCity,
      fromAddress: order.fromAddress || '',
      toAddress: order.toAddress || '',
      fromPoint: order.fromPoint || null,
      toPoint: order.toPoint || null,
      cargoType: order.cargoType,
      customCargoLabel: order.customCargoLabel || '',
      weightKg: order.weightKg,
      volumeM3: order.volumeM3 || null,
      quantity: order.quantity || null,
      quantityUnit: order.quantityUnit || '',
      truckType: order.truckType || '',
      pickupDate: order.pickupDate || '',
      distanceKm: order.distanceKm,
      // Kelishilgan narx bor bo'lsa — aynan u; yo'q bo'lsa e'londagi narx.
      amount: order.agreedAmount || order.amount,
      agreed: Boolean(order.agreedAmount),
      comment: order.comment || '',
      status: order.status || 'NEW',
      statusLabel: STATUS_LABELS[order.status || 'NEW'] || '',
      nextStatus: next,
      nextLabel: next ? NEXT_STATUS_BUTTON[order.status] || '' : '',
      owner,
    },
  });
};

/**
 * GET ?action=my-loads — yuk beruvchining o'zi joylagan buyurtmalari.
 *
 * Profildagi "Mening yuklarim" shu yerdan oziqlanadi. Ro'yxat holat
 * bo'yicha guruhlanadi, chunki interfeys aynan shu to'rt guruhni
 * ko'rsatadi: faol, jarayonda, yakunlangan, bekor qilingan.
 *
 * Faqat o'z buyurtmalari qaytariladi — identity har so'rovda qaytadan
 * tekshiriladi, ya'ni birovning kodini yozib qo'yish bilan boshqa
 * odamning yuklarini ko'rib bo'lmaydi. Telefon va izoh bu yerda ham
 * chiqmaydi: ular buyurtmaning o'z sahifasida, faqat egasiga va
 * tanlangan haydovchiga ko'rinadi.
 */
const listMyLoads = async (req, res) => {
  const identity = await resolveEmail({
    googleIdToken: req.query.googleIdToken,
    telegramInitData: req.query.telegramInitData, phoneToken: req.query.phoneToken,
  });
  if (!identity) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const codes = await kvRange('order_codes', 0, 299);
  const raw = await Promise.all(codes.map((code) => kvGet(`order:${code}`)));

  const mine = raw
    .map((str) => {
      if (!str) return null;
      try {
        return JSON.parse(str);
      } catch {
        return null;
      }
    })
    .filter((o) => o && (o.ownerIdentity || o.googleEmail) === identity)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((o) => ({
      code: o.code,
      fromCity: o.fromCity,
      toCity: o.toCity,
      weightKg: o.weightKg,
      amount: o.amount,
      truckType: o.truckType || '',
      pickupDate: o.pickupDate || '',
      createdAt: o.createdAt,
      status: o.status || 'NEW',
      statusLabel: STATUS_LABELS[o.status || 'NEW'] || '',
      driverName: o.driver ? o.driver.name || '' : '',
      rated: Boolean(o.rating),
    }));

  // Guruhlar interfeysdagi to'rt bo'limga to'g'ri keladi.
  const counts = {
    active: mine.filter((o) => o.status === 'NEW').length,
    inProgress: mine.filter((o) => o.status !== 'NEW' && o.status !== 'DELIVERED' && o.status !== 'CANCELLED').length,
    delivered: mine.filter((o) => o.status === 'DELIVERED').length,
    cancelled: mine.filter((o) => o.status === 'CANCELLED').length,
    total: mine.length,
  };

  return res.status(200).json({ ok: true, loads: mine, counts });
};

/**
 * GET ?action=earnings — haydovchining tashuv daftari.
 *
 * Oylik yig'indi, eng ko'p borilgan manzillar va yetkazilgan
 * yuklarning to'liq ro'yxati. Hammasi `earnings:<shaxs>`
 * daftaridan, ya'ni bitta so'rovda.
 *
 * ESKI TASHUVLAR. Daftar paydo bo'lishidan oldin yetkazilganlar
 * unda yo'q, shuning uchun birinchi ochilishda u bir marta
 * buyurtmalar ro'yxatidan to'ldiriladi. Bu qimmat yo'l (uch
 * yuzta o'qish), lekin faqat bir marta va faqat shu bo'lim
 * ochilganda yuradi — ilovaning issiq yo'llariga tegmaydi.
 */
const getEarnings = async (req, res) => {
  const identity = await resolveEmail({
    googleIdToken: req.query.googleIdToken,
    telegramInitData: req.query.telegramInitData, phoneToken: req.query.phoneToken,
  });
  if (!identity) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const past = async () => {
    const codes = await kvRange('order_codes', 0, 299);
    const raw = await Promise.all(codes.map((code) => kvGet(`order:${code}`)));
    return raw
      .map((str) => {
        if (!str) return null;
        try {
          return JSON.parse(str);
        } catch {
          return null;
        }
      })
      .filter((o) => o && o.status === 'DELIVERED' && o.driver && o.driver.identity === identity);
  };

  const entries = await readLedger(identity, past);
  const report = summarise(entries);

  return res.status(200).json({
    ok: true,
    ...report,
    /* "Yuk eltganlarining hammasi" — to'liq ro'yxat. Oyna
       daftarникidek: oxirgi 300 ta tashuv. */
    entries,
  });
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
    telegramInitData: body.telegramInitData, phoneToken: body.phoneToken,
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
  // Yuk endi ochiq emas — ro'yxatdan darhol tushsin.
  await invalidateLoadsCache();

  if (next === 'DELIVERED') {
    // Yuk yetkazildi — haydovchi bo'shadi, "Mening yukim" bo'shaydi.
    await kvDel(activeLoadKey(identity)).catch(() => {});
    try {
      const key = `profile:${identity}`;
      const profile = JSON.parse((await kvGet(key)) || '{}');
      profile.deliveredCount = (profile.deliveredCount || 0) + 1;
      await kvSet(key, JSON.stringify(profile));
    } catch (err) {
      // Hisoblagich yetkazishning o'zidan muhim emas.
      console.error('deliveredCount update failed:', err.message);
    }
    /* Tashuv daftariga yoziladi — "Hisob-kitob" bo'limi shundan
       o'qiydi. Yozilmasa ham yuk yetkazilgan bo'lib qolaveradi. */
    await recordDelivery(identity, order);
  }


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

/**
 * Taklifni qabul qilish yoki rad etish — asosiy mantiq, HTTP'dan mustaqil.
 *
 * Ikki chaqiruvchisi bor: pastdagi `decideOffer` (saytdan, POST orqali,
 * identity so'rov tanasidan) va `api/telegram.js` (yuk egasi Telegram'dagi
 * «✅ Qabul qilish» / «❌ Rad etish» tugmasini bosganda, identity Telegram
 * autentifikatsiyasidan). Ikkalasi ham identity'ni O'ZI aniqlab, faqat shu
 * funksiyaga uzatadi — bu yerda hech qanday tokenni qayta tekshirish yo'q,
 * faqat kim ekani allaqachon isbotlangan identity qabul qilinadi.
 */
const decideOfferCore = async (identity, offerId, accept) => {
  const offer = await readOffer(String(offerId || ''));
  if (!offer) return { status: 404, body: { error: 'Taklif topilmadi' } };

  const order = await readJson(`order:${offer.orderCode}`, null);
  if (!order) return { status: 404, body: { error: 'Buyurtma topilmadi' } };
  const ownerKey = order.ownerIdentity || order.googleEmail;
  if (!ownerKey || ownerKey !== identity) {
    return { status: 404, body: { error: 'Taklif topilmadi' } };
  }
  if (offer.status !== 'PENDING') {
    return { status: 409, body: { error: 'Bu taklif allaqachon ko‘rib chiqilgan' } };
  }

  if (!accept) {
    const rejected = { ...offer, status: 'REJECTED', updatedAt: Date.now() };
    if (!(await kvSet(offerKey(offer.id), JSON.stringify(rejected)))) {
      return { status: 500, body: { error: 'Saqlanmadi' } };
    }
    await notifyUser(offer.driverIdentity, {
      category: 'offers',
      text: `<b>Taklifingiz rad etildi</b>\n\n<b>${esc(offer.orderCode)}</b>\n`
        + `${esc(order.fromCity)} → ${esc(order.toCity)}`,
    });
    return { status: 200, body: { ok: true, offer: publicOfferShape(rejected) } };
  }

  if (!OFFERABLE_ORDER_STATUSES.includes(order.status || 'NEW')) {
    return { status: 409, body: { error: 'Bu buyurtmada allaqachon haydovchi bor' } };
  }

  /* Bir haydovchi — bir yuk. Haydovchi hozir boshqa yukni olib
     ketayotgan bo'lsa, taklifi qabul qilinmaydi: aks holda u ikkita
     yukni bir vaqtda "olib ketayotgan" bo'lib qolardi va ikkinchi
     yuk beruvchi buni bilmasdan kutib o'tirardi. Taklif PENDING
     holida qoladi — haydovchi bo'shagach egasi yana urinib ko'radi. */
  const busy = await findActiveLoad(offer.driverIdentity);
  if (busy && busy.code !== offer.orderCode) {
    return {
      status: 409,
      body: { error: 'Bu haydovchi hozir boshqa yukni olib ketyapti. Bo‘shagach taklifini qabul qilishingiz mumkin.' },
    };
  }

  const accepted = { ...offer, status: 'ACCEPTED', updatedAt: Date.now() };
  if (!(await kvSet(offerKey(offer.id), JSON.stringify(accepted)))) {
    return { status: 500, body: { error: 'Saqlanmadi' } };
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
    return { status: 500, body: { error: 'Buyurtma saqlanmadi' } };
  }
  // Taklif qabul qilindi — yuk ochiq yuklar ro'yxatidan tushadi.
  await invalidateLoadsCache();
  // Haydovchining "Mening yukim" bo'limi shu kalitga qaraydi.
  await kvSet(activeLoadKey(offer.driverIdentity), offer.orderCode).catch(() => {});

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
      + `Holatni ilovadagi yuk sahifasidan yangilab boring — `
      + `har bosqichda tugma keyingisining nomini yozib turadi.`,
    // Bosqichlar zanjiri (Yuklashga ketdim → Yukladim → Yo'ldaman →
    // Bo'shatdim) endi faqat ilovada yuradi.
    buttonText: 'Ilovada ochish',
    buttonUrl: loadUrl(offer.orderCode),
  });

  return { status: 200, body: { ok: true, offer: publicOfferShape(accepted), status: order.status } };
};

/** Taklifni qabul qilish yoki rad etish — faqat yuk egasi (saytdan, POST). */
const decideOffer = async (req, res, accept) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const identity = await resolveEmail({
    googleIdToken: body.googleIdToken,
    telegramInitData: body.telegramInitData, phoneToken: body.phoneToken,
  });
  if (!identity) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const { status, body: outBody } = await decideOfferCore(identity, body.id, accept);
  return res.status(status).json(outBody);
};

/** POST ?action=withdraw-offer — haydovchi o'z taklifini qaytarib oladi. */
const withdrawOffer = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const identity = await resolveEmail({
    googleIdToken: body.googleIdToken,
    telegramInitData: body.telegramInitData, phoneToken: body.phoneToken,
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

   Uchta chiqish yo'li:
     - bekor qilish  — yuk endi kerak emas (CANCELLED, oxirgi holat);
     - bo'shatish     — yuk kerak, lekin bu haydovchi javob bermayapti
                        (NEW ga qaytadi va ro'yxatda yana ko'rinadi);
     - voz kechish    — haydovchining o'zi yukdan chiqadi (xuddi shunday
                        NEW ga qaytadi).

   Birinchi ikkitasini yuk egasi qiladi, uchinchisini haydovchi.
   ============================================================ */
const CANCELLABLE = ['NEW', 'DRIVER_FOUND', 'PICKING_UP', 'LOADED', 'ON_THE_WAY'];
const RELEASABLE = ['DRIVER_FOUND', 'PICKING_UP', 'LOADED', 'ON_THE_WAY'];
/* Yo'lda ketayotganda ham voz kechish mumkin: mashina buzilib
   qolsa, yuk egasi buni bilishi va boshqa haydovchi izlashi kerak.
   Yetkazilgandan keyin esa ortga yo'l yo'q. */
const GIVEUPABLE = ['DRIVER_FOUND', 'PICKING_UP', 'LOADED', 'ON_THE_WAY'];

/**
 * Buyurtmani faqat egasi o'zgartira oladi. Telefon raqami yetarli emas:
 * yuk sahifasini ko'rgan har kim uni biladi, ya'ni raqamga tayansak
 * begona odam boshqa kishining buyurtmasini bekor qila olardi.
 */
const loadOwnOrder = async (req, res, allowedStatuses) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const identity = await resolveEmail({
    googleIdToken: body.googleIdToken,
    telegramInitData: body.telegramInitData, phoneToken: body.phoneToken,
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
  // Holat o'zgardi — ochiq yuklar ro'yxati endi to'g'ri emas.
  await invalidateLoadsCache();
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });
  // Yuk yo'q bo'ldi — haydovchi bo'shadi.
  if (hadDriver && hadDriver.identity) {
    await kvDel(activeLoadKey(hadDriver.identity)).catch(() => {});
  }

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
  // Holat o'zgardi — ochiq yuklar ro'yxati endi to'g'ri emas.
  await invalidateLoadsCache();
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });
  // Bo'shatilgan haydovchi endi yangi yuk olishi mumkin.
  if (previousDriver && previousDriver.identity) {
    await kvDel(activeLoadKey(previousDriver.identity)).catch(() => {});
  }

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

/**
 * POST ?action=giveup — olgan yukdan haydovchining o'zi voz kechadi.
 *
 * Ilgari bu faqat Telegram guruhidagi xabar ostidagi tugma orqali
 * bo'lardi. Guruh olib tashlangach imkoniyat yo'qolmasligi uchun
 * bir xil mantiq ilovaning o'ziga ko'chdi: yuk NEW ga qaytadi,
 * kim voz kechgani `releases` ga yoziladi va yuk egasiga darhol
 * xabar boradi — ya'ni u boshqa haydovchi izlay boshlashi mumkin.
 *
 * Huquq tekshiruvi `advanceOrder` dagi bilan bir xil: buyurtma kodi
 * yetarli emas, faqat aynan shu yukka biriktirilgan haydovchi.
 */
const giveUpOrder = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const identity = await resolveEmail({
    googleIdToken: body.googleIdToken,
    telegramInitData: body.telegramInitData, phoneToken: body.phoneToken,
  });
  if (!identity) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const code = String(body.code || '').trim().toUpperCase();
  const order = await readJson(`order:${code}`, null);
  if (!order) return res.status(404).json({ error: 'Buyurtma topilmadi' });

  if (!order.driver || order.driver.identity !== identity) {
    return res.status(403).json({ error: 'Bu buyurtma sizga tegishli emas' });
  }
  if (!GIVEUPABLE.includes(order.status || 'NEW')) {
    return res.status(409).json({ error: 'Bu amal endi mavjud emas' });
  }

  const previousDriver = order.driver;
  const reason = String(body.reason || '').trim().slice(0, 200);
  // Kim va nechchi marta voz kechgani yozib boriladi — bo'shatish
  // bilan bitta jurnalda, `by` maydoni ikkisini ajratib turadi.
  order.releases = Array.isArray(order.releases) ? order.releases : [];
  order.releases.push({
    at: Date.now(),
    by: 'DRIVER',
    driverName: previousDriver.name || null,
    driverTelegramId: previousDriver.telegramId || null,
    reason: reason || null,
  });
  order.status = 'NEW';
  order.driver = null;
  order.updatedAt = Date.now();

  if (!(await kvSet(`order:${code}`, JSON.stringify(order)))) {
    return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });
  }
  // Yuk yana ochiq — ro'yxat keshi endi to'g'ri emas.
  await invalidateLoadsCache();
  // Haydovchi bo'shadi — endi yangi yuk olishi mumkin.
  await kvDel(activeLoadKey(identity)).catch(() => {});

  await notifyUser(order.ownerIdentity || order.googleEmail, {
    category: 'orders',
    text: `<b>Haydovchi voz kechdi</b>\n\n`
      + `Buyurtma: <b>${esc(code)}</b>\n`
      + `${esc(order.fromCity)} → ${esc(order.toCity)}\n\n`
      + `${esc(previousDriver.name || 'Haydovchi')} yukdan voz kechdi. `
      + `Yuk yana ochiq — boshqa haydovchi taklif yuborishi mumkin.`
      + (reason ? `\n\nSabab: ${esc(reason)}` : ''),
  });

  return res.status(200).json({ ok: true, status: order.status });
};

export { decideOfferCore };

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const action = String(req.query.action || '');
    if (action === 'list') return listLoads(req, res);
    if (action === 'detail') return getLoadDetail(req, res);
    if (action === 'backhaul') return getBackhaul(req, res);
    if (action === 'price-stats') return getPriceStats(req, res);
    if (action === 'offers') return listOffers(req, res);
    if (action === 'my-offers') return listMyOffers(req, res);
    if (action === 'my-load') return getMyLoad(req, res);
    if (action === 'my-loads') return listMyLoads(req, res);
    if (action === 'stats') return getHomeStats(req, res);
    if (action === 'earnings') return getEarnings(req, res);
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
    if (action === 'giveup') return giveUpOrder(req, res);
    return createOrder(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
