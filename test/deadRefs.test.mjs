/**
 * Yo'q elementga va yo'q ikonkaga murojaat.
 *
 *     node test/deadRefs.test.mjs      (yoki npm test)
 *
 * NIMA UCHUN BU TEST BOR.
 *
 * `document.getElementById("x")` yo'q elementni so'rasa, xato
 * BERMAYDI — `null` qaytaradi. Kodda esa qariyb hamma yerda
 * `if(!el) return;` turadi, chunki element faqat ba'zi
 * ekranlarda bo'ladi. Natijada:
 *
 *   FUNKSIYA JIMGINA HECH NARSA QILMAYDI.
 *
 * Shunisi topilishi eng qiyin xato: tugma bosiladi, xato
 * chiqmaydi, log toza — shunchaki hech narsa bo'lmaydi.
 *
 * Aynan shu uch joyda sodir bo'lgandi:
 *
 *   `myOffersBox`   — haydovchining YUBORGAN TAKLIFLARI
 *                     ro'yxati. Server endpoint bor, CSS bor,
 *                     uchta tilda tarjimasi bor, chizadigan
 *                     funksiya bor — IDISHI yo'q. Ya'ni
 *                     haydovchi "taklifimga javob berishdimi?"
 *                     degan savolga javob topadigan joy
 *                     umuman yo'q edi. Endi bu profildagi
 *                     "Mening takliflarim" bo'limi.
 *
 *   `scrollProgress` — sahifa tepasidagi surilish chizig'i.
 *                     CSS ham, JS ham to'liq yozilgan, lekin
 *                     element hech qachon yasalmagan: chiziq
 *                     ILOVADA HECH QACHON ko'rinmagan. O'lik
 *                     kod olib tashlandi (yangi ko'rinadigan
 *                     narsa qo'shish — dizaynni o'zgartirish,
 *                     buni so'rashmagan).
 *
 *   `homeSearchBar` — uy ekrani qayta chizilgach qolgan quyruq.
 *
 * Ikkinchi yarmi — IKONKALAR. `<use href="#iconX"/>` yo'q
 * belgini ko'rsatsa, brauzer BO'SH JOY chizadi va hech narsa
 * demaydi. Tugma o'lchamini oladi, lekin ichi bo'sh bo'ladi.
 */
import { readFileSync } from 'node:fs';

const fails = [];
let pass = 0;
const check = (name, ok, extra) => {
  if (ok) { pass += 1; return; }
  fails.push(name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};

/* ------------------------------------------------------------
   JS ICHIDA YASALADIGAN id'lar.

   Ba'zi id'lar HTML'da turmaydi — ularni kodning o'zi qo'yadi
   (`el.id = "..."`) yoki nomini qo'shib yasaydi
   (`id="fAddr'+which+'"`). Bunday id'ni fayldan qidirib
   topib bo'lmaydi, shuning uchun ular shu yerda, SABABI bilan
   sanab o'tiladi. Ro'yxat qisqa bo'lishi kerak: har bir yangi
   qator — "bu id qayerda yasaladi?" degan savolga javob.
   ------------------------------------------------------------ */
const KODDA_YASALADI = {
  'index.html': {
    chatUnder: 'yozishma ostidagi quti — `under.id = "chatUnder"`',
    fFrom: 'ordPointHtml(): `id = isFrom ? "fFrom" : "fTo"`',
    fTo: 'ordPointHtml(): o‘sha yerda',
    fAddrfrom: 'manzil maydoni — `id="fAddr\'+which+\'"`',
    fAddrto: 'o‘sha yerda',
    dealRateBox: 'baholash qutisi — `id="\'+p+\'Box"`, p = "dealRate"',
  },
  'admin.html': {
    adminIconSprite: 'ikonkalar to‘plami — `holder.id = "adminIconSprite"`',
  },
};

for (const file of ['index.html', 'admin.html']) {
  const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const yasaladi = KODDA_YASALADI[file] || {};

  /* ---------- 1. Elementlar ---------- */
  /* HTML'dagi id'lar. Tirnoq oldidagi `\\?` — JS satri ichida
     yozilgan `id=\"x\"` uchun. */
  const ids = new Set([...src.matchAll(/\sid=\\?["']([\w-]+)\\?["']/g)].map((m) => m[1]));

  const soralgan = new Map();   // id → nechta joyda
  const qayd = (id) => soralgan.set(id, (soralgan.get(id) || 0) + 1);
  for (const m of src.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)) qayd(m[1]);
  for (const m of src.matchAll(/querySelector(?:All)?\(\s*['"]#([\w-]+)['"]/g)) qayd(m[1]);

  const yoq = [...soralgan.keys()]
    .filter((id) => !ids.has(id) && !(id in yasaladi))
    .sort();

  check(file + ': so‘ralgan har bir element bor (yoki kodda yasaladi)',
    yoq.length === 0, yoq.map((id) => id + ' x' + soralgan.get(id)));
  check(file + ': tekshiruvning o‘zi ishlayapti (id topildi)', ids.size > 20, ids.size);

  /* Ro'yxat eskirmasin: kodda yasalmay qolgan id shu yerda
     turib qolsa, u endi tekshiruvdan yashiradi — ro'yxat
     foydadan zararga o'tadi. */
  const keraksiz = Object.keys(yasaladi).filter((id) => !soralgan.has(id));
  check(file + ': "kodda yasaladi" ro‘yxatida ortiqcha nom yo‘q',
    keraksiz.length === 0, keraksiz);

  /* ---------- 2. Ikonkalar ---------- */
  const symbols = new Set([...src.matchAll(/<symbol[^>]*\sid="([^"]+)"/g)].map((m) => m[1]));
  const uses = new Map();
  for (const m of src.matchAll(/(?:xlink:)?href=\\?["']#([\w-]+)\\?["']/g)) {
    uses.set(m[1], (uses.get(m[1]) || 0) + 1);
  }
  if (symbols.size > 0) {
    const yoqIkon = [...uses.keys()].filter((u) => !symbols.has(u)).sort();
    check(file + ': ko‘rsatilgan har bir ikonka mavjud',
      yoqIkon.length === 0, yoqIkon.map((u) => u + ' x' + uses.get(u)));
  }
}

/* ------------------------------------------------------------
   3. "Mening takliflarim" bo'limi — to'liq ulanganmi.

   Bo'lim beshta bo'lakdan iborat va BITTASI yetishmasa ham
   jimgina ishlamay qoladi: ro'yxatda turadi-yu bosilsa bo'sh
   oyna chiqadi, yoki umuman ro'yxatda ko'rinmaydi. Shuning
   uchun beshtasi ham alohida tekshiriladi.
   ------------------------------------------------------------ */
{
  const app = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  check('bo‘lim ro‘yxatda bor', /\{ id: "offers",/.test(app));
  check('faqat haydovchida ko‘rinadi', /id: "offers"[\s\S]{0,260}roles: "DRIVER"/.test(app));
  check('ochilganda chizadigani ulangan', /offers: renderOffersSection,/.test(app));
  check('chizadigan funksiya bor', /function renderOffersSection\(body, p\)\{/.test(app));
  check('server endpointi aynan my-offers',
    /renderOffersSection[\s\S]{0,200}action=my-offers/.test(app));
  check('qatorlar yukni ochadi (taklif qaytarib olish o‘sha yerda)',
    /data-open-offer/.test(app) && /openLoadDetail\(b\.getAttribute\("data-open-offer"\)\)/.test(app));
  check('bo‘sh holat bor — "0" yozib qo‘yilmaydi',
    /pfEmpty\("offergrp\.empty"/.test(app));
  check('xato holatida qayta urinish bor',
    /pfError\(body, function\(\)\{ renderOffersSection/.test(app));

  /* Uchta til — biri qolsa, o'sha tilda kalit nomi ("pf.offers")
     ekranda chiqib qoladi. */
  ['pf.offers', 'pf.offersSub', 'offergrp.pending', 'offergrp.accepted',
    'offergrp.closed', 'offergrp.empty', 'offergrp.emptyBtn'].forEach((k) => {
    const n = app.split('"' + k + '":').length - 1;
    check('tarjimasi uchta tilda: ' + k, n === 3, n);
  });

  /* O'lik nusxa qaytib kelmasin: ikkita "mening takliflarim"
     bo'lsa, biri yangilanmay qolib eskirgan ma'lumot ko'rsatadi. */
  check('o‘lik nusxa (renderMyOffers) qaytmadi', !/renderMyOffers/.test(app));
  check('o‘lik idish (myOffersBox) qaytmadi', !/myOffersBox/.test(app));
}

if (fails.length) {
  console.log('\n' + fails.length + ' ta xato:');
  fails.forEach((f) => console.log('  XATO ' + f));
  console.log('\n==== ' + pass + ' passed, ' + fails.length + ' failed ====');
  process.exit(1);
}
console.log('\n==== ' + pass + ' passed, 0 failed ====');
