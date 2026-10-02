/**
 * Akkauntni o'chirish testi.
 *
 * Eng muhim savol: nima o'chadi va nima QOLADI. Shuning uchun har bir
 * tekshiruv ikki tomonlama — o'chishi kerak bo'lgani o'chdimi, va
 * ikkinchi odamning ma'lumoti joyidami.
 */
import assert from 'node:assert/strict';

/* ---- kv.js o'rniga xotiradagi soxta ombor ---- */
const store = new Map();
const sets = new Map();
const lists = new Map();

const kvmock = {
  kvGet: async (k) => (store.has(k) ? store.get(k) : null),
  kvSet: async (k, v) => { store.set(k, v); return true; },
  // Haqiqiy Redis'da DEL har qanday turdagi kalitni o'chiradi —
  // satrni ham, to'plamni ham, ro'yxatni ham.
  kvDel: async (k) => { store.delete(k); sets.delete(k); lists.delete(k); return true; },
  kvSadd: async (k, m) => { if (!sets.has(k)) sets.set(k, new Set()); sets.get(k).add(m); return true; },
  kvSrem: async (k, m) => { if (sets.has(k)) sets.get(k).delete(m); return true; },
  kvSmembers: async (k) => [...(sets.get(k) || [])],
  kvRange: async (k) => [...(lists.get(k) || [])],
};

/* storage.js — R2 ga chiqmaymiz, faqat chaqirilganini yozib boramiz */
const deletedObjects = [];
const storagemock = {
  keyFromUrl: (url) => (typeof url === 'string' && url.includes('r2.dev/') ? url.split('r2.dev/')[1] : null),
  deleteObject: async (key) => { deletedObjects.push(key); return true; },
};

const { default: Module } = await import('node:module');
const origResolve = Module._resolveFilename;
const origLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  return origLoad.call(this, request, parent, isMain);
};
Module._resolveFilename = origResolve;

/* ESM uchun import xaritasini qo'lda yasash o'rniga, modulni
   bog'liqliklari bilan birga chaqiramiz: deleteAccount.js faqat
   kv.js va storage.js dan foydalanadi, ikkalasini ham almashtiramiz. */
const { register } = await import('node:module');
const { pathToFileURL } = await import('node:url');

globalThis.__kvmock = kvmock;
globalThis.__storagemock = storagemock;

const loaderSrc = `
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('/kv.js')) return { url: 'mock:kv', shortCircuit: true };
  if (specifier.endsWith('/storage.js')) return { url: 'mock:storage', shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url === 'mock:kv') {
    return { format: 'module', shortCircuit: true, source:
      "const m = globalThis.__kvmock;" +
      "export const kvGet = m.kvGet; export const kvSet = m.kvSet; export const kvDel = m.kvDel;" +
      "export const kvSadd = m.kvSadd; export const kvSrem = m.kvSrem;" +
      "export const kvSmembers = m.kvSmembers; export const kvRange = m.kvRange;" };
  }
  if (url === 'mock:storage') {
    return { format: 'module', shortCircuit: true, source:
      "const m = globalThis.__storagemock;" +
      "export const keyFromUrl = m.keyFromUrl; export const deleteObject = m.deleteObject;" };
  }
  return next(url, context);
}`;
register(`data:text/javascript,${encodeURIComponent(loaderSrc)}`, pathToFileURL('./'));

const { deleteAccount, anonymiseOrder, anonymiseTruck, activeOrdersFor, DELETED_NAME } =
  await import('../lib/deleteAccount.js');

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

const ME = 'me@x.uz';
const OTHER = 'tg:777';

const reset = () => {
  store.clear(); sets.clear(); lists.clear(); deletedObjects.length = 0;

  store.set(`profile:${ME}`, JSON.stringify({
    username: 'ali_driver', displayName: 'Ali', phone: '+998901112233',
    avatarUrl: 'https://pub-abc.r2.dev/avatar/2026-10/aaa.jpg',
    ratingCount: 3, ratingSum: 14,
  }));
  store.set(`profile:${OTHER}`, JSON.stringify({ username: 'bek', displayName: 'Bek', ratingCount: 2, ratingSum: 9 }));
  store.set('username:ali_driver', ME);
  store.set('username:bek', OTHER);
  store.set(`tgChat:${ME}`, '555');
  store.set('tgIdToEmail:555', ME);
  store.set('telegram:555', '{}');
  store.set('phoneOwner:+998901112233', ME);
  store.set('phoneChat:+998901112233', '555');
  store.set(`searches:${ME}`, JSON.stringify([{ fromCity: 'Toshkent' }]));
  store.set(`notifs:${ME}`, '[]');
  store.set(`notifs_seen:${ME}`, '0');
  store.set(`truck_favs:${ME}`, '[]');
  store.set(`saved_loads:${ME}`, '[]');
  store.set(`reviews:${ME}`, '[]');
  store.set(`verifydoc:${ME}:IDENTITY`, 'data:image/jpeg;base64,AAAA');
  store.set(`verifydoc:${ME}:LICENSE`, 'data:image/jpeg;base64,BBBB');
  sets.set(`search_cities:Toshkent`, new Set([ME, OTHER]));
  sets.set(`inbox:${ME}`, new Set([OTHER]));
  sets.set(`inbox:${OTHER}`, new Set([ME]));
  store.set(`chatUnread:${ME}:${OTHER}`, '2');
  store.set(`chatUnread:${OTHER}:${ME}`, '1');
  store.set('msg:1', JSON.stringify({ id: 1, from: ME, text: 'salom' }));

  // Buyurtmalar: biri meniki va tugagan, biri meniki va hali ochiq,
  // biri butunlay boshqa odamniki.
  store.set('order:YL-1', JSON.stringify({ code: 'YL-1', ownerIdentity: ME, name: 'Ali', phone: '+998901112233', status: 'DELIVERED', fromCity: 'Toshkent', toCity: 'Samarqand' }));
  store.set('order:YL-2', JSON.stringify({ code: 'YL-2', ownerIdentity: ME, name: 'Ali', phone: '+998901112233', status: 'NEW' }));
  store.set('order:YL-3', JSON.stringify({ code: 'YL-3', ownerIdentity: OTHER, name: 'Bek', phone: '+998905556677', status: 'NEW' }));
  lists.set('order_codes', ['YL-1', 'YL-2', 'YL-3']);

  store.set('truck:t1', JSON.stringify({ id: 't1', sellerIdentity: ME, sellerName: 'Ali', sellerUsername: 'ali_driver', phone: '+998901112233', brand: 'Isuzu', status: 'ACTIVE' }));
  store.set('truck:t2', JSON.stringify({ id: 't2', sellerIdentity: OTHER, sellerName: 'Bek', phone: '+998905556677', brand: 'Kamaz', status: 'ACTIVE' }));
  sets.set('truck_ids', new Set(['t1', 't2']));
};

const run = async () => deleteAccount(ME, {
  orderCodes: await kvmock.kvRange('order_codes'),
  truckIds: await kvmock.kvSmembers('truck_ids'),
});

const j = (k) => JSON.parse(store.get(k));

console.log('\n== shaxsiy ma\'lumot o\'chadi ==');
reset(); await run();
await it('profil o\'chdi', () => assert.equal(store.get(`profile:${ME}`), undefined));
await it('tasdiqlash hujjatlari o\'chdi (pasport, guvohnoma)', () => {
  assert.equal(store.get(`verifydoc:${ME}:IDENTITY`), undefined);
  assert.equal(store.get(`verifydoc:${ME}:LICENSE`), undefined);
});
await it('avatar fayli R2 dan o\'chirildi', () => assert.deepEqual(deletedObjects, ['avatar/2026-10/aaa.jpg']));
await it('telefon bog\'lanishi o\'chdi', () => {
  assert.equal(store.get('phoneOwner:+998901112233'), undefined);
  assert.equal(store.get('phoneChat:+998901112233'), undefined);
});
await it('Telegram bog\'lanishi o\'chdi', () => {
  assert.equal(store.get(`tgChat:${ME}`), undefined);
  assert.equal(store.get('tgIdToEmail:555'), undefined);
  assert.equal(store.get('telegram:555'), undefined);
});
await it('saqlangan qidiruv va uning shahar indeksi o\'chdi', () => {
  assert.equal(store.get(`searches:${ME}`), undefined);
  assert.ok(!sets.get('search_cities:Toshkent').has(ME));
});
await it('bildirishnoma, saralangan, baholar o\'chdi', () => {
  for (const k of [`notifs:${ME}`, `notifs_seen:${ME}`, `truck_favs:${ME}`, `saved_loads:${ME}`, `reviews:${ME}`]) {
    assert.equal(store.get(k), undefined, k + ' qoldi');
  }
});
await it('yozishmalar ro\'yxati va hisoblagichlar o\'chdi', () => {
  assert.equal(sets.get(`inbox:${ME}`), undefined);
  assert.equal(store.get(`chatUnread:${ME}:${OTHER}`), undefined);
  assert.equal(store.get(`chatUnread:${OTHER}:${ME}`), undefined);
});

console.log('\n== ikkinchi tomonning ma\'lumoti saqlanadi ==');
await it('suhbatdoshning profili tegilmadi', () => assert.equal(j(`profile:${OTHER}`).displayName, 'Bek'));
await it('suhbatdoshning reytingi o\'zgarmadi', () => {
  assert.equal(j(`profile:${OTHER}`).ratingCount, 2);
  assert.equal(j(`profile:${OTHER}`).ratingSum, 9);
});
await it('xabarlarning o\'zi o\'chmadi', () => assert.ok(store.get('msg:1')));
await it('begona buyurtmaga tegilmadi', () => {
  const o = j('order:YL-3');
  assert.equal(o.name, 'Bek');
  assert.equal(o.phone, '+998905556677');
});
await it('begona e\'longa tegilmadi', () => {
  const t = j('truck:t2');
  assert.equal(t.sellerName, 'Bek');
  assert.equal(t.status, 'ACTIVE');
});

console.log('\n== tarix anonim bo\'ladi, yo\'qolmaydi ==');
await it('tugagan buyurtma qoldi', () => assert.ok(store.get('order:YL-1')));
await it('tugagan buyurtmadan ism va telefon olib tashlandi', () => {
  const o = j('order:YL-1');
  assert.equal(o.name, DELETED_NAME);
  assert.equal(o.phone, '');
  assert.equal(o.ownerIdentity, null);
  assert.equal(o.ownerDeleted, true);
});
await it('yo\'nalish ma\'lumoti saqlanib qoldi', () => {
  const o = j('order:YL-1');
  assert.equal(o.fromCity, 'Toshkent');
  assert.equal(o.toCity, 'Samarqand');
  assert.equal(o.status, 'DELIVERED');
});
await it('hali olinmagan yuk bekor qilindi (egasi yo\'q)', () => assert.equal(j('order:YL-2').status, 'CANCELLED'));
await it('mashina e\'loni sotuvdan olindi', () => {
  const t = j('truck:t1');
  assert.equal(t.status, 'REMOVED');
  assert.equal(t.sellerName, DELETED_NAME);
  assert.equal(t.phone, '');
  assert.equal(t.sellerUsername, null);
});

console.log('\n== username boshqa odamga o\'tib ketmaydi ==');
await it('username bo\'shatilmadi, band bo\'lib qoldi', () => {
  const v = store.get('username:ali_driver');
  assert.ok(v && v.startsWith('deleted:'), 'qiymat: ' + v);
});
await it('band nom boshqa odamnikiga aylanmadi', () => assert.notEqual(store.get('username:ali_driver'), ME));
await it('begona username tegilmadi', () => assert.equal(store.get('username:bek'), OTHER));

console.log('\n== yo\'ldagi buyurtma tekshiruvi ==');
reset();
store.set('order:YL-2', JSON.stringify({ code: 'YL-2', ownerIdentity: ME, status: 'ON_THE_WAY' }));
await it('yo\'ldagi buyurtma topiladi', async () => {
  const active = await activeOrdersFor(ME, ['YL-1', 'YL-2', 'YL-3']);
  assert.deepEqual(active, ['YL-2']);
});
await it('tugagan buyurtma to\'sqinlik qilmaydi', async () => {
  const active = await activeOrdersFor(OTHER, ['YL-1', 'YL-2', 'YL-3']);
  assert.deepEqual(active, []);
});
await it('haydovchi sifatida yo\'lda bo\'lsa ham topiladi', async () => {
  store.set('order:YL-9', JSON.stringify({ code: 'YL-9', ownerIdentity: OTHER, driver: { identity: ME }, status: 'LOADED' }));
  const active = await activeOrdersFor(ME, ['YL-9']);
  assert.deepEqual(active, ['YL-9']);
});

console.log('\n== alohida funksiyalar ==');
await it('anonymiseOrder begona yozuvga null qaytaradi', () => {
  assert.equal(anonymiseOrder({ ownerIdentity: OTHER }, ME), null);
});
await it('anonymiseTruck begona e\'longa null qaytaradi', () => {
  assert.equal(anonymiseTruck({ sellerIdentity: OTHER }, ME), null);
});
await it('haydovchi tomoni ham anonim bo\'ladi', () => {
  const next = anonymiseOrder({ ownerIdentity: OTHER, driver: { identity: ME, name: 'Ali', phone: '+998901112233' }, status: 'DELIVERED' }, ME);
  assert.equal(next.driver.name, DELETED_NAME);
  assert.equal(next.driver.phone, '');
  assert.equal(next.driver.deleted, true);
  assert.equal(next.name, undefined, 'yuk beruvchiga tegmasligi kerak edi');
});

console.log(`\n==== ${passed} passed, ${failed} failed ====`);
process.exit(failed ? 1 : 0);
