/**
 * Unit tests for the admin panel's server side: the signed-cookie role
 * layer (lib/adminAuth.js), the login/logout endpoint and the per-role
 * gating in api/admin-data.js.
 *
 * Run with:  npm test
 *
 * Same approach as test/trucks.test.mjs — no framework, lib/kv.js swapped
 * for an in-memory mock, handlers driven through fake req/res objects.
 * The env vars are set before importing so the HMAC secret and the three
 * role passwords are deterministic.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

process.env.ADMIN_PASSWORD = 'super-secret-pw';
process.env.ADMIN_PASSWORD_ADMIN = 'admin-pw-here';
process.env.ADMIN_PASSWORD_MODERATOR = 'moderator-pw-x';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-hmac-secret';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const work = mkdtempSync(join(tmpdir(), 'yolda-admin-test-'));

const store = new Map();
const sets = new Map();
globalThis.__store = store;
globalThis.__sets = sets;

writeFileSync(join(work, 'kvmock.mjs'), `
export const kvConfigured = true;
const store = globalThis.__store, sets = globalThis.__sets;
export const kvGet = async (k) => store.has(k) ? store.get(k) : null;
export const kvSet = async (k, v) => { store.set(k, v); return true; };
export const kvDel = async (k) => { store.delete(k); return true; };
export const kvSadd = async (k, m) => { if(!sets.has(k)) sets.set(k, new Set()); sets.get(k).add(m); return true; };
export const kvSrem = async (k, m) => { if(sets.has(k)) sets.get(k).delete(m); return true; };
export const kvSmembers = async (k) => sets.has(k) ? [...sets.get(k)] : [];
export const kvSismember = async (k, m) => sets.has(k) && sets.get(k).has(m);
export const kvPush = async () => true;
export const kvRange = async () => [];
export const kvKeys = async () => [...store.keys()].filter(k => k.startsWith('profile:'));
`);

/** Rewrites a handler's lib/kv.js import to the mock, then imports it. */
const loadHandler = async (relPath, name) => {
  const src = readFileSync(join(repo, relPath), 'utf8')
    .replace("'../lib/kv.js'", JSON.stringify(join(work, 'kvmock.mjs')))
    .replace("'../lib/adminAuth.js'", JSON.stringify(join(repo, 'lib/adminAuth.js')));
  const out = join(work, `${name}.mjs`);
  writeFileSync(out, src);
  return (await import(out)).default;
};

const adminData = await loadHandler('api/admin-data.js', 'admin_data');
const adminLogin = await loadHandler('api/admin-login.js', 'admin_login');
const config = await loadHandler('api/config.js', 'config');
const { makeSessionToken, isAdminAuthed, roleCan } = await import(join(repo, 'lib/adminAuth.js'));

function mkRes(){
  const r = { statusCode: 0, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
}
const cookieFor = (role) => `admin_session=${makeSessionToken(role, Date.now() + 60000)}`;
const call = async (handler, method, query, body, cookie) => {
  const req = { method, query: query || {}, body, headers: cookie ? { cookie } : {} };
  const res = mkRes();
  await handler(req, res);
  return res;
};

let pass = 0, fail = 0;
const check = (label, ok) => {
  if(ok){ pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
};

/* ---------------------------------------------------------- */
console.log('\n== cookie signing ==');
{
  const role = isAdminAuthed({ headers: { cookie: cookieFor('MODERATOR') } });
  check('valid cookie returns its role', role === 'MODERATOR');
  check('no cookie returns null', isAdminAuthed({ headers: {} }) === null);

  // Swapping the role inside the payload invalidates the signature.
  const good = makeSessionToken('MODERATOR', Date.now() + 60000);
  const forged = good.replace('MODERATOR', 'SUPER_ADMIN');
  check('role cannot be edited into a higher one',
    isAdminAuthed({ headers: { cookie: `admin_session=${forged}` } }) === null);

  const expired = makeSessionToken('ADMIN', Date.now() - 1000);
  check('expired cookie rejected',
    isAdminAuthed({ headers: { cookie: `admin_session=${expired}` } }) === null);

  check('garbage cookie rejected',
    isAdminAuthed({ headers: { cookie: 'admin_session=nonsense' } }) === null);

  check('unknown role name rejected',
    isAdminAuthed({ headers: { cookie: `admin_session=${makeSessionToken('GOD', Date.now() + 60000)}` } }) === null);
}

console.log('\n== permission table ==');
check('super admin can do anything', roleCan('SUPER_ADMIN', 'settings:write'));
check('admin can write settings', roleCan('ADMIN', 'settings:write'));
check('moderator cannot write settings', !roleCan('MODERATOR', 'settings:write'));
check('moderator cannot write users', !roleCan('MODERATOR', 'users:write'));
check('moderator can moderate trucks', roleCan('MODERATOR', 'trucks:write'));
check('moderator cannot read analytics', !roleCan('MODERATOR', 'analytics:read'));
check('unknown role can do nothing', !roleCan('NOBODY', 'orders:read'));

console.log('\n== login endpoint ==');
{
  const bad = await call(adminLogin, 'POST', {}, { password: 'wrong' });
  check('wrong password rejected', bad.statusCode === 401);

  // A single typo must not lock the admin out: the next attempt is still
  // allowed to reach the password check rather than bouncing off a 429.
  const retry = await call(adminLogin, 'POST', {}, { password: 'also-wrong' });
  check('one typo does not lock the next attempt out', retry.statusCode === 401);

  const ok = await call(adminLogin, 'POST', {}, { password: 'moderator-pw-x' });
  check('moderator password returns MODERATOR', ok.statusCode === 200 && ok.body.role === 'MODERATOR');
  check('cookie is HttpOnly + Secure',
    /HttpOnly/.test(ok.headers['Set-Cookie']) && /Secure/.test(ok.headers['Set-Cookie']));

  const sess = await call(adminLogin, 'GET', {}, null, cookieFor('ADMIN'));
  check('GET reports the current role', sess.body.authed === true && sess.body.role === 'ADMIN');
  const anon = await call(adminLogin, 'GET', {}, null);
  check('GET without cookie is not authed', anon.body.authed === false);

  const out = await call(adminLogin, 'POST', { action: 'logout' }, null, cookieFor('ADMIN'));
  check('logout clears the cookie', out.statusCode === 200 && /Max-Age=0/.test(out.headers['Set-Cookie']));

  // Sustained guessing still gets throttled. The successful login above
  // reset the counter, so this starts from a clean budget of 5.
  let throttled = false;
  for (let i = 0; i < 8; i++) {
    const r = await call(adminLogin, 'POST', {}, { password: 'guess-' + i });
    if (r.statusCode === 429) { throttled = true; break; }
  }
  check('repeated guessing is throttled', throttled);
}

console.log('\n== admin-data role gating ==');
{
  const noCookie = await call(adminData, 'GET', { resource: 'users' });
  check('no session gets 401', noCookie.statusCode === 401);

  const modSettings = await call(adminData, 'GET', { resource: 'settings' }, null, cookieFor('MODERATOR'));
  check('moderator reading settings gets 403', modSettings.statusCode === 403);

  const modWriteUser = await call(adminData, 'POST', { action: 'update-user' },
    { email: 'x@y.com' }, cookieFor('MODERATOR'));
  check('moderator writing a user gets 403', modWriteUser.statusCode === 403);

  const modTrucks = await call(adminData, 'GET', { resource: 'trucks' }, null, cookieFor('MODERATOR'));
  check('moderator may read trucks', modTrucks.statusCode === 200);

  const adminSettings = await call(adminData, 'GET', { resource: 'settings' }, null, cookieFor('ADMIN'));
  check('admin may read settings', adminSettings.statusCode === 200);

  const junk = await call(adminData, 'GET', { resource: 'passwords' }, null, cookieFor('SUPER_ADMIN'));
  check('unknown resource rejected', junk.statusCode === 400);
  const junkAnon = await call(adminData, 'GET', { resource: 'passwords' });
  check('unknown resource still needs a session first', junkAnon.statusCode === 401);
}

console.log('\n== settings ==');
{
  const defaults = await call(adminData, 'GET', { resource: 'settings' }, null, cookieFor('SUPER_ADMIN'));
  check('defaults returned when nothing saved', defaults.body.settings.platformName === "YO'LDA");

  const badPct = await call(adminData, 'POST', { action: 'update-settings' },
    { commissionPercent: 250 }, cookieFor('SUPER_ADMIN'));
  check('out-of-range commission rejected', badPct.statusCode === 400);

  const saved = await call(adminData, 'POST', { action: 'update-settings' },
    { supportPhone: '+998901112233', supportTelegram: '@yolda_help',
      maintenanceMode: true, maintenanceMessage: 'Texnik ishlar', commissionPercent: 7.5 },
    cookieFor('SUPER_ADMIN'));
  check('settings saved', saved.statusCode === 200 && saved.body.settings.commissionPercent === 7.5);
  check('telegram @ stripped', saved.body.settings.supportTelegram === 'yolda_help');

  // The point of the settings screen: what it saves is what the public
  // site reads back through /api/config.
  const cfg = await call(config, 'GET', {});
  check('config exposes the saved support phone', cfg.body.supportPhone === '+998901112233');
  check('config exposes maintenance mode', cfg.body.maintenanceMode === true);
  check('config exposes the maintenance message', cfg.body.maintenanceMessage === 'Texnik ishlar');
  check('config never exposes the commission', cfg.body.commissionPercent === undefined);
}

console.log('\n== single-listing detail ==');
{
  store.set('truck:t1', JSON.stringify({ id: 't1', brand: 'DAF XF', photos: ['data:image/jpeg;base64,AAA'] }));
  sets.set('truck_ids', new Set(['t1']));

  const detail = await call(adminData, 'GET', { resource: 'truck', id: 't1' }, null, cookieFor('MODERATOR'));
  check('detail includes the photos needed to moderate',
    detail.statusCode === 200 && detail.body.truck.photos.length === 1);

  const list = await call(adminData, 'GET', { resource: 'trucks' }, null, cookieFor('MODERATOR'));
  check('list strips photos but keeps the count',
    list.body.trucks[0].photos === undefined && list.body.trucks[0].photoCount === 1);

  const missing = await call(adminData, 'GET', { resource: 'truck', id: 'nope' }, null, cookieFor('MODERATOR'));
  check('unknown listing id gets 404', missing.statusCode === 404);

  const noId = await call(adminData, 'GET', { resource: 'truck' }, null, cookieFor('MODERATOR'));
  check('detail without an id gets 400', noId.statusCode === 400);
}

console.log('\n== requeue of never-reviewed listings ==');
{
  const BEFORE = Date.parse('2026-09-01T06:18:58Z');
  store.clear();
  sets.clear();
  const seed = (id, patch) => {
    store.set(`truck:${id}`, JSON.stringify({ id, brand: id, createdAt: BEFORE - 86400000, status: 'ACTIVE', ...patch }));
    return id;
  };
  sets.set('truck_ids', new Set([
    seed('legacy1'),
    seed('legacy2'),
    // Already ruled on by an admin — must not be dragged back in.
    seed('reviewed', { moderatedAt: BEFORE + 1000 }),
    // Posted after moderation shipped, so it was approved on purpose.
    seed('recent', { createdAt: BEFORE + 3600000 }),
    // Not public anyway; requeueing these would just confuse the seller.
    seed('paused', { status: 'PAUSED' }),
    seed('sold', { status: 'SOLD' }),
    seed('rejected', { status: 'REJECTED', rejectionReason: 'Rasm yo‘q' }),
    // Left over from a previous rejection that was later reactivated.
    seed('stale', { rejectionReason: 'eski sabab' }),
  ]));

  const noConfirm = await call(adminData, 'POST', { action: 'requeue-legacy' }, {}, cookieFor('SUPER_ADMIN'));
  check('requeue refuses without an explicit confirm', noConfirm.statusCode === 400);
  // Nothing was written above, so the seeded rows are still untouched here.

  const res = await call(adminData, 'POST', { action: 'requeue-legacy' }, { confirm: true }, cookieFor('SUPER_ADMIN'));
  const at = (id) => JSON.parse(store.get(`truck:${id}`));
  check('only the never-reviewed ones are requeued', res.body.requeued === 2 + 1, `requeued=${res.body.requeued}`);
  check('legacy listing moved to PENDING', at('legacy1').status === 'PENDING');
  check('admin-reviewed listing untouched', at('reviewed').status === 'ACTIVE');
  check('post-moderation listing untouched', at('recent').status === 'ACTIVE');
  check('paused listing untouched', at('paused').status === 'PAUSED');
  check('sold listing untouched', at('sold').status === 'SOLD');
  check('rejected listing keeps its reason', at('rejected').rejectionReason === 'Rasm yo‘q');
  check('stale rejection reason cleared on requeue', at('stale').rejectionReason === undefined);

  const again = await call(adminData, 'POST', { action: 'requeue-legacy' }, { confirm: true }, cookieFor('SUPER_ADMIN'));
  check('running it twice changes nothing', again.body.requeued === 0);

  // Moderation is a moderator's job, so the action must be open to them
  // too — checked last, on an already-drained queue, so it can't skew
  // the counts above.
  const asModerator = await call(adminData, 'POST', { action: 'requeue-legacy' }, { confirm: true }, cookieFor('MODERATOR'));
  check('moderator may requeue (has trucks:write)', asModerator.statusCode === 200);
}

console.log('\n== moderation stamp ==');
{
  store.set('truck:s1', JSON.stringify({ id:'s1', brand:'S', status:'PENDING', createdAt: 1 }));
  sets.set('truck_ids', new Set(['s1']));
  await call(adminData, 'POST', { action: 'update-truck' }, { id:'s1', status:'ACTIVE' }, cookieFor('ADMIN'));
  const t = JSON.parse(store.get('truck:s1'));
  check('approving stamps moderatedAt', typeof t.moderatedAt === 'number' && t.moderatedAt > 0);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
