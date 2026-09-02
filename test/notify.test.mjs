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
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail === undefined ? '' : '  → ' + detail)); }
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

/* ---------------------------------------------------------- */
console.log('\n== offers ==');
{
  store.clear(); sets.clear(); lists.clear(); resetFetch();

  const seedOrder = (code, patch) => {
    if (!lists.has('order_codes')) lists.set('order_codes', []);
    if (!lists.get('order_codes').includes(code)) lists.get('order_codes').push(code);
    store.set(`order:${code}`, JSON.stringify({
      code, ownerIdentity: 'owner@example.com', phone: '+998901112233',
      fromCity: 'Toshkent', toCity: 'Buxoro', weightKg: 5000, amount: 900000,
      status: 'NEW', groupMessageId: 42, ...patch,
    }));
  };
  const post = async (action, body) => {
    const res = mkRes();
    await orderHandler({ method: 'POST', query: { action }, body, headers: {} }, res);
    return res;
  };
  const get = async (query) => {
    const res = mkRes();
    await orderHandler({ method: 'GET', query, headers: {} }, res);
    return res;
  };
  const asDriver = (who, extra) => ({ googleIdToken: who, ...extra });
  const owner = { googleIdToken: 'owner@example.com' };

  store.set('profile:driver1@example.com', JSON.stringify({
    username: 'driver1', displayName: 'Aziz', verified: true,
    ratingCount: 4, ratingSum: 19, city: 'Toshkent', phone: '+998900000001',
  }));
  store.set('profile:driver2@example.com', JSON.stringify({
    username: 'driver2', displayName: 'Bobur', ratingCount: 0, ratingSum: 0,
  }));

  seedOrder('OF1');
  const anon = await post('offer', { code: 'OF1', price: 800000 });
  check('an offer needs a signed-in driver', anon.statusCode === 401);

  const own = await post('offer', { ...owner, code: 'OF1', price: 800000 });
  check('you cannot bid on your own load', own.statusCode === 400);

  const noPrice = await post('offer', asDriver('driver1@example.com', { code: 'OF1' }));
  check('an offer without a price is refused', noPrice.statusCode === 400);

  const first = await post('offer', asDriver('driver1@example.com',
    { code: 'OF1', price: 850000, eta: 'ertaga ertalab', note: 'Furam bo\'sh' }));
  check('a driver can send an offer', first.statusCode === 200);
  check('the driver profile is copied onto the offer',
    first.body.offer.driverName === 'Aziz' && first.body.offer.driverVerified === true);
  check('the rating rides along', first.body.offer.driverRatingCount === 4);
  check('it starts pending', first.body.offer.status === 'PENDING');

  const again = await post('offer', asDriver('driver1@example.com', { code: 'OF1', price: 800000 }));
  check('re-offering updates rather than duplicating',
    again.statusCode === 200 && again.body.updated === true);
  const afterUpdate = await get({ action: 'offers', code: 'OF1', ...owner });
  check('so the owner sees one offer, not two', afterUpdate.body.offers.length === 1);
  check('and it carries the new price', afterUpdate.body.offers[0].price === 800000);

  await post('offer', asDriver('driver2@example.com', { code: 'OF1', price: 950000 }));
  const bothSeen = await get({ action: 'offers', code: 'OF1', ...owner });
  check('the owner sees every offer', bothSeen.body.offers.length === 2 && bothSeen.body.isOwner === true);

  const driverView = await get({ action: 'offers', code: 'OF1', googleIdToken: 'driver1@example.com' });
  check('a driver sees only their own offer', driverView.body.offers.length === 1);
  check('and is not marked as the owner', driverView.body.isOwner === false);
  check('a rival price stays hidden',
    driverView.body.offers.every((o) => o.price !== 950000));

  // The public shape must never leak the driver's identity or phone.
  const shape = bothSeen.body.offers[0];
  check('offers never expose an identity or phone',
    !('driverIdentity' in shape) && !('driverPhone' in shape));

  const strangerAccept = await post('accept-offer',
    { googleIdToken: 'someone@else.com', id: shape.id });
  check('only the owner can accept', strangerAccept.statusCode === 404);

  const accepted = await post('accept-offer', { ...owner, id: shape.id });
  check('the owner can accept an offer', accepted.statusCode === 200);
  const order = JSON.parse(store.get('order:OF1'));
  check('accepting assigns the driver', order.status === 'DRIVER_FOUND' && order.driver.name === shape.driverName);
  check('the agreed price is recorded separately',
    order.agreedAmount === shape.price && order.amount === 900000);

  const others = bothSeen.body.offers.filter((o) => o.id !== shape.id);
  const rival = JSON.parse(store.get(`offer:${others[0].id}`));
  check('every other pending offer is auto-declined', rival.status === 'REJECTED');

  const twice = await post('accept-offer', { ...owner, id: shape.id });
  check('an offer cannot be accepted twice', twice.statusCode === 409);

  const lateOffer = await post('offer', asDriver('driver1@example.com', { code: 'OF1', price: 700000 }));
  check('a claimed load stops taking offers', lateOffer.statusCode === 409);

  // Reject + withdraw, on a fresh load.
  seedOrder('OF2');
  const r1 = await post('offer', asDriver('driver1@example.com', { code: 'OF2', price: 600000 }));
  const rejected = await post('reject-offer', { ...owner, id: r1.body.offer.id });
  check('the owner can decline an offer',
    rejected.statusCode === 200 && rejected.body.offer.status === 'REJECTED');
  check('declining leaves the load open', JSON.parse(store.get('order:OF2')).status === 'NEW');

  seedOrder('OF3');
  const w1 = await post('offer', asDriver('driver1@example.com', { code: 'OF3', price: 600000 }));
  const notMine = await post('withdraw-offer',
    { googleIdToken: 'driver2@example.com', id: w1.body.offer.id });
  check('a driver cannot withdraw someone else\'s offer', notMine.statusCode === 404);
  const withdrawn = await post('withdraw-offer',
    asDriver('driver1@example.com', { id: w1.body.offer.id }));
  check('a driver can withdraw their own offer',
    withdrawn.statusCode === 200 && withdrawn.body.offer.status === 'WITHDRAWN');
}

console.log('\n== home statistics ==');
{
  store.clear(); sets.clear(); lists.clear();
  const get = async (query) => {
    const res = mkRes();
    await orderHandler({ method: 'GET', query, headers: {} }, res);
    return res;
  };
  const seed = (code, status, from, to) => {
    if (!lists.has('order_codes')) lists.set('order_codes', []);
    lists.get('order_codes').push(code);
    store.set(`order:${code}`, JSON.stringify({ code, status, fromCity: from, toCity: to, weightKg: 1, amount: 1 }));
  };
  seed('S1', 'NEW', 'Toshkent', 'Buxoro');
  seed('S2', 'NEW', 'Toshkent', 'Nukus');
  seed('S3', 'DELIVERED', 'Buxoro', 'Nukus');
  seed('S4', 'CANCELLED', 'Toshkent', 'Buxoro');
  sets.set('profile_emails', new Set(['d1@x.com', 'd2@x.com', 'o1@x.com']));
  store.set('profile:d1@x.com', JSON.stringify({ role: 'DRIVER' }));
  store.set('profile:d2@x.com', JSON.stringify({ role: 'BOTH' }));
  store.set('profile:o1@x.com', JSON.stringify({ role: 'OWNER' }));

  const stats = await get({ action: 'stats' });
  check('only open loads count as active', stats.body.activeLoads === 2, stats.body.activeLoads);
  check('delivered loads are counted', stats.body.delivered === 1);
  check('drivers include BOTH but not OWNER', stats.body.drivers === 2, stats.body.drivers);
  check('cities are counted distinctly', stats.body.cities === 3, stats.body.cities);
  check('nothing is invented when a figure is zero',
    Object.values(stats.body).every((v) => typeof v === 'number'));
}

/* ---------------------------------------------------------- */
console.log('\n== seven-stage tracking ==');
{
  const { nextStatus, STATUS_FLOW } = await import(join(repo, 'lib/orderMessage.js'));
  check('the chain has six stages', STATUS_FLOW.length === 6);
  check('a claimed load heads for pickup next', nextStatus('DRIVER_FOUND') === 'PICKING_UP');
  check('loading comes before the road', nextStatus('PICKING_UP') === 'LOADED');
  check('the road comes before delivery', nextStatus('ON_THE_WAY') === 'DELIVERED');
  check('delivery is the end of the chain', nextStatus('DELIVERED') === null);
  check('a cancelled order is off the chain', nextStatus('CANCELLED') === null);
}

console.log('\n== the driver advances the load from the site ==');
{
  store.clear(); sets.clear(); lists.clear(); resetFetch();

  const seed = (code, patch) => store.set(`order:${code}`, JSON.stringify({
    code, ownerIdentity: 'owner@example.com', fromCity: 'Toshkent', toCity: 'Buxoro',
    weightKg: 5000, amount: 900000, status: 'DRIVER_FOUND', groupMessageId: 42,
    driver: { name: 'Aziz', identity: 'driver1@example.com' }, ...patch,
  }));
  const post = async (action, body) => {
    const res = mkRes();
    await orderHandler({ method: 'POST', query: { action }, body, headers: {} }, res);
    return res;
  };
  const statusOf = (code) => JSON.parse(store.get(`order:${code}`)).status;
  const driver = (extra) => ({ googleIdToken: 'driver1@example.com', ...extra });

  seed('AD1');
  check('advancing needs a signed-in user',
    (await post('advance', { code: 'AD1' })).statusCode === 401);
  check("a stranger cannot advance someone else's load",
    (await post('advance', { googleIdToken: 'nobody@example.com', code: 'AD1' })).statusCode === 403);
  check('the owner is not the driver either',
    (await post('advance', { googleIdToken: 'owner@example.com', code: 'AD1' })).statusCode === 403);
  check('an unknown code is not found',
    (await post('advance', driver({ code: 'NOPE' }))).statusCode === 404);

  const step1 = await post('advance', driver({ code: 'AD1' }));
  check('the driver moves one stage forward',
    step1.statusCode === 200 && step1.body.status === 'PICKING_UP');
  check('and the order record is what changed', statusOf('AD1') === 'PICKING_UP');
  check('the response names the stage after this one', step1.body.nextStatus === 'LOADED');

  await post('advance', driver({ code: 'AD1' }));
  check('loading is its own stage', statusOf('AD1') === 'LOADED');
  await post('advance', driver({ code: 'AD1' }));
  check('then the road', statusOf('AD1') === 'ON_THE_WAY');

  store.set('profile:driver1@example.com', JSON.stringify({ username: 'driver1', deliveredCount: 3 }));
  const last = await post('advance', driver({ code: 'AD1' }));
  check('and finally delivery', statusOf('AD1') === 'DELIVERED');
  check('no stage is offered past delivery', last.body.nextStatus === null);
  check('the delivered counter goes up once',
    JSON.parse(store.get('profile:driver1@example.com')).deliveredCount === 4);
  check('a delivered order cannot be advanced again',
    (await post('advance', driver({ code: 'AD1' }))).statusCode === 409);
  check('the counter did not move on the refused call',
    JSON.parse(store.get('profile:driver1@example.com')).deliveredCount === 4);

  const ownerNotes = (lists.get('notifs:owner@example.com') || []).map((s) => JSON.parse(s).title);
  check('the owner hears about every stage', ownerNotes.length === 4, ownerNotes.length);
  check('including the last one', ownerNotes[0] === 'Yetkazildi', ownerNotes[0]);

  // Bekor qilingan buyurtma zanjirdan chiqib ketgan — uni surib bo'lmaydi.
  seed('AD2', { status: 'CANCELLED' });
  check('a cancelled load has nowhere to advance to',
    (await post('advance', driver({ code: 'AD2' }))).statusCode === 409);
}

console.log('\n== a driver can find the load they were given ==');
{
  store.clear(); sets.clear(); lists.clear(); resetFetch();

  store.set('order:MY1', JSON.stringify({
    code: 'MY1', ownerIdentity: 'owner@example.com', fromCity: 'Toshkent', toCity: 'Buxoro',
    weightKg: 5000, status: 'LOADED', driver: { name: 'Aziz', identity: 'driver1@example.com' },
  }));
  store.set('order:MY2', JSON.stringify({
    code: 'MY2', ownerIdentity: 'owner@example.com', fromCity: 'Buxoro', toCity: 'Nukus',
    weightKg: 2000, status: 'NEW',
  }));
  store.set('offer:o1', JSON.stringify({
    id: 'o1', orderCode: 'MY1', driverIdentity: 'driver1@example.com', price: 800000, status: 'ACCEPTED',
  }));
  store.set('offer:o2', JSON.stringify({
    id: 'o2', orderCode: 'MY2', driverIdentity: 'driver1@example.com', price: 500000, status: 'PENDING',
  }));
  lists.set('driver_offers:driver1@example.com', ['o2', 'o1']);

  const get = async (query) => {
    const res = mkRes();
    await orderHandler({ method: 'GET', query, headers: {} }, res);
    return res;
  };

  check('the list needs a signed-in driver', (await get({ action: 'my-offers' })).statusCode === 401);

  const mine = await get({ action: 'my-offers', googleIdToken: 'driver1@example.com' });
  check('both offers come back', mine.body.offers.length === 2);
  const byCode = Object.fromEntries(mine.body.offers.map((o) => [o.orderCode, o]));
  check('the route rides along so the row can be read', byCode.MY1.fromCity === 'Toshkent');
  check('the assigned load knows it is being driven', byCode.MY1.isDriver === true);
  check('and carries the stage, not just the offer status', byCode.MY1.orderStatus === 'LOADED');
  check('with the next step named', byCode.MY1.nextStatus === 'ON_THE_WAY');
  check('a still-pending offer is not a trip', byCode.MY2.isDriver === false);
  check('and offers no stage button', byCode.MY2.nextStatus === null);
  check('no offer leaks a phone or identity',
    mine.body.offers.every((o) => !('driverIdentity' in o) && !('driverPhone' in o)));

  const other = await get({ action: 'my-offers', googleIdToken: 'driver2@example.com' });
  check('another driver sees none of it', other.body.offers.length === 0);
}

console.log('\n== the same chain runs from the Telegram button ==');
{
  store.clear(); sets.clear(); lists.clear(); resetFetch();
  const telegramMod = await load('api/telegram.js', 'telegram_under_test');
  const telegramHandler = telegramMod.default;

  store.set('order:TG1', JSON.stringify({
    code: 'TG1', ownerIdentity: 'owner@example.com', fromCity: 'Toshkent', toCity: 'Buxoro',
    weightKg: 5000, amount: 900000, cargoType: 'OTHER', phone: '+998901112233',
    status: 'DRIVER_FOUND', driver: { name: 'Aziz', telegramId: 555 },
  }));

  const tap = async (data, fromId) => {
    const res = mkRes();
    await telegramHandler({
      method: 'POST', headers: {},
      body: { callback_query: {
        id: 'q1', from: { id: fromId, first_name: 'Aziz' },
        message: { chat: { id: -100 }, message_id: 42, text: '' },
        data,
      } },
    }, res);
    return res;
  };
  const statusOf = (code) => JSON.parse(store.get(`order:${code}`)).status;

  await tap('next:TG1', 999);
  check('a driver who does not own the load changes nothing', statusOf('TG1') === 'DRIVER_FOUND');

  await tap('next:TG1', 555);
  check('the assigned driver advances one stage', statusOf('TG1') === 'PICKING_UP');
  const edits = sentMessages.filter((m) => m.url.endsWith('/editMessageText'));
  const button = edits[edits.length - 1].body.reply_markup.inline_keyboard[0][0].text;
  check('and the button now names the stage after that', button.includes('Yukladim'), button);

  await tap('next:TG1', 555);
  check('loading is a stage here too', statusOf('TG1') === 'LOADED');

  // Ilgari voz kechish faqat DRIVER_FOUND va ON_THE_WAY da ishlardi —
  // yangi oraliq bosqichlarda haydovchi qamalib qolardi.
  await tap('giveup:TG1', 555);
  check('a driver can still give up from a new middle stage', statusOf('TG1') === 'NEW');
  check('and the load loses its driver', JSON.parse(store.get('order:TG1')).driver === null);
}

/* ---------------------------------------------------------- */
console.log('\n== review criteria ==');
{
  const { validateReview, applyReview, topTags, CRITERIA } =
    await import(join(repo, 'lib/reviews.js'));

  check('a rating outside 1-5 is refused', Boolean(validateReview({ stars: 6 }, 'DRIVER').error));
  check('a missing rating is refused', Boolean(validateReview({}, 'DRIVER').error));
  check('half stars are refused', Boolean(validateReview({ stars: 4.5 }, 'DRIVER').error));

  const ok = validateReview({ stars: 5, comment: '  yaxshi  ', tags: ['ONTIME', 'CARE'] }, 'DRIVER');
  check('a valid review passes', !ok.error && ok.value.stars === 5);
  check('the comment is trimmed', ok.value.comment === 'yaxshi');
  check('the tags survive', ok.value.tags.join() === 'ONTIME,CARE');

  const mixed = validateReview({ stars: 3, tags: ['ONTIME', 'MADE_UP', 'ONTIME'] }, 'DRIVER');
  check('an unknown tag is dropped, not fatal', mixed.value.tags.join() === 'ONTIME');
  check('a repeated tag counts once', mixed.value.tags.length === 1);
  check("the other side's tags do not apply here",
    validateReview({ stars: 3, tags: ['PAID_ONTIME'] }, 'DRIVER').value.tags.length === 0);
  check('but they do on their own side',
    validateReview({ stars: 3, tags: ['PAID_ONTIME'] }, 'OWNER').value.tags.length === 1);
  check('the two sides ask different questions',
    CRITERIA.DRIVER.join() !== CRITERIA.OWNER.join());

  const p = {};
  applyReview(p, { stars: 5, tags: ['ONTIME'] }, 'DRIVER');
  applyReview(p, { stars: 3, tags: ['ONTIME', 'CARE'] }, 'DRIVER');
  check('driver ratings add up', p.ratingCount === 2 && p.ratingSum === 8);
  check('tags are tallied', p.tags.ONTIME === 2 && p.tags.CARE === 1);

  applyReview(p, { stars: 4, tags: [] }, 'OWNER');
  check('the shipper rating is kept apart', p.ownerRatingCount === 1 && p.ownerRatingSum === 4);
  check('and does not pollute the driver average', p.ratingCount === 2 && p.ratingSum === 8);

  const top = topTags(p.tags);
  check('only tags said more than once are shown', top.length === 1 && top[0].tag === 'ONTIME');
  check('and they carry a readable label', Boolean(top[0].label));
}

console.log('\n== both sides rate each other ==');
{
  store.clear(); sets.clear(); lists.clear(); resetFetch();

  const seed = (code, patch) => store.set(`order:${code}`, JSON.stringify({
    code, ownerIdentity: 'owner@example.com', phone: '+998901112233',
    fromCity: 'Toshkent', toCity: 'Buxoro', status: 'DELIVERED',
    driver: { name: 'Aziz', identity: 'driver1@example.com' }, ...patch,
  }));
  const rate = async (body) => {
    const res = mkRes();
    await orderHandler({ method: 'POST', query: { action: 'rate' }, body, headers: {} }, res);
    return res;
  };
  const profile = (id) => JSON.parse(store.get(`profile:${id}`) || '{}');

  seed('RV1');
  check('a stranger with the wrong phone is refused',
    (await rate({ code: 'RV1', phone: '+998900000000', stars: 5 })).statusCode === 404);

  const byPhone = await rate({ code: 'RV1', phone: '+998901112233', stars: 5, tags: ['ONTIME', 'CARE'] });
  check('the shipper rates by code and phone, as before', byPhone.statusCode === 200);
  check('the rating lands on the driver profile',
    profile('driver1@example.com').ratingCount === 1 && profile('driver1@example.com').ratingSum === 5);
  check('the tags land with it', profile('driver1@example.com').tags.ONTIME === 1);
  check('rating twice is refused',
    (await rate({ code: 'RV1', phone: '+998901112233', stars: 3 })).statusCode === 409);

  // Bu ilgari ishlamasdi: taklif orqali kelgan haydovchining bahosi
  // faqat telegramUsername orqali qidirilardi, ya'ni hech qayerga
  // tushmasdi.
  check('an offer-assigned driver is credited at all',
    profile('driver1@example.com').ratingCount === 1);

  seed('RV2');
  check('the driver cannot rate the shipper without signing in',
    (await rate({ code: 'RV2', side: 'OWNER', stars: 5 })).statusCode === 403);
  check('and neither can the shipper rate themselves as one',
    (await rate({ code: 'RV2', side: 'OWNER', googleIdToken: 'owner@example.com', stars: 5 })).statusCode === 403);

  const back = await rate({
    code: 'RV2', side: 'OWNER', googleIdToken: 'driver1@example.com',
    stars: 4, tags: ['PAID_ONTIME'],
  });
  check('the driver rates the shipper', back.statusCode === 200);
  check('it lands on the shipper as a shipper score',
    profile('owner@example.com').ownerRatingCount === 1 && profile('owner@example.com').ownerRatingSum === 4);
  check('and never on their driver score', !profile('owner@example.com').ratingCount);
  check('the shipper can still be rated as a driver separately',
    (await rate({ code: 'RV2', phone: '+998901112233', stars: 2 })).statusCode === 200);
  check('the two directions are stored separately', (() => {
    const o = JSON.parse(store.get('order:RV2'));
    return o.rating.stars === 2 && o.ownerRating.stars === 4;
  })());

  seed('RV3', { status: 'ON_THE_WAY' });
  check('an undelivered order cannot be rated',
    (await rate({ code: 'RV3', phone: '+998901112233', stars: 5 })).statusCode === 400);

  // Yulduzsiz baho bo'lmaydi — teg va izohning o'zi yetarli emas.
  seed('RV4');
  check('stars are still required',
    (await rate({ code: 'RV4', phone: '+998901112233', tags: ['ONTIME'] })).statusCode === 400);

  // Telegram guruhidan olgan haydovchi eski yo'l bilan topiladi.
  store.set('tgToEmail:aziz_driver', 'legacy@example.com');
  seed('RV5', { driver: { name: 'Aziz', telegramUsername: 'aziz_driver' } });
  await rate({ code: 'RV5', phone: '+998901112233', stars: 5 });
  check('a Telegram-claimed driver is still credited through the username index',
    profile('legacy@example.com').ratingCount === 1);
}

/* ---------------------------------------------------------- */
console.log('\n== asking to be verified ==');
{
  store.clear(); sets.clear(); lists.clear(); resetFetch();
  const call = async (body) => {
    const res = mkRes();
    await profileHandler({ method: 'POST', query: { action: 'request-verification' }, body, headers: {} }, res);
    return res;
  };
  const me = 'aziz@example.com';
  const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(200);

  check('a request needs a signed-in user',
    (await call({ kind: 'IDENTITY', docDataUrl: IMG })).statusCode === 401);

  // Telefonni bu yerdan tasdiqlab bo'lmaydi — u Telegram ishi.
  const phone = await call({ googleIdToken: me, kind: 'PHONE' });
  check('the phone is not verified from the site', phone.statusCode === 400);
  check('and the answer says where it is done', phone.body.viaTelegram === true);

  check('a document is required',
    (await call({ googleIdToken: me, kind: 'IDENTITY' })).statusCode === 400);
  check('and it has to be an image',
    (await call({ googleIdToken: me, kind: 'IDENTITY', docDataUrl: 'https://example.com/x.jpg' })).statusCode === 400);
  check('an oversized image is refused',
    (await call({ googleIdToken: me, kind: 'IDENTITY', docDataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(1_000_000) })).statusCode === 413);

  const sent = await call({ googleIdToken: me, kind: 'IDENTITY', docDataUrl: IMG });
  check('a proper request is accepted', sent.statusCode === 200);
  check('it comes back pending', sent.body.profile.verifications.IDENTITY.status === 'PENDING');
  // Hujjat profil ichida emas: profil har xil joyda o'qiladi.
  check('the document is not stored inside the profile',
    !JSON.stringify(store.get(`profile:${me}`)).includes('base64'));
  check('it is stored under its own key', store.get(`verifydoc:${me}:IDENTITY`) === IMG);
  check('and queued for a moderator', sets.get('verify_queue').has(`${me}|IDENTITY`));

  const again = await call({ googleIdToken: me, kind: 'IDENTITY', docDataUrl: IMG });
  check('asking again while pending is not an error', again.statusCode === 200);
  check('but it stays the same one request', again.body.profile.verifications.IDENTITY.status === 'PENDING');

  // Bir turdagi so'rov ikkinchisini to'smaydi.
  const truck = await call({ googleIdToken: me, kind: 'TRANSPORT', docDataUrl: IMG });
  check('a different kind can be asked for at the same time', truck.statusCode === 200);
  check('and both sit in the queue', sets.get('verify_queue').size === 2);

  // Eski mijoz `kind` yubormaydi — bu doim shaxs tasdig'i bo'lgan.
  store.clear(); sets.clear();
  const old = await call({ googleIdToken: me, docDataUrl: IMG });
  check('a request with no kind is treated as identity',
    old.statusCode === 200 && old.body.profile.verifications.IDENTITY.status === 'PENDING');
}

console.log('\n== the bot verifies a phone number ==');
{
  store.clear(); sets.clear(); lists.clear(); resetFetch();
  const telegramMod = await load('api/telegram.js', 'telegram_phone_test');
  const telegramHandler = telegramMod.default;

  const send = async (message) => {
    const res = mkRes();
    await telegramHandler({ method: 'POST', headers: {}, body: { message } }, res);
    return res;
  };
  const profileOf = (id) => JSON.parse(store.get(`profile:${id}`) || '{}');

  await send({
    chat: { id: 555 }, from: { id: 555, first_name: 'Aziz' },
    contact: { user_id: 999, phone_number: '998901112233' },
  });
  check("someone else's contact verifies nobody", !store.has('profile:tg:555'));

  await send({
    chat: { id: 555 }, from: { id: 555, first_name: 'Aziz' },
    contact: { user_id: 555, phone_number: '998901112233' },
  });
  const p = profileOf('tg:555');
  check('sharing your own contact verifies the phone',
    p.verifications.PHONE.status === 'VERIFIED');
  check('and the number is stored in international form', p.phone === '+998901112233');
  check('but it does not hand out the blue badge', p.verified === false);

  // Google akkaunti bilan bog'langan odam o'sha profilga yozilishi kerak,
  // yangi "tg:" profili yaratilmasin.
  store.set('tgIdToEmail:777', 'aziz@example.com');
  store.set('profile:aziz@example.com', JSON.stringify({ username: 'aziz' }));
  await send({
    chat: { id: 777 }, from: { id: 777, first_name: 'Aziz' },
    contact: { user_id: 777, phone_number: '+998907776655' },
  });
  check('a linked account is verified on its own profile',
    profileOf('aziz@example.com').verifications.PHONE.status === 'VERIFIED');
  check('and no duplicate telegram profile appears', !store.has('profile:tg:777'));
  check('the existing profile is not wiped', profileOf('aziz@example.com').username === 'aziz');

  resetFetch();
  await send({ chat: { id: 555 }, from: { id: 555 }, text: '/tasdiq' });
  const ask = sentMessages.find((m) => m.url.endsWith('/sendMessage'));
  check('/tasdiq offers the share-contact button',
    Boolean(ask && ask.body.reply_markup && ask.body.reply_markup.keyboard[0][0].request_contact));
}

/* ---------------------------------------------------------- */
console.log('\n== saved loads and drivers ==');
{
  store.clear(); sets.clear(); lists.clear(); resetFetch();
  const call = async (action, body) => {
    const res = mkRes();
    await profileHandler({ method: 'POST', query: { action }, body, headers: {} }, res);
    return res;
  };
  const me = { googleIdToken: 'me@example.com' };

  store.set('order:L1', JSON.stringify({
    code: 'L1', fromCity: 'Toshkent', toCity: 'Buxoro', cargoType: 'MEBEL',
    weightKg: 5000, amount: 900000, status: 'NEW', createdAt: 200,
  }));
  store.set('order:L2', JSON.stringify({
    code: 'L2', fromCity: 'Buxoro', toCity: 'Nukus', cargoType: 'MEBEL',
    weightKg: 2000, amount: 500000, status: 'DELIVERED', createdAt: 100,
  }));
  store.set('username:aziz', 'aziz@example.com');
  store.set('profile:aziz@example.com', JSON.stringify({
    username: 'aziz', displayName: 'Aziz', ratingCount: 4, ratingSum: 19,
    deliveredCount: 3, city: 'Toshkent', phone: '+998901112233', verified: true,
  }));

  check('saving needs a signed-in user',
    (await call('save', { kind: 'load', id: 'L1' })).statusCode === 401);
  check('an unknown kind is refused',
    (await call('save', { ...me, kind: 'spaceship', id: 'L1' })).statusCode === 400);
  check('an empty id is refused', (await call('save', { ...me, kind: 'load', id: '' })).statusCode === 400);

  check('a load can be saved', (await call('save', { ...me, kind: 'load', id: 'L1' })).body.saved === true);
  await call('save', { ...me, kind: 'load', id: 'L2' });
  await call('save', { ...me, kind: 'driver', id: 'aziz' });

  const saved = await call('saved', me);
  check('the list comes back', saved.statusCode === 200);
  check('both loads are there', saved.body.loads.length === 2);
  check('newest first', saved.body.loads[0].code === 'L1');
  // Faqat kodlar qaytsa, sayt har biri uchun alohida so'rov yuborardi.
  check('a load carries enough to draw its card',
    saved.body.loads[0].fromCity === 'Toshkent' && saved.body.loads[0].amount === 900000);
  check('a taken load still shows, with its stage',
    saved.body.loads.find((l) => l.code === 'L2').status === 'DELIVERED');
  check('the driver comes back too', saved.body.drivers.length === 1);
  check('with the public shape only', saved.body.drivers[0].displayName === 'Aziz');
  check('and never a phone number', !JSON.stringify(saved.body.drivers).includes('998901112233'));

  await call('save', { ...me, kind: 'load', id: 'L1', on: false });
  const after = await call('saved', me);
  check('unsaving removes it', after.body.loads.length === 1 && after.body.loads[0].code === 'L2');

  // O'chib ketgan yuk ro'yxatni buzmasin.
  store.delete('order:L2');
  const gone = await call('saved', me);
  check('a deleted load is dropped, not rendered as a hole', gone.body.loads.length === 0);
  check('and the caller is told how many vanished', gone.body.missing === 1);

  // Telefonda qolgan eski yurakchalar bir marta ko'chiriladi.
  store.set('order:L3', JSON.stringify({
    code: 'L3', fromCity: 'Nukus', toCity: 'Termiz', weightKg: 1, amount: 1, createdAt: 300,
  }));
  const migrated = await call('saved', { ...me, migrate: ['L3'] });
  check('local favourites are migrated on first sync',
    migrated.body.loads.some((l) => l.code === 'L3'));
  const stillThere = await call('saved', me);
  check('and they stay after that', stillThere.body.loads.some((l) => l.code === 'L3'));

  const other = await call('saved', { googleIdToken: 'someone@else.com' });
  check("another account sees none of it", other.body.loads.length === 0 && other.body.drivers.length === 0);
}

/* ---------------------------------------------------------- */
console.log('\n== volume and item count ==');
{
  store.clear(); sets.clear(); lists.clear(); resetFetch();

  // Buyurtma yaratish telefon raqami bo'yicha cheklangan (isThrottled),
  // shuning uchun har chaqiruv o'z raqamidan yuboradi.
  let phoneSeq = 900000000;
  const post = async (extra) => {
    const res = mkRes();
    phoneSeq += 1;
    await orderHandler({
      method: 'POST', query: {}, headers: {},
      body: {
        fromCity: 'Toshkent', toCity: 'Buxoro', weightKg: 5000, cargoType: 'GENERAL',
        name: 'Sardor', phone: String(phoneSeq), googleIdToken: 'owner@example.com', ...extra,
      },
    }, res);
    return res;
  };
  const stored = (code) => JSON.parse(store.get(`order:${code}`));

  const plain = await post({});
  check('a load posts fine with neither field', plain.statusCode === 200);
  check('and stores them as absent, not zero',
    stored(plain.body.code).volumeM3 === null && stored(plain.body.code).quantity === null);

  const both = await post({ volumeM3: 12.5, quantity: 20, quantityUnit: 'PALLET' });
  check('both can be given', both.statusCode === 200, JSON.stringify(both.body));
  check('the volume is kept', stored(both.body.code).volumeM3 === 12.5);
  check('the count and its unit are kept',
    stored(both.body.code).quantity === 20 && stored(both.body.code).quantityUnit === 'PALLET');

  check('a volume is rounded to one decimal',
    stored((await post({ volumeM3: 3.14159 })).body.code).volumeM3 === 3.1);
  check('a zero volume is refused', (await post({ volumeM3: 0 })).statusCode === 400);
  check('a negative volume is refused', (await post({ volumeM3: -5 })).statusCode === 400);
  check('an absurd volume is refused', (await post({ volumeM3: 5000 })).statusCode === 400);
  check('a fractional item count is refused', (await post({ quantity: 2.5 })).statusCode === 400);
  check('a zero item count is refused', (await post({ quantity: 0 })).statusCode === 400);

  // Birlik yozilmasa ham son ma'noli bo'lishi kerak.
  check('a count with no unit gets the default one',
    stored((await post({ quantity: 7 })).body.code).quantityUnit === 'JOY');
  const oddUnit = await post({ quantity: 7, quantityUnit: 'ELEPHANTS' });
  check('an unknown unit falls back rather than failing the post',
    oddUnit.statusCode === 200 && stored(oddUnit.body.code).quantityUnit === 'JOY');

  // Saytdagi forma to'ldirilmagan maydonni bo'sh satr qilib yuboradi.
  const blanks = await post({ volumeM3: '', quantity: '', quantityUnit: '' });
  check('blank fields are treated as absent, not as errors',
    blanks.statusCode === 200 && stored(blanks.body.code).volumeM3 === null);

  // Haydovchi guruh xabarida ham ko'rishi kerak.
  const { buildOrderMessage } = await import(join(repo, 'lib/orderMessage.js'));
  const msg = buildOrderMessage(stored(both.body.code));
  check('the volume reaches the Telegram post', msg.includes('12\\.5 m³'), msg.slice(0, 200));
  check('so does the item count', msg.includes('pallet'));
  const bare = buildOrderMessage(stored(plain.body.code));
  check('and neither line appears when they were not given',
    !bare.includes('m³') && !bare.includes('joy'));

  // Ro'yxat va tafsilot ham ularni tashiydi, aks holda haydovchi
  // yukni ochmasdan turib bilmasdi.
  const listRes = mkRes();
  await orderHandler({ method: 'GET', query: { action: 'list' }, headers: {} }, listRes);
  const inList = listRes.body.loads.find((l) => l.code === both.body.code);
  check('the browse list carries the volume', inList && inList.volumeM3 === 12.5);
  const detailRes = mkRes();
  await orderHandler({ method: 'GET', query: { action: 'detail', code: both.body.code }, headers: {} }, detailRes);
  check('so does the detail page', detailRes.body.quantity === 20 && detailRes.body.quantityUnit === 'PALLET');
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
