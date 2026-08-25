/**
 * Minimal Upstash Redis REST client — just the two commands the admin
 * panel needs. Plain `fetch`, no SDK, so no extra npm dependency.
 *
 * KV_REST_API_URL / KV_REST_API_TOKEN are injected automatically once you
 * connect an "Upstash for Redis" (or Vercel KV) database to the project
 * from the Vercel dashboard's Storage tab.
 */
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

/** Prepends `value` to the front of the list at `key`. */
export const kvPush = async (key, value) => {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(`${KV_URL}/lpush/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([value]),
    });
  } catch {
    // Order still went to Telegram even if the log write fails — never
    // let the admin log break the actual order flow.
  }
};

/** Reads elements [start, end] (inclusive) from the list at `key`. */
export const kvRange = async (key, start, end) => {
  if (!KV_URL || !KV_TOKEN) return [];
  try {
    const res = await fetch(`${KV_URL}/lrange/${encodeURIComponent(key)}/${start}/${end}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const json = await res.json();
    return json.result || [];
  } catch {
    return [];
  }
};
