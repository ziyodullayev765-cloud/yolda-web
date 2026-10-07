/**
 * Pastki paneldagi tabletka yozuvni o'rab oladimi.
 *
 * Buzilgan holat shunday edi: tabletka eni CSS da 64px qilib
 * qotirilgan, yozuvlar esa har xil — "Life" 19px, "Yuk joylash"
 * 59px, ruschada "Разместить груз" 86px. Natijada eng uzun yozuv
 * tabletkaning qirrasiga tegib turardi (ikki yonida 2.5px dan),
 * qisqalari esa uning o'rtasida suzib yurardi.
 *
 * Tuzatish ikki qismdan iborat va ikkalasi ham ko'rinmas tarzda
 * yo'qolishi mumkin:
 *
 *   1. En endi JS da, yozuvga qarab o'lchanadi (navLensWidth).
 *      Agar kimdir uni yana CSS ga qaytarib qotirsa, ilova
 *      baribir ishlaydi — xato faqat eng uzun tilda ko'rinadi.
 *
 *   2. Tabletka `position:absolute`, ya'ni uning noli panelning
 *      CHEGARASIDAN keyin boshlanadi. Chegara ayirilmasa, tabletka
 *      doim 1px o'ngga surilib turadi. Bu ham jim xato: faqat
 *      bo'shliq qisilganda sezilgan.
 *
 * Shuning uchun quyida ikkalasi ham qotirib qo'yiladi. Bu
 * tuzilma tekshiruvi — piksel o'lchash brauzerni talab qiladi,
 * bu to'plam esa Node da ishlaydi.
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

/* ---------- En yozuvdan o'lchanadi ---------- */
const width = html.match(/function navLensWidth\(item\)\{[\s\S]*?\n {2}\}/);
check('navLensWidth bor', Boolean(width));

if (width) {
  const w = width[0];
  check('yozuvning eni o\'lchanadi', /navItemLabel\(item\)/.test(w) && /getBoundingClientRect\(\)\.width/.test(w));
  check('ikki yonida bo\'shliq qoldiriladi', w.includes('LENS_PAD * 2'));
  check('eng kichik en bor', w.includes('LENS_MIN'));
  /* Tabletka o'z katagidan kengroq bo'lishi mumkin, shuning uchun
     qo'shni yozuvga tegib ketmasligi alohida tekshiriladi. */
  check('qo\'shnilar ham o\'lchanadi', /querySelectorAll\(":scope > \.bn-item"\)/.test(w));
  check('qo\'shnigacha oraliq qoldiriladi', w.includes('LENS_GAP'));
  check('cheklov eng kichikdan pastga tushirmaydi',
    /Math\.min\(w, Math\.max\(LENS_MIN, limit\)\)/.test(w));
}

for (const [name, min, max] of [['LENS_PAD', 6, 20], ['LENS_MIN', 44, 72], ['LENS_GAP', 4, 16]]) {
  const m = html.match(new RegExp('var ' + name + ' = (\\d+);'));
  check(name + ' aniqlangan va mantiqiy', Boolean(m) && +m[1] >= min && +m[1] <= max,
    m ? +m[1] : null);
}

/* `data-i18n` bo'yicha tanlash muhim: "Yuk joylash" katagida yozuvdan
   tashqari `.bn-fab` o'ramasi ham bor, unda esa `data-i18n` yo'q. */
check('yozuv data-i18n bo\'yicha topiladi',
  /function navItemLabel\(item\)\{[\s\S]{0,200}querySelector\("span\[data-i18n\]"\)/.test(html));

/* ---------- O'lchangan en haqiqatan qo'llanadi ---------- */
check('moveNavBlob o\'lchangan enni uzatadi',
  /placeNavLens\(box\.left - navBox\.left \+ box\.width \/ 2, navLensWidth\(active\)\)/.test(html));
check('placeNavLens enni qabul qiladi', /function placeNavLens\(x, w\)\{/.test(html));
check('en --ld ga yoziladi', /if\(w\) blob\.style\.setProperty\("--ld", w \+ "px"\)/.test(html));

/* Sudrash paytida en o'zgarmasligi kerak — bitta tabletka surilyapti. */
check('sudrashda en qotib turadi', /placeNavLens\(drawX \+ blobW \/ 2, blobW\)/.test(html));

/* ---------- Chegara hisobga olinadi ---------- */
const place = html.match(/function placeNavLens\(x, w\)\{[\s\S]*?\n {2}\}/);
check('placeNavLens topildi', Boolean(place));
if (place) {
  check('panel chegarasi ayiriladi',
    /borderLeftWidth/.test(place[0]) && /var left = x - d \/ 2 - edge;/.test(place[0]));
}

/* ---------- En ham silliq o'zgaradi ---------- */
const blob = html.match(/\n {2}\.bn-blob\{[\s\S]*?\n {2}\}/g) || [];
check('.bn-blob qoidasi topildi', blob.length > 0);
check('en ham animatsiya bilan o\'zgaradi',
  blob.some((b) => /transition:[^}]*\bwidth\b/.test(b)), { qoidalar: blob.length });

/* ---------- Til almashganda qayta o'lchanadi ---------- */
const lang = html.match(/function applyLang\(\)\{[\s\S]*?\n {2}\}/);
check('applyLang topildi', Boolean(lang));
if (lang) check('til almashganda tabletka qayta o\'lchanadi', lang[0].includes('moveNavBlob()'));

if (fails.length) {
  console.log('navlens: ' + fails.length + ' ta xato');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('navlens: ' + passed + ' ta tekshiruv o\'tdi');
