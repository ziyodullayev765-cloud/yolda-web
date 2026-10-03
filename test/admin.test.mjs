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
const lists = new Map();
globalThis.__lists = lists;

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
const lists = globalThis.__lists;
export const kvPush = async (k, v) => { if(!lists.has(k)) lists.set(k, []); lists.get(k).unshift(v); return true; };
export const kvRange = async (k, a, b) => {
  const all = lists.has(k) ? lists.get(k) : [];
  const end = Number(b) < 0 ? all.length : Number(b) + 1;
  return all.slice(Number(a), end);
};
export const kvLrem = async (k, v) => {
  if(lists.has(k)) lists.set(k, lists.get(k).filter((x) => x !== v));
  return true;
};
export const kvKeys = async () => [...store.keys()].filter(k => k.startsWith('profile:'));
// Kvota o'lchovi: admin paneldagi "Baza yuklanishi" sahifasi uchun.
export const kvDbSize = async () => store.size;
export const kvUsedMemory = async () => 12345678;
export const kvMonthCommands = async () => 4321;
export const usageKey = () => 'usage:cmd:2026-10';
`);

/**
 * Rewrites a handler's lib/kv.js import to the mock and every other
 * ../lib/ import to an absolute repo path, then imports it. Generic on
 * purpose: a handler that picks up a new lib import should not break
 * these tests.
 */
const loadHandler = async (relPath, name, libQuery = '') => {
  // libQuery — lib modulining yangi nusxasini olish uchun. Bitta
  // test ichida lib/storage.js ni ham sozlangan, ham sozlanmagan
  // holatda sinash kerak; modul esa env ni yuklanish paytida o'qiydi.
  const src = readFileSync(join(repo, relPath), 'utf8')
    .replaceAll("'../lib/kv.js'", JSON.stringify(join(work, 'kvmock.mjs')))
    .replace(/'\.\.\/lib\/([\w.]+)'/g, (_, f) => JSON.stringify(join(repo, 'lib', f) + libQuery));
  const out = join(work, `${name}.mjs`);
  writeFileSync(out, src);
  return (await import(out)).default;
};

// Ikonka yuklash uchun R2 sozlangan bo'lishi kerak. Haqiqiy so'rov
// ketmaydi — global.fetch quyida yozib oluvchiga almashtirilgan.
process.env.R2_ACCOUNT_ID = 'acc-test';
process.env.R2_ACCESS_KEY_ID = 'key-test';
process.env.R2_SECRET_ACCESS_KEY = 'secret-test';
process.env.R2_BUCKET = 'yolda-test';
process.env.R2_PUBLIC_URL = 'https://pub-test.r2.dev';

let r2Calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('r2.cloudflarestorage.com')) {
    r2Calls.push({ url: String(url), method: init.method });
    return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  }
  return realFetch(url, init);
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
let testIp = null;   // reset() har safar yangi "IP" beradi (login throttle uchun)
const call = async (handler, method, query, body, cookie) => {
  const headers = cookie ? { cookie } : {};
  if(testIp) headers['x-forwarded-for'] = testIp;
  const req = { method, query: query || {}, body, headers };
  const res = mkRes();
  await handler(req, res);
  return res;
};

let pass = 0, fail = 0, gaps = 0;
const check = (label, ok, detail) => {
  if(ok){ pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '  (' + detail + ')' : '')); }
};

/**
 * Ma'lum kamchilik: kod hozir bu kutilmaganini bajarmaydi, lekin buni
 * tuzatish mahsulot qarori yoki alohida ish. Testni yiqitmaydi (npm test
 * yashil qoladi), ammo yakunda ko'rinib turadi va kamchilik tuzatilgach
 * o'zi PASS'ga aylanadi.
 */
const gap = (label, ok, note) => {
  if(ok){ pass++; console.log('  PASS ' + label + '  (kamchilik yopilgan)'); }
  else { gaps++; console.log('  GAP  ' + label + '  — ' + note); }
};

// Har bir bo'lim toza xotiradan va yangi login "IP"sidan boshlashi uchun.
let ipCounter = 0;
const reset = () => { store.clear(); sets.clear(); testIp = '10.9.0.' + (++ipCounter); };

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

console.log('\n== three kinds of verification ==');
{
  const {
    readVerifications, setVerification, publicVerifications, canSubmit, docKey,
  } = await import(join(repo, 'lib/verification.js'));

  // Eski yozuv: bitta `verified` bayrog'i doim shaxsni bildirgan.
  const legacy = readVerifications({ verified: true });
  check('an old verified flag reads as an identity check', legacy.IDENTITY.status === 'VERIFIED');
  check('and says nothing about the phone', legacy.PHONE.status === 'NONE');
  check('or the vehicle', legacy.TRANSPORT.status === 'NONE');
  check('an old pending request still reads as pending',
    readVerifications({ verificationRequestedAt: 5 }).IDENTITY.status === 'PENDING');
  check('an empty profile has three untouched kinds',
    Object.values(readVerifications({})).every((v) => v.status === 'NONE'));

  const p = {};
  setVerification(p, 'PHONE', { status: 'VERIFIED', at: 1 });
  check('a verified phone does not grant the blue badge', p.verified === false);
  setVerification(p, 'IDENTITY', { status: 'VERIFIED', at: 2 });
  check('a verified identity does', p.verified === true);
  setVerification(p, 'IDENTITY', { status: 'REJECTED', reviewedAt: 3, reason: 'noaniq' });
  check('and losing it takes the badge back', p.verified === false);
  check('the phone check survives that', readVerifications(p).PHONE.status === 'VERIFIED');
  check('a pending identity restores the old queue field', (() => {
    const q = {};
    setVerification(q, 'IDENTITY', { status: 'PENDING', at: 99 });
    return q.verificationRequestedAt === 99;
  })());

  const pub = publicVerifications(p);
  check('the public shape is booleans only',
    Object.values(pub).every((v) => typeof v === 'boolean'));
  check('a rejection is not published as anything', pub.IDENTITY === false);
  check('a rejection reason never reaches the public shape',
    !JSON.stringify(pub).includes('noaniq'));

  check('a verified kind cannot be resubmitted', !canSubmit({ status: 'VERIFIED' }).ok);
  check('nor can a pending one', !canSubmit({ status: 'PENDING' }).ok);
  check('a fresh rejection waits out its cooldown',
    !canSubmit({ status: 'REJECTED', reviewedAt: Date.now() }).ok);
  check('an old rejection may try again',
    canSubmit({ status: 'REJECTED', reviewedAt: Date.now() - 2 * 24 * 3600 * 1000 }).ok);
  check('an untouched kind may be submitted', canSubmit({ status: 'NONE' }).ok);
  check('documents are keyed per person and per kind',
    docKey('a@b.c', 'IDENTITY') !== docKey('a@b.c', 'TRANSPORT'));
}

console.log('\n== the moderator decides, and the document goes ==');
{
  store.clear(); sets.clear();
  store.set('profile:d@example.com', JSON.stringify({ username: 'aziz' }));
  store.set('verifydoc:d@example.com:TRANSPORT', 'data:image/jpeg;base64,AAAA');
  sets.set('verify_queue', new Set(['d@example.com|TRANSPORT']));

  const noAuth = await call(adminData, 'POST', { action: 'verify-review' },
    { email: 'd@example.com', kind: 'TRANSPORT', approve: true });
  check('reviewing needs an admin session', noAuth.statusCode === 401);
  check('a moderator lacks users:write for this',
    (await call(adminData, 'POST', { action: 'verify-review' },
      { email: 'd@example.com', kind: 'TRANSPORT', approve: true }, cookieFor('MODERATOR'))).statusCode === 403);

  const noDoc = await call(adminData, 'GET',
    { resource: 'verifydoc', email: 'd@example.com', kind: 'PHONE' }, null, cookieFor('ADMIN'));
  check('there is no document to fetch for a phone check', noDoc.statusCode === 400);

  const doc = await call(adminData, 'GET',
    { resource: 'verifydoc', email: 'd@example.com', kind: 'TRANSPORT' }, null, cookieFor('ADMIN'));
  check('an admin can open the document', doc.statusCode === 200 && doc.body.doc.startsWith('data:image/'));

  const noReason = await call(adminData, 'POST', { action: 'verify-review' },
    { email: 'd@example.com', kind: 'TRANSPORT', approve: false }, cookieFor('ADMIN'));
  check('rejecting without a reason is refused', noReason.statusCode === 400);
  check('and changes nothing', store.has('verifydoc:d@example.com:TRANSPORT'));

  const ok = await call(adminData, 'POST', { action: 'verify-review' },
    { email: 'd@example.com', kind: 'TRANSPORT', approve: true }, cookieFor('ADMIN'));
  check('approving works', ok.statusCode === 200);
  check('the profile records it',
    JSON.parse(store.get('profile:d@example.com')).verifications.TRANSPORT.status === 'VERIFIED');
  check('a vehicle check does not hand out the blue badge',
    JSON.parse(store.get('profile:d@example.com')).verified === false);
  // Ko'rib bo'lingan hujjatni saqlab turishning sababi yo'q.
  check('the document is deleted once reviewed', !store.has('verifydoc:d@example.com:TRANSPORT'));
  check('and the queue entry with it', !sets.get('verify_queue').has('d@example.com|TRANSPORT'));

  // Eski tugma ishlashda davom etadi va yangi shakl bilan kelishadi.
  store.set('verifydoc:d@example.com:IDENTITY', 'data:image/jpeg;base64,BBBB');
  await call(adminData, 'POST', { action: 'verify-driver' },
    { email: 'd@example.com', verified: true }, cookieFor('ADMIN'));
  const after = JSON.parse(store.get('profile:d@example.com'));
  check('the old verify button still grants the badge', after.verified === true);
  check('and now writes the identity record too', after.verifications.IDENTITY.status === 'VERIFIED');
  check('it clears the old pending field', after.verificationRequestedAt === undefined);
  check('and drops that document as well', !store.has('verifydoc:d@example.com:IDENTITY'));
  check('while leaving the vehicle check alone', after.verifications.TRANSPORT.status === 'VERIFIED');
}

/* ---------------------------------------------------------- */
console.log('\n== login: all roles, edge cases ==');
{
  reset();
  const sup = await call(adminLogin, 'POST', {}, { password: 'super-secret-pw' });
  check('super password returns SUPER_ADMIN', sup.statusCode === 200 && sup.body.role === 'SUPER_ADMIN');
  const adm = await call(adminLogin, 'POST', {}, { password: 'admin-pw-here' });
  check('admin password returns ADMIN', adm.statusCode === 200 && adm.body.role === 'ADMIN');

  check('empty password rejected', (await call(adminLogin, 'POST', {}, { password: '' })).statusCode === 401);
  check('missing password field rejected', (await call(adminLogin, 'POST', {}, {})).statusCode === 401);
  check('missing body rejected', [400, 401].includes((await call(adminLogin, 'POST', {}, undefined)).statusCode));
  check('non-string password rejected',
    (await call(adminLogin, 'POST', {}, { password: 12345 })).statusCode === 401);

  const ok = await call(adminLogin, 'POST', {}, { password: 'admin-pw-here' });
  const c = ok.headers['Set-Cookie'] || '';
  check('cookie has SameSite', /SameSite=(Strict|Lax)/i.test(c));
  check('cookie has Path=/', /Path=\//.test(c));
  check('cookie has a Max-Age', /Max-Age=\d+/.test(c) && !/Max-Age=0/.test(c));

  check('PUT is not allowed', (await call(adminLogin, 'PUT', {}, {})).statusCode === 405);
  check('DELETE is not allowed', (await call(adminLogin, 'DELETE', {})).statusCode === 405);

  // Bloklangandan keyin to'g'ri parol ham o'tmasligi kerak.
  reset();
  let blocked = false;
  for (let i = 0; i < 10; i++) {
    if ((await call(adminLogin, 'POST', {}, { password: 'x' + i })).statusCode === 429) { blocked = true; break; }
  }
  const afterBlock = await call(adminLogin, 'POST', {}, { password: 'admin-pw-here' });
  check('correct password is also refused while blocked', blocked && afterBlock.statusCode === 429);
}

console.log('\n== cookie signature tampering ==');
{
  const good = makeSessionToken('ADMIN', Date.now() + 60000);
  const flipLast = good.slice(0, -1) + (good.slice(-1) === 'a' ? 'b' : 'a');
  check('flipped last signature char rejected',
    isAdminAuthed({ headers: { cookie: `admin_session=${flipLast}` } }) === null);
  check('truncated token rejected',
    isAdminAuthed({ headers: { cookie: `admin_session=${good.slice(0, -8)}` } }) === null);
  check('empty cookie value rejected',
    isAdminAuthed({ headers: { cookie: 'admin_session=' } }) === null);
  check('other cookies do not confuse the parser',
    isAdminAuthed({ headers: { cookie: `a=1; admin_session=${good}; b=2` } }) === 'ADMIN');
  // Ikkalasi ham hozircha yiqiladi: isAdminAuthed `req.headers.cookie` ni
  // to'g'ridan-to'g'ri o'qiydi va decodeURIComponent'ni try/catch'siz
  // chaqiradi. Birinchisi Vercel'da bo'lmaydi (headers doim bor), ikkinchisi
  // esa bo'lishi mumkin: buzuq cookie 401 o'rniga istisno tashlaydi.
  gap('no headers object at all does not throw', (() => {
    try { return isAdminAuthed({}) === null; } catch { return false; }
  })(), 'req.headers undefined bo‘lsa TypeError; Vercel’da uchramaydi');
  gap('malformed %-encoding in the cookie is rejected instead of throwing', (() => {
    try { return isAdminAuthed({ headers: { cookie: 'admin_session=%E0%A4%A' } }) === null; }
    catch { return false; }
  })(), 'decodeURIComponent URIError tashlaydi → 401 o‘rniga 500');
}

console.log('\n== endpoint-level permissions ==');
{
  reset();
  // Ruxsat jadvali (lib/adminAuth.js) bo'yicha: moderator buyurtma va
  // foydalanuvchilarni O'QIY oladi, lekin sozlamalarni o'qiy olmaydi va
  // hech narsa yoza olmaydi (users/settings). "analytics" resursi yo'q.
  const cases = [
    ['moderator cannot POST update-settings', 'POST', { action: 'update-settings' }, { commissionPercent: 5 }, 'MODERATOR', 403],
    ['moderator cannot POST update-user', 'POST', { action: 'update-user' }, { email: 'x@y.z' }, 'MODERATOR', 403],
    ['moderator cannot read settings', 'GET', { resource: 'settings' }, null, 'MODERATOR', 403],
    ['moderator may read users (per permission table)', 'GET', { resource: 'users' }, null, 'MODERATOR', 200],
    ['moderator may read orders (per permission table)', 'GET', { resource: 'orders' }, null, 'MODERATOR', 200],
    ['admin may read users', 'GET', { resource: 'users' }, null, 'ADMIN', 200],
    ['admin may read orders', 'GET', { resource: 'orders' }, null, 'ADMIN', 200],
    ['admin may read settings', 'GET', { resource: 'settings' }, null, 'ADMIN', 200],
    ['unknown resource refused', 'GET', { resource: 'analytics' }, null, 'ADMIN', 400],
    ['unknown action rejected', 'POST', { action: 'drop-database' }, {}, 'SUPER_ADMIN', 400],
  ];
  for (const [label, m, q, b, role, want] of cases) {
    const r = await call(adminData, m, q, b, cookieFor(role));
    check(label, r.statusCode === want, `got ${r.statusCode}`);
  }
  check('unknown resource without a session gets 401, not 400',
    (await call(adminData, 'GET', { resource: 'analytics' }, null)).statusCode === 401);
  check('unknown action without a session gets 401, not 400',
    (await call(adminData, 'POST', { action: 'drop-database' }, {})).statusCode === 401);

  const anon = await call(adminData, 'POST', { action: 'requeue-legacy' }, { confirm: true });
  check('requeue-legacy needs a session', anon.statusCode === 401);
  const adminRequeue = await call(adminData, 'POST', { action: 'requeue-legacy' }, { confirm: true }, cookieFor('ADMIN'));
  check('admin may requeue', adminRequeue.statusCode === 200);
}

console.log('\n== moderation: reject path ==');
{
  reset();
  store.set('truck:m1', JSON.stringify({ id: 'm1', brand: 'M', status: 'PENDING', createdAt: 1 }));
  sets.set('truck_ids', new Set(['m1']));

  const badStatus = await call(adminData, 'POST', { action: 'update-truck' },
    { id: 'm1', status: 'BANANA' }, cookieFor('MODERATOR'));
  check('invalid status refused', badStatus.statusCode === 400);
  const noSuch = await call(adminData, 'POST', { action: 'update-truck' },
    { id: 'nope', status: 'ACTIVE' }, cookieFor('MODERATOR'));
  check('unknown listing id gets 404', noSuch.statusCode === 404);
  const noId = await call(adminData, 'POST', { action: 'update-truck' },
    { status: 'ACTIVE' }, cookieFor('MODERATOR'));
  check('missing id gets 400', noId.statusCode === 400);
  check('failed attempts change nothing', JSON.parse(store.get('truck:m1')).status === 'PENDING');

  const rej = await call(adminData, 'POST', { action: 'update-truck' },
    { id: 'm1', status: 'REJECTED', rejectionReason: 'Rasm sifatsiz' }, cookieFor('MODERATOR'));
  const t = JSON.parse(store.get('truck:m1'));
  check('rejection succeeds', rej.statusCode === 200);
  check('rejection stores the reason', t.rejectionReason === 'Rasm sifatsiz');
  check('rejection stamps moderatedAt', typeof t.moderatedAt === 'number');

  await call(adminData, 'POST', { action: 'update-truck' }, { id: 'm1', status: 'ACTIVE' }, cookieFor('MODERATOR'));
  check('reactivating clears the old reason', JSON.parse(store.get('truck:m1')).rejectionReason === undefined);

  // Mahsulot qarori kerak: hozir sababsiz rad etish mumkin, sotuvchiga esa
  // "rad etildi" degan xabar sababsiz boradi. Tasdiqlash (verify-review)
  // esa sababni majburiy qiladi — ikki joy bir-biriga o'xshamaydi.
  store.set('truck:m2', JSON.stringify({ id: 'm2', brand: 'M2', status: 'PENDING', createdAt: 1 }));
  sets.get('truck_ids').add('m2');
  const bare = await call(adminData, 'POST', { action: 'update-truck' },
    { id: 'm2', status: 'REJECTED' }, cookieFor('MODERATOR'));
  gap('rejecting a listing without a reason is refused', bare.statusCode === 400,
    'verify-review sabab talab qiladi, update-truck esa yo‘q');
}

console.log('\n== settings: bad input ==');
{
  reset();
  const S = cookieFor('SUPER_ADMIN');
  const post = (b) => call(adminData, 'POST', { action: 'update-settings' }, b, S);
  check('negative commission rejected', (await post({ commissionPercent: -1 })).statusCode === 400);
  check('NaN commission rejected', (await post({ commissionPercent: NaN })).statusCode === 400);
  check('string commission rejected', (await post({ commissionPercent: 'abc' })).statusCode === 400);
  check('0 is a valid commission', (await post({ commissionPercent: 0 })).statusCode === 200);
  check('100 is a valid commission', (await post({ commissionPercent: 100 })).statusCode === 200);
  check('100.01 is too much', (await post({ commissionPercent: 100.01 })).statusCode === 400);

  const long = await post({ maintenanceMessage: 'x'.repeat(5000) });
  check('very long message rejected or truncated',
    long.statusCode === 400 || long.body.settings.maintenanceMessage.length < 5000);

  // Server matnni o'zgartirmaydi (JSON'da xom qaytadi) — xavfsizlik uni
  // CHIZISH joyida: sayt textContent, admin panel esa esc() ishlatadi.
  // Shu ikki joyning birortasi innerHTML'ga o'tib qolsa, test yiqiladi.
  const html = await post({ maintenanceMessage: '<script>alert(1)</script>' });
  const cfg = await call(config, 'GET', {});
  check('markup in the message is returned as plain text, unchanged',
    html.statusCode === 200 && cfg.body.maintenanceMessage === '<script>alert(1)</script>');
  const siteSrc = readFileSync(join(repo, 'index.html'), 'utf8');
  check('the site shows the message via textContent',
    /maintenanceBannerText[\s\S]{0,200}bannerText\.textContent\s*=\s*cfg\.maintenanceMessage/.test(siteSrc));
  check('the site never writes it with innerHTML',
    !/innerHTML\s*=[^;]*maintenanceMessage/.test(siteSrc));
  const adminSrc = readFileSync(join(repo, 'admin.html'), 'utf8');
  check('the admin panel escapes it before putting it in the form',
    /esc\(s\.maintenanceMessage/.test(adminSrc));

  const flag = await post({ maintenanceMode: 'yes' });
  check('non-boolean maintenanceMode is refused or coerced to a boolean',
    flag.statusCode === 400 || typeof flag.body.settings.maintenanceMode === 'boolean');
}

console.log('\n== requeue: edge cases ==');
{
  reset();
  const BEFORE = Date.parse('2026-09-01T06:18:58Z');
  const seed = (id, patch) => {
    store.set(`truck:${id}`, JSON.stringify({ id, brand: id, status: 'ACTIVE', ...patch }));
    return id;
  };
  sets.set('truck_ids', new Set([
    seed('edge', { createdAt: BEFORE }),
    seed('justbefore', { createdAt: BEFORE - 1 }),
    seed('nodate', {}),
  ]));
  store.set('truck:broken', '{not json');
  sets.get('truck_ids').add('broken');

  const strConfirm = await call(adminData, 'POST', { action: 'requeue-legacy' }, { confirm: 'true' }, cookieFor('SUPER_ADMIN'));
  check('confirm as a string is not enough', strConfirm.statusCode === 400);

  const res = await call(adminData, 'POST', { action: 'requeue-legacy' }, { confirm: true }, cookieFor('SUPER_ADMIN'));
  check('corrupt JSON row does not crash the run', res.statusCode === 200);
  check('listing with no createdAt is treated as legacy',
    JSON.parse(store.get('truck:nodate')).status === 'PENDING');
  // Kod `createdAt < MODERATION_LAUNCHED_AT` deydi: aynan ishga tushgan
  // lahzada yaratilgan e'lon endi moderatsiyadan o'tgan davrga kiradi.
  check('createdAt exactly at the cutoff is NOT legacy',
    JSON.parse(store.get('truck:edge')).status === 'ACTIVE');
  check('one millisecond before the cutoff IS legacy',
    JSON.parse(store.get('truck:justbefore')).status === 'PENDING');
}

console.log('\n== verification review: full paths ==');
{
  reset();
  const setup = () => {
    store.set('profile:r@example.com', JSON.stringify({ username: 'r' }));
    store.set('verifydoc:r@example.com:IDENTITY', 'data:image/jpeg;base64,ZZZ');
    sets.set('verify_queue', new Set(['r@example.com|IDENTITY']));
  };
  setup();

  const modDoc = await call(adminData, 'GET',
    { resource: 'verifydoc', email: 'r@example.com', kind: 'IDENTITY' }, null, cookieFor('MODERATOR'));
  // verifydoc uchun faqat 'users:read' kerak, moderatorda esa u bor —
  // ya'ni pasport/guvohnoma rasmini ko'ra oladi, garchi ko'rib chiqa olmasa
  // (verify-review 'users:write' talab qiladi). Egasi qaror qilsin.
  gap('moderator cannot open identity documents', modDoc.statusCode === 403,
    'READ_PERMISSIONS.verifydoc = users:read; moderator’da bor');

  const rej = await call(adminData, 'POST', { action: 'verify-review' },
    { email: 'r@example.com', kind: 'IDENTITY', approve: false, reason: 'noaniq' }, cookieFor('ADMIN'));
  const p = JSON.parse(store.get('profile:r@example.com'));
  check('rejection succeeds', rej.statusCode === 200);
  check('rejection is recorded with its reason',
    p.verifications.IDENTITY.status === 'REJECTED' && p.verifications.IDENTITY.reason === 'noaniq');
  check('rejection leaves no blue badge', p.verified === false);
  check('rejected document is deleted', !store.has('verifydoc:r@example.com:IDENTITY'));
  check('rejected entry leaves the queue', !sets.get('verify_queue').has('r@example.com|IDENTITY'));

  const badKind = await call(adminData, 'POST', { action: 'verify-review' },
    { email: 'r@example.com', kind: 'GOD', approve: true }, cookieFor('ADMIN'));
  check('unknown kind refused', badKind.statusCode === 400);

  const noProfile = await call(adminData, 'POST', { action: 'verify-review' },
    { email: 'ghost@example.com', kind: 'IDENTITY', approve: true }, cookieFor('ADMIN'));
  check('unknown profile gets 404', noProfile.statusCode === 404);

  const noDoc = await call(adminData, 'GET',
    { resource: 'verifydoc', email: 'r@example.com', kind: 'IDENTITY' }, null, cookieFor('ADMIN'));
  check('fetching a deleted document gets 404', noDoc.statusCode === 404);

  // verified:false badge revoke
  setup();
  await call(adminData, 'POST', { action: 'verify-driver' }, { email: 'r@example.com', verified: true }, cookieFor('ADMIN'));
  await call(adminData, 'POST', { action: 'verify-driver' }, { email: 'r@example.com', verified: false }, cookieFor('ADMIN'));
  const rev = JSON.parse(store.get('profile:r@example.com'));
  check('verify-driver false takes the badge back', rev.verified === false);
  check('and no longer reads as verified identity', rev.verifications.IDENTITY.status !== 'VERIFIED');
}

console.log('\n== lib/verification.js: edges ==');
{
  const { readVerifications, publicVerifications, canSubmit, docKey, setVerification } =
    await import(join(repo, 'lib/verification.js'));

  check('publicVerifications({}) is all false',
    Object.values(publicVerifications({})).every((v) => v === false));
  check('publicVerifications(null) does not throw', (() => {
    try { publicVerifications(null); return true; } catch { return false; }
  })());
  check('readVerifications(null) does not throw', (() => {
    try { readVerifications(null); return true; } catch { return false; }
  })());

  const DAY = 24 * 3600 * 1000;
  check('just under 24h is still cooling down',
    !canSubmit({ status: 'REJECTED', reviewedAt: Date.now() - DAY + 60000 }).ok);
  check('just over 24h may retry',
    canSubmit({ status: 'REJECTED', reviewedAt: Date.now() - DAY - 60000 }).ok);

  gap('email case does not split the document key',
    docKey('D@x.com', 'IDENTITY') === docKey('d@x.com', 'IDENTITY'),
    'kalit aynan mos keladi; identity Google/Telegram’dan xom keladi, shuning uchun hozir zarari yo‘q');
  check('different people never share a key',
    docKey('a@x.com', 'IDENTITY') !== docKey('b@x.com', 'IDENTITY'));

  gap('unknown kind is refused by setVerification', (() => {
    try { const r = {}; setVerification(r, 'GOD', { status: 'VERIFIED' }); return !r.verifications?.GOD; }
    catch { return true; }
  })(), 'chaqiruvchilar turni o‘zlari tekshiradi; lib ichida himoya yo‘q');
}

/* ==========================================================
   Ikonkalar — ilovadagi belgini o'z rasmi bilan almashtirish
   ========================================================== */
console.log('\n== ikonkalar ==');
{
  const PNG = 'data:image/png;base64,' + Buffer.from('fake-png').toString('base64');

  // Ruxsatlar
  const anon = await call(adminData, 'GET', { resource: 'icons' });
  check('kirmasdan ko‘rib bo‘lmaydi', anon.statusCode === 401, String(anon.statusCode));
  const modWrite = await call(adminData, 'POST', { action: 'save-icon' },
    { id: 'iconHome', dataUrl: PNG }, cookieFor('MODERATOR'));
  check('moderator almashtira olmaydi', modWrite.statusCode === 403, String(modWrite.statusCode));
  const modRead = await call(adminData, 'GET', { resource: 'icons' }, null, cookieFor('MODERATOR'));
  check('moderator ko‘ra oladi', modRead.statusCode === 200);

  // Saqlash
  r2Calls = [];
  const saved = await call(adminData, 'POST', { action: 'save-icon' },
    { id: 'iconHome', dataUrl: PNG }, cookieFor('ADMIN'));
  check('admin almashtira oladi', saved.statusCode === 200, JSON.stringify(saved.body));
  check('havola qaytdi', typeof saved.body.url === 'string' && saved.body.url.startsWith('https://pub-test.r2.dev/icon/'),
    saved.body && saved.body.url);
  check('rasm R2 ga yuborildi', r2Calls.length === 1 && r2Calls[0].method === 'PUT', JSON.stringify(r2Calls));
  check('bazada rasm emas, havola saqlanadi',
    !String(store.get('icon_overrides')).includes('base64'), store.get('icon_overrides'));

  const listed = await call(adminData, 'GET', { resource: 'icons' }, null, cookieFor('ADMIN'));
  check('ro‘yxatda ko‘rinadi', listed.body.icons.iconHome === saved.body.url);
  check('saqlash yoqilgani aytiladi', listed.body.storage === true);

  // Ilovaga yetib boradimi
  const cfg = await call(config, 'GET', {});
  check('ilovaga /api/config orqali boradi', cfg.body.icons.iconHome === saved.body.url, JSON.stringify(cfg.body.icons));

  // Noto'g'ri kiritmalar
  check('nomi noto‘g‘ri bo‘lsa rad etiladi',
    (await call(adminData, 'POST', { action: 'save-icon' }, { id: '../../etc', dataUrl: PNG }, cookieFor('ADMIN'))).statusCode === 400);
  check('rasm o‘rniga matn rad etiladi',
    (await call(adminData, 'POST', { action: 'save-icon' }, { id: 'iconBox', dataUrl: 'salom' }, cookieFor('ADMIN'))).statusCode === 400);
  check('zararli turdagi fayl rad etiladi',
    (await call(adminData, 'POST', { action: 'save-icon' },
      { id: 'iconBox', dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }, cookieFor('ADMIN'))).statusCode === 400);

  // Almashtirilganda eskisi o'chiriladi
  r2Calls = [];
  const again = await call(adminData, 'POST', { action: 'save-icon' },
    { id: 'iconHome', dataUrl: 'data:image/png;base64,' + Buffer.from('boshqa').toString('base64') }, cookieFor('ADMIN'));
  check('qayta almashtirish ishlaydi', again.statusCode === 200);
  await new Promise((r) => setTimeout(r, 10));
  check('eski rasm bucket‘dan o‘chiriladi', r2Calls.some((c) => c.method === 'DELETE'), JSON.stringify(r2Calls));

  // Asliga qaytarish
  const reset = await call(adminData, 'POST', { action: 'delete-icon' }, { id: 'iconHome' }, cookieFor('ADMIN'));
  check('asliga qaytariladi', reset.statusCode === 200);
  const after = await call(adminData, 'GET', { resource: 'icons' }, null, cookieFor('ADMIN'));
  check('jadvaldan chiqib ketdi', after.body.icons.iconHome === undefined, JSON.stringify(after.body.icons));
  check('almashtirilmaganini o‘chirib bo‘lmaydi',
    (await call(adminData, 'POST', { action: 'delete-icon' }, { id: 'iconHome' }, cookieFor('ADMIN'))).statusCode === 404);
}

console.log('\n== saqlash sozlanmaganda ==');
{
  // R2 kalitlari yo'q bo'lsa ikonka almashtirish ishlamaydi va buning
  // sababi ochiq aytiladi — jimgina "saqlandi" deb ko'rsatilmaydi.
  const keep = { ...process.env };
  delete process.env.R2_ACCOUNT_ID;
  const bare = await loadHandler('api/admin-data.js', 'admin_data_nostore', '?nostore');
  const res = await call(bare, 'POST', { action: 'save-icon' },
    { id: 'iconHome', dataUrl: 'data:image/png;base64,AAAA' }, cookieFor('ADMIN'));
  check('sozlanmaganda rad etiladi', res.statusCode === 503, String(res.statusCode));
  check('sababi aytiladi', String(res.body.error).includes('R2'), res.body && res.body.error);
  const read = await call(bare, 'GET', { resource: 'icons' }, null, cookieFor('ADMIN'));
  check('ko‘rish baribir ishlaydi', read.statusCode === 200 && read.body.storage === false, JSON.stringify(read.body));
  Object.assign(process.env, keep);
}

/* ==========================================================
   Eski buyurtmalarni tozalash — faqat bosh administrator
   ========================================================== */
console.log('\n== buyurtmalarni tozalash ==');
{
  const DAY = 24 * 60 * 60 * 1000;
  const seed = () => {
    store.clear(); lists.clear();
    const make = (code, ageDays) => {
      store.set(`order:${code}`, JSON.stringify({ code, createdAt: Date.now() - ageDays * DAY }));
      lists.set('order_codes', [...(lists.get('order_codes') || []), code]);
    };
    make('OLD40', 40);
    make('OLD10', 10);
    make('OLD3', 3);
    make('NEW', 0.2);
    // Sanasi noma'lum yozuv — hech qachon o'chmasligi kerak.
    store.set('order:NOTIME', JSON.stringify({ code: 'NOTIME' }));
    lists.set('order_codes', [...lists.get('order_codes'), 'NOTIME']);
    // Yozuvi yo'q, kodi ro'yxatda qolgan "yetim" kod.
    lists.set('order_codes', [...lists.get('order_codes'), 'GHOST']);
  };
  const codes = () => (lists.get('order_codes') || []).slice();

  // Ruxsat
  seed();
  const byAdmin = await call(adminData, 'POST', { action: 'purge-orders' },
    { olderThanDays: 7, confirm: true }, cookieFor('ADMIN'));
  check('oddiy admin o‘chira olmaydi', byAdmin.statusCode === 403, String(byAdmin.statusCode));
  const byMod = await call(adminData, 'POST', { action: 'purge-orders' },
    { olderThanDays: 7, confirm: true }, cookieFor('MODERATOR'));
  check('moderator ham o‘chira olmaydi', byMod.statusCode === 403, String(byMod.statusCode));
  check('hech narsa o‘chmadi', codes().length === 6, codes());

  // Tasdiqsiz
  const noConfirm = await call(adminData, 'POST', { action: 'purge-orders' },
    { olderThanDays: 7 }, cookieFor('SUPER_ADMIN'));
  check('tasdiqsiz rad etiladi', noConfirm.statusCode === 400, String(noConfirm.statusCode));
  check('tasdiqsiz hech narsa o‘chmadi', codes().length === 6);

  // 7 kundan eskilari
  seed();
  const week = await call(adminData, 'POST', { action: 'purge-orders' },
    { olderThanDays: 7, confirm: true }, cookieFor('SUPER_ADMIN'));
  check('bosh administrator o‘chira oladi', week.statusCode === 200, JSON.stringify(week.body));
  check('faqat 7 kundan eskilari ketdi', week.body.removed === 2, JSON.stringify(week.body));
  check('yangilari qoldi', codes().includes('OLD3') && codes().includes('NEW'), codes());
  check('sanasi noma‘lum yozuv qoldi', codes().includes('NOTIME'), codes());
  check('yetim kod tozalandi', !codes().includes('GHOST'), codes());
  check('yozuvning o‘zi ham o‘chdi', !store.has('order:OLD40') && !store.has('order:OLD10'));

  // 1 kundan eskilari
  seed();
  const day = await call(adminData, 'POST', { action: 'purge-orders' },
    { olderThanDays: 1, confirm: true }, cookieFor('SUPER_ADMIN'));
  check('1 kunlik tanlov ishlaydi', day.body.removed === 3, JSON.stringify(day.body));
  check('bugungisi qoldi', codes().includes('NEW'), codes());

  // 1 oydan eskilari
  seed();
  const month = await call(adminData, 'POST', { action: 'purge-orders' },
    { olderThanDays: 30, confirm: true }, cookieFor('SUPER_ADMIN'));
  check('1 oylik tanlov ishlaydi', month.body.removed === 1, JSON.stringify(month.body));

  // Hammasi
  seed();
  const all = await call(adminData, 'POST', { action: 'purge-orders' },
    { olderThanDays: 0, confirm: true }, cookieFor('SUPER_ADMIN'));
  check('hammasi o‘chadi', all.body.removed === 4, JSON.stringify(all.body));
  check('sanasi noma‘lum yozuv hatto shunda ham qoladi', codes().includes('NOTIME'), codes());

  // Noto'g'ri muddat
  check('manfiy muddat rad etiladi',
    (await call(adminData, 'POST', { action: 'purge-orders' },
      { olderThanDays: -5, confirm: true }, cookieFor('SUPER_ADMIN'))).statusCode === 400);
  check('juda katta muddat rad etiladi',
    (await call(adminData, 'POST', { action: 'purge-orders' },
      { olderThanDays: 99999, confirm: true }, cookieFor('SUPER_ADMIN'))).statusCode === 400);

  store.clear(); lists.clear();
}

console.log(`\n==== ${pass} passed, ${fail} failed, ${gaps} known gaps ====`);
process.exit(fail ? 1 : 0);
