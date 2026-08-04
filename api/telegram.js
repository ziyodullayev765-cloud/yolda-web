/**
 * POST /api/telegram
 *
 * Telegram webhook. Handles the "Men olaman" button: the first driver to tap
 * claims the order, the message is rewritten to show who took it, and the
 * customer's phone number is revealed.
 *
 * State lives in the Telegram message itself — the edited text is the record
 * of who claimed what. No database is involved, which is exactly why this
 * stays cheap to run.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// Optional but recommended: set it in Vercel and pass the same value to setWebhook.
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

const escapeMd = (s) => String(s).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (m) => `\\${m}`);

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

const displayName = (user) =>
  [user.first_name, user.last_name].filter(Boolean).join(' ')
  || (user.username ? `@${user.username}` : `id${user.id}`);

/** Marker written into the claimed message; also used to detect a double tap. */
const CLAIMED_MARK = '✅ *OLINDI*';

const handleTake = async (query, code, phone) => {
  const message = query.message;
  const currentText = message?.text ?? '';

  // Someone already claimed it — Telegram delivered a stale button press.
  if (currentText.includes('OLINDI')) {
    await telegram('answerCallbackQuery', {
      callback_query_id: query.id,
      text: 'Bu yukni boshqa haydovchi allaqachon oldi.',
      show_alert: true,
    });
    return;
  }

  const driver = displayName(query.from);
  const driverLink = query.from.username
    ? `@${escapeMd(query.from.username)}`
    : `[${escapeMd(driver)}](tg://user?id=${query.from.id})`;

  // Rebuild the message: keep the cargo details, swap the footer.
  const kept = currentText
    .split('\n')
    .filter((line) => !line.includes('Raqam buyurtmani qabul'))
    .join('\n')
    .trim();

  const updated = [
    escapeMd(kept),
    '',
    '━━━━━━━━━━━━━━',
    CLAIMED_MARK,
    `🚚 Haydovchi: ${driverLink}`,
    `📞 Mijoz: \`${escapeMd(phone)}\``,
  ].join('\n');

  await telegram('editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: updated,
    parse_mode: 'MarkdownV2',
    // Removing the keyboard prevents a second claim outright.
    reply_markup: { inline_keyboard: [] },
  });

  await telegram('answerCallbackQuery', {
    callback_query_id: query.id,
    text: `Yuk sizniki! Mijoz raqami: ${phone}`,
    show_alert: true,
  });

  // Try to DM the driver the contact details; harmless if they never started
  // a chat with the bot.
  await telegram('sendMessage', {
    chat_id: query.from.id,
    text: `Siz *${escapeMd(code)}* yukini oldingiz\\.\n📞 Mijoz: \`${escapeMd(phone)}\``,
    parse_mode: 'MarkdownV2',
  }).catch(() => {});
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
