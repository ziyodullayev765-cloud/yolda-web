/**
 * Single entry point every endpoint uses to find out who's calling,
 * whether they signed in with Google or opened the app inside Telegram.
 * Mirrors this app's existing pattern for Google (verifyGoogleEmail
 * re-checked on every request, no session/cookie) — a Telegram Mini App
 * hands us initData fresh on every launch anyway, so the same stateless,
 * re-verify-every-request shape applies here too, instead of bolting a
 * separate cookie/JWT subsystem onto an app that doesn't have one.
 *
 * The canonical identity string every caller gets back is either:
 *   - a real, Google-verified email address — unchanged, existing shape, or
 *   - "tg:<telegram_id>" — for an account that only has Telegram identity.
 * Both are safe to use exactly like the old `email` variable everywhere
 * (profile:<identity>, username:<x> -> identity, convo:<pairKey>, ...) —
 * none of that code does email-format validation, it's just a key string.
 *
 * Account linking (a user who already has a Google account, and later
 * opens the app in Telegram, or vice versa) is opt-in and explicit — see
 * createTelegramLinkCode/redeemTelegramLinkCode below — never automatic by
 * email, since Telegram never gives us a verified email to safely match
 * against. It's a two-step, one-time-code flow rather than a single call
 * that takes both credentials at once, because in practice those two
 * credentials can never be present together: Google itself refuses to sign
 * a user in from inside Telegram's in-app browser (see isInAppBrowser() in
 * index.html), so a device that has a fresh telegramInitData never has a
 * usable googleIdToken alongside it, and vice versa.
 */
import crypto from 'node:crypto';
import { verifyGoogleEmail } from './google.js';
import { verifyTelegramInitData } from './telegramAuth.js';
import { kvGet, kvSet, kvDel } from './kv.js';

const LINK_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes to type a 6-digit code into the other app

export const tgIdentity = (telegramId) => `tg:${telegramId}`;

/** Keeps telegram:<id> -> {profile info} fresh on every successful Telegram login. */
const saveTelegramProfile = async (tgUser, identity) => {
  const record = {
    telegramId: tgUser.id,
    username: tgUser.username || '',
    firstName: tgUser.firstName || '',
    lastName: tgUser.lastName || '',
    photoUrl: tgUser.photoUrl || '',
    identity,
    updatedAt: Date.now(),
  };
  await kvSet(`telegram:${tgUser.id}`, JSON.stringify(record));
};

/**
 * Resolves the caller's identity from whichever credential was sent.
 * Google is tried first — every existing call site keeps working exactly
 * as before, byte for byte, when it sends a googleIdToken. Telegram is only
 * consulted when there's no (valid) Google token, so a Telegram field
 * riding along on an otherwise-Google request never overrides it.
 *
 * @param {{googleIdToken?: string, telegramInitData?: string}} creds
 * @returns {Promise<{identity: string, method: 'google'|'telegram', telegramUser?: object} | null>}
 */
export const resolveIdentity = async ({ googleIdToken, telegramInitData } = {}) => {
  if (googleIdToken) {
    const email = await verifyGoogleEmail(googleIdToken);
    if (email) return { identity: email, method: 'google' };
  }

  if (telegramInitData) {
    const tgUser = verifyTelegramInitData(telegramInitData);
    if (tgUser) {
      // Already explicitly linked to a Google account (see linkTelegramToGoogle)?
      // Resolve to that email so linking is transparent to every endpoint —
      // requirement #4: an existing account is found, never a duplicate created.
      const linkedEmail = await kvGet(`tgIdToEmail:${tgUser.id}`);
      const identity = linkedEmail || tgIdentity(tgUser.id);
      await saveTelegramProfile(tgUser, identity);
      return { identity, method: 'telegram', telegramUser: tgUser };
    }
  }

  return null;
};

/** Convenience for endpoints that only need the identity string (most of them). */
export const resolveEmail = async (creds) => {
  const result = await resolveIdentity(creds);
  return result ? result.identity : null;
};

const generateLinkCode = () => String(crypto.randomInt(100000, 1000000));

/**
 * Step 1 of account linking (requirement #6), called from a normal browser
 * tab where the user is already signed in with Google: mints a short-lived,
 * single-use 6-digit code tied to their email. Shown on screen for them to
 * type into the Telegram Mini App.
 */
export const createTelegramLinkCode = async (googleIdToken) => {
  const email = await verifyGoogleEmail(googleIdToken);
  if (!email) return { error: 'Avval Google orqali kiring' };

  const code = generateLinkCode();
  const saved = await kvSet(`linkCode:${code}`, JSON.stringify({ email, expiresAt: Date.now() + LINK_CODE_TTL_MS }));
  if (!saved) return { error: 'Kod yaratib bo‘lmadi, qayta urinib ko‘ring' };

  return { ok: true, code, expiresInSeconds: Math.floor(LINK_CODE_TTL_MS / 1000) };
};

/**
 * Step 2, called from inside the Telegram Mini App: redeems the code shown
 * in step 1, linking this cryptographically-verified telegram_id to that
 * email. Both sides of the link are independently verified — the code
 * alone proves the browser tab was really signed in with Google, and
 * telegramInitData alone proves this is really that Telegram account;
 * nothing here trusts a client-supplied id or email directly.
 */
export const redeemTelegramLinkCode = async ({ code, telegramInitData }) => {
  const tgUser = verifyTelegramInitData(telegramInitData);
  if (!tgUser) return { error: 'Telegram autentifikatsiyasi tasdiqlanmadi' };

  const cleanCode = String(code || '').trim();
  if (!/^\d{6}$/.test(cleanCode)) return { error: 'Kod 6 ta raqamdan iborat bo‘lishi kerak' };

  const raw = await kvGet(`linkCode:${cleanCode}`);
  if (!raw) return { error: 'Kod noto‘g‘ri yoki eskirgan' };
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return { error: 'Kod noto‘g‘ri' };
  }
  if (!record || !record.email || !record.expiresAt || Date.now() > record.expiresAt) {
    await kvDel(`linkCode:${cleanCode}`);
    return { error: 'Kod muddati tugagan, qaytadan urinib ko‘ring' };
  }

  const existingOwner = await kvGet(`tgIdToEmail:${tgUser.id}`);
  if (existingOwner && existingOwner !== record.email) {
    return { error: 'Bu Telegram akkaunt allaqachon boshqa profilga bog‘langan' };
  }

  const linked = await kvSet(`tgIdToEmail:${tgUser.id}`, record.email);
  if (!linked) return { error: 'Bog‘lab bo‘lmadi, qayta urinib ko‘ring' };

  await kvDel(`linkCode:${cleanCode}`);
  await saveTelegramProfile(tgUser, record.email);
  return { ok: true, identity: record.email, telegramUser: tgUser };
};
