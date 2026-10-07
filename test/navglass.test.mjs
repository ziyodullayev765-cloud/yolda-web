/**
 * Pastki paneldagi shisha buzilmaganmi.
 *
 * Bu yerdagi effekt ikki qismdan iborat va ikkalasi ham oson
 * yo'qoladi:
 *
 *   1. `#navGlassFilter` — nur sinishini beradigan SVG filtri.
 *      Uning ichidagi `feImage` dagi rasm "displacement map":
 *      R kanali X siljishni, G kanali Y siljishni beradi. Agar
 *      kimdir rasmni olib tashlasa yoki `feDisplacementMap` larni
 *      o'chirsa, filtr jim turadi — panel baribir chiziladi,
 *      shuning uchun xato ko'zga tashlanmaydi.
 *
 *   2. CSS dagi IKKI qatorli yozuv. `backdrop-filter` ga `url()`
 *      berishni Safari ham, Firefox ham ko'tarmaydi. Shuning uchun
 *      avval oddiy xiralashtirish, keyin ustidan `url()` li variant
 *      yoziladi: ko'tarmagan brauzer ikkinchisini butunlay tashlab
 *      yuboradi va birinchisida qoladi. Agar birinchi qator
 *      o'chirilsa, o'sha brauzerlarda panel umuman shaffof bo'lib,
 *      ostidagi matn yozuvlarga qo'shilib ketadi.
 *
 * Shuning uchun bu to'plam ikkalasini ham qotirib qo'yadi.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

let passed = 0;
const fails = [];
const check = (name, ok, extra) => {
  if (ok) { passed += 1; return; }
  fails.push(name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)));
};

/* ---------- Filtrning o'zi ---------- */
const filter = html.match(/<filter id="navGlassFilter"[\s\S]*?<\/filter>/);
check('#navGlassFilter mavjud', Boolean(filter));

if (filter) {
  const f = filter[0];
  check('sRGB da hisoblanadi', f.includes('color-interpolation-filters="sRGB"'));
  check('displacement map rasmi joyida', /<feImage[\s\S]*?href="data:image\/png;base64,[A-Za-z0-9+/=]{500,}"/.test(f));
  check('rasm element chegarasiga cho\'ziladi', f.includes('preserveAspectRatio="none"'));

  const disp = f.match(/<feDisplacementMap/g) || [];
  check('uchta kanal uchun uchta egish', disp.length === 3, { topildi: disp.length });

  /* Uch kanal uch xil kuchda surilmasa, qirradagi rangin yoyilish
     yo'qoladi — shisha oddiy xiralashtirishga aylanib qoladi. */
  const scales = [...f.matchAll(/<feDisplacementMap[^>]*scale="(-?\d+)"/g)].map((m) => m[1]);
  check('kuchlari har xil', new Set(scales).size === 3, { scales });

  for (const [ch, sel] of [['R', 'xChannelSelector="R"'], ['G', 'yChannelSelector="G"']]) {
    check(ch + ' kanali siljishga ulangan', (f.split(sel).length - 1) === 3);
  }

  const blends = [...f.matchAll(/<feBlend[^>]*mode="(\w+)"/g)].map((m) => m[1]);
  check('kanallar screen bilan qaytib qo\'shiladi',
    blends.length === 2 && blends.every((m) => m === 'screen'), { blends });
}

/* ---------- Qo'llanishi va zaxira yo'li ---------- */
const nav = html.match(/\n {2}\.bottom-nav\{[\s\S]*?\n {2}\}/);
check('.bottom-nav qoidasi topildi', Boolean(nav));

if (nav) {
  const n = nav[0];
  /* Zaxira avval, url() li variant keyin — tartibi muhim. */
  const plain = n.indexOf('backdrop-filter:var(--nav-filter)');
  const refract = n.indexOf('backdrop-filter:var(--nav-refract)');
  check('oddiy xiralashtirish zaxira sifatida bor', plain !== -1);
  check('nur sinishi qo\'llangan', refract !== -1);
  check('zaxira oldinda turadi', plain !== -1 && refract !== -1 && plain < refract,
    { plain, refract });
  check('-webkit- prefiksi ham bor',
    n.includes('-webkit-backdrop-filter:var(--nav-refract)'));
}

/* Ikkala mavzuda ham o'zgaruvchi aniqlangan bo'lishi kerak, aks
   holda `var(--nav-refract)` bo'sh qolib, qator o'chib ketadi. */
const refractVars = [...html.matchAll(/--nav-refract:([^;]+);/g)].map((m) => m[1].trim());
check('--nav-refract yorug\' va qorong\'i mavzuda ham bor', refractVars.length === 2,
  { topildi: refractVars.length });
check('har ikkalasi filtrga ishora qiladi',
  refractVars.length > 0 && refractVars.every((v) => v.includes('url(#navGlassFilter)')), { refractVars });
/* Egish xiralashtirishdan KEYIN kelsin: aks holda shishaning ichi
   ham egilib, yozuvlar ostidagi tasvir tinch turmaydi. */
check('avval xiralashtirish, keyin egish',
  refractVars.every((v) => v.indexOf('blur(') < v.indexOf('url(#navGlassFilter)')), { refractVars });

/* Shaffoflikni kamaytirishni so'raganda butun effekt tushib qolsin. */
check('prefers-reduced-transparency uchun chiqish yo\'li bor',
  /@media \(prefers-reduced-transparency: reduce\)\{[\s\S]{0,260}backdrop-filter:var\(--nav-filter\)/.test(html));

if (fails.length) {
  console.log('navglass: ' + fails.length + ' ta xato');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('navglass: ' + passed + ' ta tekshiruv o\'tdi');
