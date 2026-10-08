/**
 * Almashtirilgan ikonka ikki rejimda to'g'ri ko'rinishi.
 *
 *     node test/iconTheme.test.mjs      (yoki npm test)
 *
 * MUAMMO. Ilovaning o'z ikonkalari chizilgan, ya'ni rangi yo'q:
 * `currentColor` orqali atrofidagi matn rangini oladi. Admin
 * qo'ygan PNG ning rangi esa ichida qotib qolgan. Shu sababli
 * ikkita nuqson bor edi va ikkalasi ham ko'rinib turardi:
 *
 *   - yorug' rejim uchun qilingan qora rasm qorong'u rejimda
 *     qora panel ustida deyarli yo'qolardi;
 *   - tanlangan bo'limda yozuv yashil, belgisi esa qora bo'lib
 *     qolardi — ya'ni tanlov yarmigina ko'rinardi.
 *
 * YECHIM. Rasmdan faqat shakli olinadi (niqob), rangni ilova
 * beradi. Rangli belgilar (Telegram, tasdiq nishoni) uchun bu
 * noto'g'ri, shuning uchun ular "o'z rangida" deb belgilanadi.
 *
 * ENG MUHIM TASDIQ — ESKI YOZUVLAR BUZILMASLIGI. Bazada 26 ta
 * ikonka oddiy satr ko'rinishida turibdi. Ular o'qilishi, va
 * eski (keshdan ochilgan) sahifa kutadigan `{id: havola}` shakli
 * o'zgarmasligi kerak.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const work = mkdtempSync(join(tmpdir(), 'yolda-icontheme-'));

let passed = 0;
let failed = 0;
const check = (name, ok, extra) => {
  if (ok) { passed += 1; return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`);
};
const flow = (name) => console.log(`\n== ${name} ==`);

const icons = await import(join(repo, 'lib/icons.js'));

/* ============================================================
   1. Eski va yangi saqlash shakli
   ============================================================ */
flow('1. Saqlangan jadvalni o\'qish');
{
  // Bazada hozir turgan shakl — oddiy satr.
  const old = { iconHome: 'https://r2/x.png', iconUser: 'https://r2/y.png' };
  const a = icons.normalizeIcons(old);
  check('eski yozuvlar o‘qiladi', a.urls.iconHome === 'https://r2/x.png', a.urls);
  check('eski yozuvlar bo‘yaladi (ro‘yxatda yo‘q)', a.plain.length === 0, a.plain);

  const mixed = {
    iconHome: 'https://r2/x.png',
    iconTelegram: { url: 'https://r2/t.png', plain: true },
    iconBox: { url: 'https://r2/b.png' },
  };
  const b = icons.normalizeIcons(mixed);
  check('aralash jadval o‘qiladi',
    b.urls.iconHome === 'https://r2/x.png'
    && b.urls.iconTelegram === 'https://r2/t.png'
    && b.urls.iconBox === 'https://r2/b.png', b.urls);
  check('faqat belgilangani o‘z rangida',
    b.plain.length === 1 && b.plain[0] === 'iconTelegram', b.plain);

  /* Eski sahifa `{id: havola}` kutadi — shakl o‘zgarmasligi kerak,
     aks holda u ikonkalarni umuman ko‘rsatmay qo‘yardi. */
  check('havolalar satr bo‘lib qoladi',
    Object.values(b.urls).every((v) => typeof v === 'string'), b.urls);

  // Buzuq yozuvlar
  check('havolasiz yozuv tushib qoladi',
    icons.normalizeIcons({ a: null, b: {}, c: 5, d: { plain: true } }).plain.length === 0);
  check('havolasiz yozuv havolalar ichida ham yo‘q',
    Object.keys(icons.normalizeIcons({ a: null, b: {}, c: 5 }).urls).length === 0);
  check('jadval emas — bo‘sh', icons.normalizeIcons(null).plain.length === 0);
  check('ro‘yxat ham bo‘sh', Object.keys(icons.normalizeIcons([1, 2]).urls).length === 0);

  check('iconEntry: bo‘yaladigan — oddiy satr',
    icons.iconEntry('https://r2/x.png', false) === 'https://r2/x.png');
  check('iconEntry: o‘z rangida — obyekt',
    icons.iconEntry('https://r2/x.png', true).plain === true);
}

/* ============================================================
   2. /api/config
   ============================================================ */
flow('2. Ilovaga nima boradi');

process.env.ADMIN_PASSWORD = 'super-secret-pw';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-hmac-secret';
process.env.R2_ACCOUNT_ID = 'acc';
process.env.R2_ACCESS_KEY_ID = 'key';
process.env.R2_SECRET_ACCESS_KEY = 'secret';
process.env.R2_BUCKET = 'yolda';
process.env.R2_PUBLIC_URL = 'https://pub-test.r2.dev';

const store = new Map();
globalThis.__iconStore = store;
writeFileSync(join(work, 'kvmock.mjs'), `
const store = globalThis.__iconStore;
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

const load = async (relPath, name) => {
  const src = readFileSync(join(repo, relPath), 'utf8')
    .replaceAll("'../lib/kv.js'", JSON.stringify(join(work, 'kvmock.mjs')))
    .replace(/'\.\.\/lib\/([\w.]+)'/g, (_, f) => JSON.stringify(join(repo, 'lib', f)));
  const out = join(work, `${name}.mjs`);
  writeFileSync(out, src);
  return (await import(out)).default;
};

const call = async (handler, { method = 'GET', query = {}, body = null, cookie = null } = {}) => {
  let code = 200; let out = null;
  const res = {
    setHeader() {}, status(c) { code = c; return this; },
    json(v) { out = v; return this; }, end() { return this; },
  };
  await handler({ method, query, body, headers: cookie ? { cookie } : {} }, res);
  return { code, body: out };
};

const config = await load('api/config.js', 'config');

{
  // Bazadagi hozirgi holat: hammasi oddiy satr.
  store.set('icon_overrides', JSON.stringify({
    iconHome: 'https://pub-test.r2.dev/icon/a.png',
    iconTelegram: { url: 'https://pub-test.r2.dev/icon/t.png', plain: true },
  }));
  const cfg = await call(config);
  check('ikonkalar keladi', cfg.body.icons.iconHome === 'https://pub-test.r2.dev/icon/a.png', cfg.body.icons);
  check('shakli o‘zgarmadi (eski sahifa uchun)',
    typeof cfg.body.icons.iconTelegram === 'string', cfg.body.icons.iconTelegram);
  check('o‘z rangidagilar alohida ro‘yxatda',
    Array.isArray(cfg.body.iconsPlain) && cfg.body.iconsPlain.join() === 'iconTelegram',
    cfg.body.iconsPlain);

  store.set('icon_overrides', 'buzuq json');
  const broken = await call(config);
  check('buzuq jadval sahifani yiqitmaydi', broken.code === 200, broken.code);
  check('buzuq jadvalda ro‘yxat bo‘sh',
    Array.isArray(broken.body.iconsPlain) && broken.body.iconsPlain.length === 0, broken.body.iconsPlain);
}

/* ============================================================
   3. Admin: rejimni almashtirish
   ============================================================ */
flow('3. Admin paneldan rejimni almashtirish');
{
  const adminData = await load('api/admin-data.js', 'admindata');
  const { makeSessionToken } = await import(join(repo, 'lib/adminAuth.js'));
  const cookie = `admin_session=${makeSessionToken('SUPER_ADMIN', Date.now() + 60000)}`;
  const modCookie = `admin_session=${makeSessionToken('MODERATOR', Date.now() + 60000)}`;

  const post = (action, body, c = cookie) =>
    call(adminData, { method: 'POST', query: { action }, body, cookie: c });

  store.set('icon_overrides', JSON.stringify({ iconHome: 'https://pub-test.r2.dev/icon/a.png' }));

  const read = await call(adminData, { query: { resource: 'icons' }, cookie });
  check('panel ikonkalarni ko‘radi', read.body.icons.iconHome === 'https://pub-test.r2.dev/icon/a.png');
  check('panel rejimni ham ko‘radi', Array.isArray(read.body.iconsPlain), read.body.iconsPlain);
  check('eski yozuv — bo‘yaladigan', read.body.iconsPlain.length === 0, read.body.iconsPlain);

  const anon = await post('icon-mode', { id: 'iconHome', plain: true }, null);
  check('kirmasdan o‘zgartirib bo‘lmaydi', anon.code === 401, anon.code);
  const mod = await post('icon-mode', { id: 'iconHome', plain: true }, modCookie);
  check('moderator o‘zgartira olmaydi', mod.code === 403, mod.code);

  const on = await post('icon-mode', { id: 'iconHome', plain: true });
  check('admin o‘zgartira oladi', on.code === 200 && on.body.plain === true, on);
  check('saqlandi',
    JSON.parse(store.get('icon_overrides')).iconHome.plain === true,
    store.get('icon_overrides'));
  check('havola yo‘qolmadi',
    JSON.parse(store.get('icon_overrides')).iconHome.url === 'https://pub-test.r2.dev/icon/a.png');

  const off = await post('icon-mode', { id: 'iconHome', plain: false });
  check('qaytarib ham bo‘ladi', off.code === 200 && off.body.plain === false, off);
  check('qaytganda oddiy satrga aylanadi',
    JSON.parse(store.get('icon_overrides')).iconHome === 'https://pub-test.r2.dev/icon/a.png',
    store.get('icon_overrides'));

  const missing = await post('icon-mode', { id: 'iconBox', plain: true });
  check('almashtirilmagan ikonka — 404', missing.code === 404, missing.code);
  const badName = await post('icon-mode', { id: '../../etc', plain: true });
  check('nomi noto‘g‘ri — 400', badName.code === 400, badName.code);

  /* Rasm qayta yuklanganda rejim saqlanib qolishi kerak: admin
     uni qo'lda qo'ygan bo'lsa, yangi rasm uni bekor qilmasin. */
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '' });
  await post('icon-mode', { id: 'iconHome', plain: true });
  const png = `data:image/png;base64,${Buffer.from('fake').toString('base64')}`;
  const again = await post('save-icon', { id: 'iconHome', dataUrl: png });
  check('qayta yuklanganda rejim saqlanadi', again.code === 200 && again.body.plain === true, again.body);

  const explicit = await post('save-icon', { id: 'iconHome', dataUrl: png, plain: false });
  check('yuklashda ochiq aytilsa — o‘sha', explicit.body.plain === false, explicit.body);

  const fresh = await post('save-icon', { id: 'iconBox', dataUrl: png });
  check('yangi ikonka sukut bo‘yicha bo‘yaladi', fresh.body.plain === false, fresh.body);
}

/* ============================================================
   4. Ilovadagi tomoni
   ============================================================ */
flow('4. index.html');
{
  const html = readFileSync(join(repo, 'index.html'), 'utf8');

  check('ro‘yxat ilovaga uzatiladi', html.includes('applyIconOverrides(cfg.icons, cfg.iconsPlain)'));
  check('niqoblar uchun joy bor', html.includes('<defs id="iconMaskDefs">'));

  /* ---- Asosiy ikonkalar sahifaning O'ZIDA ----
     Ilgari ular bazadagi jadvalda turardi: ilova ochilib,
     /api/config javob bergandan keyin almashardi va bir lahza
     eskisi ko'rinib ketardi. Shu bilan birga baza tozalansa
     ikonkalar ham yo'qolardi. */
  const QUYILGAN = [
    'iconVerifiedBadge', 'iconHome', 'iconSearch', 'iconPlus', 'iconHandshake',
    'iconHeadphones', 'iconUser', 'iconBox', 'iconTelegram', 'iconTruck',
    'iconSnow', 'iconBolt', 'iconMap', 'iconReceipt', 'iconRefresh', 'iconEye',
    'iconEyeOff', 'iconTarget', 'iconPin', 'iconChart', 'iconSettings',
    'iconUsers', 'iconFuel', 'iconGear', 'iconSun', 'iconHeart',
    'iconWeight', 'iconCheck', 'iconAlert', 'iconInboxEmpty', 'iconClock',
    'iconClose', 'iconDownload', 'iconShare', 'iconEdit', 'iconShield',
    'iconFlame', 'iconLogout', 'iconBed', 'iconWrench', 'iconMonitor',
    'iconFood', 'iconParking', 'iconCheckLine', 'iconReactThumb',
  ];
  /* Rangli ikonkalar bo'yalmaydi — bitta rangga bo'yash
     belgisini buzardi. */
  const RANGLI = new Set(['iconVerifiedBadge', 'iconBox']);

  QUYILGAN.forEach((id) => {
    const m = html.match(new RegExp('<symbol id="' + id + '" viewBox="0 0 24 24">([\\s\\S]*?)</symbol>'));
    if (!m) { check(id + ' sprite ichida', false); return; }
    if (RANGLI.has(id)) {
      check(id + ' o‘z rangida', m[1].includes('<image href="https://'), m[1].slice(0, 80));
      check(id + ' bo‘yalmagan', !m[1].includes('currentColor'), m[1].slice(0, 80));
    } else {
      check(id + ' ilova rangini oladi',
        m[1].includes('fill="currentColor"') && m[1].includes('mask="url(#iconmask-' + id + ')"'),
        m[1].slice(0, 120));
      const mask = html.match(new RegExp('<mask id="iconmask-' + id + '"[^>]*>([\\s\\S]*?)</mask>'));
      check(id + ' niqobi defs ichida', Boolean(mask));
      if (mask) {
        check(id + ' niqobda rasm bor', mask[1].includes('<image href="https://'), mask[1].slice(0, 80));
        check(id + ' shaffoflik bo‘yicha qirqiladi',
          /mask-type:alpha/.test(html.match(new RegExp('<mask id="iconmask-' + id + '"[^>]*>'))[0]));
      }
    }
  });
  check('niqoblar soni to‘g‘ri',
    (html.match(/<mask id="iconmask-/g) || []).length === QUYILGAN.length - RANGLI.size,
    (html.match(/<mask id="iconmask-/g) || []).length);

  /* Hech qaysi ikonka eski chizmasi bilan ikki marta
     yozilmagan bo'lsin — aks holda qaysi biri chiqishi
     tartibga bog'liq bo'lib qolardi. */
  QUYILGAN.forEach((id) => {
    check(id + ' bir marta yozilgan',
      (html.match(new RegExp('<symbol id="' + id + '"', 'g')) || []).length === 1);
  });

  /* Bazadagi rasm sahifadagi bilan bir xil bo'lsa qayta
     chizilmasin — har ochilishda 24 ta niqob behuda yasalardi. */
  check('bir xil bo‘lsa qayta chizilmaydi', html.includes('if(hozir.indexOf(url) >= 0) return;'));
  check('usul ham solishtiriladi', html.includes('if(hozirNiqob === !plain[id]){'));
  check('shaffoflik bo‘yicha qirqiladi', html.includes('mask-type:alpha'));
  check('rangni ilova beradi', html.includes('fill="currentColor"') && html.includes('mask="url(#'));
  check('o‘z rangidagilar eskidek rasm bo‘lib qoladi',
    /if\(plain\[id\] \|\| !defs\)\{ symbol\.innerHTML = img; return; \}/.test(html));

  /* Niqob symbol ichida bo'lsa, `<use>` uni nusxalaganda id lar
     takrorlanib ketardi. */
  check('niqob symbol ichida emas', html.includes('defs.appendChild(mask)'));

  const fn = html.slice(html.indexOf('function applyIconOverrides'));
  check('faqat https qabul qilinadi', fn.slice(0, 2000).includes('/^https:\\/\\//'));
  check('havola ekranlanadi', fn.slice(0, 2000).includes('escapeHtml(url)'));
}

/* ============================================================
   5. Admin paneldagi tomoni
   ============================================================ */
flow('5. admin.html');
{
  const html = readFileSync(join(repo, 'admin.html'), 'utf8');

  check('belgi bor', html.includes('data-icon-plain="'));
  check('belgi ulangan', html.includes('mode.getAttribute("data-icon-plain")'));
  check('rejim almashtiriladi', html.includes('function setIconMode'));
  check('serverga yuboriladi', html.includes('Api.post("icon-mode"'));

  // Paneldagi ko'rinish ilovadagidek bo'lishi kerak.
  check('bo‘yaladigan rasm panelda ham bo‘yalgan ko‘rinadi', html.includes('icon-card-tint'));
  check('niqob uslubi bor', html.includes('.icon-card-tint{'));
  check('o‘z rangidagisi oddiy rasm bo‘lib qoladi',
    /plain\s*\?\s*'<img src="/.test(html));

  // Rangli rasmni o'zi tanib olishi
  check('rangli rasm tanib olinadi', html.includes('function isColorful'));
  check('shaffof piksellar hisobga olinmaydi', html.includes('px[i + 3] < 200'));
  check('yuklashda rejim yuboriladi', html.includes('plain: isColorful(ctx, size)'));
  check('o‘qib bo‘lmasa bo‘yamaydi', /catch\(e\)\{[^}]*return true;/.test(html));

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
