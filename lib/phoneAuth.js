/**
 * Telefon raqami + Telegram bot orqali keladigan kod bilan kirish.
 *
 * Nega SMS emas: bu loyihada SMS provayderi yo'q va uni soxta qilib
 * ko'rsatish mumkin emas. Telegram boti esa allaqachon bor va raqamni
 * o'zi tasdiqlab beradi — odam botda «Raqamni ulashish» tugmasini
 * bosganda Telegram `contact.user_id` bilan birga raqamni yuboradi,
 * ya'ni raqam haqiqatan ham shu odamniki ekani isbotlanadi.
 *
 * Muhim cheklov: bot telefon raqamiga yoza olmaydi, faqat `chat_id` ga
 * yoza oladi. Shuning uchun birinchi marta odam botni ochib raqamini
 * ulashadi — shundan keyin `phoneChat:<raqam>` indeksi paydo bo'ladi va
 * keyingi kodlar to'g'ridan-to'g'ri yetib boradi.
 *
 * Bu yerda faqat qoidalar va kriptografiya. Tarmoq (bot, HTTP) bilan
 * ishlash api/auth-phone.js va api/telegram.js da.
 */
import crypto from 'node:crypto';
import { kvGet, kvSet, kvDel } from './kv.js';

export const OTP_TTL_MS = 5 * 60 * 1000;        // kod 5 daqiqa yashaydi
export const OTP_RESEND_MS = 60 * 1000;         // «qayta yuborish» taymeri
export const OTP_MAX_ATTEMPTS = 5;              // 4 xonali kod uchun — 5/10000
export const OTP_MAX_PER_HOUR = 5;              // bitta raqamga soatiga
export const LOGIN_MAX_FAILS = 10;              // soatiga noto'g'ri parol
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SETUP_TTL_MS = 10 * 60 * 1000;            // kod tasdiqlangandan keyin parol qo'yishga
const HOUR_MS = 60 * 60 * 1000;

/* ---------- Raqam ---------- */

/**
 * O'zbekiston raqamini bitta ko'rinishga keltiradi: +998XXXXXXXXX.
 * Boshqa hech qanday ko'rinish qabul qilinmaydi — ikki xil yozilgan
 * bitta raqam ikkita akkaunt bo'lib qolmasin.
 */
export const normalisePhone = (raw) => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (/^998\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\d{9}$/.test(digits)) return `+998${digits}`;
  return null;
};

/** `profile:<identity>` va boshqa hamma kalitlarda ishlatiladigan identity. */
export const phoneIdentity = (phone) => `ph:${String(phone).replace(/\D/g, '')}`;

/** Ekranda ko'rsatish uchun: +998 90 123 45 67 */
export const prettyPhone = (phone) => {
  const d = String(phone).replace(/\D/g, '');
  if (d.length !== 12) return phone;
  return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
};

/* ---------- Imzo kaliti ----------
   AUTH_SECRET bo'lsa o'sha ishlatiladi. Bo'lmasa — bot tokenidan
   hosil qilinadi: u ham faqat serverda turadigan maxfiy qiymat,
   ya'ni kodda hech qanday sir yozilmaydi. Ikkalasi ham yo'q bo'lsa
   token umuman chiqarilmaydi (soxta xavfsizlikdan ko'ra ishlamagani
   yaxshi). */
const signingKey = () => {
  const base = process.env.AUTH_SECRET || process.env.TELEGRAM_BOT_TOKEN;
  if (!base) return null;
  return crypto.createHash('sha256').update(`yolda-phone-auth-v1:${base}`).digest();
};

export const authConfigured = () => Boolean(signingKey());

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payload) => {
  const key = signingKey();
  if (!key) return null;
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return `v1.${body}.${mac}`;
};

const unsign = (token) => {
  const key = signingKey();
  if (!key || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const expected = crypto.createHmac('sha256', key).update(parts[1]).digest('base64url');
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
};

/* ---------- Akkaunt ---------- */

const accountKey = (phone) => `phoneUser:${phone}`;

export const readAccount = async (phone) => {
  const raw = await kvGet(accountKey(phone));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const saveAccount = (account) => kvSet(accountKey(account.phone), JSON.stringify(account));

/* ---------- Parol ----------
   scrypt — Node'ning o'zida bor, qo'shimcha paket kerak emas.
   Har parolning o'z tuzi (salt) bor, taqqoslash esa vaqt bo'yicha
   bir xil (timingSafeEqual). */
const SCRYPT = { N: 16384, r: 8, p: 1 };

export const hashPassword = (password) =>
  new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, 64, SCRYPT, (err, dk) => {
      if (err) reject(err);
      else resolve({ salt: salt.toString('base64'), hash: dk.toString('base64') });
    });
  });

export const verifyPassword = (password, stored) =>
  new Promise((resolve) => {
    if (!stored || !stored.salt || !stored.hash) return resolve(false);
    crypto.scrypt(password, Buffer.from(stored.salt, 'base64'), 64, SCRYPT, (err, dk) => {
      if (err) return resolve(false);
      const want = Buffer.from(stored.hash, 'base64');
      resolve(dk.length === want.length && crypto.timingSafeEqual(dk, want));
    });
  });

/** Parol talablari. Xabar foydalanuvchiga ko'rinadi. */
export const passwordProblem = (password) => {
  const value = String(password ?? '');
  if (value.length < 8) return 'Parol kamida 8 ta belgidan iborat bo‘lsin';
  if (value.length > 128) return 'Parol juda uzun';
  if (!/[a-zA-Z]/.test(value) || !/\d/.test(value)) return 'Parolda harf ham, raqam ham bo‘lsin';
  return null;
};

/* ---------- Tokenlar ---------- */

/**
 * Kirish tokeni. Ichida faqat raqam va parol versiyasi (`pv`) bor —
 * parol o'zgarganda eski tokenlar o'z-o'zidan ishlamay qoladi.
 */
export const issueSessionToken = (phone, pv) =>
  sign({ t: 's', p: phone, pv: Number(pv) || 1, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS });

/** Token -> raqam. Akkaunt va `pv` tekshiruvi — resolvePhoneIdentity'da. */
export const readSessionToken = (token) => {
  const payload = unsign(token);
  return payload && payload.t === 's' ? payload : null;
};

/** Kod tasdiqlangach beriladigan qisqa muddatli token: parol qo'yish uchun. */
export const issueSetupToken = (phone, purpose) =>
  sign({ t: 'w', p: phone, w: purpose, iat: Date.now(), exp: Date.now() + SETUP_TTL_MS });

export const readSetupToken = (token, purpose) => {
  const payload = unsign(token);
  if (!payload || payload.t !== 'w' || payload.w !== purpose) return null;
  return payload;
};

/* ---------- Kod ---------- */

const otpKey = (phone) => `otp:${phone}`;
const outKey = (phone) => `otpOut:${phone}`;
const rateKey = (phone) => `otpRate:${phone}`;
const failKey = (phone) => `loginFail:${phone}`;

const digest = (phone, code) =>
  crypto.createHash('sha256').update(`${phone}:${code}`).digest('base64');

/** Soatlik hisoblagich. KV'da TTL yo'q, shuning uchun oyna vaqti ichida saqlaymiz. */
const bumpCounter = async (key, limit) => {
  let record = { n: 0, since: Date.now() };
  const raw = await kvGet(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Date.now() - Number(parsed.since) < HOUR_MS) record = parsed;
    } catch { /* buzilgan yozuv — noldan boshlaymiz */ }
  }
  if (record.n >= limit) return false;
  record.n += 1;
  await kvSet(key, JSON.stringify(record));
  return true;
};

const clearCounter = (key) => kvDel(key);

export const readOtp = async (phone) => {
  const raw = await kvGet(otpKey(phone));
  if (!raw) return null;
  try {
    const record = JSON.parse(raw);
    if (!record || Date.now() > record.expiresAt) return null;
    return record;
  } catch {
    return null;
  }
};

/**
 * Yangi kod yaratadi (yoki «juda tez-tez» deb rad etadi).
 * Kodning o'zi faqat shu yerdan qaytadi — KV'da hash'i turadi.
 */
export const createOtp = async (phone, purpose) => {
  const existing = await readOtp(phone);
  if (existing && Date.now() - existing.sentAt < OTP_RESEND_MS) {
    return { error: 'Biroz kuting, kod endigina yuborilgan', retryInSeconds: Math.ceil((OTP_RESEND_MS - (Date.now() - existing.sentAt)) / 1000) };
  }
  if (!(await bumpCounter(rateKey(phone), OTP_MAX_PER_HOUR))) {
    return { error: 'Juda ko‘p urinish. Bir soatdan keyin qayta urinib ko‘ring' };
  }

  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  const record = {
    phone,
    purpose,
    codeHash: digest(phone, code),
    attempts: 0,
    sentAt: Date.now(),
    expiresAt: Date.now() + OTP_TTL_MS,
    delivered: false,
  };
  if (!(await kvSet(otpKey(phone), JSON.stringify(record)))) {
    return { error: 'Kod yaratib bo‘lmadi, qayta urinib ko‘ring' };
  }
  // Yetkazilmagan kod alohida kalitda kutib turadi: raqam hali botga
  // ulanmagan bo'lsa, odam botga raqamini ulashgan zahoti kod o'ziga
  // yuboriladi (api/telegram.js). Yetkazilishi bilan darhol o'chadi —
  // tekshirish baribir yuqoridagi hash bo'yicha ketadi.
  await kvSet(outKey(phone), code);
  return { ok: true, code, record };
};

/** Hali yuborilmagan kod (yoki null). O'qish uni o'chirmaydi. */
export const peekUndeliveredCode = async (phone) => {
  const record = await readOtp(phone);
  if (!record || record.delivered) return null;
  return (await kvGet(outKey(phone))) || null;
};

/** Bot kodni yetkazgach chaqiriladi — «yetkazildi» belgisi uchun. */
export const markOtpDelivered = async (phone) => {
  await kvDel(outKey(phone));
  const record = await readOtp(phone);
  if (!record) return false;
  record.delivered = true;
  return kvSet(otpKey(phone), JSON.stringify(record));
};

export const verifyOtp = async (phone, code, purpose) => {
  const clean = String(code ?? '').replace(/\D/g, '');
  if (clean.length !== 4) return { error: 'Kod 4 ta raqamdan iborat' };

  const record = await readOtp(phone);
  if (!record) return { error: 'Kod eskirgan. Qaytadan so‘rang' };
  if (purpose && record.purpose !== purpose) return { error: 'Kod bu amal uchun emas' };

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await kvDel(otpKey(phone));
    await kvDel(outKey(phone));
    return { error: 'Juda ko‘p noto‘g‘ri urinish. Kodni qaytadan so‘rang' };
  }

  const want = Buffer.from(record.codeHash, 'base64');
  const got = Buffer.from(digest(phone, clean), 'base64');
  const match = want.length === got.length && crypto.timingSafeEqual(want, got);
  if (!match) {
    record.attempts += 1;
    await kvSet(otpKey(phone), JSON.stringify(record));
    return { error: 'Kod noto‘g‘ri', attemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - record.attempts) };
  }

  await kvDel(otpKey(phone));
  await kvDel(outKey(phone));
  return { ok: true, purpose: record.purpose };
};

/* ---------- Parol bilan kirish uchun hisoblagich ---------- */
export const allowLoginAttempt = (phone) => bumpCounter(failKey(phone), LOGIN_MAX_FAILS);
export const resetLoginAttempts = (phone) => clearCounter(failKey(phone));

/**
 * Kirish tokenidan identity. Akkaunt hali ham bormi va parol
 * o'zgarmaganmi — shu yerda tekshiriladi, shuning uchun parolni
 * almashtirish eski qurilmalarni darhol chiqarib yuboradi.
 */
export const resolvePhoneIdentity = async (token) => {
  const payload = readSessionToken(token);
  if (!payload) return null;
  const account = await readAccount(payload.p);
  if (!account || (Number(account.pv) || 1) !== payload.pv) return null;
  return { identity: phoneIdentity(payload.p), phone: payload.p, account };
};
