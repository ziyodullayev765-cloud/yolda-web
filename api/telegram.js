/**
 * POST /api/telegram
 *
 * Telegram webhook. Drives the order through its lifecycle from the
 * driver's side, one button tap at a time. The button always names the
 * next stage, so the driver never has to choose between four of them:
 *
 *   ✅ Men olaman → 🚚 Yuklashga ketdim → 📦 Yukladim → 🛣️ Yo'lga chiqdim → ✅ Yetkazdim
 *   (NEW)          (DRIVER_FOUND)        (PICKING_UP)   (LOADED)            (ON_THE_WAY → DELIVERED)
 *
 * The persisted `order:<code>` record (written by /api/order) is the source
 * of truth for status and who's driving it. If that record is missing —
 * KV was down when the order was posted — claiming still works by editing
 * the message text directly, same as before this pipeline existed; it just
 * can't offer the follow-up "yo'lda" / "yetkazdim" buttons, since those
 * need to know which driver owns the order.
 */
import { kvGet, kvSet } from '../lib/kv.js';
import {
  buildOrderMessage, escapeMd, STATUS_LABELS, nextStatus, NEXT_STATUS_BUTTON,
} from '../lib/orderMessage.js';
import { notifyUser, esc } from '../lib/notify.js';

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

const answer = (query, text, showAlert) =>
  telegram('answerCallbackQuery', { callback_query_id: query.id, text, show_alert: Boolean(showAlert) });

const displayName = (user) =>
  [user.first_name, user.last_name].filter(Boolean).join(' ')
  || (user.username ? `@${user.username}` : `id${user.id}`);

/**
 * Buyurtma egasiga holat o'zgargani haqida shaxsiy xabar.
 *
 * Ilgari yuk beruvchi hech narsa bilmasdi: yuk guruhga tushardi va u
 * saytga o'zi kirib ko'rmaguncha haydovchi topilgani ham noma'lum edi.
 *
 * ownerIdentity — Google va Telegram egalarini ham qamraydi; undan
 * oldingi buyurtmalarda googleEmail bo'lgan.
 */
const notifyOwner = (order, text) =>
  notifyUser(order.ownerIdentity || order.googleEmail, {
    text,
    category: 'orders',
  });

const routeOf = (order) => `${esc(order.fromCity)} → ${esc(order.toCity)}`;

/**
 * Haydovchining bitta tugmasi butun zanjirni yuritadi.
 *
 * Har bosqich uchun alohida tugma qo'yish haydovchiga to'rt marta
 * bosishni yuklardi; bitta tugma esa keyingi bosqichning nomini o'zi
 * yozib turadi. Yuk beruvchi esa buyurtma qayerda ekanini aniq ko'radi.
 */
const BUTTON_EMOJI = {
  DRIVER_FOUND: '🚚', PICKING_UP: '📦', LOADED: '🛣️', ON_THE_WAY: '✅',
};

/** Yetkazilgunga qadar har qanday bosqichda voz kechish mumkin. */
const GIVEUPABLE = ['DRIVER_FOUND', 'PICKING_UP', 'LOADED', 'ON_THE_WAY'];

/** Haydovchi uchun klaviatura: keyingi bosqich + voz kechish. */
const driverKeyboard = (order) => {
  const label = NEXT_STATUS_BUTTON[order.status];
  const row = [];
  if (label) {
    row.push({
      text: `${BUTTON_EMOJI[order.status] || '➡️'} ${label}`,
      callback_data: `next:${order.code}`,
    });
  }
  if (GIVEUPABLE.includes(order.status)) {
    row.push({ text: '✖️ Voz kechaman', callback_data: `giveup:${order.code}` });
  }
  return row.length ? [row] : [];
};

const getOrder = async (code) => {
  const raw = await kvGet(`order:${code}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

/** Looks up a driver's linked profile (and its verified flag) by their Telegram @username. */
const lookupDriverProfile = async (username) => {
  if (!username) return null;
  try {
    const email = await kvGet(`tgToEmail:${username.toLowerCase()}`);
    if (!email) return null;
    const raw = await kvGet(`profile:${email}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const handleTake = async (query, code, phone) => {
  const message = query.message;
  const currentText = message?.text ?? '';
  const order = await getOrder(code);

  // Double-claim guard: the persisted record is the source of truth when
  // it exists; fall back to scanning the message text when it doesn't.
  const alreadyClaimed = order ? order.status !== 'NEW' : currentText.includes('OLINDI');
  if (alreadyClaimed) {
    await answer(query, 'Bu yukni boshqa haydovchi allaqachon oldi.', true);
    return;
  }

  const driverName = displayName(query.from);

  if (order) {
    const driverProfile = await lookupDriverProfile(query.from.username);
    order.status = 'DRIVER_FOUND';
    order.driver = {
      name: driverName,
      telegramUsername: query.from.username || null,
      telegramId: query.from.id,
      verified: Boolean(driverProfile && driverProfile.verified),
    };
    order.updatedAt = Date.now();
    if (!order.phone) order.phone = phone;
    await kvSet(`order:${code}`, JSON.stringify(order));

    await notifyOwner(order,
      `<b>Haydovchi topildi</b>\n\n`
      + `Buyurtma: <b>${esc(code)}</b>\n`
      + `${routeOf(order)}\n\n`
      + `Haydovchi: <b>${esc(driverName)}</b>`
      + (order.driver.verified ? ' ✓' : '')
      + (query.from.username ? `\n@${esc(query.from.username)}` : '')
      + `\n\nU tez orada siz bilan bog'lanadi.`);

    await telegram('editMessageText', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: buildOrderMessage(order),
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: driverKeyboard(order) },
    });
  } else {
    // No persisted record — edit the message directly, no status buttons.
    const driverLink = query.from.username
      ? `@${escapeMd(query.from.username)}`
      : `[${escapeMd(driverName)}](tg://user?id=${query.from.id})`;
    const kept = currentText
      .split('\n')
      .filter((line) => !line.includes('Raqam buyurtmani qabul'))
      .join('\n')
      .trim();
    const updated = [
      kept, '', '━━━━━━━━━━━━━━', '✅ *OLINDI*',
      `🚚 Haydovchi: ${driverLink}`, `📞 Mijoz: \`${escapeMd(phone)}\``,
    ].join('\n');
    await telegram('editMessageText', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: updated,
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: [] },
    });
  }

  await answer(query, `Yuk sizniki! Mijoz raqami: ${phone}`, true);

  // Try to DM the driver the contact details; harmless if they never started
  // a chat with the bot.
  await telegram('sendMessage', {
    chat_id: query.from.id,
    text: `Siz *${escapeMd(code)}* yukini oldingiz\\.\n📞 Mijoz: \`${escapeMd(phone)}\`\n\nGuruhdagi xabar ostidagi tugma har safar keyingi bosqichni yozib turadi — yuklashga ketganingizda, yuklaganingizda, yo'lga chiqqaningizda va yetkazganingizda bosing\\.`,
    parse_mode: 'MarkdownV2',
  }).catch(() => {});
};

/**
 * Shared guard for the 'depart' and 'deliver' steps: the order must exist,
 * be at the expected stage, and belong to whoever tapped the button.
 */
const requireOwnDriver = async (query, code, expectedStatus) => {
  const order = await getOrder(code);
  if (!order) {
    await answer(query, 'Buyurtma topilmadi.', true);
    return null;
  }
  if (order.status !== expectedStatus) {
    await answer(query, 'Bu amal endi mavjud emas.', true);
    return null;
  }
  if (!order.driver || order.driver.telegramId !== query.from.id) {
    await answer(query, 'Bu buyurtma sizga tegishli emas.', true);
    return null;
  }
  return order;
};

const handleDepart = async (query, code) => {
  const order = await requireOwnDriver(query, code, 'DRIVER_FOUND');
  if (!order) return;

  order.status = 'ON_THE_WAY';
  order.updatedAt = Date.now();
  await kvSet(`order:${code}`, JSON.stringify(order));

  await notifyOwner(order,
    `<b>Haydovchi yo'lga chiqdi</b>\n\n`
    + `Buyurtma: <b>${esc(code)}</b>\n`
    + `${routeOf(order)}\n\n`
    + `Haydovchi: ${esc(order.driver && order.driver.name)}`);

  await telegram('editMessageText', {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text: buildOrderMessage(order),
    parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: driverKeyboard(order) },
  });
  await answer(query, "Holat yangilandi: Yo'lda");
};

const handleDeliver = async (query, code) => {
  const order = await requireOwnDriver(query, code, 'ON_THE_WAY');
  if (!order) return;

  order.status = 'DELIVERED';
  order.deliveredAt = Date.now();
  order.updatedAt = Date.now();
  await kvSet(`order:${code}`, JSON.stringify(order));

  // Haydovchi profilidagi "yetkazilgan yuklar" hisoblagichi. Faqat
  // taklif orqali biriktirilgan haydovchida identity bo'ladi; eski
  // oqimdagi (Telegram username orqali) haydovchilar sanalmaydi.
  if (order.driver && order.driver.identity) {
    try {
      const key = `profile:${order.driver.identity}`;
      const profile = JSON.parse((await kvGet(key)) || '{}');
      profile.deliveredCount = (profile.deliveredCount || 0) + 1;
      await kvSet(key, JSON.stringify(profile));
    } catch (err) {
      // Hisoblagich yetkazishning o'zidan muhim emas.
      console.error('deliveredCount update failed:', err.message);
    }
  }

  await notifyOwner(order,
    `<b>Yuk yetkazildi</b>\n\n`
    + `Buyurtma: <b>${esc(code)}</b>\n`
    + `${routeOf(order)}\n\n`
    + `Haydovchi: ${esc(order.driver && order.driver.name)}\n\n`
    + `Saytdagi «Buyurtmani kuzatish» bo'limida haydovchiga baho qoldirishingiz mumkin.`);

  await telegram('editMessageText', {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text: buildOrderMessage(order),
    parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: [] },
  });
  await answer(query, 'Rahmat! Yetkazildi deb belgilandi.');
};

/**
 * Haydovchi olgan yukidan voz kechadi.
 *
 * Yuk yo'qolmaydi: NEW ga qaytadi va guruhdagi o'sha xabarda yana
 * "Men olaman" tugmasi paydo bo'ladi, ya'ni boshqa haydovchi darrov
 * ola oladi. Yuk beruvchiga xabar boradi — aks holda u haydovchi
 * kutayotganini o'ylab o'tiraverardi.
 */
const handleGiveUp = async (query, code) => {
  const order = await getOrder(code);
  if (!order) {
    await answer(query, 'Buyurtma topilmadi.', true);
    return;
  }
  if (!GIVEUPABLE.includes(order.status)) {
    await answer(query, 'Bu amal endi mavjud emas.', true);
    return;
  }
  if (!order.driver || order.driver.telegramId !== query.from.id) {
    await answer(query, 'Bu buyurtma sizga tegishli emas.', true);
    return;
  }

  const previousDriver = order.driver;
  order.releases = Array.isArray(order.releases) ? order.releases : [];
  order.releases.push({
    at: Date.now(),
    by: 'DRIVER',
    driverName: previousDriver.name,
    driverTelegramId: previousDriver.telegramId,
    reason: null,
  });
  order.status = 'NEW';
  order.driver = null;
  order.updatedAt = Date.now();
  await kvSet(`order:${code}`, JSON.stringify(order));

  await telegram('editMessageText', {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text: buildOrderMessage(order),
    parse_mode: 'MarkdownV2',
    reply_markup: {
      inline_keyboard: [[{ text: '✅ Men olaman', callback_data: `take:${code}:${order.phone}` }]],
    },
  });

  await notifyOwner(order,
    `<b>Haydovchi voz kechdi</b>\n\n`
    + `Buyurtma: <b>${esc(code)}</b>\n`
    + `${routeOf(order)}\n\n`
    + `${esc(previousDriver.name)} yukdan voz kechdi. Yuk yana guruhda — `
    + `boshqa haydovchi olishi mumkin.`);

  await answer(query, 'Yukdan voz kechdingiz. U yana guruhga chiqdi.');
};

/** Buyurtmani zanjir bo'yicha bir bosqich oldinga suradi. */
const handleAdvance = async (query, code) => {
  const order = await getOrder(code);
  if (!order) {
    await answer(query, 'Buyurtma topilmadi.', true);
    return;
  }
  if (!order.driver || order.driver.telegramId !== query.from.id) {
    await answer(query, 'Bu buyurtma sizga tegishli emas.', true);
    return;
  }
  const next = nextStatus(order.status);
  if (!next) {
    await answer(query, 'Bu amal endi mavjud emas.', true);
    return;
  }

  order.status = next;
  order.updatedAt = Date.now();
  if (next === 'DELIVERED') order.deliveredAt = Date.now();
  await kvSet(`order:${code}`, JSON.stringify(order));

  if (next === 'DELIVERED' && order.driver && order.driver.identity) {
    try {
      const key = `profile:${order.driver.identity}`;
      const profile = JSON.parse((await kvGet(key)) || '{}');
      profile.deliveredCount = (profile.deliveredCount || 0) + 1;
      await kvSet(key, JSON.stringify(profile));
    } catch (err) {
      console.error('deliveredCount update failed:', err.message);
    }
  }

  await telegram('editMessageText', {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text: buildOrderMessage(order),
    parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: driverKeyboard(order) },
  });

  await notifyOwner(order,
    `<b>${esc(STATUS_LABELS[next] || next)}</b>\n\n`
    + `Buyurtma: <b>${esc(code)}</b>\n`
    + `${routeOf(order)}\n\n`
    + `Haydovchi: ${esc(order.driver.name)}`
    + (next === 'DELIVERED'
        ? `\n\nSaytdagi «Buyurtmani kuzatish» bo'limida haydovchiga baho qoldirishingiz mumkin.`
        : ''));

  await answer(query, `Holat yangilandi: ${STATUS_LABELS[next] || next}`);
};

const handleCommand = async (message) => {
  const text = (message.text || '').trim();

  if (text.startsWith('/start')) {
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      text: [
        "Salom\\! Bu — *YO'LDA* yuk bozori boti\\.",
        '',
        'Yangi yuklar haydovchilar guruhiga tushadi\\. Guruhda *«Men olaman»* tugmasini bosing — mijoz raqami sizga ko\\‘rinadi\\.',
        '',
        'Yuk yubormoqchimisiz? Saytga o\\‘ting va formani to\\‘ldiring\\.',
      ].join('\n'),
      parse_mode: 'MarkdownV2',
    }).catch(() => {});
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
    if (update.callback_query) {
      const data = update.callback_query.data || '';
      const [action, code, phone] = data.split(':');
      if (action === 'take' && code && phone) {
        await handleTake(update.callback_query, code, phone);
      } else if (action === 'depart' && code) {
        await handleDepart(update.callback_query, code);
      } else if (action === 'deliver' && code) {
        await handleDeliver(update.callback_query, code);
      } else if (action === 'giveup' && code) {
        await handleGiveUp(update.callback_query, code);
      } else if (action === 'next' && code) {
        await handleAdvance(update.callback_query, code);
      }
    } else if (update.message) {
      await handleCommand(update.message);
    }
  } catch (err) {
    // Always 200 back to Telegram: a non-2xx makes it retry the same update
    // forever, which would spam the group.
    console.error('Webhook error:', err.message);
  }

  return res.status(200).json({ ok: true });
}
