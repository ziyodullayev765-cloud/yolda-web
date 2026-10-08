/**
 * Ikonkani tortib tashlab almashtirish.
 *
 *     node test/icondrop.test.mjs      (yoki npm test)
 *
 * NEGA KERAK. Ilgari ikonkani almashtirish uch qadam edi: rasmni
 * Chrome'dan saqlab olish → papkadan topish → "Rasm" tugmasi.
 * Endi rasmni to'g'ridan ikonkaning ustiga sudrab tashlasa bo'ladi.
 *
 * ENG MUHIM TASDIQ — SSRF. Brauzer sahifadan sudralgan rasmning
 * o'zini bermaydi, faqat MANZILINI beradi. Ya'ni serverga "mana shu
 * manzilga bor" deyiladi. Agar tekshirilmasa, admin (yoki uning
 * seansini o'g'irlagan odam) serverni ichki tarmoqqa — masalan
 * bulutdagi metadata xizmatiga, ya'ni kalitlar turgan joyga —
 * yuborishi mumkin. Quyida aynan shuni qilib ko'riladi.
 *
 * Tarmoqqa chiqmaymiz: `fetch` o'rnida o'z javobimiz turadi va har
 * bir so'rov yozib olinadi — demak "so'rov yuborilmadi" degan
 * tasdiqni ham qo'yish mumkin.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const work = mkdtempSync(join(tmpdir(), 'yolda-icondrop-'));

let passed = 0;
let failed = 0;
const check = (name, ok, extra) => {
  if (ok) { passed += 1; return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`);
};
const flow = (name) => console.log(`\n== ${name} ==`);

/* ============================================================
   Tarmoq o'rnini bosuvchi
   ============================================================ */
let calls = [];
/** Keyingi `fetch` nima qaytarishi. */
let reply = null;

const png = Buffer.from('fake-png-bytes');

const makeResponse = ({ status = 200, type = 'image/png', body = png, length } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: {
    get: (k) => {
      const key = String(k).toLowerCase();
      if (key === 'content-type') return type;
      if (key === 'content-length') {
        return length === null ? null : String(length === undefined ? body.length : length);
      }
      return null;
    },
  },
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  text: async () => body.toString(),
});

globalThis.fetch = async (url, opts) => {
  calls.push({ url: String(url), opts: opts || {} });
  // R2 ga yozish (SigV4 PUT) — har doim muvaffaqiyatli.
  if (String(url).includes('r2.cloudflarestorage.com')) {
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => '' };
  }
  if (typeof reply === 'function') return reply(String(url), opts);
  return makeResponse(reply || {});
};

const { fetchRemoteImage, isPrivateAddress } = await import(join(repo, 'lib/remoteImage.js'));

/* ============================================================
   1. Ichki manzillar — ro'yxat
   ============================================================ */
flow('1. Ichki manzilni tanish');
{
  const inside = [
    '127.0.0.1', '10.0.0.5', '10.255.255.255', '172.16.0.1', '172.31.255.254',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', '::ffff:10.0.0.1',
  ];
  inside.forEach((ip) => check(`ichki: ${ip}`, isPrivateAddress(ip) === true, ip));

  const outside = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '192.169.0.1',
    '100.63.255.255', '2606:4700::1111'];
  outside.forEach((ip) => check(`tashqi: ${ip}`, isPrivateAddress(ip) === false, ip));

  check('bo‘sh qiymat ichki deb hisoblanadi', isPrivateAddress('') === true);
  check('null ichki deb hisoblanadi', isPrivateAddress(null) === true);
  check('manzil emas — ichki deb hisoblanadi', isPrivateAddress('salom') === true);

  /* 169.254.169.254 — bulutdagi metadata xizmati. Agar bu o'tib
     ketsa, serverning kalitlari o'g'irlanishi mumkin. */
  check('bulut metadata manzili berk', isPrivateAddress('169.254.169.254') === true);
}

/* ============================================================
   2. fetchRemoteImage qo'riqchilari
   ============================================================ */
flow('2. Manzilni olib kelish qoidalari');
{
  const MAX = 200 * 1024;

  calls = []; reply = null;
  const notHttps = await fetchRemoteImage('http://93.184.216.34/a.png', MAX);
  check('http rad etiladi', Boolean(notHttps.error), notHttps);
  check('http uchun so‘rov yuborilmadi', calls.length === 0, calls.length);

  calls = [];
  const bad = await fetchRemoteImage('bu manzil emas', MAX);
  check('noto‘g‘ri manzil rad etiladi', Boolean(bad.error), bad);
  check('noto‘g‘ri manzil uchun so‘rov yuborilmadi', calls.length === 0, calls.length);

  /* ENG MUHIMI: ichki manzil. IP to'g'ridan berilgani uchun DNS
     chaqirilmaydi — tekshiruv aynan shu yerda ishlashi kerak. */
  calls = [];
  const internal = await fetchRemoteImage('https://169.254.169.254/latest/meta-data/', MAX);
  check('bulut metadata manzili rad etiladi', Boolean(internal.error), internal);
  check('metadata manziliga SO‘ROV YUBORILMADI', calls.length === 0, calls);

  calls = [];
  const lan = await fetchRemoteImage('https://192.168.1.1/x.png', MAX);
  check('uy tarmog‘idagi manzil rad etiladi', Boolean(lan.error), lan);
  check('unga ham so‘rov yuborilmadi', calls.length === 0, calls);

  calls = [];
  const loop = await fetchRemoteImage('https://[::1]/x.png', MAX);
  check('IPv6 loopback rad etiladi', Boolean(loop.error), loop);
  check('IPv6 loopback‘ga so‘rov yuborilmadi', calls.length === 0, calls);

  // Yaxshi yo'l
  calls = []; reply = null;
  const ok = await fetchRemoteImage('https://93.184.216.34/rasm.png', MAX);
  check('tashqi rasm olib kelinadi', ok.dataUrl && ok.dataUrl.startsWith('data:image/png;base64,'), ok);
  check('hajmi qaytadi', ok.bytes === png.length, ok.bytes);
  check('so‘rov bir marta ketdi', calls.length === 1, calls.length);

  /* Yo'naltirish o'chirilgan bo'lishi KERAK: aks holda tashqi
     manzil ichki manzilga olib borardi va yuqoridagi tekshiruv
     bekor bo'lardi. */
  check('yo‘naltirish o‘chirilgan', calls[0].opts.redirect === 'error', calls[0].opts.redirect);
  check('kutish muddati bor', Boolean(calls[0].opts.signal), Object.keys(calls[0].opts));

  // Turlar
  reply = { type: 'text/html' };
  check('rasm bo‘lmagan javob rad etiladi',
    Boolean((await fetchRemoteImage('https://93.184.216.34/a', MAX)).error));

  reply = { type: 'image/svg+xml', body: Buffer.from('<svg onload="alert(1)"/>') };
  const svg = await fetchRemoteImage('https://93.184.216.34/a.svg', MAX);
  check('SVG olib kelinmaydi (ichida skript bo‘lishi mumkin)', Boolean(svg.error), svg);

  reply = { type: 'image/png; charset=binary' };
  check('turdagi qo‘shimcha to‘sqinlik qilmaydi',
    Boolean((await fetchRemoteImage('https://93.184.216.34/a.png', MAX)).dataUrl));

  reply = { status: 404 };
  check('404 rad etiladi', Boolean((await fetchRemoteImage('https://93.184.216.34/a.png', MAX)).error));

  reply = () => { throw new Error('tarmoq yo‘q'); };
  check('tarmoq xatosi yutilmaydi, ammo tashlanmaydi',
    Boolean((await fetchRemoteImage('https://93.184.216.34/a.png', MAX)).error));

  // Hajm
  reply = { length: MAX + 1 };
  check('sarlavhadagi katta hajm rad etiladi',
    Boolean((await fetchRemoteImage('https://93.184.216.34/a.png', MAX)).error));

  /* Sarlavhadagi hajm yolg'on bo'lishi mumkin — shuning uchun
     o'qilgandan keyin ham tekshiriladi. */
  reply = { body: Buffer.alloc(MAX + 10, 1), length: 10 };
  const lied = await fetchRemoteImage('https://93.184.216.34/a.png', MAX);
  check('sarlavha yolg‘on bo‘lsa ham hajm tekshiriladi', Boolean(lied.error), lied);

  reply = { body: Buffer.alloc(0) };
  check('bo‘sh javob rad etiladi',
    Boolean((await fetchRemoteImage('https://93.184.216.34/a.png', MAX)).error));

  reply = null;
}

/* ============================================================
   3. save-icon manzilni qabul qiladi
   ============================================================ */
flow('3. save-icon manzil bilan');

process.env.ADMIN_PASSWORD = 'super-secret-pw';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-hmac-secret';
process.env.R2_ACCOUNT_ID = 'acc';
process.env.R2_ACCESS_KEY_ID = 'key';
process.env.R2_SECRET_ACCESS_KEY = 'secret';
process.env.R2_BUCKET = 'yolda';
process.env.R2_PUBLIC_URL = 'https://pub-test.r2.dev';

const store = new Map();
globalThis.__store2 = store;
writeFileSync(join(work, 'kvmock.mjs'), `
const store = globalThis.__store2;
export const kvConfigured = true;
export const kvGet = async (k) => store.has(k) ? store.get(k) : null;
export const kvSet = async (k, v) => { store.set(k, v); return true; };
export const kvDel = async (k) => { store.delete(k); return true; };
export const kvSadd = async () => true;
export const kvSaddNew = async () => true;
export const kvExpire = async () => true;
export const kvSrem = async () => true;
export const kvSmembers = async () => [];
export const kvSismember = async () => false;
export const kvPush = async () => true;
export const kvRange = async () => [];
export const kvLrem = async () => true;
export const kvKeys = async () => [];
export const kvDbSize = async () => 0;
export const kvUsedMemory = async () => 0;
export const kvMonthCommands = async () => 0;
export const usageKey = () => 'usage:cmd:2026-10';
`);

const src = readFileSync(join(repo, 'api/admin-data.js'), 'utf8')
  .replaceAll("'../lib/kv.js'", JSON.stringify(join(work, 'kvmock.mjs')))
  .replace(/'\.\.\/lib\/([\w.]+)'/g, (_, f) => JSON.stringify(join(repo, 'lib', f)));
writeFileSync(join(work, 'admindata.mjs'), src);
const adminData = (await import(join(work, 'admindata.mjs'))).default;

/* Seansni qo'lda yasamaymiz — kodning o'zi yasaydi, aks holda
   test haqiqiy imzoni emas, o'zining taxminini sinagan bo'lardi. */
const { makeSessionToken } = await import(join(repo, 'lib/adminAuth.js'));
const cookie = `admin_session=${makeSessionToken('SUPER_ADMIN', Date.now() + 60000)}`;

const call = async (body) => {
  let code = 200; let out = null;
  const res = {
    setHeader() {}, status(c) { code = c; return this; },
    json(v) { out = v; return this; }, end() { return this; },
  };
  await adminData({
    method: 'POST', url: '/api/admin-data?action=save-icon',
    query: { action: 'save-icon' }, body,
    headers: { cookie, 'x-forwarded-proto': 'https' },
  }, res);
  return { code, body: out };
};

{
  // Seansni tekshirib ko'ramiz: cookie ishlamasa qolgani ma'nosiz.
  calls = []; reply = null;
  const direct = await call({ id: 'iconHome', dataUrl: `data:image/png;base64,${png.toString('base64')}` });
  check('fayl orqali almashtirish ishlayveradi', direct.code === 200, direct);

  // Manzil orqali
  calls = []; reply = null;
  const viaUrl = await call({ id: 'iconBox', url: 'https://93.184.216.34/rasm.png' });
  check('manzil orqali almashtiriladi', viaUrl.code === 200, viaUrl);
  check('havola qaytadi',
    typeof viaUrl.body.url === 'string' && viaUrl.body.url.startsWith('https://pub-test.r2.dev/icon/'),
    viaUrl.body);
  check('rasm olib kelindi va R2 ga yozildi',
    calls.some((c) => c.url.includes('93.184.216.34'))
    && calls.some((c) => c.url.includes('r2.cloudflarestorage.com')),
    calls.map((c) => c.url));
  check('bazada rasmning o‘zi emas, havola',
    !String(store.get('icon_overrides')).includes('base64'), store.get('icon_overrides'));

  // Ichki manzil — endpoint darajasida ham rad etilishi kerak.
  calls = [];
  const ssrf = await call({ id: 'iconBox', url: 'https://169.254.169.254/latest/meta-data/' });
  check('endpoint ichki manzilni rad etadi', ssrf.code === 400, ssrf);
  check('hech qanday so‘rov ketmadi', calls.length === 0, calls.map((c) => c.url));

  calls = [];
  const noneGiven = await call({ id: 'iconBox' });
  check('rasm ham, manzil ham yo‘q bo‘lsa rad etiladi', noneGiven.code === 400, noneGiven);

  calls = [];
  const badId = await call({ id: '../../etc', url: 'https://93.184.216.34/rasm.png' });
  check('nomi noto‘g‘ri bo‘lsa manzilga ham borilmaydi',
    badId.code === 400 && calls.length === 0, { badId, calls: calls.length });
}

/* ============================================================
   4. Admin paneldagi tomoni
   ============================================================ */
flow('4. Admin paneldagi tortib tashlash');
{
  const html = readFileSync(join(repo, 'admin.html'), 'utf8');

  check('kartochka tashlash maydoni', html.includes('data-icon-drop="'), 'data-icon-drop');
  check('tanlanadigan (Ctrl+V uchun)',
    html.includes('\' data-icon-drop="\' + esc(id) + \'" tabindex="0"\''),
    'tabindex kartochkaning o‘zida');
  check('ko‘rinadigan ishora bor', html.includes('icon-drop-hint'));
  check('ishora uslubi bor', html.includes('.icon-drop-hint{'));
  check('tashlash paytida kartochka belgilanadi', html.includes('.icon-card.drop-on'));
  check('yuklanayotgani ko‘rinadi', html.includes('.icon-card.busy'));
  check('tanlangani ko‘rinadi', html.includes('.icon-card.picked'));
  check('klaviatura bilan ham ko‘rinadi', /icon-card[^{]*:focus-visible/.test(html));

  check('tashlash hodisasi ulanadi', html.includes('"drop"'));
  check('qo‘yish (paste) ulanadi', html.includes('"paste"'));
  check('sudrab o‘tish ulanadi', html.includes('"dragover"'));

  /* Sahifaning bo'sh joyiga tashlab yuborilsa brauzer faylni
     ochib, admin paneldan chiqarib yuborardi. */
  check('nishonga tegmagan tashlash to‘xtatiladi',
    /\["dragover", "drop"\]\.forEach/.test(html), 'document qo‘riqchisi');

  check('manzildan rasm ajratiladi', html.includes('function imageUrlFromDrop'));
  check('uri-list o‘qiladi', html.includes('"text/uri-list"'));
  check('html bo‘lagidan <img src> olinadi', html.includes('text/html'));
  check('oddiy matn ham qaraladi', html.includes('"text/plain"'));

  check('avval brauzerda urinib ko‘riladi', html.includes('function iconDataUrlFromRemote'));
  check('CORS uchun crossOrigin qo‘yiladi', html.includes('crossOrigin = "anonymous"'));
  check('javob kelmasa kutib qolinmaydi', /setTimeout\(function\(\)\{ finish\(null\); \}, 6000\)/.test(html));

  check('manzil bo‘yicha yuklash bor', html.includes('function uploadIconUrl'));
  /* Brauzerda bo'lmasa serverga manzilning O'ZI beriladi —
     aks holda Chrome'dan tortib tashlash ishlamay qolardi. */
  check('brauzerda bo‘lmasa serverga manzil beriladi',
    /got\s*\n?\s*\? \{ id: id, dataUrl: got\.dataUrl, plain: got\.plain \}\s*\n?\s*: \{ id: id, url: url \}/.test(html));

  check('papkadagi fayl avval qaraladi',
    html.indexOf('e.dataTransfer.files') < html.indexOf('imageUrlFromDrop(e.dataTransfer)'));

  check('hodisalar bir marta ulanadi', html.includes('if(initIconDrop.done) return;'));
  check('ulash chaqiriladi', /\n\s*initIconDrop\(\);/.test(html));

  // Ko'rsatma bo'lmasa bu imkoniyatni hech kim topmaydi.
  check('ko‘rsatma yozilgan', html.includes('sudrab tashlang'));
  check('Ctrl+V ham aytilgan', html.includes('Ctrl+V'));

  // Sintaksis
  let ok = true; let err = '';
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try { new Function(m[1]); } catch (e) { ok = false; err = e.message; }
  }
  check('admin.html skripti toza', ok, err);
}

console.log(`\n${failed ? `${failed} ta xato, ` : ''}${passed} ta tekshiruv — ${failed ? 'XATO' : 'hammasi o\'tdi'}`);
process.exit(failed ? 1 : 0);
