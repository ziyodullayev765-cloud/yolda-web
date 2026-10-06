/**
 * Yolda Telegramsiz ham ishlaydimi.
 *
 * Bu to'plam bitta narsani isbotlaydi: yuk joylash endi Telegram
 * guruhiga bog'liq emas. Ilgari `api/order.js` da shunday to'siq
 * bor edi —
 *
 *     if (!BOT_TOKEN || !GROUP_ID) return 500 "Server sozlanmagan"
 *
 * — ya'ni bot tokeni yoki guruh id'si bo'lmasa, platforma umuman yuk
 * qabul qilmasdi. Shuning uchun bu yerda ikkala sozlama ham ATAYLAB
 * o'chirilgan holda ishga tushiriladi.
 *
 * Qolgan to'plamlardagi kabi: lib/kv.js xotiradagi nusxa bilan
 * almashtiriladi, global.fetch esa yozib boruvchi bilan — ya'ni
 * testdan birorta ham tarmoq so'rovi chiqmaydi. Aynan shu yozuv
 * "Telegramga hech narsa yuborilmadi" degan tasdiqni beradi.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ATAYLAB bo'sh: Telegram sozlanmagan muhitni taqlid qilamiz.
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_GROUP_ID;
delete process.env.TELEGRAM_BOT_USERNAME;

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const work = mkdtempSync(join(tmpdir(), 'yolda-standalone-test-'));

const store = new Map();
const sets = new Map();
const lists = new Map();
globalThis.__store = store;
globalThis.__sets = sets;
globalThis.__lists = lists;
globalThis.__kvWritesFail = false;

writeFileSync(join(work, 'kvmock.mjs'), `
export const kvConfigured = true;
const store = globalThis.__store, sets = globalThis.__sets, lists = globalThis.__lists;
export const kvGet = async (k) => store.has(k) ? store.get(k) : null;
export const kvSet = async (k, v) => {
  if (globalThis.__kvWritesFail) return false;
  store.set(k, v); return true;
};
export const kvDel = async (k) => { store.delete(k); return true; };
export const kvSadd = async (k, m) => { if(!sets.has(k)) sets.set(k, new Set()); sets.get(k).add(m); return true; };
export const kvSrem = async (k, m) => { if(sets.has(k)) sets.get(k).delete(m); return true; };
export const kvSmembers = async (k) => sets.has(k) ? [...sets.get(k)] : [];
export const kvSismember = async (k, m) => sets.has(k) && sets.get(k).has(m);
export const kvPush = async (k, v) => { if(!lists.has(k)) lists.set(k, []); lists.get(k).unshift(v); return true; };
export const kvRange = async (k) => lists.has(k) ? lists.get(k) : [];
export const kvKeys = async () => [];
export const kvIncr = async () => 1;
export const kvDbSize = async () => 0;
export const kvUsedMemory = async () => 0;
export const kvMonthCommands = async () => 0;
export const usageKey = 'usage';
`);

writeFileSync(join(work, 'identitymock.mjs'), `
export const resolveEmail = async ({ googleIdToken, telegramInitData } = {}) =>
  googleIdToken || telegramInitData || null;
export const resolveIdentity = async (creds) => {
  const identity = await resolveEmail(creds);
  return identity ? { identity, method: 'google' } : null;
};
export const tgIdentity = (id) => 'tg:' + id;
export const createTelegramLinkCode = async () => ({ error: 'not under test' });
export const redeemTelegramLinkCode = async () => ({ error: 'not under test' });
`);

const load = async (relPath, name) => {
  const kvMock = JSON.stringify(join(work, 'kvmock.mjs'));
  const src = readFileSync(join(repo, relPath), 'utf8')
    .replaceAll("'./kv.js'", kvMock)
    .replaceAll("'../lib/kv.js'", kvMock)
    .replaceAll("'../lib/identity.js'", JSON.stringify(join(work, 'identitymock.mjs')))
    .replace(/'\.\.\/lib\/([\w.]+)'/g, (_, f) => JSON.stringify(join(repo, 'lib', f)))
    .replace(/'\.\/([\w.]+\.js)'/g, (_, f) => JSON.stringify(join(repo, 'lib', f)));
  const out = join(work, `${name}.mjs`);
  writeFileSync(out, src);
  return import(out);
};

/* --- fetch yozuvchisi: bironta so'rov tashqariga chiqmaydi --- */
let outgoing = [];
globalThis.fetch = async (url, init) => {
  outgoing.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
  return { status: 200, ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
};

const orderMod = await load('api/order.js', 'order_under_test');
const order = orderMod.default;

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail === undefined ? '' : '  → ' + JSON.stringify(detail))); }
};

/** Vercel javob obyektining eng kichik nusxasi. */
const makeRes = () => {
  const r = { statusCode: 0, payload: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.payload = b; return r; };
  r.setHeader = () => r;
  r.end = () => r;
  return r;
};

const newLoad = (extra = {}) => ({
  googleIdToken: 'shipper@example.com',
  fromCity: 'Toshkent',
  toCity: 'Samarqand',
  weightKg: 12000,
  cargoType: 'GENERAL',
  name: 'Alisher',
  phone: '+998901234567',
  ...extra,
});

const postOrder = async (body) => {
  const res = makeRes();
  await order({ method: 'POST', query: {}, body }, res);
  return res;
};

/* ============================================================ */
console.log('\n== Telegramsiz yuk joylash ==');
{
  outgoing = [];
  const res = await postOrder(newLoad());

  check('Telegram sozlanmagan bo\'lsa ham yuk joylandi', res.statusCode === 200,
    { status: res.statusCode, body: res.payload });
  check('kod qaytarildi', Boolean(res.payload && res.payload.code), res.payload);
  check('narx hisoblandi', Number(res.payload && res.payload.amount) > 0, res.payload);

  // ENG MUHIM TASDIQ: hech qayerga so'rov ketmadi.
  const toTelegram = outgoing.filter((o) => o.url.includes('api.telegram.org'));
  check('Telegramga BIRORTA ham so\'rov ketmadi', toTelegram.length === 0,
    toTelegram.map((o) => o.url));

  const code = res.payload && res.payload.code;
  const saved = store.get(`order:${code}`);
  check('yuk bazaga saqlandi', Boolean(saved), code);
  if (saved) {
    const parsed = JSON.parse(saved);
    check('holati NEW', parsed.status === 'NEW', parsed.status);
    check('egasi yozildi', parsed.ownerIdentity === 'shipper@example.com', parsed.ownerIdentity);
    check('guruh xabari id\'si umuman yo\'q', !('groupMessageId' in parsed),
      Object.keys(parsed).filter((k) => k.toLowerCase().includes('group')));
  }
  check('kodlar ro\'yxatiga qo\'shildi', (lists.get('order_codes') || []).includes(code), code);
}

/* ============================================================ */
console.log('\n== joylangan yuk ro\'yxatda ko\'rinadi ==');
{
  const res = makeRes();
  await order({ method: 'GET', query: { action: 'list' }, body: {} }, res);
  check('ro\'yxat berildi', res.statusCode === 200, res.statusCode);
  const loads = (res.payload && res.payload.loads) || [];
  check('yangi yuk ro\'yxatda bor', loads.some((l) => l.fromCity === 'Toshkent' && l.toCity === 'Samarqand'),
    loads.length);
}

/* ============================================================ */
console.log('\n== baza yozmasa, soxta muvaffaqiyat qaytmaydi ==');
{
  /* Boshqa raqam: bitta raqamdan ketma-ket joylashni throttle
     to'xtatadi (bu o'z o'rnida to'g'ri himoya), bu yerda esa biz
     bazaning xatosini sinamoqchimiz. */
  globalThis.__kvWritesFail = true;
  const res = await postOrder(newLoad({ toCity: 'Buxoro', phone: '+998901119988' }));
  globalThis.__kvWritesFail = false;

  check('xato qaytdi, "ok" emas', res.statusCode >= 500, { status: res.statusCode, body: res.payload });
  check('foydalanuvchiga tushunarli xabar',
    Boolean(res.payload && res.payload.error && !/undefined|null|Error:/.test(res.payload.error)),
    res.payload);
}

/* ============================================================ */
console.log('\n== tekshiruv hali ham ishlaydi ==');
{
  const bad = await postOrder(newLoad({ weightKg: 0, phone: '+998901112233' }));
  check('noto\'g\'ri og\'irlik rad etildi', bad.statusCode === 400, bad.statusCode);

  const same = await postOrder(newLoad({ toCity: 'Toshkent', phone: '+998901112244' }));
  check('bir xil shahar rad etildi', same.statusCode === 400, same.statusCode);

  const anon = await postOrder({ ...newLoad(), phone: '+998901112255', googleIdToken: undefined });
  check('kirmagan odam yuk joylay olmaydi', anon.statusCode === 401, anon.statusCode);
}

/* ============================================================
   Haydovchi yukdan voz kechishi ilovaning o'zida ishlaydi.

   Ilgari bu faqat Telegram guruhidagi xabar ostidagi tugma
   edi. Guruh olib tashlangach imkoniyat yo'qolmasligi kerak:
   quyidagi tekshiruvlar aynan shuni isbotlaydi. */
console.log('\n== haydovchi yukdan voz kechadi (ilovada) ==');
{
  const made = await postOrder(newLoad({ toCity: 'Navoiy', phone: '+998901114455' }));
  const code = made.payload.code;

  /* Haydovchini qo'lda biriktiramiz: taklif/qabul zanjiri bu
     to'plamning mavzusi emas, bizga faqat "yuk haydovchida"
     holati kerak. */
  const attach = (status) => {
    const o = JSON.parse(store.get(`order:${code}`));
    o.status = status;
    o.driver = { identity: 'driver@example.com', name: 'Bekzod', telegramId: null };
    store.set(`order:${code}`, JSON.stringify(o));
  };
  const giveUp = async (body) => {
    const res = makeRes();
    await order({ method: 'POST', query: { action: 'giveup' }, body }, res);
    return res;
  };

  attach('ON_THE_WAY');

  const stranger = await giveUp({ googleIdToken: 'nobody@example.com', code });
  check('begona odam voz kecha olmaydi', stranger.statusCode === 403,
    { status: stranger.statusCode, body: stranger.payload });

  const anon = await giveUp({ code });
  check('kirmagan odam voz kecha olmaydi', anon.statusCode === 401, anon.statusCode);

  /* Egasining o'zi ham bu yo'ldan yurmaydi — unda `release` bor. */
  const owner = await giveUp({ googleIdToken: 'shipper@example.com', code });
  check('yuk egasi haydovchi yo\'lidan yurmaydi', owner.statusCode === 403, owner.statusCode);

  outgoing = [];
  const res = await giveUp({
    googleIdToken: 'driver@example.com', code, reason: 'Mashina buzildi',
  });
  check('haydovchi voz kechdi', res.statusCode === 200,
    { status: res.statusCode, body: res.payload });

  const after = JSON.parse(store.get(`order:${code}`));
  check('yuk yana ochiq (NEW)', after.status === 'NEW', after.status);
  check('haydovchi ajratildi', after.driver === null, after.driver);
  check('jurnalda haydovchi voz kechgani yozildi',
    after.releases && after.releases.length === 1 && after.releases[0].by === 'DRIVER',
    after.releases);
  check('sabab saqlandi', after.releases[0].reason === 'Mashina buzildi', after.releases[0]);
  check('voz kechishda ham Telegramga so\'rov ketmadi',
    outgoing.filter((o) => o.url.includes('api.telegram.org')).length === 0,
    outgoing.map((o) => o.url));

  /* Ikkinchi marta bosilsa — endi haydovchi yo'q, 403. */
  const twice = await giveUp({ googleIdToken: 'driver@example.com', code });
  check('ikkinchi marta voz kechib bo\'lmaydi', twice.statusCode === 403, twice.statusCode);

  /* Yetkazilgandan keyin ortga yo'l yo'q. */
  attach('DELIVERED');
  const late = await giveUp({ googleIdToken: 'driver@example.com', code });
  check('yetkazilgan yukdan voz kechilmaydi', late.statusCode === 409,
    { status: late.statusCode, body: late.payload });
}

/* ============================================================
   Bir haydovchi — bir yuk.

   "Mening yukim" bo'limi aynan shu qoidaga tayanadi: bo'limda
   bitta yuk turadi, chunki haydovchida ham bitta yuk bo'ladi.
   Quyidagilar shu qoidani va bo'limni to'ldiradigan so'rovni
   tekshiradi. */
console.log('\n== bir haydovchi bir yuk olib ketadi ==');
{
  const DRIVER = 'driver2@example.com';
  store.set(`profile:${DRIVER}`, JSON.stringify({
    displayName: 'Sardor', phone: '+998901234000', username: 'sardor',
  }));
  store.set('profile:shipper@example.com', JSON.stringify({
    displayName: 'Alisher Qodirov', username: 'alisher', verified: true,
  }));

  const call = async (action, body, method = 'POST') => {
    const res = makeRes();
    const req = method === 'GET'
      ? { method: 'GET', query: { action, ...body }, body: {} }
      : { method: 'POST', query: { action }, body };
    await order(req, res);
    return res;
  };

  // Ikkita yuk, bitta yuk beruvchidan.
  const a = await postOrder(newLoad({ toCity: 'Qarshi', phone: '+998901230001' }));
  const b = await postOrder(newLoad({ toCity: 'Termiz', phone: '+998901230002' }));
  check('ikkita yuk joylandi', a.statusCode === 200 && b.statusCode === 200,
    { a: a.statusCode, b: b.statusCode });
  const codeA = a.payload.code, codeB = b.payload.code;

  // Haydovchi ikkalasiga ham taklif yuboradi — bu ruxsat etilgan.
  const offA = await call('offer', { googleIdToken: DRIVER, code: codeA, price: 900000 });
  const offB = await call('offer', { googleIdToken: DRIVER, code: codeB, price: 950000 });
  check('ikkala yukka ham taklif yuborildi',
    offA.statusCode === 200 && offB.statusCode === 200,
    { a: offA.statusCode, b: offB.statusCode });

  // Birinchisi qabul qilinadi.
  const ok = await call('accept-offer', {
    googleIdToken: 'shipper@example.com', id: offA.payload.offer.id,
  });
  check('birinchi taklif qabul qilindi', ok.statusCode === 200,
    { status: ok.statusCode, body: ok.payload });

  // ASOSIY TASDIQ: ikkinchisi endi qabul qilinmaydi.
  const busy = await call('accept-offer', {
    googleIdToken: 'shipper@example.com', id: offB.payload.offer.id,
  });
  check('band haydovchining ikkinchi taklifi qabul qilinmadi', busy.statusCode === 409,
    { status: busy.statusCode, body: busy.payload });
  check('sabab tushunarli aytildi',
    Boolean(busy.payload && /boshqa yukni/.test(busy.payload.error)), busy.payload);
  check('ikkinchi yuk hali ham ochiq',
    JSON.parse(store.get(`order:${codeB}`)).status === 'NEW',
    JSON.parse(store.get(`order:${codeB}`)).status);

  /* ---- "Mening yukim" bitta yukni to'liq beradi ---- */
  const mine = await call('my-load', { googleIdToken: DRIVER }, 'GET');
  check('my-load javob berdi', mine.statusCode === 200, mine.statusCode);
  const L = mine.payload && mine.payload.load;
  check('aynan qabul qilingan yuk qaytdi', Boolean(L) && L.code === codeA,
    L && L.code);
  check('yo\'nalish bor', Boolean(L) && L.fromCity === 'Toshkent' && L.toCity === 'Qarshi', L);
  check('kelishilgan narx qaytdi', Boolean(L) && L.amount === 900000 && L.agreed === true,
    L && { amount: L.amount, agreed: L.agreed });
  check('hozirgi bosqich va keyingi qadam bor',
    Boolean(L) && L.status === 'DRIVER_FOUND' && L.nextStatus === 'PICKING_UP',
    L && { status: L.status, next: L.nextStatus });
  check('yuk beruvchining telefoni biriktirilgan haydovchiga ochiq',
    Boolean(L && L.owner) && L.owner.phone === '+998901230001', L && L.owner);
  check('yuk beruvchining ismi profildan olindi',
    Boolean(L && L.owner) && L.owner.name === 'Alisher Qodirov', L && L.owner);

  /* Begonaga hech narsa ko'rinmaydi. */
  const stranger = await call('my-load', { googleIdToken: 'nobody@example.com' }, 'GET');
  check('begona odamda yuk yo\'q', stranger.statusCode === 200 && stranger.payload.load === null,
    stranger.payload);
  const anon = await call('my-load', {}, 'GET');
  check('kirmagan odamga berilmaydi', anon.statusCode === 401, anon.statusCode);

  /* ---- Haydovchi bo'shagach ikkinchi yukni olishi mumkin ---- */
  const up = await call('giveup', { googleIdToken: DRIVER, code: codeA });
  check('haydovchi birinchi yukdan voz kechdi', up.statusCode === 200, up.statusCode);

  const empty = await call('my-load', { googleIdToken: DRIVER }, 'GET');
  check('"Mening yukim" bo\'shadi', empty.payload.load === null, empty.payload);

  const second = await call('accept-offer', {
    googleIdToken: 'shipper@example.com', id: offB.payload.offer.id,
  });
  check('bo\'shagach ikkinchi taklif qabul qilindi', second.statusCode === 200,
    { status: second.statusCode, body: second.payload });
  const now = await call('my-load', { googleIdToken: DRIVER }, 'GET');
  check('endi "Mening yukim" ikkinchi yukni ko\'rsatadi',
    Boolean(now.payload.load) && now.payload.load.code === codeB,
    now.payload.load && now.payload.load.code);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
