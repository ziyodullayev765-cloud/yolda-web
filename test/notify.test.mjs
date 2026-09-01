/**
 * Unit tests for Telegram notifications (lib/notify.js) and the price
 * advisor (api/order.js ?action=price-stats).
 *
 * Run with:  npm test
 *
 * Same shape as the other suites: lib/kv.js is swapped for an in-memory
 * mock and global.fetch is replaced with a recorder, so no network call
 * ever leaves the test.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const work = mkdtempSync(join(tmpdir(), 'yolda-notify-test-'));

const store = new Map();
const sets = new Map();
const lists = new Map();
globalThis.__store = store;
globalThis.__sets = sets;
globalThis.__lists = lists;

writeFileSync(join(work, 'kvmock.mjs'), `
export const kvConfigured = true;
const store = globalThis.__store, sets = globalThis.__sets, lists = globalThis.__lists;
export const kvGet = async (k) => store.has(k) ? store.get(k) : null;
export const kvSet = async (k, v) => { store.set(k, v); return true; };
export const kvDel = async (k) => { store.delete(k); return true; };
export const kvSadd = async (k, m) => { if(!sets.has(k)) sets.set(k, new Set()); sets.get(k).add(m); return true; };
export const kvSrem = async (k, m) => { if(sets.has(k)) sets.get(k).delete(m); return true; };
export const kvSmembers = async (k) => sets.has(k) ? [...sets.get(k)] : [];
export const kvSismember = async (k, m) => sets.has(k) && sets.get(k).has(m);
export const kvPush = async (k, v) => { if(!lists.has(k)) lists.set(k, []); lists.get(k).unshift(v); return true; };
export const kvRange = async (k) => lists.has(k) ? lists.get(k) : [];
export const kvKeys = async () => [];
`);

// Same test double as test/trucks.test.mjs: the credential string IS the
// identity, so "owner@example.com" vs "someone@else.com" exercises the
// real ownership checks without a network round trip to Google.
writeFileSync(join(work, 'identitymock.mjs'), `
export const resolveEmail = async ({ googleIdToken, telegramInitData } = {}) =>
  googleIdToken || telegramInitData || null;
export const resolveIdentity = async (creds) => {
  const identity = await resolveEmail(creds);
  return identity ? { identity, method: 'google' } : null;
};
export const tgIdentity = (id) => 'tg:' + id;
// api/profile.js also imports the linking helpers; they are not under
// test here, so stubs are enough to satisfy the import.
export const createTelegramLinkCode = async () => ({ error: 'not under test' });
export const redeemTelegramLinkCode = async () => ({ error: 'not under test' });
`);

/**
 * Copies a module into a temp dir with lib/kv.js and lib/identity.js
 * swapped for mocks. Every other relative import is rewritten to an
 * absolute repo path, since the copy no longer sits next to its siblings.
 */
const load = async (relPath, name) => {
  const kvMock = JSON.stringify(join(work, 'kvmock.mjs'));
  const src = readFileSync(join(repo, relPath), 'utf8')
    .replaceAll("'./kv.js'", kvMock)
    .replaceAll("'../lib/kv.js'", kvMock)
    .replaceAll("'../lib/identity.js'", JSON.stringify(join(work, 'identitymock.mjs')))
    .replaceAll("'../lib/notify.js'", JSON.stringify(join(work, 'notify.mjs')))
    .replace(/'\.\.\/lib\/([\w.]+)'/g, (_, f) => JSON.stringify(join(repo, 'lib', f)))
    .replace(/'\.\/([\w.]+\.js)'/g, (_, f) => JSON.stringify(join(repo, 'lib', f)));
  const out = join(work, `${name}.mjs`);
  writeFileSync(out, src);
  return import(out);
};

const notify = await load('lib/notify.js', 'notify');

/* --- fetch recorder: every Telegram call lands here, none go out --- */
let sentMessages = [];
let nextResponse = { ok: true, status: 200, body: { ok: true } };
globalThis.fetch = async (url, init) => {
  sentMessages.push({ url, body: JSON.parse(init.body) });
  return {
    status: nextResponse.status,
    json: async () => nextResponse.body,
  };
};
const resetFetch = () => {
  sentMessages = [];
  nextResponse = { ok: true, status: 200, body: { ok: true } };
};

let pass = 0, fail = 0;
const check = (label, ok) => {
  if (ok) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
};

/* ---------------------------------------------------------- */
console.log('\n== who can be reached ==');
{
  resetFetch();
  const sent = await notify.notifyUser('tg:555', { text: 'salom' });
  check('a tg: identity is messaged directly', sent === true && sentMessages.length === 1);
  check('the chat id comes from the identity', sentMessages[0].body.chat_id === '555');

  resetFetch();
  const none = await notify.notifyUser('nobody@example.com', { text: 'salom' });
  check('an unlinked email is skipped silently', none === false && sentMessages.length === 0);

  resetFetch();
  store.set('tgChat:linked@example.com', '777');
  const linked = await notify.notifyUser('linked@example.com', { text: 'salom' });
  check('a linked email resolves through the reverse index',
    linked === true && sentMessages[0].body.chat_id === '777');

  resetFetch();
  check('no identity, no call', (await notify.notifyUser('', { text: 'x' })) === false && !sentMessages.length);
  check('no text, no call', (await notify.notifyUser('tg:1', {})) === false && !sentMessages.length);
}

console.log('\n== per-category preferences ==');
{
  resetFetch();
  store.set('profile:tg:900', JSON.stringify({ username: 'a', notify: { chat: false } }));
  check('a switched-off category is not sent',
    (await notify.notifyUser('tg:900', { text: 'x', category: 'chat' })) === false);
  resetFetch();
  check('other categories still go out',
    (await notify.notifyUser('tg:900', { text: 'x', category: 'orders' })) === true);
  resetFetch();
  store.set('profile:tg:901', JSON.stringify({ username: 'b' }));
  check('no preference set means enabled',
    (await notify.notifyUser('tg:901', { text: 'x', category: 'chat' })) === true);
  resetFetch();
  store.set('profile:tg:902', 'not json at all');
  check('a corrupt profile does not silence notifications',
    (await notify.notifyUser('tg:902', { text: 'x', category: 'chat' })) === true);
}

console.log('\n== failure is never the caller\'s problem ==');
{
  resetFetch();
  nextResponse = { status: 403, body: { ok: false, description: 'bot was blocked by the user' } };
  store.set('tgChat:blocked@example.com', '888');
  const blocked = await notify.notifyUser('blocked@example.com', { text: 'x' });
  check('a blocked chat reports false rather than throwing', blocked === false);
  check('a blocked chat is dropped from the index', !store.has('tgChat:blocked@example.com'));

  resetFetch();
  nextResponse = { status: 500, body: { ok: false, description: 'server error' } };
  check('a Telegram outage returns false, not an exception',
    (await notify.notifyUser('tg:1', { text: 'x' })) === false);

  resetFetch();
  globalThis.fetch = async () => { throw new Error('network down'); };
  check('a thrown network error is swallowed',
    (await notify.notifyUser('tg:1', { text: 'x' })) === false);
  globalThis.fetch = async (url, init) => {
    sentMessages.push({ url, body: JSON.parse(init.body) });
    return { status: nextResponse.status, json: async () => nextResponse.body };
  };
}

console.log('\n== HTML escaping ==');
{
  check('angle brackets are escaped', notify.esc('<b>x</b>') === '&lt;b&gt;x&lt;/b&gt;');
  check('ampersands are escaped', notify.esc('a & b') === 'a &amp; b');
  check('null becomes empty', notify.esc(null) === '');
}

/* ---------------------------------------------------------- */
console.log('\n== price advisor ==');
const orderMod = await load('api/order.js', 'order_under_test');
const orderHandler = orderMod.default;

function mkRes() {
  const r = { statusCode: 0, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
}
const priceCall = async (query) => {
  const res = mkRes();
  await orderHandler({ method: 'GET', query: { action: 'price-stats', ...query }, headers: {} }, res);
  return res;
};

{
  store.clear(); lists.clear();
  const seed = (code, fromCity, toCity, weightKg, amount) => {
    store.set(`order:${code}`, JSON.stringify({ code, fromCity, toCity, weightKg, amount }));
    if (!lists.has('order_codes')) lists.set('order_codes', []);
    lists.get('order_codes').push(code);
  };
  // Six orders on one route, all at exactly 100 000 so'm per tonne.
  for (let i = 0; i < 6; i++) seed(`A${i}`, 'Toshkent', 'Buxoro', 10000, 1000000);
  // Only three on another — below the threshold.
  for (let i = 0; i < 3; i++) seed(`B${i}`, 'Nukus', 'Termiz', 5000, 700000);
  // Records that must not skew anything.
  seed('BAD1', 'Toshkent', 'Buxoro', 0, 500000);        // no weight
  seed('BAD2', 'Toshkent', 'Buxoro', 10000, 0);         // no price
  store.set('order:BROKEN', '{{{not json');
  lists.get('order_codes').push('BROKEN');

  const missing = await priceCall({ fromCity: 'Toshkent' });
  check('a half-specified route is rejected', missing.statusCode === 400);

  const thin = await priceCall({ fromCity: 'Nukus', toCity: 'Termiz', weightKg: 5000 });
  check('too few orders reports "not enough" instead of guessing',
    thin.statusCode === 200 && thin.body.enough === false);
  check('the threshold is stated, not hidden', thin.body.minSample === 5);

  const unknown = await priceCall({ fromCity: 'Andijon', toCity: 'Navoiy', weightKg: 5000 });
  check('an unseen route reports "not enough"', unknown.body.enough === false);

  const good = await priceCall({ fromCity: 'Toshkent', toCity: 'Buxoro', weightKg: 10000 });
  check('a well-covered route returns a range', good.body.enough === true);
  check('broken and zero rows are excluded from the count', good.body.count === 6, good.body.count);
  check('per-tonne figures are computed from real amounts', good.body.perTon.mid === 100000, good.body.perTon.mid);
  check('the estimate scales to the requested weight', good.body.estimate.mid === 1000000, good.body.estimate.mid);
  check('low never exceeds high', good.body.estimate.low <= good.body.estimate.high);

  const halfLoad = await priceCall({ fromCity: 'Toshkent', toCity: 'Buxoro', weightKg: 5000 });
  check('half the weight gives half the estimate', halfLoad.body.estimate.mid === 500000);

  const noWeight = await priceCall({ fromCity: 'Toshkent', toCity: 'Buxoro' });
  check('without a weight only the per-tonne figures come back',
    noWeight.body.enough === true && noWeight.body.estimate === undefined);

  const reversed = await priceCall({ fromCity: 'Buxoro', toCity: 'Toshkent', weightKg: 10000 });
  check('the opposite direction is a different route', reversed.body.enough === false);

  check('the computed table is cached for reuse', store.has('price_stats'));
  check('no personal data leaks into the response',
    JSON.stringify(good.body).indexOf('Toshkent') === -1
    && !('orders' in good.body) && !('phone' in good.body));
}

/* ---------------------------------------------------------- */
console.log('\n== cancel / release ==');
{
  store.clear(); lists.clear(); resetFetch();

  const seedOrder = (code, patch) => {
    if (!lists.has('order_codes')) lists.set('order_codes', []);
    if (!lists.get('order_codes').includes(code)) lists.get('order_codes').push(code);
    store.set(`order:${code}`, JSON.stringify({
      code, ownerIdentity: 'owner@example.com', phone: '+998901112233',
      fromCity: 'Toshkent', toCity: 'Buxoro', weightKg: 5000, amount: 900000,
      status: 'DRIVER_FOUND', groupMessageId: 42,
      driver: { name: 'Haydovchi', telegramId: 777 },
      ...patch,
    }));
  };
  const post = async (action, body) => {
    const res = mkRes();
    await orderHandler({ method: 'POST', query: { action }, body, headers: {} }, res);
    return res;
  };
  // In this suite the credential IS the identity (no real Google/Telegram
  // verification runs), so "owner@example.com" proves ownership.
  const asOwner = (extra) => ({ googleIdToken: 'owner@example.com', ...extra });

  const anon = await post('cancel', { code: 'C1' });
  check('cancelling without signing in is refused', anon.statusCode === 401);

  seedOrder('C1');
  const stranger = await post('cancel', { googleIdToken: 'someone@else.com', code: 'C1' });
  check('a non-owner cannot cancel', stranger.statusCode === 404);
  check('and the order is untouched', JSON.parse(store.get('order:C1')).status === 'DRIVER_FOUND');

  const missing = await post('cancel', asOwner({ code: 'NOPE' }));
  check('an unknown code is a 404', missing.statusCode === 404);

  seedOrder('C2', { status: 'DELIVERED' });
  const late = await post('cancel', asOwner({ code: 'C2' }));
  check('a delivered order can no longer be cancelled', late.statusCode === 409);

  seedOrder('C3');
  resetFetch();
  const cancelled = await post('cancel', asOwner({ code: 'C3', reason: 'Yuk kerak emas' }));
  const toDriver = sentMessages.filter((m) => m.body.chat_id === '777');
  check('the driver is told the load is gone', toDriver.length === 1);
  check('and told why', toDriver.length === 1 && toDriver[0].body.text.includes('Yuk kerak emas'));
  const c3 = JSON.parse(store.get('order:C3'));
  check('the owner can cancel', cancelled.statusCode === 200 && c3.status === 'CANCELLED');
  check('the reason is kept', c3.cancelReason === 'Yuk kerak emas');
  check('who cancelled it is recorded', c3.cancelledBy === 'OWNER' && c3.cancelledAt > 0);

  const twice = await post('cancel', asOwner({ code: 'C3' }));
  check('cancelling twice is refused', twice.statusCode === 409);

  seedOrder('R1');
  resetFetch();
  const released = await post('release', asOwner({ code: 'R1', reason: 'Javob bermayapti' }));
  check('the released driver is notified',
    sentMessages.some((m) => m.body.chat_id === '777' && m.body.text.includes('Javob bermayapti')));
  const r1 = JSON.parse(store.get('order:R1'));
  check('releasing returns the load to the pool', released.statusCode === 200 && r1.status === 'NEW');
  check('the driver is cleared', r1.driver === null);
  check('the release is recorded with who and why',
    r1.releases.length === 1 && r1.releases[0].by === 'OWNER'
    && r1.releases[0].driverName === 'Haydovchi' && r1.releases[0].reason === 'Javob bermayapti');

  const nothingToRelease = await post('release', asOwner({ code: 'R1' }));
  check('a load with no driver cannot be released', nothingToRelease.statusCode === 409);

  seedOrder('R2', { status: 'ON_THE_WAY' });
  const midRoute = await post('release', asOwner({ code: 'R2' }));
  check('a driver already en route can still be released',
    midRoute.statusCode === 200 && JSON.parse(store.get('order:R2')).status === 'NEW');

  // A released load must be claimable again — that is the whole point.
  seedOrder('R3');
  await post('release', asOwner({ code: 'R3' }));
  const listRes = mkRes();
  await orderHandler({ method: 'GET', query: { action: 'list' }, headers: {} }, listRes);
  const publicCodes = (listRes.body.loads || []).map((o) => o.code);
  check('a released load is back in the public list', publicCodes.includes('R3'), publicCodes.join(','));
  check('a cancelled load is not in the public list', !publicCodes.includes('C3'));
  check('a load with a driver is not in the public list', !publicCodes.includes('C1'));
}

/* ---------------------------------------------------------- */
console.log('\n== saved searches ==');
const profileHandler = (await load('api/profile.js', 'profile_under_test')).default;
{
  store.clear(); sets.clear(); lists.clear(); resetFetch();
  const call = async (action, body) => {
    const res = mkRes();
    await profileHandler({ method: 'POST', query: { action }, body, headers: {} }, res);
    return res;
  };
  const driver = { googleIdToken: 'driver@example.com' };

  const anon = await call('save-search', { search: { fromCity: 'Toshkent' } });
  check('saving without signing in is refused', anon.statusCode === 401);

  const empty = await call('searches', driver);
  check('a new user has no saved searches', empty.body.searches.length === 0);

  const first = await call('save-search', { ...driver, search: { fromCity: 'Toshkent', toCity: 'Buxoro' } });
  check('a search can be saved', first.statusCode === 200 && first.body.searches.length === 1);
  check('it gets an id', Boolean(first.body.searches[0].id));

  const dupe = await call('save-search', { ...driver, search: { fromCity: 'Toshkent', toCity: 'Buxoro' } });
  check('the same search cannot be saved twice', dupe.statusCode === 409);

  const badRange = await call('save-search', { ...driver, search: { minWeight: 9000, maxWeight: 100 } });
  check('a backwards weight range is rejected', badRange.statusCode === 400);

  for (let i = 0; i < 4; i++) {
    await call('save-search', { ...driver, search: { fromCity: 'Toshkent', toCity: `City${i}` } });
  }
  const overflow = await call('save-search', { ...driver, search: { fromCity: 'Nukus' } });
  check('the number of saved searches is capped', overflow.statusCode === 409);

  check('the city index knows who is waiting',
    (await (await import(join(work, 'kvmock.mjs'))).kvSmembers('search_cities:Toshkent'))
      .includes('driver@example.com'));

  const list = await call('searches', driver);
  const firstId = list.body.searches[0].id;
  const gone = await call('delete-search', { ...driver, id: firstId });
  check('a search can be deleted', gone.statusCode === 200 && gone.body.searches.length === 4);
  const missing = await call('delete-search', { ...driver, id: 'nope' });
  check('deleting an unknown search is a 404', missing.statusCode === 404);

  // Another user's searches must be entirely separate.
  const other = await call('searches', { googleIdToken: 'other@example.com' });
  check('searches are per-user', other.body.searches.length === 0);
}

console.log('\n== matching rules ==');
{
  const { matchesSearch } = await import(join(repo, 'lib/savedSearch.js'));
  const load1 = { fromCity: 'Toshkent', toCity: 'Buxoro', weightKg: 5000, cargoType: 'MEBEL', truckType: 'FURGON' };
  check('an empty search matches everything', matchesSearch(load1, {}));
  check('the route must match', !matchesSearch(load1, { fromCity: 'Nukus' }));
  check('a matching route passes', matchesSearch(load1, { fromCity: 'Toshkent', toCity: 'Buxoro' }));
  check('half a route still filters', !matchesSearch(load1, { toCity: 'Nukus' }));
  check('weight below the minimum is excluded', !matchesSearch(load1, { minWeight: 9000 }));
  check('weight above the maximum is excluded', !matchesSearch(load1, { maxWeight: 1000 }));
  check('weight inside the range passes', matchesSearch(load1, { minWeight: 1000, maxWeight: 9000 }));
  check('cargo type is honoured', !matchesSearch(load1, { cargoType: 'OTHER' }));
  check('truck type is honoured', !matchesSearch(load1, { truckType: 'REF' }));
  check('a missing order never matches', !matchesSearch(null, {}));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
