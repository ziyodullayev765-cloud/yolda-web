/**
 * Ilova o'zi yangilanadimi.
 *
 *     node test/buildId.test.mjs      (yoki npm test)
 *
 * MUAMMO. O'rnatilgan ilova kunlab yopilmaydi — sahifa qaytadan
 * ochilmaydi. Ilgari yangilikni faqat xizmat fayli (`sw.js`)
 * almashganidan bilardik, lekin u fayl har nashrda o'zgarmaydi:
 * tuzatish `index.html` ichida bo'lsa, `sw.js` baytlari o'sha-o'sha
 * qoladi va brauzer "yangilik yo'q" deb qaytaradi. Ya'ni sayt
 * yangilangan, telefondagi ilova esa eski kodda qolib ketardi.
 *
 * Shuning uchun nashr belgisi SERVERDAN so'raladi. Shu yerda uning
 * ikki sharti tekshiriladi:
 *
 *   1. bitta nashr davomida belgi o'zgarmaydi (aks holda ilova
 *      o'zini bekordan-bekorga qayta yuklab turardi);
 *   2. nashr almashsa belgi ham almashadi (aks holda yangilik
 *      hech qachon ko'rinmaydi).
 *
 * Va git commit nomeri o'z holida berilmaydi.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { db, loadApi, repo, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const config = await loadApi('api/config.js', 'buildid_config');

const ask = async () => {
  let out = null;
  const res = {
    setHeader() { return this; },
    status() { return this; },
    json(v) { out = v; return this; },
    send() { return this; },
    end() { return this; },
  };
  await config({ method: 'GET', query: {}, body: null, headers: {} }, res);
  return out;
};

/** Nashrni almashtiradi (Vercel aynan shu o'zgaruvchini beradi). */
const deploy = (id) => {
  if (id === null) delete process.env.VERCEL_DEPLOYMENT_ID;
  else process.env.VERCEL_DEPLOYMENT_ID = id;
};

const SHA = '9c1f0aa7b3e4d5c6a7b8c9d0e1f2a3b4c5d6e7f8';

/* ---------------------------------------------------------- */
flow('Belgi nashr bilan bog\'langan');
{
  db.strings.clear();
  deploy('dpl_birinchi');
  const bir = await ask();
  check('belgi keldi', typeof bir.build === 'string' && bir.build.length > 0, bir.build);

  const yana = await ask();
  check('BITTA NASHRDA O\'ZGARMAYDI', yana.build === bir.build, [bir.build, yana.build]);

  deploy('dpl_ikkinchi');
  const ikki = await ask();
  check('NASHR ALMASHSA — ALMASHADI', ikki.build !== bir.build, [bir.build, ikki.build]);
}

flow('Commit nomeri o\'z holida berilmaydi');
{
  deploy(null);
  process.env.VERCEL_GIT_COMMIT_SHA = SHA;
  const cfg = await ask();
  check('zaxira sifatida commit ishlatiladi', Boolean(cfg.build), cfg.build);
  /* Sir emas, lekin ombordagi ishlarimizni oshkor qilishning
     hojati yo'q — qisqa, ma'nosiz xesh ham xuddi shu vazifani
     bajaradi. */
  check('NOMERNING O\'ZI KO\'RINMAYDI', !cfg.build.includes(SHA.slice(0, 12)), cfg.build);
  check('qisqa', cfg.build.length <= 16, cfg.build);
  check('faqat hex', /^[0-9a-f]+$/.test(cfg.build), cfg.build);
  delete process.env.VERCEL_GIT_COMMIT_SHA;
}

flow('Hech narsa ma\'lum bo\'lmasa — bo\'sh');
{
  deploy(null);
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_URL;
  const cfg = await ask();
  /* Mahalliy ishga tushirish. Ilova bo'sh qiymatni "bilmadim" deb
     qabul qiladi — taxmin qilib qayta yuklamaydi. */
  check('bo\'sh satr', cfg.build === '', cfg.build);
}

flow('Boshqa maydonlar joyida qoldi');
{
  deploy('dpl_uchinchi');
  const cfg = await ask();
  check('googleClientId bor', 'googleClientId' in cfg);
  check('ikonkalar bor', 'icons' in cfg && 'iconsPlain' in cfg);
  /* Maxfiy narsalar baribir chiqmasligi kerak. */
  const matn = JSON.stringify(cfg);
  check('bot tokeni yo\'q', !/TELEGRAM_BOT_TOKEN|bot[0-9]{6,}/.test(matn));
  check('maxfiy kalit yo\'q', !/vapidPrivate|privateKey|secret/i.test(matn), matn.slice(0, 120));
}

/* ---------------------------------------------------------- */
const html = readFileSync(join(repo, 'index.html'), 'utf8');

flow('Ilova tomoni');
{
  check('nashr belgisi kuzatiladi', html.includes('function watchBuild()'));
  check('kuzatuv ishga tushadi', /\n\s*watchBuild\(\);/.test(html));
  check('o\'z keshidan o\'qimaydi',
    /fetch\("\/api\/config", \{cache:"no-store"\}\)/.test(html));
  check('belgi solishtiriladi', /build !== baseline|build === baseline/.test(html));

  /* Birinchi qiymat — ishlab turgan koddan. Uni yangilik deb
     bilib qayta yuklash — bekorga. */
  check('BIRINCHI QIYMAT YANGILIK EMAS', /if\(!baseline\)\{ baseline = build; return; \}/.test(html));
  /* Server aytmasa (mahalliy, yoki eski server) — tegilmaydi. */
  check('bo\'sh qiymat e\'tiborsiz', /if\(!build\) return;/.test(html));

  /* Qayta yuklash o'zboshimcha emas: forma to'ldirilayotganda
     yoki varaq ochiqligida tegilmaydi. */
  check('xavfsiz payt kutiladi', /newVersionReady = true;\s*\n\s*applyNewVersion\(\);/.test(html));

  check('fondan qaytganda so\'raladi', /ask\(hiddenAt && Date\.now\(\) - hiddenAt > 10000\)/.test(html));
  check('tortib yangilash ham so\'raydi', /askBuild\(true\);/.test(html));
  check('uzoq ochiq turganda ham', /setInterval\(function\(\)\{ if\(!document\.hidden\) ask\(true\); \}/.test(html));
}

flow('Xizmat fayli raqami oshirildi');
{
  /* Telefonda turgan ESKI nusxa yangi yo'lni bilmaydi. Unga
     yetib borishning yagona yo'li — xizmat faylining almashishi:
     shunda boshqaruv almashadi va u bir marta qayta yuklanib
     yangi kodga o'tadi. */
  const sw = readFileSync(join(repo, 'sw.js'), 'utf8');
  const m = /CACHE_VERSION = 'yolda-v(\d+)'/.exec(sw);
  check('raqam o\'qildi', Boolean(m), sw.slice(0, 40));
  check('v8 dan past emas', m && Number(m[1]) >= 8, m && m[1]);
}

flow('Telefonda turgan eski nusxa qo\'zg\'atiladi');
{
  /* Yangi sahifalar yangilikni o'zi sezadi. Lekin TELEFONDA
     ALLAQACHON TURGAN eski nusxada o'sha eski kod bor — u
     hech narsa sezmaydi. Shuning uchun yangi xizmat fayli
     ishga tushganda ochiq oynalarga xabar yuboradi. */
  const sw = readFileSync(join(repo, 'sw.js'), 'utf8');
  check('ishga tushganda xabar yuboriladi', /nudgeClients\(\)/.test(sw));
  check('xabar hamma oynaga ketadi', /postMessage\(\{ type: 'NEW_VERSION' \}\)/.test(sw));

  /* Yangi kod javob qaytaradi — demak uni majburan qayta
     yuklash shart emas, u o'zi qulay paytda yangilanadi. */
  check('javob kutiladi', /VERSION_ACK/.test(sw));
  check('javob berganga tegilmaydi', /acked\.has\(c\.id\)[\s\S]{0,40}continue;/.test(sw));
  /* Javob kelmasa — u yerda eski kod. Boshqa yo'l yo'q. */
  check('JAVOB BERMAGANI QAYTA YUKLANADI', /c\.navigate\(c\.url\)/.test(sw));
  /* /admin ichki vosita — u yerda ish ketayotgan bo'lishi
     mumkin, tegilmaydi. */
  check('admin tegilmaydi',
    (sw.match(/c\.url\.indexOf\('\/admin'\) === -1/g) || []).length === 2, sw.includes('/admin'));

  /* BIRINCHI MARTA KIRGAN ODAMGA TEGILMAYDI. Unda allaqachon
     eng yangi kod turibdi — hozirgina yuklandi. Bu qoida
     bo'lmaganda har bir yangi tashrif qayta yuklanib ketardi. */
  check('faqat yangilanishda qo\'zg\'atiladi', /yangilanish \? nudgeClients\(\) : undefined/.test(sw));
  check('yangilanish eski keshdan aniqlanadi', /yangilanish = keys\.length > 0;/.test(sw));

  check('sahifa javob qaytaradi', /type:"VERSION_ACK"/.test(html));
  /* Va o'zi darhol emas, XAVFSIZ paytda yangilanadi. */
  check('sahifa xavfsiz paytda yangilanadi',
    /NEW_VERSION"\)\{[\s\S]{0,400}?newVersionReady = true;\s*\n\s*applyNewVersion\(\);/.test(html));
}

t.done();
