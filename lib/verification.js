/**
 * Uch xil tasdiqlash.
 *
 * Ilgari bitta `verified` bayrog'i bor edi va u hech nimani aniq
 * anglatmasdi: raqami tekshirilganmi, pasporti ko'rilganmi, yoki
 * mashinasi bormi — bittasi ham ma'lum emas. Endi uchtasi alohida:
 *
 *   PHONE     — telefon raqami haqiqiy va shu odamniki.
 *               Telegram boti orqali avtomatik: odam «Raqamni
 *               ulashish» tugmasini bosadi, Telegram raqamni o'zi
 *               yuboradi. Bu yerda hech qanday SMS xizmati yo'q va
 *               kerak ham emas.
 *   IDENTITY  — hujjat bo'yicha shaxsi. Buni odam ko'radi:
 *               foydalanuvchi hujjat rasmini yuklaydi, moderator
 *               tasdiqlaydi yoki rad etadi.
 *   TRANSPORT — texnik pasport. Xuddi shu tartibda.
 *
 * Hujjat qaror chiqarilgach o'chiriladi. Ko'rib bo'lingan pasport
 * rasmini saqlab turishning hech qanday sababi yo'q, xavfi esa bor.
 *
 * Eski yozuvlar: `verified: true` — bu doim "shaxsi tekshirilgan"
 * degani edi, shuning uchun u IDENTITY ga o'giriladi. Ko'k belgi ham
 * o'sha joyda qoladi, ya'ni hech kim bor belgisidan ayrilmaydi.
 */

export const KINDS = ['PHONE', 'IDENTITY', 'TRANSPORT'];

/** Odam ko'rib chiqadigan turlar — qolgani avtomatik. */
export const REVIEWED_KINDS = ['IDENTITY', 'TRANSPORT'];

export const KIND_LABELS = {
  PHONE: 'Telefon raqami',
  IDENTITY: 'Shaxs hujjati',
  TRANSPORT: 'Texnik pasport',
};

export const STATUSES = ['NONE', 'PENDING', 'VERIFIED', 'REJECTED'];

/** Rad etilgandan keyin qayta yuborishdan oldin kutiladigan vaqt. */
export const RESUBMIT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Hujjat rasmi uchun yuqori chegara (data: URL uzunligi bo'yicha). */
export const MAX_DOC_CHARS = 900_000;

/**
 * Profildagi tasdiqlar. Eski yozuvni ham to'g'ri o'qiydi — chaqirgan
 * joyda "bormi yo'qmi" degan tekshiruvlar takrorlanmasin.
 */
export const readVerifications = (profile) => {
  const p = profile && typeof profile === 'object' ? profile : {};
  const stored = p.verifications && typeof p.verifications === 'object' ? p.verifications : {};
  const out = {};
  for (const kind of KINDS) {
    const entry = stored[kind] && typeof stored[kind] === 'object' ? stored[kind] : null;
    out[kind] = {
      status: entry && STATUSES.includes(entry.status) ? entry.status : 'NONE',
      at: (entry && entry.at) || 0,
      reviewedAt: (entry && entry.reviewedAt) || 0,
      reason: (entry && entry.reason) || '',
    };
  }

  // Eski bayroq: u har doim "shaxsi tekshirilgan" degani bo'lgan.
  if (p.verified && out.IDENTITY.status === 'NONE') {
    out.IDENTITY = { status: 'VERIFIED', at: 0, reviewedAt: 0, reason: '' };
  }
  // Eski navbat: request-verification faqat shaxs uchun ishlatilardi.
  if (p.verificationRequestedAt && out.IDENTITY.status === 'NONE') {
    out.IDENTITY = { status: 'PENDING', at: p.verificationRequestedAt, reviewedAt: 0, reason: '' };
  }
  return out;
};

export const statusOf = (profile, kind) => readVerifications(profile)[kind]?.status || 'NONE';

/**
 * Bitta turning holatini o'zgartiradi va eski maydonlarni moslab
 * qo'yadi, shunda admin paneli va ko'k belgi ishlashda davom etadi.
 * Profil ob'ekti joyida o'zgaradi.
 */
export const setVerification = (profile, kind, patch) => {
  const p = profile && typeof profile === 'object' ? profile : {};
  const all = readVerifications(p);
  all[kind] = { ...all[kind], ...patch };
  p.verifications = all;

  // Ko'k belgi — shaxs tasdig'i. Bir joyda hisoblanadi, ikkita
  // haqiqat manbai bo'lmasin.
  p.verified = all.IDENTITY.status === 'VERIFIED';
  if (all.IDENTITY.status === 'PENDING') p.verificationRequestedAt = all.IDENTITY.at || Date.now();
  else delete p.verificationRequestedAt;
  return p;
};

/** Hujjat rasmi — faqat moderator ko'radi va qaror chiqqach o'chadi. */
export const docKey = (identity, kind) => `verifydoc:${identity}:${kind}`;

/**
 * Ommaviy profilga chiqadigan shakl: faqat "tasdiqlanganmi" degan
 * javob. Kutilayotgani ham, rad etilgani ham begonaga ko'rinmaydi —
 * bu odamning o'z ishi.
 */
export const publicVerifications = (profile) => {
  const all = readVerifications(profile);
  const out = {};
  for (const kind of KINDS) out[kind] = all[kind].status === 'VERIFIED';
  return out;
};

/** Yangi so'rov yuborish mumkinmi? */
export const canSubmit = (entry) => {
  if (!entry) return { ok: true };
  if (entry.status === 'VERIFIED') return { ok: false, error: 'Bu allaqachon tasdiqlangan' };
  if (entry.status === 'PENDING') return { ok: false, error: 'So‘rovingiz ko‘rib chiqilmoqda' };
  if (entry.status === 'REJECTED' && Date.now() - (entry.reviewedAt || 0) < RESUBMIT_COOLDOWN_MS) {
    return { ok: false, error: 'Qayta yuborish uchun bir kun kuting' };
  }
  return { ok: true };
};
