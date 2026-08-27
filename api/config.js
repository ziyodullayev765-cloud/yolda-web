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
 */
export default function handler(req, res) {
  res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || '',
  });
}
