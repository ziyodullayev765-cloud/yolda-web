/**
 * Telegram orqali shaxsiy bildirishnoma yuborish.
 *
 * Bot allaqachon bor va har bir Telegram foydalanuvchisining raqamli
 * ID'si saqlanadi (lib/identity.js), shuning uchun bu yerda yangi
 * infratuzilma yo'q — mavjud botdan foydalanamiz. Serverless funksiya
 * ham qo'shilmaydi: bu oddiy kutubxona, uni chaqirgan endpoint ichida
 * ishlaydi (Vercel Hobby'da 12 ta funksiya cheklovi bor).
 *
 * Ikkita qat'iy qoida:
 *
 *   1. Bildirishnoma hech qachon asosiy amalni buzmasin. Buyurtma
 *      saqlandi-yu, Telegram javob bermadi — bu foydalanuvchi uchun xato
 *      emas. Shuning uchun bu yerdagi hech bir funksiya `throw` qilmaydi.
 *
 *   2. Kimga yuborishni bilmasak — hech narsa qilmaymiz. Bot faqat
 *      o'zi bilan suhbat boshlagan odamga yoza oladi; buni aylanib
 *      o'tishning iloji yo'q va urinib ko'rishning ham ma'nosi yo'q.
 *
 * Kimga yetadi:
 *   - Telegram orqali kirganlar ("tg:<id>") — to'g'ridan-to'g'ri;
 *   - Google akkauntini Telegram bilan bog'laganlar — `tgChat:<identity>`
 *     teskari indeksi orqali (lib/identity.js uni har safar Telegram'ga
 *     kirganda yangilab turadi).
 * Telegram'i yo'q foydalanuvchi hech narsa olmaydi va bu normal holat.
 */
import { kvGet, kvSet, kvDel, kvPush } from './kv.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/** Foydalanuvchi o'chirib qo'ya oladigan turkumlar. Standart holat — yoqilgan. */
export const NOTIFY_CATEGORIES = ['orders', 'listings', 'chat', 'matches', 'offers'];

/** Telegram HTML rejimi uchun — faqat shu uchta belgi xavfli. */
export const esc = (v) =>
  String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** identity -> Telegram chat id, yoki null. */
const chatIdFor = async (identity) => {
  if (!identity) return null;
  if (String(identity).startsWith('tg:')) return String(identity).slice(3);
  return await kvGet(`tgChat:${identity}`);
};

/** Foydalanuvchi shu turkumni o'chirib qo'yganmi? */
const wantsCategory = async (identity, category) => {
  if (!category) return true;
  const raw = await kvGet(`profile:${identity}`);
  if (!raw) return true;
  try {
    const profile = JSON.parse(raw);
    // Faqat aniq `false` o'chiradi — maydon umuman yo'q bo'lsa, yoqilgan.
    if (profile && profile.notify && profile.notify[category] === false) return false;
  } catch {
    // Buzilgan yozuv sababli bildirishnomani yo'qotmaymiz.
  }
  return true;
};

/* ---------- Ilova ichidagi bildirishnomalar ----------
   Telegram yagona kanal bo'lolmaydi: foydalanuvchida Telegram
   bo'lmasligi, botni bloklagan bo'lishi yoki turkumni o'chirib
   qo'ygan bo'lishi mumkin. Shuning uchun har bir bildirishnoma
   avval ilova ichiga yoziladi, keyin Telegram'ga urinib ko'riladi.
   Turkum kaliti faqat Telegram'ni o'chiradi — sozlamalarda ham
   shunday yozilgan ("Telegram bildirishnomalari"). */
export const NOTIF_LIMIT = 50;
const notifKey = (identity) => `notifs:${identity}`;
export const notifSeenKey = (identity) => `notifs_seen:${identity}`;

/** Telegram HTML'ini ilova ichida ko'rsatish uchun oddiy matnga aylantiradi. */
const toPlain = (html) =>
  String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const recordNotification = async (identity, { title, text, category, link }) => {
  if (!identity) return false;
  try {
    // Xabarlarning hammasi "<b>Sarlavha</b>\n\n..." shaklida yoziladi,
    // shuning uchun sarlavhani matnning o'zidan olamiz — har bir
    // chaqiruv joyiga alohida `title` qo'shib chiqishning hojati yo'q.
    const bold = /<b>(.*?)<\/b>/.exec(String(text || ''));
    const derivedTitle = title || (bold ? bold[1] : '');
    const body = toPlain(String(text || '').replace(/<b>.*?<\/b>/, ''));

    const entry = {
      id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: derivedTitle,
      body,
      category: category || '',
      link: link || '',
      at: Date.now(),
    };
    await kvPush(notifKey(identity), JSON.stringify(entry));
    return true;
  } catch (err) {
    console.error('recordNotification failed:', err.message);
    return false;
  }
};

/**
 * Bitta foydalanuvchiga xabar yuboradi. Hech qachon xato tashlamaydi —
 * yuborilgan-yuborilmagani `true`/`false` bilan qaytadi, chaqirgan tomon
 * xohlasa e'tiborsiz qoldirsa ham bo'ladi.
 *
 * @param {string} identity  "tg:<id>" yoki email
 * @param {{text: string, category?: string, buttonText?: string, buttonUrl?: string}} opts
 */
export const notifyUser = async (identity, opts = {}) => {
  const { text, category, buttonText, buttonUrl, title } = opts;
  if (!identity || !text) return false;

  // Ilova ichidagi yozuv har doim qoladi — Telegram yetib bormasa ham
  // foydalanuvchi saytga kirganda nima bo'lganini ko'radi.
  await recordNotification(identity, { title, text, category });

  if (!BOT_TOKEN) return false;
  try {
    const chatId = await chatIdFor(identity);
    if (!chatId) return false;
    if (!(await wantsCategory(identity, category))) return false;

    const payload = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (buttonText && buttonUrl) {
      payload.reply_markup = { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] };
    }

    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.ok) return true;

    // Bot bloklangan yoki suhbat boshlanmagan — bu manzil endi ishlamaydi.
    // Indeksni o'chiramiz, aks holda har safar behuda so'rov ketaveradi.
    // Foydalanuvchi ilovani qayta ochsa, indeks o'z-o'zidan tiklanadi.
    if (res.status === 403) await kvDel(`tgChat:${identity}`).catch(() => {});
    else console.error('notifyUser failed:', json.description || res.status);
    return false;
  } catch (err) {
    console.error('notifyUser error:', err.message);
    return false;
  }
};

/**
 * Foydalanuvchining bildirishnomalari, eng yangisi birinchi, va
 * o'qilmaganlar soni.
 */
export const readNotifications = async (identity, kvRange) => {
  const raw = await kvRange(notifKey(identity), 0, NOTIF_LIMIT - 1);
  const items = raw.map((s) => {
    try { return JSON.parse(s); } catch { return null; }
  }).filter(Boolean);
  const seenAt = Number(await kvGet(notifSeenKey(identity))) || 0;
  return {
    items: items.map((i) => ({ ...i, unread: i.at > seenAt })),
    unread: items.filter((i) => i.at > seenAt).length,
  };
};

/** "Hammasini o'qidim" — vaqt belgisi, har bir yozuvni yangilamaymiz. */
export const markNotificationsSeen = async (identity) =>
  kvSet(notifSeenKey(identity), String(Date.now()));

/**
 * Bir nechta odamga yuborish. Ketma-ket emas, birga — biri ishlamasa
 * qolganlari baribir yetib boradi.
 */
export const notifyMany = async (identities, opts) => {
  const unique = [...new Set((identities || []).filter(Boolean))];
  const results = await Promise.all(unique.map((id) => notifyUser(id, opts)));
  return results.filter(Boolean).length;
};
