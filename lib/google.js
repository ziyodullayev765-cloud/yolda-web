/**
 * Verifies the Google ID token the browser got from "Sign in with Google".
 * Shared by every endpoint that needs to know who the caller really is —
 * re-checking it server-side (not trusting the client) is what actually
 * stops a spoofed request. Uses Google's tokeninfo endpoint so no extra
 * dependency is needed.
 */
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

export const verifyGoogleEmail = async (idToken) => {
  if (!idToken) return null;
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!res.ok) return null;
    const payload = await res.json();
    if (GOOGLE_CLIENT_ID && payload.aud !== GOOGLE_CLIENT_ID) return null;
    if (payload.email_verified !== 'true' && payload.email_verified !== true) return null;
    return payload.email || null;
  } catch {
    return null;
  }
};
