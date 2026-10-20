/**
 * Ikonka havolasi: ombor manzilidan saytning o'z manziliga.
 *
 * NEGA. Egasi qo'ygan ikonkalar fayl omborida (R2) turadi. Agar
 * brauzer ularni to'g'ridan o'sha yerdan olsa, ilova ochilganda
 * ellikka yaqin BOSHQA DOMENGA so'rov ketadi: yangi ulanish,
 * yangi TLS, omborning o'z cheklovlari. Biri kelmasa — o'sha
 * ikonka umuman ko'rinmaydi, chunki rasm niqob ichida turadi va
 * bo'sh niqob ustidagi shaklni qirqib tashlaydi.
 *
 * Shuning uchun havola `/icon/...` ga aylantiriladi: so'rov
 * saytning o'ziga boradi, u yerdan esa Vercel chekkasidagi
 * nusxa qaytadi. Fayl o'sha omborda qoladi — faqat yo'li
 * o'zgaradi.
 *
 * Bu yerda ikki narsa bor: yo'lning SHAKLI (uni server qat'iy
 * tekshiradi — "manzilni ayt, olib kelaman" degan endpoint SSRF
 * uchun ochiq eshik) va almashtirishning o'zi.
 */

/** `2026-10/<32 belgi>.png` — `uploadImage` yasaydigan shakl. */
export const R2_ICON_RE = /^\d{4}-\d{2}\/[0-9a-f]{32}\.(png|jpg|jpeg|webp)$/;

/**
 * Ombordagi ikonka havolasini saytning o'z manziliga aylantiradi.
 *
 * Boshqa ko'rinishdagi havola O'ZGARISHSIZ qaytadi: bu funksiya
 * faqat ikonkalar uchun va faqat tanigan shaklini almashtiradi.
 * Shunda eski yozuvlar ham, boshqa joydagi rasm ham buzilmaydi.
 */
export const sameOriginIcon = (url) => {
  const raw = String(url || '');
  const at = raw.indexOf('/icon/');
  if (at === -1 || !/^https:\/\//.test(raw)) return raw;
  const path = raw.slice(at + '/icon/'.length);
  return R2_ICON_RE.test(path) ? `/icon/${path}` : raw;
};
