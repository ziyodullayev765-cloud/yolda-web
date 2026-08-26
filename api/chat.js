/**
 * /api/chat — search users by username, and message them directly.
 *
 * One function (not four) to stay well under Vercel Hobby's 12-function
 * cap — see api/admin-data.js for the same reasoning. Dispatch is by
 * `?action=`:
 *
 *   GET  /api/chat?action=search&q=<text>&googleIdToken=...
 *   GET  /api/chat?action=inbox&googleIdToken=...
 *   GET  /api/chat?action=thread&googleIdToken=...&withEmail=...   (or &withUsername=...)
 *   POST /api/chat?action=send   { googleIdToken, toUsername, text }
 *
 * A conversation is one Redis list shared by both sides, keyed by their
 * emails sorted alphabetically — whoever asks for it gets the same key.
 * Google ID tokens ride in the query string for GETs, the same tradeoff
 * /api/order already makes for phone numbers — acceptable at this app's
 * scale, and verified server-side on every call regardless.
 */
import { kvGet, kvPush, kvRange, kvSadd, kvSmembers, kvKeys, kvSismember } from '../lib/kv.js';
import { verifyGoogleEmail } from '../lib/google.js';

const MAX_TEXT = 1000;
const MAX_SEARCH_RESULTS = 20;

const pairKey = (a, b) => `convo:${[a, b].sort().join('|')}`;

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
  const email = await verifyGoogleEmail(req.query.googleIdToken);
  if (!email) return res.status(401).json({ error: 'Avval Google orqali kiring' });

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
  const myEmail = await verifyGoogleEmail(req.query.googleIdToken);
  if (!myEmail) return res.status(401).json({ error: 'Avval Google orqali kiring' });

  const others = await kvSmembers(`inbox:${myEmail}`);
  const conversations = (
    await Promise.all(
      others.map(async (otherEmail) => {
        const profile = parseProfile(await kvGet(`profile:${otherEmail}`));
        const last = await kvRange(pairKey(myEmail, otherEmail), 0, 0);
        let lastMsg = null;
        if (last[0]) {
          try {
            lastMsg = JSON.parse(last[0]);
          } catch {
            lastMsg = null;
          }
        }
        return {
          email: otherEmail,
          username: profile.username || otherEmail,
          lastText: lastMsg ? lastMsg.text : '',
          lastAt: lastMsg ? lastMsg.at : 0,
          lastFromMe: lastMsg ? lastMsg.from === myEmail : false,
        };
      }),
    )
  ).sort((a, b) => b.lastAt - a.lastAt);

  return res.status(200).json({ conversations });
};

const getThread = async (req, res) => {
  const myEmail = await verifyGoogleEmail(req.query.googleIdToken);
  if (!myEmail) return res.status(401).json({ error: 'Avval Google orqali kiring' });

  let withEmail = String(req.query.withEmail || '').trim();
  const withUsername = String(req.query.withUsername || '').trim().toLowerCase();
  if (!withEmail && withUsername) {
    withEmail = (await kvGet(`username:${withUsername}`)) || '';
  }
  if (!withEmail) return res.status(400).json({ error: 'Bunday foydalanuvchi topilmadi' });

  const raw = await kvRange(pairKey(myEmail, withEmail), 0, 99);
  const messages = raw
    .map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse() // stored newest-first (LPUSH); a chat reads oldest-first
    .map((m) => ({ text: m.text, at: m.at, fromMe: m.from === myEmail }));

  const profile = parseProfile(await kvGet(`profile:${withEmail}`));
  return res.status(200).json({ messages, withEmail, withUsername: profile.username || withUsername });
};

const sendMessage = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const myEmail = await verifyGoogleEmail(body.googleIdToken);
  if (!myEmail) return res.status(401).json({ error: 'Avval Google orqali kiring' });
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

  const ok = await kvPush(pairKey(myEmail, toEmail), JSON.stringify({ from: myEmail, text, at: Date.now() }));
  if (!ok) return res.status(500).json({ error: 'Yuborilmadi, qayta urinib ko‘ring' });

  await kvSadd(`inbox:${myEmail}`, toEmail);
  await kvSadd(`inbox:${toEmail}`, myEmail);

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
    return res.status(400).json({ error: 'Noto‘g‘ri action' });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
