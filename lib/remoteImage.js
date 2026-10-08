/**
 * Boshqa saytdagi rasmni olib kelish.
 *
 * NEGA SERVERDA. Admin panelda rasmni to'g'ridan Chrome'dan tortib
 * tashlash mumkin. Lekin brauzer sahifadan sudralgan rasmning
 * O'ZINI bermaydi — faqat uning manzilini beradi. Manzilni
 * brauzerning o'zi yuklab olishi ham ishlamaydi: boshqa saytdagi
 * rasm CORS sababli `canvas` ga tushmaydi. Shuning uchun uni
 * server olib keladi.
 *
 * XAVFSIZLIK. Serverga "mana shu manzilga bor" deyish — bu SSRF
 * uchun ochiq eshik: ichki tarmoqdagi manzil berilsa, server
 * tashqaridan ko'rinmaydigan joyga so'rov yuborardi. Bu yerdagi
 * qoidalar shuning uchun:
 *
 *   - faqat `https:`;
 *   - manzil IP ga aylantiriladi va ichki diapazonlar rad etiladi
 *     (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x, ::1, fc00::/7
 *     va boshqalar) — bulutdagi metadata xizmati ham shu yerda
 *     to'xtaydi;
 *   - yo'naltirishlar (redirect) O'CHIRILGAN: aks holda tashqi
 *     manzil ichki manzilga olib borardi va yuqoridagi tekshiruv
 *     bekor bo'lardi;
 *   - javob faqat rasm bo'lishi kerak va hajmi cheklangan.
 *
 * Bularning ustiga endpointning o'zi faqat adminga ochiq.
 */
import { lookup } from 'dns/promises';
import { isIP } from 'net';

/* Ruxsat etilgan turlar AYNAN storage.js dagidek. Kengroq
   ro'yxat foyda bermaydi: gif yoki svg olib kelinsa, uni baribir
   `uploadImage` rad etadi — ya'ni so'rov bekorga ketgan bo'lardi,
   xato esa tushunarsiz ("Rasm yuklanmadi") bo'lib qolardi. Svg
   ustiga yana bir sabab bor: uning ichida skript bo'lishi mumkin,
   shuning uchun u hech qachon olib kelinmaydi. */
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Ichki (tashqaridan ko'rinmaydigan) manzilmi. */
export const isPrivateAddress = (ip) => {
  const v = String(ip || '').toLowerCase();
  if (!v) return true;

  if (isIP(v) === 6) {
    if (v === '::' || v === '::1') return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    /* IPv4 ko'rinishidagi IPv6 (::ffff:10.0.0.1) — ichidagi
       to'rtlikni qaytadan tekshiramiz. */
    const tail = v.split(':').pop();
    if (isIP(tail) === 4) return isPrivateAddress(tail);
    return false;
  }

  const p = v.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;            // link-local, bulut metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;  // operator NAT
  if (a >= 224) return true;                           // multicast va zaxira
  return false;
};

/**
 * Manzildagi rasmni `data:` ko'rinishida qaytaradi.
 *
 * Hech qachon xato tashlamaydi — `{ dataUrl }` yoki `{ error }`.
 *
 * @param {string} url
 * @param {number} maxBytes
 */
export const fetchRemoteImage = async (url, maxBytes) => {
  let parsed;
  try {
    parsed = new URL(String(url || '').trim());
  } catch {
    return { error: 'Manzil noto‘g‘ri' };
  }
  if (parsed.protocol !== 'https:') return { error: 'Faqat https manzillar qabul qilinadi' };

  // Manzil qayerga olib borishini OLDINDAN bilamiz.
  let address;
  try {
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    address = isIP(host) ? host : (await lookup(host)).address;
  } catch {
    return { error: 'Manzil topilmadi' };
  }
  if (isPrivateAddress(address)) return { error: 'Bu manzilga ruxsat yo‘q' };

  let res;
  try {
    res = await fetch(parsed.href, {
      // Yo'naltirish ichki manzilga olib borishi mumkin.
      redirect: 'error',
      headers: { accept: 'image/*' },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { error: 'Rasmni olib bo‘lmadi' };
  }
  if (!res.ok) return { error: `Rasm olinmadi (${res.status})` };

  const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED.has(type)) return { error: 'Bu havolada rasm yo‘q' };

  /* Sarlavhadagi hajmga ishonilmaydi — u yolg'on bo'lishi mumkin,
     shuning uchun o'qilgandan keyin ham tekshiriladi. */
  const declared = Number(res.headers.get('content-length') || 0);
  if (maxBytes && declared && declared > maxBytes) {
    return { error: 'Rasm hajmi katta, boshqasini tanlang' };
  }

  let bytes;
  try {
    bytes = Buffer.from(await res.arrayBuffer());
  } catch {
    return { error: 'Rasm o‘qilmadi' };
  }
  if (!bytes.length) return { error: 'Rasm bo‘sh' };
  if (maxBytes && bytes.length > maxBytes) {
    return { error: 'Rasm hajmi katta, boshqasini tanlang' };
  }

  return { dataUrl: `data:${type};base64,${bytes.toString('base64')}`, type, bytes: bytes.length };
};
