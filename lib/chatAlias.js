/**
 * Yozishmada suhbatdoshni ATAYDIGAN belgi.
 *
 * ============================================================
 * MUAMMO
 * ------------------------------------------------------------
 * Yozishmalar ro'yxati va suhbatning o'zi mijozga suhbatdoshning
 * `identity` sini qaytarardi — keyin mijoz uni so'rovda qaytarib
 * yuborardi (`withEmail`). Kalit sifatida bu qulay, lekin
 * Google bilan kirgan odam uchun `identity` — uning HAQIQIY
 * pochta manzili.
 *
 * Ya'ni: istalgan `@username` ni qidirib topish → unga bitta
 * xabar yozish → `?action=inbox` dan uning Gmail manzilini
 * o'qib olish. Hech qanday ruxsat talab qilinmaydi.
 *
 * ============================================================
 * YECHIM
 * ------------------------------------------------------------
 * Mijozga endi identity emas, qaytarib ochib bo'lmaydigan belgi
 * beriladi: `u_<22 belgi>`. U identity dan HMAC bilan hosil
 * qilinadi, ya'ni:
 *
 *   - bitta odam uchun DOIM bir xil (eski havolalar, qadalgan
 *     suhbatlar, localStorage dagi "oxirgi suhbat" ishlayveradi);
 *   - belgidan identity ni hisoblab bo'lmaydi (kalit serverda);
 *   - boshqa odamning belgisini taxmin qilib bo'lmaydi.
 *
 * Teskari yo'l uchun bazada bitta kalit turadi
 * (`chatAlias:<belgi>` → identity). U belgi birinchi marta
 * berilganda yoziladi.
 *
 * ESKI MIJOZLAR. Keshdan ochilgan sahifa hali identity yuborishi
 * mumkin, shuning uchun `resolveChatTarget` ikkalasini ham
 * qabul qiladi. Bu teshikni ochiq qoldirmaydi: teshik javobda
 * identity BERILISHI edi, uni qabul qilish emas. Yangi javoblarda
 * identity yo'q, ya'ni eski sahifa yopilishi bilan o'z-o'zidan
 * tugaydi.
 *
 * KALIT. Yangi sir qo'shilmaydi: `AUTH_SECRET`, bo'lmasa bot
 * tokeni — lib/phoneAuth.js dagi bilan bir xil yondashuv. Kalit
 * umuman bo'lmasa (mahalliy ishga tushirish), belgi berilmaydi
 * va eski yo'l ishlaydi — shunda yozishma buzilmaydi.
 * ============================================================
 */
import crypto from 'node:crypto';
import { kvGet, kvSet } from './kv.js';

const ALIAS_PREFIX = 'u_';
const ALIAS_LEN = 22;

const aliasKey = (alias) => `chatAlias:${alias}`;

let cachedKey;
const signingKey = () => {
  if (cachedKey !== undefined) return cachedKey;
  const base = process.env.AUTH_SECRET || process.env.TELEGRAM_BOT_TOKEN || '';
  cachedKey = base
    ? crypto.createHash('sha256').update(`yolda-chat-alias-v1:${base}`).digest()
    : null;
  return cachedKey;
};

export const aliasConfigured = () => Boolean(signingKey());

/** Belgining shakli to'g'rimi — bazaga bormasdan. */
export const isAlias = (value) =>
  typeof value === 'string'
  && value.startsWith(ALIAS_PREFIX)
  && new RegExp(`^${ALIAS_PREFIX}[A-Za-z0-9_-]{${ALIAS_LEN}}$`).test(value);

/** identity → belgi. Kalit yo'q bo'lsa null. */
export const aliasOf = (identity) => {
  const key = signingKey();
  if (!key || !identity) return null;
  const mac = crypto.createHmac('sha256', key).update(String(identity)).digest('base64url');
  return ALIAS_PREFIX + mac.slice(0, ALIAS_LEN);
};

/**
 * Belgi yasaydi VA teskari yozuvni ta'minlaydi.
 *
 * Yozuv faqat yo'q bo'lsa qo'yiladi: yozishmalar ro'yxati har
 * ochilganda qayta yozilsa, bu bejiz sarf bo'lardi (ro'yxatda
 * o'nlab suhbat bo'lishi mumkin).
 */
export const ensureAlias = async (identity) => {
  const alias = aliasOf(identity);
  if (!alias) return null;
  const have = await kvGet(aliasKey(alias)).catch(() => null);
  if (have !== identity) await kvSet(aliasKey(alias), String(identity)).catch(() => {});
  return alias;
};

/** Belgi → identity, yoki null. */
export const identityOfAlias = async (alias) => {
  if (!isAlias(alias)) return null;
  const got = await kvGet(aliasKey(alias)).catch(() => null);
  return got || null;
};

/**
 * Mijoz yuborgan qiymatdan identity.
 *
 * Belgi bo'lsa — bazadan ochiladi. Bo'lmasa, eski mijozning
 * identity si deb qabul qilinadi (yuqoridagi izohga qarang).
 * Hech qaysi bo'lmasa — null, chaqiruvchi 404 qaytaradi.
 */
export const resolveChatTarget = async (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (isAlias(raw)) return identityOfAlias(raw);
  return raw;
};
