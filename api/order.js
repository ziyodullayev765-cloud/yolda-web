/**
 * POST /api/order
 *
 * Receives an order from the website, recomputes the price server-side, and
 * posts it to the drivers' Telegram group with an "accept" button.
 *
 * The bot token never reaches the browser — that is the whole reason this
 * function exists rather than the page calling Telegram directly.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// Group id is not a secret, so it ships with the code as a fallback.
const GROUP_ID = process.env.TELEGRAM_GROUP_ID || '-1003778958582';
// Must match the Client ID configured in Google Cloud Console / api/config.js.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

const PRICE_PER_KM = Number(process.env.PRICE_PER_KM || 2500);
const PRICE_PER_KG = Number(process.env.PRICE_PER_KG || 300);
const PRICE_MINIMUM = Number(process.env.PRICE_MINIMUM || 150000);

const CITIES = [
  'Toshkent', 'Samarqand', 'Buxoro', 'Andijon',
  'Namangan', 'Nukus', 'Qarshi', 'Urganch',
];

const DISTANCE = {
  'Andijon|Buxoro': 700, 'Andijon|Namangan': 90, 'Andijon|Nukus': 1450, 'Andijon|Qarshi': 750,
  'Andijon|Samarqand': 480, 'Andijon|Toshkent': 320, 'Andijon|Urganch': 1300,
  'Buxoro|Namangan': 650, 'Buxoro|Nukus': 550, 'Buxoro|Qarshi': 280, 'Buxoro|Samarqand': 270,
  'Buxoro|Toshkent': 450, 'Buxoro|Urganch': 450,
  'Namangan|Nukus': 1400, 'Namangan|Qarshi': 700, 'Namangan|Samarqand': 440,
  'Namangan|Toshkent': 280, 'Namangan|Urganch': 1250,
  'Nukus|Qarshi': 700, 'Nukus|Samarqand': 950, 'Nukus|Toshkent': 1200, 'Nukus|Urganch': 180,
  'Qarshi|Samarqand': 220, 'Qarshi|Toshkent': 520, 'Qarshi|Urganch': 750,
  'Samarqand|Toshkent': 300, 'Samarqand|Urganch': 800,
  'Toshkent|Urganch': 1050,
};

const CARGO = {
  GENERAL: { label: 'Umumiy yuk', emoji: '📦', mult: 1.0 },
  PERISHABLE: { label: 'Tez buziluvchi', emoji: '🧊', mult: 1.3 },
  FRAGILE: { label: 'Qimmatbaho / mo\u2018rt', emoji: '💎', mult: 1.5 },
  HEAVY: { label: 'Og\u2018ir texnika', emoji: '🏗', mult: 1.4 },
};

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const generateCode = () => {
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `YL-${out}`;
};

const formatNum = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Telegram MarkdownV2 requires escaping a long list of characters. */
const escapeMd = (s) => String(s).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (m) => `\\${m}`);

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
  if (!CITIES.includes(fromCity)) errors.push('Noto\u2018g\u2018ri shahar (qayerdan)');
  if (!CITIES.includes(toCity)) errors.push('Noto\u2018g\u2018ri shahar (qayerga)');
  if (fromCity && fromCity === toCity) errors.push('Shaharlar bir xil bo\u2018lmasin');

  const weightKg = Number(body.weightKg);
  if (!Number.isInteger(weightKg) || weightKg < 1 || weightKg > 50_000) {
    errors.push('Og\u2018irlik 1 dan 50000 kg gacha bo\u2018lsin');
  }

  const cargoType = String(body.cargoType || 'GENERAL');
  if (!CARGO[cargoType]) errors.push('Noto\u2018g\u2018ri yuk turi');

  const name = String(body.name || '').trim().slice(0, 80);
  if (name.length < 2) errors.push('Ismni kiriting');

  const phone = normalisePhone(body.phone);
  if (!phone) errors.push('Telefon raqam noto\u2018g\u2018ri');

  const note = String(body.note || '').trim().slice(0, 300);

  return { errors, value: { fromCity, toCity, weightKg, cargoType, name, phone, note } };
};

const quote = ({ fromCity, toCity, weightKg, cargoType }) => {
  const distanceKm = DISTANCE[[fromCity, toCity].sort().join('|')] ?? 400;
  const mult = CARGO[cargoType].mult;
  const rounded = Math.round(((distanceKm * PRICE_PER_KM + weightKg * PRICE_PER_KG) * mult) / 1000) * 1000;
  return { distanceKm, amount: Math.max(PRICE_MINIMUM, rounded) };
};

const buildMessage = (order) => {
  const cargo = CARGO[order.cargoType];
  return [
    `🚚 *YANGI YUK* \\| \`${escapeMd(order.code)}\``,
    '',
    `📍 *${escapeMd(order.fromCity)}* → *${escapeMd(order.toCity)}*`,
    `📏 ${escapeMd(formatNum(order.distanceKm))} km`,
    `⚖️ ${escapeMd(formatNum(order.weightKg))} kg`,
    `${cargo.emoji} ${escapeMd(cargo.label)}`,
    '',
    `💰 *${escapeMd(formatNum(order.amount))} so\u2018m* \\(taxminiy\\)`,
    '',
    `👤 ${escapeMd(order.name)}`,
    order.googleEmail ? `✅ Google: ${escapeMd(order.googleEmail)}` : null,
    order.note ? `📝 ${escapeMd(order.note)}` : null,
    '',
    '_Raqam buyurtmani qabul qilgandan keyin ko\u2018rinadi\\._',
  ].filter(Boolean).join('\n');
};

/**
 * Verifies the Google ID token the browser got from "Sign in with Google".
 * Re-checking it here (not trusting the client) is what actually stops a
 * spoofed order — the client-side sign-in alone proves nothing on its own.
 * Uses Google's tokeninfo endpoint so no extra dependency is needed.
 */
const verifyGoogleEmail = async (idToken) => {
  if (!idToken) return null;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!res.ok) return null;
    const payload = await res.json();
    if (GOOGLE_CLIENT_ID && payload.aud !== GOOGLE_CLIENT_ID) return null;
    if (payload.email_verified !== 'true' && payload.email_verified !== true) return null;
    return payload.email || null;
  } catch {
    return null;
  }
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!BOT_TOKEN || !GROUP_ID) {
    return res.status(500).json({ error: 'Server sozlanmagan' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});

  const googleEmail = await verifyGoogleEmail(body.googleIdToken);
  if (!googleEmail) {
    return res.status(401).json({ error: 'Avval Google orqali kiring' });
  }

  const { errors, value } = validate(body);
  if (errors.length) {
    return res.status(400).json({ error: errors[0], errors });
  }

  if (isThrottled(value.phone)) {
    return res.status(429).json({ error: 'Biroz kuting va qayta urinib ko\u2018ring' });
  }

  const { distanceKm, amount } = quote(value);
  const code = generateCode();
  const order = { ...value, code, distanceKm, amount, googleEmail };

  try {
    await telegram('sendMessage', {
      chat_id: GROUP_ID,
      text: buildMessage(order),
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [[
          {
            text: '✅ Men olaman',
            // The phone rides in callback_data so the bot can reveal it to
            // whoever taps first — no database required.
            callback_data: `take:${code}:${value.phone}`,
          },
        ]],
      },
    });

    return res.status(200).json({ ok: true, code, amount, distanceKm });
  } catch (err) {
    console.error('Telegram send failed:', err.message);
    return res.status(502).json({ error: 'Hozircha yuborib bo\u2018lmadi, birozdan keyin urinib ko\u2018ring' });
  }
}
