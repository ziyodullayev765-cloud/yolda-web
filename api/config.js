/**
 * GET /api/config
 *
 * Exposes the few public settings the browser needs (like the Google
 * OAuth Client ID) without hardcoding them into the static index.html —
 * change them in Vercel's Environment Variables and they take effect on
 * the next request, no redeploy of the HTML required.
 *
 * telegramBotUsername is the bot's public @handle (not a secret — it's
 * visible to anyone who opens the bot in Telegram) used to build the
 * "Open in Telegram" deep link when the site is opened in a normal
 * browser. TELEGRAM_BOT_TOKEN itself is never exposed here or anywhere
 * else the browser can reach.
 *
 * The rest comes from the `admin_settings` blob the admin panel's
 * Sozlamalar screen writes (see api/admin-data.js). That's what makes
 * those settings real rather than decorative: changing the support phone
 * or flipping maintenance mode in /admin changes what this returns, and
 * index.html renders whatever it gets. Only the genuinely public fields
 * are forwarded — commissionPercent stays admin-side.
 */
import { kvGet } from '../lib/kv.js';

const FALLBACK = {
  platformName: "YO'LDA",
  supportPhone: '',
  supportTelegram: '',
  maintenanceMode: false,
  maintenanceMessage: '',
};

export default async function handler(req, res) {
  let settings = FALLBACK;
  try {
    const parsed = JSON.parse((await kvGet('admin_settings')) || '{}');
    if (parsed && typeof parsed === 'object') settings = { ...FALLBACK, ...parsed };
  } catch {
    // KV unreachable or the blob is corrupt — the site must still load and
    // sign people in, so fall back to "no overrides" rather than failing.
  }

  // Short cache: settings change rarely, but flipping maintenance mode
  // shouldn't take minutes to reach visitors.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
  res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || '',
    platformName: settings.platformName,
    supportPhone: settings.supportPhone,
    supportTelegram: settings.supportTelegram,
    maintenanceMode: Boolean(settings.maintenanceMode),
    maintenanceMessage: settings.maintenanceMessage,
  });
}
