/**
 * Ochiq yuklar ro'yxatining keshi.
 *
 * "Yuklar" eng ko'p ochiladigan bo'lim, lekin har ochilishda 300 ta
 * buyurtma bittalab o'qilardi. Kesh shuni bitta o'qishga tushiradi.
 *
 * Ataylab DENORMALIZATSIYA emas: buyurtma o'nlab joyda yoziladi
 * (api/order.js, api/telegram.js, lib/deleteAccount.js) va indeksni
 * hammasida qo'lda yangilash — bittasini unutib qo'yish, ya'ni
 * ro'yxatda allaqachon olingan yuk ko'rinib turishi degani.
 *
 * Kesh esa haqiqat manbaidan o'zi qayta quriladi: eng yomoni
 * eskiradi, hech qachon chalg'imaydi. Muddati tugagach o'zi
 * yangilanadi, yozish yo'llari esa uni darhol tashlab yuboradi —
 * shuning uchun amalda kechikish sezilmaydi.
 */
import { kvDel } from './kv.js';

export const LOADS_CACHE_KEY = 'loads_cache';

/** Kesh shu muddatdan keyin eskirgan hisoblanadi. */
export const LOADS_CACHE_MS = 30_000;

/**
 * Buyurtma o'zgardi — ro'yxat endi to'g'ri emas.
 * Xatosi jim o'tadi: kesh tashlanmasa ham javob noto'g'ri bo'lmaydi,
 * faqat 30 soniyagacha eski ro'yxat ko'rinishi mumkin.
 */
export const invalidateLoadsCache = async () => {
  await kvDel(LOADS_CACHE_KEY).catch(() => {});
};
