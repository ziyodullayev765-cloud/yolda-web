/**
 * Shared check for the signed cookie /api/admin-login sets. Any admin
 * endpoint (orders, users, ...) calls this instead of re-implementing it.
 */
import crypto from 'node:crypto';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ADMIN_PASSWORD;

const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');

export const isAdminAuthed = (req) => {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/admin_session=([^;]+)/);
  if (!match) return false;

  const [expiresStr, sig] = decodeURIComponent(match[1]).split('.');
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || expires < Date.now()) return false;

  return sig === sign(expiresStr);
};
