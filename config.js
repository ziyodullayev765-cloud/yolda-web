/**
 * GET /api/config
 *
 * Exposes the few public settings the browser needs (like the Google
 * OAuth Client ID) without hardcoding them into the static index.html —
 * change them in Vercel's Environment Variables and they take effect on
 * the next request, no redeploy of the HTML required.
 */
export default function handler(req, res) {
  res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  });
}
