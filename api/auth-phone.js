/**
 * POST /api/auth-phone
 *
 * Telefon raqami bilan ro'yxatdan o'tish va kirish. Tasdiqlash kodi
 * Telegram boti orqali keladi (SMS yo'q — sabablari lib/phoneAuth.js
 * boshida yozilgan).
 *
 * Amallar (`action` maydoni):
 *   register-start  {phone, firstName, lastName, terms}  -> kod yuboriladi
 *   login-start     {phone}            -> parolni tiklash uchun kod
 *   resend          {phone}            -> kodni qayta yuborish
 *   verify          {phone, code}      -> parol qo'yish uchun qisqa token
 *   set-password    {phone, setupToken, password} -> akkaunt + kirish tokeni
 *   login           {phone, password}  -> kirish tokeni
 *
 * Vercel Hobby'da 12 ta funksiya cheklovi bor, shuning uchun hamma
 * amal bitta endpoint ichida — har biriga alohida fayl ochilmagan.
 */
import { kvGet, kvSet } from '../lib/kv.js';
import { setVerification } from '../lib/verification.js';
import {
  normalisePhone, phoneIdentity, prettyPhone,
  authConfigured, readAccount, saveAccount,
  hashPassword, verifyPassword, passwordProblem,
  createOtp, verifyOtp, readOtp, markOtpDelivered, OTP_RESEND_MS,
  issueSessionToken, issueSetupToken, readSetupToken,
  allowLoginAttempt, resetLoginAttempts,
} from '../lib/phoneAuth.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '';

/** Bot allaqachon biladigan suhbatga kodni yuboradi. */
const sendCodeToChat = async (chatId, code) => {
  if (!BOT_TOKEN || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `<b>${code}</b> — YO‘LDA tasdiqlash kodi.\n\nKod 5 daqiqa amal qiladi. Uni hech kimga aytmang.`,
        parse_mode: 'HTML',
      }),
    });
    const json = await res.json();
    return Boolean(json.ok);
  } catch (err) {
    console.error('auth-phone sendCode failed:', err.message);
    return false;
  }
};

/**
 * Kodni yetkazishga urinadi. Raqam botga ulanmagan bo'lsa — kod
 * saqlanib turadi va odam botni ochganda (api/telegram.js, kontakt
 * ulashish) o'sha yerda yuboriladi.
 */
const deliverCode = async (phone, code) => {
  const chatId = await kvGet(`phoneChat:${phone}`);
  if (chatId && (await sendCodeToChat(chatId, code))) {
    await markOtpDelivered(phone);
    return 'telegram';
  }
  return 'bot';
};

const deliveryPayload = (phone, delivery) => ({
  ok: true,
  phone,
  prettyPhone: prettyPhone(phone),
  delivery,
  botUsername: BOT_USERNAME,
  botLink: BOT_USERNAME ? `https://t.me/${BOT_USERNAME}?start=kod` : '',
  resendInSeconds: Math.round(OTP_RESEND_MS / 1000),
});

const cleanName = (value, max = 40) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/* ---------- Amallar ---------- */

const registerStart = async (body, res) => {
  const phone = normalisePhone(body.phone);
  if (!phone) return res.status(400).json({ error: 'Telefon raqamini to‘liq kiriting' });

  const firstName = cleanName(body.firstName);
  const lastName = cleanName(body.lastName);
  if (firstName.length < 2) return res.status(400).json({ error: 'Ismingizni kiriting' });
  if (lastName.length < 2) return res.status(400).json({ error: 'Familiyangizni kiriting' });
  if (!body.terms) return res.status(400).json({ error: 'Foydalanish shartlariga rozilik kerak' });

  if (await readAccount(phone)) {
    return res.status(409).json({ error: 'Bu raqam allaqachon ro‘yxatdan o‘tgan. Kiring yoki parolni tiklang' });
  }

  const otp = await createOtp(phone, 'register');
  if (otp.error) return res.status(429).json({ error: otp.error, retryInSeconds: otp.retryInSeconds });

  // Kod tasdiqlangandan keyin akkaunt shu ma'lumot bilan yaratiladi.
  await kvSet(`phonePending:${phone}`, JSON.stringify({ firstName, lastName, at: Date.now() }));

  const delivery = await deliverCode(phone, otp.code);
  return res.status(200).json(deliveryPayload(phone, delivery));
};

const loginStart = async (body, res) => {
  const phone = normalisePhone(body.phone);
  if (!phone) return res.status(400).json({ error: 'Telefon raqamini to‘liq kiriting' });
  if (!(await readAccount(phone))) {
    return res.status(404).json({ error: 'Bu raqam ro‘yxatdan o‘tmagan' });
  }

  const otp = await createOtp(phone, 'reset');
  if (otp.error) return res.status(429).json({ error: otp.error, retryInSeconds: otp.retryInSeconds });

  const delivery = await deliverCode(phone, otp.code);
  return res.status(200).json(deliveryPayload(phone, delivery));
};

const resend = async (body, res) => {
  const phone = normalisePhone(body.phone);
  if (!phone) return res.status(400).json({ error: 'Telefon raqamini to‘liq kiriting' });

  const previous = await readOtp(phone);
  const purpose = previous ? previous.purpose : (body.mode === 'reset' ? 'reset' : 'register');
  if (purpose === 'register' && (await readAccount(phone))) {
    return res.status(409).json({ error: 'Bu raqam allaqachon ro‘yxatdan o‘tgan' });
  }
  if (purpose === 'reset' && !(await readAccount(phone))) {
    return res.status(404).json({ error: 'Bu raqam ro‘yxatdan o‘tmagan' });
  }

  const otp = await createOtp(phone, purpose);
  if (otp.error) return res.status(429).json({ error: otp.error, retryInSeconds: otp.retryInSeconds });

  const delivery = await deliverCode(phone, otp.code);
  return res.status(200).json(deliveryPayload(phone, delivery));
};

const verify = async (body, res) => {
  const phone = normalisePhone(body.phone);
  if (!phone) return res.status(400).json({ error: 'Telefon raqamini to‘liq kiriting' });

  const result = await verifyOtp(phone, body.code);
  if (result.error) return res.status(400).json({ error: result.error, attemptsLeft: result.attemptsLeft });

  const setupToken = issueSetupToken(phone, result.purpose);
  if (!setupToken) return res.status(500).json({ error: 'Server sozlanmagan. Administratorga murojaat qiling' });

  return res.status(200).json({ ok: true, purpose: result.purpose, setupToken });
};

/** Profil yozuvi — ilovaning qolgan qismi shu ko'rinishni kutadi. */
const upsertProfile = async (identity, phone, firstName, lastName) => {
  const key = `profile:${identity}`;
  let profile = {};
  try {
    profile = JSON.parse((await kvGet(key)) || '{}');
  } catch {
    profile = {};
  }
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  if (fullName) profile.name = fullName;
  profile.phone = phone;
  // Raqam Telegram botining «Raqamni ulashish» tugmasi orqali
  // tasdiqlangan — kod aynan shu yo'l bilan yetib borgan.
  setVerification(profile, 'PHONE', {
    status: 'VERIFIED', at: Date.now(), reviewedAt: Date.now(), reason: '',
  });
  await kvSet(key, JSON.stringify(profile));
  return profile;
};

const setPassword = async (body, res) => {
  const phone = normalisePhone(body.phone);
  if (!phone) return res.status(400).json({ error: 'Telefon raqamini to‘liq kiriting' });

  const payload = readSetupToken(body.setupToken, 'register') || readSetupToken(body.setupToken, 'reset');
  if (!payload || payload.p !== phone) {
    return res.status(401).json({ error: 'Tasdiqlash muddati tugagan. Kodni qaytadan so‘rang' });
  }

  const problem = passwordProblem(body.password);
  if (problem) return res.status(400).json({ error: problem });

  const existing = await readAccount(phone);
  if (payload.w === 'register' && existing) {
    return res.status(409).json({ error: 'Bu raqam allaqachon ro‘yxatdan o‘tgan' });
  }
  if (payload.w === 'reset' && !existing) {
    return res.status(404).json({ error: 'Bu raqam ro‘yxatdan o‘tmagan' });
  }

  let firstName = existing ? existing.firstName : '';
  let lastName = existing ? existing.lastName : '';
  if (payload.w === 'register') {
    try {
      const pending = JSON.parse((await kvGet(`phonePending:${phone}`)) || '{}');
      firstName = cleanName(pending.firstName);
      lastName = cleanName(pending.lastName);
    } catch { /* ism yo'qolgan bo'lsa profil keyin to'ldiriladi */ }
  }

  const pass = await hashPassword(String(body.password));
  const account = {
    phone,
    firstName,
    lastName,
    pass,
    // Parol har almashtirilganda oshadi — eski qurilmalardagi
    // tokenlar shu bilan darhol kuchini yo'qotadi.
    pv: existing ? (Number(existing.pv) || 1) + 1 : 1,
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now(),
  };
  if (!(await saveAccount(account))) {
    return res.status(500).json({ error: 'Saqlab bo‘lmadi, qayta urinib ko‘ring' });
  }

  const identity = phoneIdentity(phone);
  await upsertProfile(identity, phone, firstName, lastName);
  await resetLoginAttempts(phone);

  const token = issueSessionToken(phone, account.pv);
  return res.status(200).json({
    ok: true,
    phoneToken: token,
    name: [firstName, lastName].filter(Boolean).join(' '),
    phone,
    prettyPhone: prettyPhone(phone),
  });
};

const login = async (body, res) => {
  const phone = normalisePhone(body.phone);
  if (!phone) return res.status(400).json({ error: 'Telefon raqamini to‘liq kiriting' });

  if (!(await allowLoginAttempt(phone))) {
    return res.status(429).json({ error: 'Juda ko‘p urinish. Bir soatdan keyin qayta urinib ko‘ring' });
  }

  const account = await readAccount(phone);
  // Raqam yo'q ham, parol noto'g'ri ham — bitta javob. Aks holda bu
  // forma qaysi raqamlar ro'yxatdan o'tganini ayturvchi vositaga aylanadi.
  const okPassword = account ? await verifyPassword(String(body.password ?? ''), account.pass) : false;
  if (!account || !okPassword) {
    return res.status(401).json({ error: 'Raqam yoki parol noto‘g‘ri' });
  }

  await resetLoginAttempts(phone);
  const token = issueSessionToken(phone, Number(account.pv) || 1);
  if (!token) return res.status(500).json({ error: 'Server sozlanmagan. Administratorga murojaat qiling' });

  return res.status(200).json({
    ok: true,
    phoneToken: token,
    name: [account.firstName, account.lastName].filter(Boolean).join(' '),
    phone,
    prettyPhone: prettyPhone(phone),
  });
};

const ACTIONS = {
  'register-start': registerStart,
  'login-start': loginStart,
  resend,
  verify,
  'set-password': setPassword,
  login,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!authConfigured()) {
    return res.status(503).json({ error: 'Telefon orqali kirish hozircha sozlanmagan' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const action = ACTIONS[String(body.action || '')];
  if (!action) return res.status(400).json({ error: 'Noma’lum amal' });

  try {
    return await action(body, res);
  } catch (err) {
    console.error('auth-phone error:', err.message);
    return res.status(500).json({ error: 'Xatolik yuz berdi, qayta urinib ko‘ring' });
  }
}
