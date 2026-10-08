/**
 * Almashtirilgan ikonkalar jadvali.
 *
 * NEGA BU FAYL BOR. Ilovaning o'z ikonkalari — chizilgan SVG, ya'ni
 * ularning rangi yo'q: `currentColor` orqali atrofidagi matn rangini
 * oladi. Shuning uchun ular qorong'u rejimda oqarib, yorug'ida
 * qorayib, tanlangan bo'lim ustida esa yashil bo'lib turadi.
 *
 * Admin qo'ygan rasm esa PNG — uning rangi ichida qotib qolgan.
 * Yorug' rejim uchun qilingan qora chiziqli rasm qorong'u rejimda
 * deyarli ko'rinmay qoladi, tanlangan bo'lim esa yashil bo'lmaydi:
 * pastki paneldagi yozuv yashil, belgisi esa qora bo'lib turadi.
 *
 * Yechim: rasm odatda ILOVA RANGIDA chiziladi — rasmning o'zidan
 * faqat SHAKLI olinadi (shaffof bo'lmagan joylari), rangini esa
 * ilova beradi. Shunda u o'z chizilgan ikonkalari bilan bir xil
 * tutadi.
 *
 * Lekin har bir rasm ham bunday emas: Telegram belgisi ko'k,
 * tasdiq nishoni yashil — ularni bitta rangga bo'yash noto'g'ri
 * bo'lardi. Shuning uchun har bir ikonka uchun tanlov bor va u shu
 * yerda saqlanadi: `plain: true` — rasm o'z rangida chizilsin.
 *
 * SAQLASH SHAKLI. Eski yozuvlar oddiy satr edi (`{iconHome: "..."}`)
 * va ular shundayligicha ishlayveradi. Tanlov qo'shilgan ikonka
 * obyekt bo'lib saqlanadi: `{iconHome: {url: "...", plain: true}}`.
 * Shu sababli ikkala shakl ham o'qiladi va hech qanday ko'chirish
 * (migration) kerak emas.
 */

/** Bitta yozuvdan havolani ajratadi (eski va yangi shakl uchun). */
export const iconUrl = (entry) => {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && typeof entry.url === 'string') return entry.url;
  return '';
};

/** Shu ikonka o'z rangida chizilsinmi. */
export const iconIsPlain = (entry) =>
  Boolean(entry && typeof entry === 'object' && entry.plain);

/** Saqlash uchun yozuv yasaydi — kerak bo'lmasa oddiy satr qoladi. */
export const iconEntry = (url, plain) => (plain ? { url: String(url), plain: true } : String(url));

/**
 * Saqlangan jadvalni ilova kutadigan ikki bo'lakka ajratadi.
 *
 * `urls` — eski shakl: `{id: havola}`. Eski, keshdan ochilgan
 * sahifa ham shuni kutadi, shuning uchun shakli o'zgarmaydi.
 * `plain` — o'z rangida chiziladigan ikonkalar ro'yxati.
 *
 * @param {unknown} raw
 * @returns {{ urls: Record<string,string>, plain: string[] }}
 */
export const normalizeIcons = (raw) => {
  const urls = {};
  const plain = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { urls, plain };
  Object.keys(raw).forEach((id) => {
    const url = iconUrl(raw[id]);
    if (!url) return;
    urls[id] = url;
    if (iconIsPlain(raw[id])) plain.push(id);
  });
  return { urls, plain };
};
