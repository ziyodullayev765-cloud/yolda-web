/**
 * Ilovaning ochiq manzili.
 *
 * Bildirishnomalardagi "Ilovada ochish" tugmasi shu yerga olib boradi.
 * Manzil kodda yozilmaydi: domen o'zgarganda (masalan yolda.uz olinganda)
 * faqat sozlamani almashtirish kifoya, kodga tegilmaydi.
 *
 * Zaxira sifatida Vercel o'zi beradigan manzil ishlatiladi — ya'ni
 * hech narsa sozlanmagan bo'lsa ham tugma ishlaydi. Ikkalasi ham
 * bo'lmasa `appUrl()` bo'sh qaytaradi va chaqirgan tomon tugmani
 * umuman qo'ymaydi: ishlamaydigan tugmadan ko'ra tugmasiz xabar
 * yaxshi.
 */
const base = String(
  process.env.APP_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : '')
).trim().replace(/\/+$/, '');

/** @param {string} path "/?load=YL123" ko'rinishida. */
export const appUrl = (path = '') => (base ? `${base}${path}` : '');

/** Yukning ilovadagi sahifasi. */
export const loadUrl = (code) => appUrl(`/?load=${encodeURIComponent(code)}`);
