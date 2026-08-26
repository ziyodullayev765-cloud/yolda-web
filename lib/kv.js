/**
 * Minimal Upstash Redis REST client. Plain `fetch`, no SDK, so no extra npm
 * dependency. Commands are sent as a raw array to the base REST URL, which
 * Upstash accepts directly — this handles any value safely (usernames,
 * emails, JSON blobs) without per-argument URL-encoding edge cases.
 *
 * KV_REST_API_URL / KV_REST_API_TOKEN are injected automatically once you
 * connect an "Upstash for Redis" (or Vercel KV) database to the project
 * from the Vercel dashboard's Storage tab.
 */
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

const call = async (command) => {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(KV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    const json = await res.json();
    return json.result;
  } catch {
    return null;
  }
};

/** Prepends `value` to the front of the list at `key`. */
export const kvPush = (key, value) => call(['LPUSH', key, value]);

/** Reads elements [start, end] (inclusive) from the list at `key`. */
export const kvRange = async (key, start, end) => (await call(['LRANGE', key, String(start), String(end)])) || [];

/** Plain string get/set/delete — used for the profile/username lookup. */
export const kvGet = (key) => call(['GET', key]);
export const kvSet = (key, value) => call(['SET', key, value]);
export const kvDel = (key) => call(['DEL', key]);
