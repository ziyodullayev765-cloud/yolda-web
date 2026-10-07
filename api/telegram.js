/**
 * POST /api/telegram — Telegram webhook.
 *
 * Botning yagona vazifasi: odamning telefon raqamini tasdiqlash va
 * tasdiqlash kodini yetkazish.
 *
 * Ilgari bu fayl buyurtmani boshidan oxirigacha Telegram ichida
 * yuritardi: haydovchi guruhdagi tugmani bosib yukni olar, keyingi
 * tugmalar bilan bosqichlarni surar, yuk egasi esa taklifni shaxsiy
 * xabardagi tugma bilan qabul qilardi. Ya'ni platformaning asosiy ishi
 * boshqa ilova ichida bo'lardi.
 *
 * Endi hammasi YO'LDA ichida. Bot esa shunchaki kod yetkazib beradigan
 * kanal — SMS o'rnida. Raqam botga ulangani uchun (`phoneChat:<raqam>`)
 * kod to'g'ridan-to'g'ri egasiga boradi va u raqam haqiqatan ham shu
 * odamniki ekanini isbotlaydi: Telegram «Raqamni ulashish» tugmasida
 * raqamni o'zi yuboradi, qo'lda yozilmaydi.
 */
import { kvGet, kvSet } from '../lib/kv.js';
import { setVerification } from '../lib/verification.js';
import {
  normalisePhone, peekUndeliveredCode, markOtpDelivered, claimPhoneForTelegram,
} from '../lib/phoneAuth.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// Optional but recommended: set it in Vercel and pass the same value to setWebhook.
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

const telegram = async (method, payload) => {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || 'Telegram API error');
  return json.result;
};

const CONTACT_KEYBOARD = {
  keyboard: [[{ text: '📱 Raqamni ulashish', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

/** Telegram foydalanuvchisining sayt tomonidagi identity'si. */
const identityForTelegram = async (tgId) =>
  (await kvGet(`tgIdToEmail:${tgId}`)) || `tg:${tgId}`;

const askForPhone = (chatId) =>
  telegram('sendMessage', {
    chat_id: chatId,
    text: 'Raqamingizni tasdiqlash uchun pastdagi tugmani bosing. '
      + 'Raqamni Telegramning o‘zi yuboradi — qo‘lda yozish shart emas.',
    reply_markup: CONTACT_KEYBOARD,
  }).catch(() => {});

const handleContact = async (message) => {
  const contact = message.contact;
  // Boshqa odamning kontakti — bu o'zini tasdiqlash emas.
  if (!contact || contact.user_id !== message.from.id) {
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      text: 'Bu boshqa odamning raqami. O‘z raqamingizni tugma orqali yuboring.',
      reply_markup: CONTACT_KEYBOARD,
    }).catch(() => {});
    return;
  }

  const identity = await identityForTelegram(message.from.id);
  const key = `profile:${identity}`;
  let profile = {};
  try {
    profile = JSON.parse((await kvGet(key)) || '{}');
  } catch {
    profile = {};
  }

  const phone = String(contact.phone_number || '').replace(/[^\d+]/g, '');
  profile.phone = phone.startsWith('+') ? phone : `+${phone}`;
  setVerification(profile, 'PHONE', {
    status: 'VERIFIED', at: Date.now(), reviewedAt: Date.now(), reason: '',
  });
  await kvSet(key, JSON.stringify(profile));

  await telegram('sendMessage', {
    chat_id: message.chat.id,
    text: `✅ Raqam tasdiqlandi: ${profile.phone}\n\nProfilingizda «Telefon tasdiqlangan» belgisi ko‘rinadi.`,
    reply_markup: { remove_keyboard: true },
  }).catch(() => {});

  await linkPhoneToChat(profile.phone, message.chat.id, identity);
};

/* ============================================================
   Saytdagi telefon orqali kirish uchun kod
   ------------------------------------------------------------
   Bot telefon raqamiga yoza olmaydi — faqat `chat_id` ga yoza
   oladi. Shuning uchun raqam ulashilganda `phoneChat:<raqam>`
   indeksi yoziladi; saytdan so'ralgan kod shu indeks orqali yetib
   boradi (api/auth-phone.js). Indeks hali yo'q bo'lsa, kod KV'da
   kutib turadi va aynan shu yerda — odam botga raqamini ulashgan
   zahoti — yuboriladi.
   ============================================================ */
const linkPhoneToChat = async (phone, chatId, identity) => {
  const normalised = normalisePhone(phone);
  if (!normalised) return;
  await kvSet(`phoneChat:${normalised}`, String(chatId));
  // Raqam shu Telegram akkauntiniki ekani Telegramning o'zi
  // tomonidan tasdiqlandi — demak saytga shu raqam bilan kirgan
  // odam ham aynan shu profilga tushadi, ikkinchi akkaunt
  // yaratilmaydi (lib/phoneAuth.js: identityForPhone).
  await claimPhoneForTelegram(normalised, identity);

  const code = await peekUndeliveredCode(normalised);
  if (!code) return;
  const sent = await telegram('sendMessage', {
    chat_id: chatId,
    text: `<b>${code}</b> — YO‘LDA tasdiqlash kodi.\n\nKod 5 daqiqa amal qiladi. Uni hech kimga aytmang.`,
    parse_mode: 'HTML',
  }).catch(() => null);
  if (sent) await markOtpDelivered(normalised);
};

const handleCommand = async (message) => {
  if (message.contact) {
    await handleContact(message);
    return;
  }

  const text = (message.text || '').trim();

  // Saytdagi «Telegramda kodni olish» tugmasi shu havolani ochadi.
  // Raqam ulashilishi bilan kutayotgan kod o'sha yerga yuboriladi.
  if (text.startsWith('/start kod') || text.startsWith('/kod')) {
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      text: 'Tasdiqlash kodini olish uchun raqamingizni ulashing. '
        + 'Kod shu yerga darhol keladi.',
      reply_markup: CONTACT_KEYBOARD,
    }).catch(() => {});
    return;
  }

  if (text.startsWith('/start')) {
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      /* Ilgari bu yerda shunday yozilgandi:
           «Yangi yuklar haydovchilar guruhiga tushadi. Guruhda
            "Men olaman" tugmasini bosing — mijoz raqami sizga
            ko'rinadi.»
         Haydovchilar guruhi olib tashlanganidan keyin bu yolg'on
         bo'lib qoldi — va eng yomon joyda qoldi: botni ochgan
         haydovchi birinchi o'qiydigan gap shu edi. U Telegramda
         guruh izlab, topolmay, "yuk kelmaydi" deb o'ylardi.

         Endi matn bor narsani aytadi: yuklar ilovada, bot esa
         faqat xabar beradi. Oxirgi qator eng muhimi — xabar
         kelishi uchun haydovchi qidiruvini saqlab qo'yishi kerak,
         aks holda bot jim turadi. */
      text: [
        "Salom\\! Bu — *YO'LDA* yuk bozori boti\\.",
        '',
        'Yangi yuklar *ilovada* chiqadi — «Yuklar» bo‘limida\\. Mos yukni ochib, taklifingizni yuborasiz; yuk egasi takliflardan o‘zi tanlaydi\\.',
        '',
        'Bot sizga xabar beradi: sizga mos yuk chiqqanda, taklifingizga javob kelganda va yozishmalarda\\.',
        '',
        '*Muhim:* mos yuk haqida xabar olish uchun ilovada qidiruvingizni saqlab qo‘ying \\(«Yuklar» → qidiruvni saqlash\\)\\. Saqlanmasa, bot yangi yuklar haqida xabar bermaydi\\.',
        '',
        'Raqamingizni tasdiqlash uchun: /tasdiq',
      ].join('\n'),
      parse_mode: 'MarkdownV2',
    }).catch(() => {});
    return;
  }

  if (text.startsWith('/tasdiq')) {
    await askForPhone(message.chat.id);
    return;
  }

  // Useful once, during setup: tells you the numeric id of the group.
  if (text.startsWith('/id')) {
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      text: `chat_id: \`${message.chat.id}\``,
      parse_mode: 'MarkdownV2',
    }).catch(() => {});
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Telegram echoes the secret configured at setWebhook time. Anything else is
  // not Telegram and gets dropped.
  if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const update = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});

  try {
    /* Bot endi faqat bitta ish qiladi: raqamni tasdiqlab, tasdiqlash
       kodini yetkazadi. Buyurtma bilan bog'liq hamma ish — yukni olish,
       bosqichlarni surish, taklifni qabul qilish — ilovaning o'zida.
       Shuning uchun bu yerda callback tugmalari umuman kutilmaydi. */
    if (update.message) {
      await handleCommand(update.message);
    }
  } catch (err) {
    // Always 200 back to Telegram: a non-2xx makes it retry the same update
    // forever, which would spam the group.
    console.error('Webhook error:', err.message);
  }

  return res.status(200).json({ ok: true });
}
