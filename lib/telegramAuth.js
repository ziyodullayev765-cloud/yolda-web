/**
 * Verifies Telegram Web App `initData` per Telegram's documented signature
 * scheme. Mirrors lib/google.js: a small, focused, exported verifier every
 * endpoint that needs Telegram identity calls instead of trusting the
 * client's `Telegram.WebApp.initDataUnsafe` (which, as the name says, is
 * unsafe — it's just what the client claims, never what to authenticate
 * against).
 *
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 *
 * Reuses TELEGRAM_BOT_TOKEN — already set in Vercel for the existing order
 * bot (api/order.js, api/telegram.js) — no new secret needed.
 */
import crypto from 'node:crypto';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// How long a given initData string stays acceptable after Telegram signed
// it, closing the replay window on a captured/leaked initData value. Telegram
// re-signs a fresh initData every time the Mini App is (re)opened, so this
// only has to outlast one real session, not be permanent.
const MAX_AGE_SECONDS = 24 * 60 * 60;
// Small forward tolerance for clock skew between Telegram's servers and this
// one — not a real allowance for a forged future auth_date.
const CLOCK_SKEW_SECONDS = 60;

let cachedSecretKey = null;
let cachedForToken = null;
const secretKey = () => {
  if (cachedSecretKey && cachedForToken === BOT_TOKEN) return cachedSecretKey;
  // Per Telegram's spec: secret_key = HMAC_SHA256(bot_token, "WebAppData")
  cachedSecretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  cachedForToken = BOT_TOKEN;
  return cachedSecretKey;
};

/**
 * @param {string} initData raw `Telegram.WebApp.initData` string from the client
 * @returns {{ id:number, firstName:string, lastName:string, username:string, photoUrl:string } | null}
 */
export const verifyTelegramInitData = (initData) => {
  if (!BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN missing — cannot verify Telegram Web App initData.');
    return null;
  }
  if (!initData || typeof initData !== 'string') return null;

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const receivedHash = params.get('hash');
  if (!receivedHash || !/^[0-9a-f]{64}$/i.test(receivedHash)) return null;
  params.delete('hash');

  // data-check-string: every remaining field as "key=value", sorted
  // alphabetically by key, joined with "\n".
  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push(`${key}=${value}`);
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const computedHash = crypto.createHmac('sha256', secretKey()).update(dataCheckString).digest('hex');

  const a = Buffer.from(computedHash, 'hex');
  const b = Buffer.from(receivedHash.toLowerCase(), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  // Replay protection: reject a stale (or implausibly future-dated) initData.
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) return null;
  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > MAX_AGE_SECONDS || ageSeconds < -CLOCK_SKEW_SECONDS) return null;

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
  // The Telegram user id is the one piece of this we actually trust — it's
  // inside the HMAC-signed payload, not a separate client-supplied field.
  if (!user || !Number.isInteger(user.id)) return null;

  return {
    id: user.id,
    firstName: typeof user.first_name === 'string' ? user.first_name : '',
    lastName: typeof user.last_name === 'string' ? user.last_name : '',
    username: typeof user.username === 'string' ? user.username : '',
    photoUrl: typeof user.photo_url === 'string' ? user.photo_url : '',
  };
};
