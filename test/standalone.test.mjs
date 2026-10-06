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

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
