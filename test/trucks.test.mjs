/**
 * Unit tests for api/trucks.js — validation, authorization and ownership.
 *
 * Run with:  npm test
 *
 * No test framework (this project has no dependencies): the handler is
 * imported with lib/kv.js and lib/identity.js swapped for in-memory mocks,
 * then driven through fake req/res objects. In the identity mock the
 * credential string IS the identity, so "alice@x.com" vs "mallory@x.com"
 * exercises the real ownership checks.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const work = mkdtempSync(join(tmpdir(), 'yolda-trucks-test-'));

const store = new Map();
const sets = new Map();
const kvMock = `
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
export const kvKeys = async () => [];
`;
const identityMock = `
export const resolveEmail = async ({ googleIdToken, telegramInitData }) => {
  // Test doubles: the token IS the identity, empty means unauthenticated.
  return googleIdToken || telegramInitData || null;
};
`;
globalThis.__store = store;
globalThis.__sets = sets;
writeFileSync(join(work, 'kvmock.mjs'), kvMock);
writeFileSync(join(work, 'identitymock.mjs'), identityMock);

let src = readFileSync(join(repo, 'api/trucks.js'), 'utf8')
  .replace("'../lib/identity.js'", JSON.stringify(join(work, 'identitymock.mjs')))
  .replace("'../lib/kv.js'", JSON.stringify(join(work, 'kvmock.mjs')));
writeFileSync(join(work, 'trucks_under_test.mjs'), src);
const { default: handler } = await import(join(work, 'trucks_under_test.mjs'));

function mkRes(){
  const r = { statusCode: 0, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const call = async (method, query, body) => {
  const res = mkRes();
  await handler({ method, query, body }, res);
  return res;
};

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if(cond){ pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); }
};

const VALID = {
  googleIdToken: 'alice@x.com', category: 'YUK', brand: 'DAF XF', year: 2020,
  price: 500000000, city: 'Toshkent', phone: '901234567', sellerName: 'Alice',
};

console.log('\n== auth ==');
check('create requires auth', (await call('POST', {action:'create'}, {...VALID, googleIdToken: null})).statusCode === 401);
check('mine requires auth', (await call('GET', {action:'mine'}, null)).statusCode === 401);
check('favorites requires auth', (await call('GET', {action:'favorites'}, null)).statusCode === 401);

console.log('\n== validation ==');
check('bad category rejected', (await call('POST', {action:'create'}, {...VALID, category:'NOPE'})).statusCode === 400);
check('bad city rejected', (await call('POST', {action:'create'}, {...VALID, city:'Paris'})).statusCode === 400);
check('bad year rejected', (await call('POST', {action:'create'}, {...VALID, year:1800})).statusCode === 400);
check('bad phone rejected', (await call('POST', {action:'create'}, {...VALID, phone:'123'})).statusCode === 400);
check('zero price rejected', (await call('POST', {action:'create'}, {...VALID, price:0})).statusCode === 400);
check('missing brand rejected', (await call('POST', {action:'create'}, {...VALID, brand:'  '})).statusCode === 400);
check('bad fuel rejected', (await call('POST', {action:'create'}, {...VALID, fuel:'PLUTONIUM'})).statusCode === 400);
check('non-image photo rejected', (await call('POST', {action:'create'}, {...VALID, photos:['data:text/html;base64,AAA']})).statusCode === 400);
check('>5 photos rejected', (await call('POST', {action:'create'}, {...VALID, photos:Array(6).fill('data:image/jpeg;base64,AAAA')})).statusCode === 400);
const bigPhoto = 'data:image/jpeg;base64,' + 'A'.repeat(400*1024);
check('oversized photo rejected', (await call('POST', {action:'create'}, {...VALID, photos:[bigPhoto]})).statusCode === 400);

console.log('\n== create + normalisation ==');
const c = await call('POST', {action:'create'}, {...VALID, phone:'901234567', mileageKm:'150000', photos:['data:image/jpeg;base64,AAAA']});
check('create ok', c.statusCode === 200, c.body);
const id = c.body?.truck?.id;
check('phone normalised to +998', c.body?.truck?.phone === '+998901234567', c.body?.truck?.phone);
check('new listing starts PENDING (not publishable)', c.body?.truck?.status === 'PENDING', c.body?.truck?.status);
check('defaults: verified false', c.body?.truck?.verified === false);
check('defaults: promoted false', c.body?.truck?.promoted === false);
check('mileage coerced to number', c.body?.truck?.mileageKm === 150000);

console.log('\n== moderation: nothing is public until an admin approves ==');
// The seller-facing API must never be able to make a listing ACTIVE.
const listWhilePending = await call('GET', {action:'list'}, null);
check('PENDING listing hidden from public list', !(listWhilePending.body.trucks||[]).some(t => t.id === id));
check('owner sees own PENDING listing in mine', (await call('GET', {action:'mine', googleIdToken:'alice@x.com'}, null)).body.trucks.some(t => t.id === id));
check('seller CANNOT self-approve PENDING -> ACTIVE',
  (await call('POST', {action:'set-status'}, {googleIdToken:'alice@x.com', id, status:'ACTIVE'})).statusCode === 403);
check('...and it really is still PENDING', JSON.parse(store.get(`truck:${id}`)).status === 'PENDING');

// Simulate the admin approving it (api/admin-data.js writes the same key).
const approve = (tid, status, reason) => {
  const t = JSON.parse(store.get(`truck:${tid}`));
  t.status = status;
  if (reason) t.rejectionReason = reason; else delete t.rejectionReason;
  store.set(`truck:${tid}`, JSON.stringify(t));
};
approve(id, 'ACTIVE');
check('approved listing becomes publicly visible', (await call('GET', {action:'list'}, null)).body.trucks.some(t => t.id === id));

console.log('\n== ownership ==');
check('other user cannot update', (await call('POST', {action:'update'}, {googleIdToken:'mallory@x.com', id, price: 1})).statusCode === 403);
check('other user cannot delete', (await call('POST', {action:'delete'}, {googleIdToken:'mallory@x.com', id})).statusCode === 403);
check('other user cannot set-status', (await call('POST', {action:'set-status'}, {googleIdToken:'mallory@x.com', id, status:'SOLD'})).statusCode === 403);
check('owner CAN pause an approved listing', (await call('POST', {action:'set-status'}, {googleIdToken:'alice@x.com', id, status:'PAUSED'})).statusCode === 200);
check('owner CAN mark it sold', (await call('POST', {action:'set-status'}, {googleIdToken:'alice@x.com', id, status:'SOLD'})).statusCode === 200);
check('bad status rejected', (await call('POST', {action:'set-status'}, {googleIdToken:'alice@x.com', id, status:'HACKED'})).statusCode === 400);
check('seller cannot set PENDING via set-status', (await call('POST', {action:'set-status'}, {googleIdToken:'alice@x.com', id, status:'PENDING'})).statusCode === 400);
check('seller cannot set REJECTED via set-status', (await call('POST', {action:'set-status'}, {googleIdToken:'alice@x.com', id, status:'REJECTED'})).statusCode === 400);

console.log('\n== editing an approved listing sends it back for review ==');
approve(id, 'ACTIVE');
check('owner CAN update', (await call('POST', {action:'update'}, {googleIdToken:'alice@x.com', id, price: 600000000})).statusCode === 200);
check('edit resets status to PENDING', JSON.parse(store.get(`truck:${id}`)).status === 'PENDING');
check('edited listing drops out of the public list', !(await call('GET', {action:'list'}, null)).body.trucks.some(t => t.id === id));

console.log('\n== rejection ==');
approve(id, 'REJECTED', 'Rasmlar aniq emas');
check('REJECTED listing hidden from public list', !(await call('GET', {action:'list'}, null)).body.trucks.some(t => t.id === id));
const rejectedMine = (await call('GET', {action:'mine', googleIdToken:'alice@x.com'}, null)).body.trucks.find(t => t.id === id);
check('owner sees the rejection reason', rejectedMine?.rejectionReason === 'Rasmlar aniq emas', rejectedMine?.rejectionReason);
check('seller cannot revive a REJECTED listing',
  (await call('POST', {action:'set-status'}, {googleIdToken:'alice@x.com', id, status:'ACTIVE'})).statusCode === 403);
check('re-editing a rejected listing clears the reason and re-queues it',
  (await call('POST', {action:'update'}, {googleIdToken:'alice@x.com', id, price: 610000000})).statusCode === 200
  && JSON.parse(store.get(`truck:${id}`)).status === 'PENDING'
  && JSON.parse(store.get(`truck:${id}`)).rejectionReason === undefined);

console.log('\n== update cannot forge trust flags ==');
await call('POST', {action:'update'}, {googleIdToken:'alice@x.com', id, verified:true, promoted:true, viewCount:99999, sellerIdentity:'mallory@x.com'});
const after = JSON.parse(store.get(`truck:${id}`));
check('verified not settable by owner', after.verified === false, after.verified);
check('promoted not settable by owner', after.promoted === false, after.promoted);
check('sellerIdentity not reassignable', after.sellerIdentity === 'alice@x.com', after.sellerIdentity);
check('status not settable to ACTIVE through update payload', after.status === 'PENDING', after.status);

console.log('\n== list hides non-ACTIVE ==');
approve(id, 'SOLD');
const listAfterSold = await call('GET', {action:'list'}, null);
check('SOLD listing hidden from public list', !(listAfterSold.body.trucks||[]).some(t => t.id === id));
const mineRes = await call('GET', {action:'mine', googleIdToken:'alice@x.com'}, null);
check('SOLD listing still in owner\'s mine', (mineRes.body.trucks||[]).some(t => t.id === id));

console.log('\n== favorites ==');
await call('POST', {action:'favorite'}, {googleIdToken:'bob@x.com', id});
check('favorite persisted per-identity', (await call('GET', {action:'favorites', googleIdToken:'bob@x.com'}, null)).body.trucks.length === 1);
check('other identity has own empty favorites', (await call('GET', {action:'favorites', googleIdToken:'carol@x.com'}, null)).body.trucks.length === 0);
await call('POST', {action:'unfavorite'}, {googleIdToken:'bob@x.com', id});
check('unfavorite removes it', (await call('GET', {action:'favorites', googleIdToken:'bob@x.com'}, null)).body.trucks.length === 0);

console.log('\n== ban check ==');
sets.set('banned', new Set(['banned@x.com']));
check('banned user cannot create', (await call('POST', {action:'create'}, {...VALID, googleIdToken:'banned@x.com'})).statusCode === 403);

console.log('\n== method / action guards ==');
check('PUT rejected', (await call('PUT', {action:'list'}, null)).statusCode === 405);
check('unknown GET action rejected', (await call('GET', {action:'nope'}, null)).statusCode === 400);
check('unknown POST action rejected', (await call('POST', {action:'nope'}, {})).statusCode === 400);

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
