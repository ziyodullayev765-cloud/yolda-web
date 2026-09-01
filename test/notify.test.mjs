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

/**
 * Copies a module into a temp dir with lib/kv.js swapped for the mock.
 * Every other relative import is rewritten to an absolute repo path,
 * since the copy no longer sits next to its siblings.
 */
const load = async (relPath, name) => {
  const kvMock = JSON.stringify(join(work, 'kvmock.mjs'));
  const src = readFileSync(join(repo, relPath), 'utf8')
    .replaceAll("'./kv.js'", kvMock)
    .replaceAll("'../lib/kv.js'", kvMock)
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

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
