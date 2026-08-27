/**
 * Minimal Upstash Redis REST client. Plain `fetch`, no SDK, so no extra npm
 * dependency. Commands are sent as a raw array to the base REST URL, which
 * Upstash accepts directly — this handles any value safely (usernames,
 * emails, JSON blobs) without per-argument URL-encoding edge cases.
 *
 * KV_REST_API_URL / KV_REST_API_TOKEN are injected automatically once you
 * connect an "Upstash for Redis" (or Vercel KV) database to the project
 * from the Vercel dashboard's Storage tab.
 *
 * Every call reports whether it actually reached Redis (`ok`) — callers that
 * need the write to really persist (like saving a profile) must check this
 * instead of assuming success, or a missing/broken connection fails silently
 * and looks like "my data keeps disappearing".
 */
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

export const kvConfigured = Boolean(KV_URL && KV_TOKEN);

const call = async (command) => {
  if (!kvConfigured) {
    console.error('KV not configured: KV_REST_API_URL / KV_REST_API_TOKEN missing in this environment.');
    return { ok: false, result: null };
  }
  try {
    const res = await fetch(KV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    const json = await res.json();
    if (!res.ok) {
      console.error('KV command failed:', res.status, JSON.stringify(json));
      return { ok: false, result: null };
    }
    return { ok: true, result: json.result };
  } catch (err) {
    console.error('KV request error:', err.message);
    return { ok: false, result: null };
  }
};

/** Prepends `value` to the front of the list at `key`. */
export const kvPush = async (key, value) => (await call(['LPUSH', key, value])).ok;

/** Reads elements [start, end] (inclusive) from the list at `key`. */
export const kvRange = async (key, start, end) => (await call(['LRANGE', key, String(start), String(end)])).result || [];

/** Plain string get/set/delete — used for the profile/username lookup. */
export const kvGet = async (key) => (await call(['GET', key])).result;
/** Resolves to true only if the write actually reached Redis. */
export const kvSet = async (key, value) => (await call(['SET', key, value])).ok;
export const kvDel = async (key) => (await call(['DEL', key])).ok;

/** Set membership — used to keep an index of every registered profile. */
export const kvSadd = async (key, member) => (await call(['SADD', key, member])).ok;
export const kvSmembers = async (key) => (await call(['SMEMBERS', key])).result || [];
/** True only if `member` is actually in the set — used for the ban check. */
export const kvSismember = async (key, member) => (await call(['SISMEMBER', key, member])).result === 1;
/** Removes `member` from the set — used to unban someone from the admin panel. */
export const kvSrem = async (key, member) => (await call(['SREM', key, member])).ok;

/**
 * Lists keys matching a glob pattern (e.g. 'profile:*'). Only used by the
 * admin panel, at the small scale this app runs at — not something to call
 * on every request in a hot path.
 */
export const kvKeys = async (pattern) => (await call(['KEYS', pattern])).result || [];
