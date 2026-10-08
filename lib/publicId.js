/**
 * Har bir odamning o'z raqami.
 *
 * NEGA KERAK. Ilova ichida odamni ajratish uchun uchta narsa bor
 * edi va uchalasi ham bu ish uchun yaramaydi:
 *
 *   - ichki shaxs (`tg:123456`, `ph:998901234567`, pochta manzili)
 *     — bu kalit, ko'rsatish uchun emas: unda telefon raqami yoki
 *     pochta manzili ochiq turadi;
 *   - `username` — ixtiyoriy, ko'pchilikda yo'q va o'zgarib turadi;
 *   - telefon raqami — buni birovga aytish shaxsiy ma'lumotni
 *     berish degani.
 *
 * Shuning uchun qisqa, o'zgarmas va telefonda aytish oson raqam
 * beriladi: 100001, 100002 va hokazo. Haydovchi yuk egasiga
 * "mening raqamim 100342" deb ayta oladi va bu hech narsani
 * oshkor qilmaydi.
 *
 * NEGA KETMA-KET. Tasodifiy raqam chiroyliroq ko'rinardi, lekin
 * u band-bandligini tekshirishni talab qiladi: ikki odam bir
 * vaqtda ro'yxatdan o'tsa, ikkalasiga bitta raqam tushishi
 * mumkin. `INCR` esa Redis'da atomik — har chaqiruv boshqa son
 * qaytaradi va hech qanday tekshiruv kerak emas.
 *
 * Boshlanishi 100000 dan: shunda raqam har doim olti xonali
 * bo'ladi, "7" va "1000007" kabi turli uzunliklar aralashmaydi.
 */
import { kvGet, kvSet, kvIncr } from './kv.js';

export const SEQ_KEY = 'public_id_seq';
const BASE = 100000;

/** Raqamdan egasini topish uchun teskari indeks. */
export const publicIdKey = (id) => `publicId:${id}`;

/** Navbatdagi raqam. Atomik — ikki odamga bitta raqam tushmaydi. */
export const nextPublicId = async () => {
  const n = await kvIncr(SEQ_KEY);
  if (!n || !Number.isFinite(Number(n))) return null;
  return BASE + Number(n);
};

/**
 * Profilda raqam bo'lmasa — beradi.
 *
 * Profil obyektini O'ZGARTIRADI va yangi raqam berilgan bo'lsa
 * `true` qaytaradi, ya'ni chaqirgan tomon profilni saqlashi
 * kerakligini biladi. Saqlashni o'zi qilmaydi: chaqirgan joyda
 * profil ko'pincha baribir saqlanadi va ikki marta yozish
 * ortiqcha bo'lardi.
 *
 * Hech qachon xato tashlamaydi: raqam berilmasa ham odam
 * ro'yxatdan o'ta olishi kerak.
 */
export const ensurePublicId = async (identity, profile) => {
  if (!identity || !profile || profile.publicId) return false;
  try {
    const id = await nextPublicId();
    if (!id) return false;
    profile.publicId = id;
    // Teskari indeks: raqam bo'yicha odamni topish uchun.
    await kvSet(publicIdKey(id), identity).catch(() => {});
    return true;
  } catch {
    return false;
  }
};

/** Raqam bo'yicha egasining shaxsi. */
export const identityByPublicId = async (id) => {
  const clean = String(id || '').replace(/\D/g, '');
  if (!clean) return null;
  return kvGet(publicIdKey(clean));
};
