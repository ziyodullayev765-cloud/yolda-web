/**
 * Admin authentication + role check for the signed cookie /api/admin-login
 * sets. Any admin endpoint (orders, users, ...) calls this instead of
 * re-implementing it.
 *
 * There are no admin user accounts — a role is proven by which password
 * was used to log in, and the cookie's own HMAC signature is what proves
 * the cookie wasn't forged. The role sits inside the signed payload, so a
 * moderator can't edit their own cookie into a super admin.
 *
 * Cookie payload: "<expiresMs>.<role>.<hmac(expiresMs + '.' + role)>"
 *
 * A pre-roles cookie ("<expiresMs>.<hmac(expiresMs)>") is still accepted
 * and treated as SUPER_ADMIN, so sessions issued before roles existed
 * aren't logged out by the deploy that adds them.
 */
import crypto from 'node:crypto';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ADMIN_PASSWORD;

export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'];

/**
 * What each role may do. Enforced server-side on every endpoint — hiding a
 * button in the UI is a convenience, never the permission itself.
 */
const PERMISSIONS = {
  SUPER_ADMIN: ['*'],
  ADMIN: [
    'orders:read', 'users:read', 'users:write', 'reports:read', 'reports:write',
    'trucks:read', 'trucks:write', 'messages:read', 'analytics:read',
    'settings:read', 'settings:write',
  ],
  MODERATOR: [
    'orders:read', 'users:read', 'reports:read', 'reports:write',
    'trucks:read', 'trucks:write', 'messages:read',
  ],
};

const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');

/** Timing-safe compare so a signature can't be probed byte by byte. */
const signatureMatches = (expected, given) => {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(given || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

/** Builds the cookie value for a freshly authenticated admin. */
export const makeSessionToken = (role, expiresMs) => {
  const payload = `${expiresMs}.${role}`;
  return `${payload}.${sign(payload)}`;
};

/**
 * Returns the admin's role when the cookie is valid and unexpired, else
 * null. Truthy/falsy either way, so older `if (!isAdminAuthed(req))` call
 * sites keep working unchanged.
 */
export const isAdminAuthed = (req) => {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/admin_session=([^;]+)/);
  if (!match) return null;

  const parts = decodeURIComponent(match[1]).split('.');
  if (parts.length !== 2 && parts.length !== 3) return null;
  // Legacy two-part cookie, issued before roles existed.
  const [expiresStr, role, sig] = parts.length === 2
    ? [parts[0], 'SUPER_ADMIN', parts[1]]
    : parts;

  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;
  if (!ROLES.includes(role)) return null;

  const expected = parts.length === 2 ? sign(expiresStr) : sign(`${expiresStr}.${role}`);
  if (!signatureMatches(expected, sig)) return null;

  return role;
};

/** True if `role` may perform `permission` (e.g. "users:write"). */
export const roleCan = (role, permission) => {
  const granted = PERMISSIONS[role];
  if (!granted) return false;
  return granted.includes('*') || granted.includes(permission);
};

/**
 * Guard for an admin endpoint: returns the role, or writes the 401/403
 * itself and returns null so the caller can just `if (!role) return;`.
 */
export const requireAdmin = (req, res, permission) => {
  const role = isAdminAuthed(req);
  if (!role) {
    res.status(401).json({ error: 'Kirish kerak' });
    return null;
  }
  if (permission && !roleCan(role, permission)) {
    res.status(403).json({ error: 'Bu amal uchun ruxsatingiz yo‘q' });
    return null;
  }
  return role;
};
