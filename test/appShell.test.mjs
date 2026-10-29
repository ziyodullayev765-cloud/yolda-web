/**
 * Ilova ramkasi: lenta va pastki panel qimirlamasligi.
 *
 *     node test/appShell.test.mjs      (yoki npm test)
 *
 * NIMA UCHUN BU TEST BOR.
 *
 * Telefon brauzeri sahifa surilganda o'z manzil qatorini yashiradi
 * va qaytaradi — shunda ko'rinadigan maydonning balandligi
 * o'zgaradi va unga yopishtirilgan lenta bilan panel joyidan
 * siljiydi. Ilgari aynan shu shikoyat bo'lgan.
 *
 * Yechim hiyla emas, sababni olib tashlash: SAHIFANING O'ZI
 * SURILMAYDI. Ilova — balandligi ekranga teng ramka, suriladigan
 * yagona narsa `<main>`. Surilish yo'q — manzil qatori ham
 * qimirlamaydi.
 *
 * Shu qoida CSS'da bir necha joyga tarqalgan va uni bitta
 * e'tiborsiz o'zgartirish buzib qo'yishi mumkin. Shuning uchun
 * bu yerda tekshiriladi.
 */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const fails = [];
let pass = 0;
const check = (name, ok, extra) => {
  if (ok) { pass += 1; return; }
  fails.push(name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};

/* ---------- Ramka ---------- */
check('html va body surilmaydi',
  /html,\s*body\{[^}]*overflow:hidden;/.test(html));
check('balandligi ekranga teng (dvh, zaxirasi vh)',
  /html,\s*body\{[^}]*height:100vh;[^}]*height:100dvh;/.test(html));
check('body — ustun (lenta, main, panel)',
  /body\{display:flex;flex-direction:column;\}/.test(html));
check('lenta siqilmaydi', /body > \.nav\{flex:0 0 auto;\}/.test(html));

/* ---------- Suriladigan yagona narsa ---------- */
check('main suriladi',
  /main\{[^}]*flex:1 1 auto;[^}]*overflow-y:auto;/.test(html));
check('ro‘yxat oxirida sahifa tortilmaydi',
  /main\{[^}]*overscroll-behavior-y:contain;/.test(html));
check('pastki bo‘shliq main da (panel ostida qolmasin)',
  /main\{padding-bottom:calc\(96px \+ env\(safe-area-inset-bottom, 0px\)\);\}/.test(html));
check('Telegram ichida ham bo‘shliq main da',
  /:root\[data-tg="1"\] main\{padding-bottom:/.test(html));
check('eski body bo‘shlig‘i qolmadi',
  !/body\{padding-bottom:calc\(96px/.test(html));

/* ---------- Lenta va panel ---------- */
check('lenta endi sticky emas', !/\.nav\{\s*\n?\s*position:sticky/.test(html));
check('pastki panel joyida qotgan (fixed)',
  /\.bottom-nav\{[\s\S]{0,2000}?position:fixed;/.test(html));

/* ---------- JS ham shu qoidaga tayanadi ----------
   `window.scrollY` endi doimo nol: uni ishlatgan joy jim
   ishlamay qoladi, shuning uchun bu alohida tekshiriladi. */
check('suriladigan maydon bitta joyda e\'lon qilingan',
  /window\.pageScrollTop = function\(\)\{/.test(html)
  && /window\.pageScroller = function\(\)\{ return document\.querySelector\("main"\); \}/.test(html));
check('tepaga tortib yangilash main holatiga qaraydi',
  (html.match(/pageScrollTop\(\) > 0/g) || []).length >= 3);
check('bo‘lim almashganda main tepaga qaytadi', /pageScrollTo\(0\);/.test(html));
check('"Yana" dan keyin main suriladi', /pageScrollBy\(surish\);/.test(html));
check('eski window.scrollY tekshiruvi qolmadi',
  !/if\(window\.scrollY > 0\)/.test(html) && !/window\.scrollTo\(0, 0\)/.test(html));
check('oyna ochilganda main qulflanadi',
  /window\.lockPageScroll = function\(on\)\{/.test(html)
  && (html.match(/lockPageScroll\((true|false)\)/g) || []).length === 6);
check('main surilishi ham eshitiladi (capture)',
  /\{passive:true, capture:true\}/.test(html));

if (fails.length) {
  console.log('appShell: ' + fails.length + ' ta xato');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('appShell: ' + pass + ' ta tekshiruv o\'tdi');
