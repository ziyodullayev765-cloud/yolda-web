/**
 * POST /api/profile
 *
 * One endpoint doing double duty:
 *   - { googleIdToken }              → returns the caller's current username (or null)
 *   - { googleIdToken, username }    → claims/changes the username, if it's free
 *
 * A username can belong to only one Google account at a time. Two keys in
 * Redis track that both ways:
 *   username:<lowercased>  -> owner's email   (who currently holds it)
 *   profile:<email>        -> exact-case username the account chose
 */
import { verifyGoogleEmail } from '../lib/google.js';
import { kvGet, kvSet, kvDel } from '../lib/kv.js';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = await verifyGoogleEmail(body.googleIdToken);
  if (!email) return res.status(401).json({ error: 'Avval Google orqali kiring' });

  if (body.username !== undefined && body.username !== null && body.username !== '') {
    const username = String(body.username).trim();
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({
        error: 'Username 3-20 belgidan, faqat lotin harflari, raqam va pastki chiziq (_) bo‘lishi kerak',
      });
    }

    const usernameKey = `username:${username.toLowerCase()}`;
    const owner = await kvGet(usernameKey);
    if (owner && owner !== email) {
      return res.status(409).json({ error: 'Bu username band, boshqasini tanlang' });
    }

    // Changing usernames releases the old one so it can be claimed again.
    const previous = await kvGet(`profile:${email}`);
    if (previous && previous.toLowerCase() !== username.toLowerCase()) {
      await kvDel(`username:${previous.toLowerCase()}`);
    }

    await kvSet(usernameKey, email);
    await kvSet(`profile:${email}`, username);
    return res.status(200).json({ ok: true, username, email });
  }

  const current = await kvGet(`profile:${email}`);
  return res.status(200).json({ ok: true, username: current || null, email });
}
