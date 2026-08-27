/**
 * /api/chat — search users by username, message them, and edit/delete/react
 * to individual messages.
 *
 * One function (not several) to stay well under Vercel Hobby's 12-function
 * cap — see api/admin-data.js for the same reasoning. Dispatch is by
 * `?action=`:
 *
 *   GET  /api/chat?action=search&q=<text>&googleIdToken=...|&telegramInitData=...
 *   GET  /api/chat?action=inbox&googleIdToken=...|&telegramInitData=...
 *   GET  /api/chat?action=thread&googleIdToken=...|&telegramInitData=...&withEmail=...   (or &withUsername=...)
 *   POST /api/chat?action=send    { googleIdToken|telegramInitData, toUsername, text }
 *   POST /api/chat?action=edit    { googleIdToken|telegramInitData, id, text }
 *   POST /api/chat?action=delete  { googleIdToken|telegramInitData, id }
 *   POST /api/chat?action=react   { googleIdToken|telegramInitData, id, emoji }
 *
 * Each message is its own key (`msg:<id>`), not just an entry appended to a
 * list — that's what makes editing/deleting/reacting to one specific
 * message possible later without having to rewrite the whole conversation.
 * `convo:<pairKey>` is only the ordering: a list of message ids, keyed by
 * the two participants' identities sorted alphabetically so both sides
 * read/write the same key. An identity is either a real email (Google) or
 * "tg:<id>" (Telegram-only) — see lib/identity.js.
 *
 * The credential rides in the query string for GETs, the same tradeoff
 * /api/order already makes for phone numbers — acceptable at this app's
 * scale, and verified server-side on every call regardless.
 */
import { kvGet, kvSet, kvPush, kvRange, kvSadd, kvSmembers, kvKeys, kvSismember } from '../lib/kv.js';
import { resolveEmail } from '../lib/identity.js';

const MAX_TEXT = 1000;
const MAX_SEARCH_RESULTS = 20;
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const pairKey = (a, b) => `convo:${[a, b].sort().join('|')}`;
const generateId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** profile:<email> used to just be the plain username string — read old and new shapes. */
const parseProfile = (raw) => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // fall through
  }
  return { username: raw };
};

const parseMessage = (raw) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

/** Crude in-memory throttle against message spam. */
const recent = new Map();
const isThrottled = (key) => {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > 3_000) recent.delete(k);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
};

const searchUsers = async (req, res) => {
  const email = await resolveEmail({ googleIdToken: req.query.googleIdToken, telegramInitData: req.query.telegramInitData });
  if (!email) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.status(200).json({ users: [] });

  const keys = await kvKeys('username:*');
  const matches = keys
    .map((k) => k.slice('username:'.length))
    .filter((u) => u.includes(q) && u !== '')
    .slice(0, MAX_SEARCH_RESULTS);

  const users = (
    await Promise.all(
      matches.map(async (uname) => {
        const ownerEmail = await kvGet(`username:${uname}`);
        if (!ownerEmail || ownerEmail === email) return null;
        const profile = parseProfile(await kvGet(`profile:${ownerEmail}`));
        return { username: profile.username || uname, role: profile.role || null, city: profile.city || null };
      }),
    )
  ).filter(Boolean);

  return res.status(200).json({ users });
};

const getInbox = async (req, res) => {
  const myEmail = await resolveEmail({ googleIdToken: req.query.googleIdToken, telegramInitData: req.query.telegramInitData });
  if (!myEmail) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const others = await kvSmembers(`inbox:${myEmail}`);
  const conversations = (
    await Promise.all(
      others.map(async (otherEmail) => {
        const profile = parseProfile(await kvGet(`profile:${otherEmail}`));
        const lastIds = await kvRange(pairKey(myEmail, otherEmail), 0, 0);
        const lastMsg = lastIds[0] ? parseMessage(await kvGet(`msg:${lastIds[0]}`)) : null;
        return {
          email: otherEmail,
          username: profile.username || otherEmail,
          lastText: lastMsg ? (lastMsg.deleted ? 'Xabar o‘chirildi' : lastMsg.text) : '',
          lastAt: lastMsg ? lastMsg.at : 0,
          lastFromMe: lastMsg ? lastMsg.from === myEmail : false,
        };
      }),
    )
  ).sort((a, b) => b.lastAt - a.lastAt);

  return res.status(200).json({ conversations });
};

const getThread = async (req, res) => {
  const myEmail = await resolveEmail({ googleIdToken: req.query.googleIdToken, telegramInitData: req.query.telegramInitData });
  if (!myEmail) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  let withEmail = String(req.query.withEmail || '').trim();
  const withUsername = String(req.query.withUsername || '').trim().toLowerCase();
  if (!withEmail && withUsername) {
    withEmail = (await kvGet(`username:${withUsername}`)) || '';
  }
  if (!withEmail) return res.status(400).json({ error: 'Bunday foydalanuvchi topilmadi' });

  const ids = await kvRange(pairKey(myEmail, withEmail), 0, 99);
  const raw = (await Promise.all(ids.map((id) => kvGet(`msg:${id}`)))).map(parseMessage).filter(Boolean);

  const messages = raw
    .reverse() // ids stored newest-first (LPUSH); a chat reads oldest-first
    .map((m) => ({
      id: m.id,
      text: m.deleted ? '' : m.text,
      at: m.at,
      editedAt: m.editedAt || null,
      deleted: Boolean(m.deleted),
      fromMe: m.from === myEmail,
      reactions: REACTIONS
        .map((emoji) => ({ emoji, count: (m.reactions?.[emoji] || []).length, mine: (m.reactions?.[emoji] || []).includes(myEmail) }))
        .filter((r) => r.count > 0),
    }));

  const profile = parseProfile(await kvGet(`profile:${withEmail}`));
  return res.status(200).json({ messages, withEmail, withUsername: profile.username || withUsername });
};

const sendMessage = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const myEmail = await resolveEmail({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData });
  if (!myEmail) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });
  if (await kvSismember('banned', myEmail.toLowerCase())) {
    return res.status(403).json({ error: 'Sizga xizmatdan foydalanish cheklangan' });
  }

  const toUsername = String(body.toUsername || '').trim().toLowerCase();
  const text = String(body.text || '').trim().slice(0, MAX_TEXT);
  if (!toUsername) return res.status(400).json({ error: 'Kimga yuborishni tanlang' });
  if (!text) return res.status(400).json({ error: 'Xabar matnini yozing' });

  const toEmail = await kvGet(`username:${toUsername}`);
  if (!toEmail) return res.status(404).json({ error: 'Bunday foydalanuvchi topilmadi' });
  if (toEmail === myEmail) return res.status(400).json({ error: 'O‘zingizga yozib bo‘lmaydi' });

  if (isThrottled(myEmail)) return res.status(429).json({ error: 'Biroz kuting va qayta urinib ko‘ring' });

  const id = generateId();
  const message = { id, from: myEmail, to: toEmail, text, at: Date.now(), editedAt: null, deleted: false, reactions: {} };

  const saved = await kvSet(`msg:${id}`, JSON.stringify(message));
  if (!saved) return res.status(500).json({ error: 'Yuborilmadi, qayta urinib ko‘ring' });
  await kvPush(pairKey(myEmail, toEmail), id);
  await kvSadd(`inbox:${myEmail}`, toEmail);
  await kvSadd(`inbox:${toEmail}`, myEmail);

  return res.status(200).json({ ok: true, id });
};

/** Shared guard for edit/delete/react: loads the message and checks the caller is a participant. */
const loadOwnMessage = async (req, res, { requireSender } = {}) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const myEmail = await resolveEmail({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData });
  if (!myEmail) {
    res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });
    return null;
  }

  const id = String(body.id || '');
  if (!id) {
    res.status(400).json({ error: 'Xabar topilmadi' });
    return null;
  }
  const message = parseMessage(await kvGet(`msg:${id}`));
  if (!message) {
    res.status(404).json({ error: 'Xabar topilmadi' });
    return null;
  }
  const isParticipant = message.from === myEmail || message.to === myEmail;
  if (!isParticipant || (requireSender && message.from !== myEmail)) {
    res.status(403).json({ error: 'Bu amalga huquqingiz yo‘q' });
    return null;
  }

  return { myEmail, id, message, body };
};

const editMessage = async (req, res) => {
  const ctx = await loadOwnMessage(req, res, { requireSender: true });
  if (!ctx) return;
  const { id, message, body } = ctx;
  if (message.deleted) return res.status(400).json({ error: 'O‘chirilgan xabarni tahrirlab bo‘lmaydi' });

  const text = String(body.text || '').trim().slice(0, MAX_TEXT);
  if (!text) return res.status(400).json({ error: 'Xabar matnini yozing' });

  message.text = text;
  message.editedAt = Date.now();
  const saved = await kvSet(`msg:${id}`, JSON.stringify(message));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });

  return res.status(200).json({ ok: true });
};

const deleteMessage = async (req, res) => {
  const ctx = await loadOwnMessage(req, res, { requireSender: true });
  if (!ctx) return;
  const { id, message } = ctx;

  message.deleted = true;
  message.text = '';
  const saved = await kvSet(`msg:${id}`, JSON.stringify(message));
  if (!saved) return res.status(500).json({ error: 'O‘chirilmadi, qayta urinib ko‘ring' });

  return res.status(200).json({ ok: true });
};

const reactToMessage = async (req, res) => {
  const ctx = await loadOwnMessage(req, res);
  if (!ctx) return;
  const { myEmail, id, message, body } = ctx;
  if (message.deleted) return res.status(400).json({ error: 'O‘chirilgan xabarga reaksiya qo‘yib bo‘lmaydi' });

  const emoji = String(body.emoji || '');
  if (!REACTIONS.includes(emoji)) return res.status(400).json({ error: 'Noto‘g‘ri reaksiya' });

  message.reactions = message.reactions || {};
  const holders = message.reactions[emoji] || [];
  const idx = holders.indexOf(myEmail);
  if (idx === -1) holders.push(myEmail);
  else holders.splice(idx, 1);
  message.reactions[emoji] = holders;

  const saved = await kvSet(`msg:${id}`, JSON.stringify(message));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });

  return res.status(200).json({ ok: true });
};

export default async function handler(req, res) {
  const action = String(req.query.action || '');

  if (req.method === 'GET') {
    if (action === 'search') return searchUsers(req, res);
    if (action === 'inbox') return getInbox(req, res);
    if (action === 'thread') return getThread(req, res);
    return res.status(400).json({ error: 'Noto‘g‘ri action' });
  }
  if (req.method === 'POST') {
    if (action === 'send') return sendMessage(req, res);
    if (action === 'edit') return editMessage(req, res);
    if (action === 'delete') return deleteMessage(req, res);
    if (action === 'react') return reactToMessage(req, res);
    return res.status(400).json({ error: 'Noto‘g‘ri action' });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
