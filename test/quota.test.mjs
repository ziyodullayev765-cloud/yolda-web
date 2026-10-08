/**
 * Kvota: bitta so'rov nechta Redis buyrug'i "yeydi".
 *
 * Muammoning o'zi raqamli edi — yozishma polli har 1,5 soniyada
 * ketadi va ilgari har safar 100 dan ortiq buyruq sarflardi. Shuning
 * uchun bu yerda xatti-harakat emas, SARF o'lchanadi: haqiqiy
 * endpoint haqiqiy token bilan chaqiriladi va buyruqlar sanaladi.
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

/* ---- kv.js o'rniga sanab boradigan soxta ombor ---- */
const store = new Map();
const sets = new Map();
const lists = new Map();
const calls = [];

const kvmock = {
  kvGet: async (k) => { calls.push('GET ' + k); return store.has(k) ? store.get(k) : null; },
  kvSet: async (k, v) => { calls.push('SET ' + k); store.set(k, v); return true; },
  kvDel: async (k) => { calls.push('DEL ' + k); store.delete(k); sets.delete(k); lists.delete(k); return true; },
  kvIncr: async (k) => { calls.push('INCR ' + k); const n = Number(store.get(k) || 0) + 1; store.set(k, String(n)); return n; },
  kvPush: async (k, v) => { calls.push('LPUSH ' + k); if (!lists.has(k)) lists.set(k, []); lists.get(k).unshift(v); return true; },
  kvRange: async (k) => { calls.push('LRANGE ' + k); return [...(lists.get(k) || [])]; },
  kvSadd: async (k, m) => { calls.push('SADD ' + k); if (!sets.has(k)) sets.set(k, new Set()); sets.get(k).add(m); return true; },
  kvSaddNew: async (k, m) => { calls.push('SADD ' + k); if (!sets.has(k)) sets.set(k, new Set());
    const had = sets.get(k).has(m); sets.get(k).add(m); return !had; },
  kvExpire: async () => true,
  kvSrem: async (k, m) => { calls.push('SREM ' + k); if (sets.has(k)) sets.get(k).delete(m); return true; },
  kvSmembers: async (k) => { calls.push('SMEMBERS ' + k); return [...(sets.get(k) || [])]; },
  kvSismember: async (k, m) => { calls.push('SISMEMBER ' + k); return Boolean(sets.get(k) && sets.get(k).has(m)); },
  kvKeys: async (p) => { calls.push('KEYS ' + p); return [...store.keys()].filter((k) => k.startsWith(p.replace('*', ''))); },
};
globalThis.__kvmock = kvmock;

const loaderSrc = `
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('/kv.js')) return { url: 'mock:kv', shortCircuit: true };
  if (specifier.endsWith('/notify.js')) return { url: 'mock:notify', shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url === 'mock:kv') {
    return { format: 'module', shortCircuit: true, source:
      "const m = globalThis.__kvmock;" +
      "export const kvGet=m.kvGet; export const kvSet=m.kvSet; export const kvDel=m.kvDel;" +
      "export const kvIncr=m.kvIncr; export const kvPush=m.kvPush; export const kvRange=m.kvRange;" +
      "export const kvLrem=async()=>true; export const kvSadd=m.kvSadd; export const kvSrem=m.kvSrem;" +
      "export const kvSaddNew=m.kvSaddNew; export const kvExpire=m.kvExpire;" +
      "export const kvSmembers=m.kvSmembers; export const kvSismember=m.kvSismember;" +
      "export const kvKeys=m.kvKeys; export const kvConfigured=true;" +
      "export const kvDbSize=async()=>0; export const kvUsedMemory=async()=>0;" +
      "export const kvMonthCommands=async()=>0; export const usageKey=()=>'usage:cmd:x';" };
  }
  if (url === 'mock:notify') {
    return { format: 'module', shortCircuit: true, source:
      "export const notifyUser=async()=>true; export const notifyMany=async()=>true;" +
      "export const recordNotification=async()=>true; export const readNotifications=async()=>[];" +
      "export const markNotificationsSeen=async()=>true; export const esc=(v)=>String(v==null?'':v);" +
      "export const NOTIFY_CATEGORIES=['orders','listings','chat','matches','offers'];" +
      "export const NOTIF_LIMIT=50; export const notifSeenKey=(i)=>'notifs_seen:'+i;" };
  }
  return next(url, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loaderSrc)}`, pathToFileURL('./'));

process.env.AUTH_SECRET = 'quota-test-secret';

const { issueSessionToken } = await import('../lib/phoneAuth.js');
const chat = (await import('../api/chat.js')).default;

let passed = 0;
let failed = 0;
const it = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log('  PASS', name);
  } catch (err) {
    failed += 1;
    console.log('  FAIL', name, '\n       ', err.message);
  }
};

const PHONE_ME = '+998901112233';
const PHONE_OTHER = '+998905556677';
const ME = `ph:998901112233`;
const OTHER = `ph:998905556677`;
const pair = `convo:${[ME, OTHER].sort().join('|')}`;
const vkey = `convoVer:${[ME, OTHER].sort().join('|')}`;

const seed = (messageCount) => {
  store.clear(); sets.clear(); lists.clear();
  // Telefon akkaunti — token shu bilan tekshiriladi.
  store.set(`phoneUser:${PHONE_ME}`, JSON.stringify({ phone: PHONE_ME, pv: 1 }));
  store.set(`phoneUser:${PHONE_OTHER}`, JSON.stringify({ phone: PHONE_OTHER, pv: 1 }));
  store.set(`profile:${OTHER}`, JSON.stringify({ username: 'bek', displayName: 'Bek' }));
  const ids = [];
  for (let i = 1; i <= messageCount; i += 1) {
    store.set(`msg:${i}`, JSON.stringify({ id: i, from: OTHER, to: ME, text: 'xabar ' + i, at: i, reactions: {} }));
    ids.unshift(String(i));
  }
  lists.set(pair, ids);
};

const token = issueSessionToken(PHONE_ME, 1);

const fakeRes = () => {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

const call = async (query) => {
  calls.length = 0;
  const res = fakeRes();
  await chat({ method: 'GET', query, body: {} }, res);
  return { res, used: calls.length };
};

/* ---------------------------------------------------------------- */
console.log('\n== token haqiqatan ishlayaptimi ==');
seed(100);
const first = await call({ action: 'thread', phoneToken: token, withEmail: OTHER });
await it('yozishma o\'qildi', () => {
  assert.equal(first.res.code, 200, JSON.stringify(first.res.body).slice(0, 120));
  assert.equal((first.res.body.messages || []).length, 100);
});
await it('server versiya qaytardi', () => {
  assert.ok(first.res.body.ver !== undefined, JSON.stringify(first.res.body).slice(0, 120));
});

console.log('\n== 100 xabarli yozishma: sarf ==');
console.log(`       to'liq o'qish: ${first.used} buyruq`);
await it('to\'liq o\'qish 100 dan ortiq buyruq talab qiladi', () => {
  assert.ok(first.used > 100, 'buyruqlar: ' + first.used);
});

const ver = String(first.res.body.ver);
const again = await call({ action: 'thread', phoneToken: token, withEmail: OTHER, ver });
console.log(`       o'zgarmagan poll: ${again.used} buyruq`);
await it('o\'zgarmagan poll bo\'sh javob qaytaradi', () => {
  assert.equal(again.res.code, 200);
  assert.equal(again.res.body.unchanged, true, JSON.stringify(again.res.body).slice(0, 120));
  assert.equal(again.res.body.messages, undefined);
});
await it('o\'zgarmagan poll 10 dan kam buyruq yeydi', () => {
  assert.ok(again.used < 10, 'buyruqlar: ' + again.used);
});
await it('tejamkorlik 10 barobardan ko\'p', () => {
  assert.ok(first.used / again.used > 10, `${first.used} -> ${again.used}`);
});

console.log('\n== yangi xabar kelsa versiya o\'zgaradi ==');
store.set(`msg:101`, JSON.stringify({ id: 101, from: OTHER, to: ME, text: 'yangi', at: 101, reactions: {} }));
lists.get(pair).unshift('101');
store.set(vkey, String(Number(store.get(vkey) || 0) + 1));
const after = await call({ action: 'thread', phoneToken: token, withEmail: OTHER, ver });
await it('eski versiya bilan so\'ralganda to\'liq javob keladi', () => {
  assert.equal(after.res.body.unchanged, undefined);
  assert.equal((after.res.body.messages || []).length, 101);
});
await it('yangi versiya qaytdi', () => {
  assert.notEqual(String(after.res.body.ver), ver);
});

console.log('\n== bo\'sh yozishma ham arzon ==');
seed(0);
const emptyFirst = await call({ action: 'thread', phoneToken: token, withEmail: OTHER });
const emptyVer = String(emptyFirst.res.body.ver);
const emptyAgain = await call({ action: 'thread', phoneToken: token, withEmail: OTHER, ver: emptyVer });
await it('bo\'sh yozishmada ham qayta so\'rov qisqaradi', () => {
  assert.equal(emptyAgain.res.body.unchanged, true);
  assert.ok(emptyAgain.used <= emptyFirst.used, `${emptyFirst.used} -> ${emptyAgain.used}`);
});

console.log('\n== xavfsizlik: versiya himoyani chetlab o\'tmaydi ==');
await it('tokensiz so\'rov 401, bazaga tegmaydi', async () => {
  const r = await call({ action: 'thread', withEmail: OTHER, ver: '999' });
  assert.equal(r.res.code, 401);
  assert.equal(r.used, 0, 'buyruqlar: ' + r.used);
});
await it('buzilgan token 401 qaytaradi', async () => {
  const r = await call({ action: 'thread', phoneToken: token + 'x', withEmail: OTHER });
  assert.equal(r.res.code, 401);
});

console.log('\n== "Yuklar" ro\'yxati: kesh ==');
const order = (await import('../api/order.js')).default;

const seedOrders = (n) => {
  store.clear(); sets.clear(); lists.clear();
  const codes = [];
  for (let i = 1; i <= n; i += 1) {
    const code = 'YL-' + i;
    codes.push(code);
    store.set(`order:${code}`, JSON.stringify({
      code, status: 'NEW', fromCity: i % 2 ? 'Toshkent' : 'Samarqand', toCity: 'Buxoro',
      cargoType: 'OTHER', weightKg: 1000 + i, amount: 500000, distanceKm: 300,
      createdAt: i, ownerIdentity: 'ph:99890000000' + (i % 3),
    }));
  }
  lists.set('order_codes', codes);
  for (let k = 0; k < 3; k += 1) {
    store.set(`profile:ph:99890000000${k}`, JSON.stringify({ displayName: 'Egasi ' + k, ratingCount: 2, ratingSum: 9 }));
  }
};

const callOrder = async (query) => {
  calls.length = 0;
  const res = fakeRes();
  await order({ method: 'GET', query, body: {} }, res);
  return { res, used: calls.length };
};

seedOrders(300);
const cold = await callOrder({ action: 'list' });
console.log(`       birinchi ochilish (kesh yo'q): ${cold.used} buyruq`);
await it('ro\'yxat qaytdi', () => {
  assert.equal(cold.res.code, 200);
  assert.equal((cold.res.body.loads || []).length, 60);
});
await it('kesh yo\'q paytda 300 dan ortiq buyruq ketadi', () => {
  assert.ok(cold.used > 300, 'buyruqlar: ' + cold.used);
});

const warm = await callOrder({ action: 'list' });
console.log(`       keyingi ochilish (kesh bor): ${warm.used} buyruq`);
await it('keshdan o\'qilganda bitta buyruqqa tushadi', () => {
  assert.equal(warm.used, 1, 'buyruqlar: ' + warm.used);
});
await it('kesh bilan ham ro\'yxat bir xil', () => {
  assert.deepEqual(warm.res.body.loads, cold.res.body.loads);
});
await it('tejamkorlik 100 barobardan ko\'p', () => {
  assert.ok(cold.used / warm.used > 100, `${cold.used} -> ${warm.used}`);
});

await it('filtr keshdan ham to\'g\'ri ishlaydi', async () => {
  const f = await callOrder({ action: 'list', fromCity: 'Samarqand' });
  assert.equal(f.used, 1, 'buyruqlar: ' + f.used);
  assert.ok(f.res.body.loads.length > 0);
  assert.ok(f.res.body.loads.every((l) => l.fromCity === 'Samarqand'));
});

await it('olingan yuk ro\'yxatda qolmaydi (kesh tashlangach)', async () => {
  const taken = JSON.parse(store.get('order:YL-2'));
  taken.status = 'DRIVER_FOUND';
  store.set('order:YL-2', JSON.stringify(taken));
  store.delete('loads_cache');                      // holat o'zgarishi shuni qiladi
  const after = await callOrder({ action: 'list' });
  assert.ok(!after.res.body.loads.some((l) => l.code === 'YL-2'));
});

await it('kesh eskirsa o\'zi qayta quriladi', async () => {
  const cached = JSON.parse(store.get('loads_cache'));
  cached.at = Date.now() - 60000;                   // 60 soniya oldin
  store.set('loads_cache', JSON.stringify(cached));
  const rebuilt = await callOrder({ action: 'list' });
  assert.ok(rebuilt.used > 100, 'qayta qurilmadi, buyruqlar: ' + rebuilt.used);
});

await it('buzuq kesh javobni buzmaydi', async () => {
  store.set('loads_cache', 'bu JSON emas');
  const r = await callOrder({ action: 'list' });
  assert.equal(r.res.code, 200);
  assert.ok((r.res.body.loads || []).length > 0);
});

await it('kesh maxfiy maydonlarni saqlamaydi', () => {
  const cached = JSON.parse(store.get('loads_cache'));
  const txt = JSON.stringify(cached);
  assert.ok(!/phone|email|comment/i.test(txt), 'keshda maxfiy maydon bor');
});

console.log('\n== admin: kvota chegaralari ==');
const adminSrc = await (await import('node:fs/promises'))
  .readFile(new URL('../api/admin-data.js', import.meta.url), 'utf8');
await it('chegaralar Upstash bepul tarifiga mos', () => {
  assert.ok(/QUOTA_BYTES = 256 \* 1024 \* 1024/.test(adminSrc));
  assert.ok(/QUOTA_COMMANDS = 500000/.test(adminSrc));
});
await it('usage resursi ruxsat bilan himoyalangan', () => {
  assert.ok(/usage: 'settings:read'/.test(adminSrc));
});
await it('buyruqlar soni "taxminiy" deb belgilangan', () => {
  assert.ok(/approximate: true/.test(adminSrc));
});

console.log(`\n==== ${passed} passed, ${failed} failed ====`);
process.exit(failed ? 1 : 0);
