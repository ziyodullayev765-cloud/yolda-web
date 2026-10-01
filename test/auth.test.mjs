/**
 * Telefon raqami orqali kirish (api/auth-phone.js + lib/phoneAuth.js).
 *
 * Run with:  npm test
 *
 * Boshqa to'plamlar bilan bir xil shakl: lib/kv.js xotiradagi nusxaga
 * almashtiriladi va global.fetch yozib oluvchiga — shuning uchun hech
 * qanday so'rov tashqariga chiqmaydi.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
process.env.TELEGRAM_BOT_USERNAME = 'yoldatestbot';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const work = mkdtempSync(join(tmpdir(), 'yolda-auth-test-'));

const store = new Map();
globalThis.__store = store;

writeFileSync(join(work, 'kvmock.mjs'), `
export const kvConfigured = true;
const store = globalThis.__store;
export const kvGet = async (k) => store.has(k) ? store.get(k) : null;
export const kvSet = async (k, v) => { store.set(k, String(v)); return true; };
export const kvDel = async (k) => { store.delete(k); return true; };
export const kvSadd = async () => true;
export const kvSrem = async () => true;
export const kvSmembers = async () => [];
export const kvSismember = async () => false;
export const kvPush = async () => true;
export const kvRange = async () => [];
export const kvKeys = async () => [];
`);

const kvMock = JSON.stringify(join(work, 'kvmock.mjs'));
const phoneAuthPath = join(work, 'phoneauth.mjs');

/** Modulni vaqtinchalik papkaga ko'chiradi, kv.js o'rniga mock qo'yadi. */
const copy = (relPath, name, extra = {}) => {
  let src = readFileSync(join(repo, relPath), 'utf8')
    .replaceAll("'./kv.js'", kvMock)
    .replaceAll("'../lib/kv.js'", kvMock)
    .replaceAll("'./phoneAuth.js'", JSON.stringify(phoneAuthPath))
    .replaceAll("'../lib/phoneAuth.js'", JSON.stringify(phoneAuthPath));
  for (const [from, to] of Object.entries(extra)) src = src.replaceAll(from, JSON.stringify(to));
  src = src
    .replace(/'\.\.\/lib\/([\w.]+)'/g, (_, f) => JSON.stringify(join(repo, 'lib', f)))
    .replace(/'\.\/([\w.]+\.js)'/g, (_, f) => JSON.stringify(join(repo, 'lib', f)));
  const out = join(work, `${name}.mjs`);
  writeFileSync(out, src);
  return out;
};

copy('lib/phoneAuth.js', 'phoneauth');
const handler = (await import(copy('api/auth-phone.js', 'authphone'))).default;
const { resolveIdentity } = await import(copy('lib/identity.js', 'identity'));

/* --- fetch recorder: botga ketadigan har bir xabar shu yerda qoladi --- */
let sent = [];
globalThis.fetch = async (url, init) => {
  sent.push({ url, body: JSON.parse(init.body) });
  return { status: 200, json: async () => ({ ok: true, result: {} }) };
};

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail === undefined ? '' : '  → ' + JSON.stringify(detail))); }
};

const call = async (body) => {
  let status = 0, payload = null;
  await handler({ method: 'POST', body }, {
    status(s) { status = s; return this; },
    json(j) { payload = j; return this; },
    setHeader() {},
  });
  return { status, payload };
};

const PHONE = '+998901234567';
const code = () => store.get(`otpOut:${PHONE}`);
/** Taymerni va soatlik hisoblagichni tozalaydi — vaqt kutmaslik uchun. */
const clearThrottle = () => { store.delete(`otp:${PHONE}`); store.delete(`otpRate:${PHONE}`); };

/* ---------------------------------------------------------- */
console.log('\n== ro\'yxatdan o\'tish ==');
let r = await call({ action: 'register-start', phone: '90 123 45 67', firstName: 'Ali', lastName: 'Valiyev', terms: true });
check('raqam har qanday ko\'rinishda qabul qilinadi', r.status === 200 && r.payload.phone === PHONE, r.payload);
check('bot hali bu raqamni bilmaydi', r.payload.delivery === 'bot', r.payload);
check('kod to\'rt xonali', /^\d{4}$/.test(code() || ''), code());
check('kod brauzerga qaytarilmaydi', !JSON.stringify(r.payload).includes(code()));
check('shartlarsiz ro\'yxat yo\'q',
  (await call({ action: 'register-start', phone: '901112233', firstName: 'A', lastName: 'B', terms: false })).status === 400);
check('noto\'g\'ri raqam rad etiladi',
  (await call({ action: 'register-start', phone: '123', firstName: 'Ali', lastName: 'Valiyev', terms: true })).status === 400);

console.log('\n== kodni tekshirish ==');
const wrong = String((Number(code()) + 1) % 10000).padStart(4, '0');
check('noto\'g\'ri kod rad etiladi', (await call({ action: 'verify', phone: PHONE, code: wrong })).status === 400);
const good = code();
r = await call({ action: 'verify', phone: PHONE, code: good });
check('to\'g\'ri kod qabul qilinadi', r.status === 200 && typeof r.payload.setupToken === 'string', r.payload);
check('ishlatilgan kod o\'chadi', !code());
const setupToken = r.payload.setupToken;

console.log('\n== parol ==');
check('qisqa parol rad etiladi',
  (await call({ action: 'set-password', phone: PHONE, setupToken, password: 'qisqa' })).status === 400);
check('faqat harfdan iborat parol rad etiladi',
  (await call({ action: 'set-password', phone: PHONE, setupToken, password: 'salomlar' })).status === 400);
r = await call({ action: 'set-password', phone: PHONE, setupToken, password: 'Salom1234' });
check('parol saqlanadi va token beriladi', r.status === 200 && typeof r.payload.phoneToken === 'string', r.payload);
check('ism profilga yoziladi', r.payload.name === 'Ali Valiyev', r.payload);
check('parol ochiq saqlanmaydi', !JSON.stringify([...store.entries()]).includes('Salom1234'));
check('profil yozuvi yaratildi', store.has('profile:ph:998901234567'));
check('telefon tasdiqlangan deb belgilandi',
  JSON.parse(store.get('profile:ph:998901234567')).verifications.PHONE.status === 'VERIFIED');
const token = r.payload.phoneToken;

console.log('\n== kimligini aniqlash ==');
check('token identity beradi', (await resolveIdentity({ phoneToken: token }))?.identity === 'ph:998901234567');
check('o\'zgartirilgan token ishlamaydi', !(await resolveIdentity({ phoneToken: token.slice(0, -2) + 'xx' })));
check('tokensiz so\'rovda identity yo\'q', !(await resolveIdentity({})));
check('yasama token ishlamaydi', !(await resolveIdentity({ phoneToken: 'v1.aaa.bbb' })));

console.log('\n== kirish ==');
check('to\'g\'ri parol bilan kiriladi',
  (await call({ action: 'login', phone: PHONE, password: 'Salom1234' })).status === 200);
r = await call({ action: 'login', phone: PHONE, password: 'Boshqa1234' });
check('noto\'g\'ri parol rad etiladi', r.status === 401, r.payload);
const unknown = await call({ action: 'login', phone: '+998900000000', password: 'Salom1234' });
check('mavjud bo\'lmagan raqam ham xuddi shunday javob beradi',
  unknown.status === 401 && unknown.payload.error === r.payload.error, [r.payload, unknown.payload]);
check('bir raqam ikki marta ro\'yxatdan o\'tmaydi',
  (await call({ action: 'register-start', phone: PHONE, firstName: 'Ali', lastName: 'Valiyev', terms: true })).status === 409);

console.log('\n== parolni tiklash ==');
clearThrottle();
check('ro\'yxatdan o\'tmagan raqamga tiklash yo\'q',
  (await call({ action: 'login-start', phone: '+998900000000' })).status === 404);
await call({ action: 'login-start', phone: PHONE });
r = await call({ action: 'verify', phone: PHONE, code: code() });
r = await call({ action: 'set-password', phone: PHONE, setupToken: r.payload.setupToken, password: 'Yangi12345' });
check('yangi parol o\'rnatiladi', r.status === 200, r.payload);
check('eski qurilmadagi token kuchini yo\'qotadi', !(await resolveIdentity({ phoneToken: token })));
check('yangi token ishlaydi', (await resolveIdentity({ phoneToken: r.payload.phoneToken }))?.identity === 'ph:998901234567');
check('eski parol endi ishlamaydi',
  (await call({ action: 'login', phone: PHONE, password: 'Salom1234' })).status === 401);

console.log('\n== kodni yetkazish ==');
clearThrottle();
sent = [];
store.set(`phoneChat:${PHONE}`, '555001');
r = await call({ action: 'login-start', phone: PHONE });
check('bot biladigan raqamga kod darhol ketadi', r.payload.delivery === 'telegram', r.payload);
check('xabar o\'sha suhbatga yuboriladi', sent.length === 1 && String(sent[0].body.chat_id) === '555001', sent);
check('kod xabar ichida bor', /\d{4}/.test(sent[0].body.text), sent[0].body.text);
check('yetkazilgandan keyin kod saqlanmaydi', !store.has(`otpOut:${PHONE}`));

console.log('\n== cheklovlar ==');
check('60 soniya ichida qayta yuborilmaydi', (await call({ action: 'resend', phone: PHONE })).status === 429);
clearThrottle();
await call({ action: 'login-start', phone: PHONE });
const real = code();
const bad = String((Number(real) + 7) % 10000).padStart(4, '0');
for (let i = 0; i < 5; i += 1) await call({ action: 'verify', phone: PHONE, code: bad });
check('besh marta xato kiritilsa kod bekor bo\'ladi',
  (await call({ action: 'verify', phone: PHONE, code: real })).status === 400);

console.log('\n== endpoint ==');
let st = 0;
await handler({ method: 'GET', body: {} }, { status(s) { st = s; return this; }, json() { return this; } });
check('GET so\'rov rad etiladi', st === 405);
check('noma\'lum amal rad etiladi', (await call({ action: 'nimadir' })).status === 400);

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
