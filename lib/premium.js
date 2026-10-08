/**
 * Premium: yangi yukni birinchi ko'radigan odamlar.
 *
 * Premiumning yagona imtiyozi — VAQT. Yangi yuk chiqqanda xabar
 * premiumga darhol boradi, qolganlarga esa bir soatdan keyin
 * (lib/notifyQueue.js). Yukning o'zi hammaga ko'rinadi, hech
 * narsa yopilmaydi: faqat kim birinchi taklif yuborishga ulguradi
 * degan farq qoladi.
 *
 * TO'LOV HAQIDA. Bu yerda to'lov yo'q va ataylab yo'q: ilovada
 * to'lov tizimi hali qurilmagan. Premiumni faqat admin qo'lda
 * beradi (api/admin-data.js, `action=update-user`). Ya'ni
 * mexanizm bor va ishlaydi, lekin "sotib olish" tugmasi yo'q —
 * ishlamaydigan tugma qo'yishdan ko'ra tugmasiz qolgani yaxshi.
 * To'lov ulangach bu yerga faqat `grantPremium()` chaqiruvi
 * qo'shiladi, qolgan kod o'zgarmaydi.
 *
 * SAQLANISHI. Ikki joyda:
 *   premium_users            -> hamma premium egalarining to'plami
 *   premium:<identity>       -> muddati tugaydigan vaqt (ms) yoki "0"
 *
 * To'plam kerak, chunki yangi yuk kelganda "kim premium" degan
 * savolga bitta so'rov bilan javob berish kerak — har bir odamning
 * yozuvini alohida o'qib chiqish qimmat bo'lardi.
 *
 * MUDDAT dangasa tekshiriladi: o'qilgan paytda tugagan bo'lsa,
 * o'sha zahoti to'plamdan chiqariladi. Shuning uchun muddatni
 * kuzatib turadigan jadval (cron) kerak emas — Vercel Hobby'da u
 * kuniga bir martagina ishlaydi, ya'ni soatlik aniqlik bermasdi.
 */
import { kvGet, kvSet, kvDel, kvSadd, kvSrem, kvSmembers } from './kv.js';

export const PREMIUM_SET = 'premium_users';
export const premiumKey = (identity) => `premium:${identity}`;

/** "0" — muddatsiz. Aks holda millisekundlardagi tugash vaqti. */
const NO_EXPIRY = '0';

/**
 * Shu odam hozir premiummi.
 * Muddati tugagan bo'lsa — to'plamdan chiqaradi va `false` qaytaradi.
 */
export const isPremium = async (identity) => {
  if (!identity) return false;
  const raw = await kvGet(premiumKey(identity));
  if (raw === null || raw === undefined) return false;
  const until = Number(raw);
  if (!until) return true;                 // muddatsiz
  if (Date.now() < until) return true;
  await revokePremium(identity);
  return false;
};

/**
 * Hozir premium bo'lgan odamlar.
 *
 * Muddati tugaganlar shu yerda ham tozalanadi: ro'yxat yangi yuk
 * kelganda o'qiladi, ya'ni tozalash uchun eng qulay joy aynan shu.
 */
export const premiumMembers = async () => {
  const all = await kvSmembers(PREMIUM_SET);
  if (!all.length) return [];
  const alive = [];
  for (const identity of all) {
    if (await isPremium(identity)) alive.push(identity);
  }
  return alive;
};

/**
 * Premium beradi.
 * @param {string} identity
 * @param {number} [untilMs] tugash vaqti; berilmasa — muddatsiz
 */
export const grantPremium = async (identity, untilMs) => {
  if (!identity) return false;
  const value = untilMs ? String(Math.round(untilMs)) : NO_EXPIRY;
  /* Avval muddat, keyin to'plam. Teskarisida bo'lsa, oradagi
     bir lahzada odam to'plamda bo'lib, muddati yo'q bo'lardi —
     `isPremium` esa unga `false` deb javob berardi. */
  if (!(await kvSet(premiumKey(identity), value))) return false;
  return kvSadd(PREMIUM_SET, identity);
};

export const revokePremium = async (identity) => {
  if (!identity) return false;
  await kvSrem(PREMIUM_SET, identity).catch(() => {});
  return kvDel(premiumKey(identity));
};

/** Odamning premium holati — profil javobiga qo'shish uchun. */
export const premiumState = async (identity) => {
  const raw = await kvGet(premiumKey(identity));
  if (raw === null || raw === undefined) return { premium: false };
  const until = Number(raw);
  if (until && Date.now() >= until) {
    await revokePremium(identity);
    return { premium: false };
  }
  return until ? { premium: true, premiumUntil: until } : { premium: true };
};
