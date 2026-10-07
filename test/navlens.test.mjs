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
  /var x = box\.left - navBox\.left \+ box\.width \/ 2;[\s\S]{0,80}placeNavLens\(x, navLensWidth\(active\)\)/.test(html));
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
const blobTrans = blob.filter((b) => /transition:[^}]*\bwidth\b/.test(b));
check('en ham animatsiya bilan o\'zgaradi', blobTrans.length > 0, { qoidalar: blob.length });
/* Surilish egri chizig'i maqsaddan OSHIB ketmasligi kerak. Joy
   uchun oshib-qaytish mayin ko'rinardi, lekin en ham shu egri
   chiziqda: tabletka kerakligidan kengayib, keyin torayardi.
   Ikki oshib-qaytish ustma-ust tushib, harakat taka-puka bo'lardi.
   Shuning uchun ikkinchi boshqaruv nuqtasi 1 dan oshmasin. */
for (const b of blobTrans) {
  /* Izohlar olib tashlanadi: ularda eski egri chiziq misol sifatida
     keltirilgan va u qoidaning o'zi deb hisoblanib ketardi. */
  const code = b.replace(/\/\*[\s\S]*?\*\//g, '');
  const curves = [...code.matchAll(/cubic-bezier\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/g)];
  check('surilish egri chizig\'i oshib ketmaydi',
    curves.length > 0 && curves.every((c) => +c[2] <= 1 && +c[4] <= 1),
    curves.map((c) => c[0]));
}

/* ---------- Yo'ldagi cho'zilish ----------
   Tabletka bir bo'limdan ikkinchisiga o'tganda yo'nalish bo'ylab
   cho'zilib, yetib borgach o'z holiga qaytadi. Bu ham jim
   yo'qoladigan narsalardan: animatsiya o'chsa, tabletka baribir
   to'g'ri joyga boradi — faqat qattiq jism kabi. */
check('navBlobTravel keyframe bor', /@keyframes navBlobTravel\{/.test(html));
const kf = html.match(/@keyframes navBlobTravel\{[\s\S]*?\n {2}\}/);
if (kf) {
  check('cho\'zilish eng kuchli nuqtasi bor',
    /\d+%\s*\{transform:scaleX\(var\(--stretch[^)]*\)\) scaleY\(var\(--squash/.test(kf[0]));
  /* O'rtada qo'shimcha nuqtalar bo'lishi kerak: ularsiz tabletka
     eng cho'zilgan joyida bir "sinib" qo'yardi — shakl keskin
     burilardi. Shuning uchun bosqichlar soni tekshiriladi. */
  const steps = (kf[0].match(/\n\s+\d+%\s*\{/g) || []).length;
  check('o\'tish burchaksiz (oraliq nuqtalari bor)', steps >= 5, { bosqichlar: steps });
  /* Boshi ham, oxiri ham 1 — aks holda shakl o'zgargancha qolib
     ketardi va keyingi bosilish allaqachon buzilgan holatdan
     boshlanardi. */
  check('boshi va oxiri o\'z shaklida',
    /0%\s*\{transform:scaleX\(1\) scaleY\(1\);\}/.test(kf[0])
    && /100%\s*\{transform:scaleX\(1\) scaleY\(1\);\}/.test(kf[0]));
}
check('cho\'zilish qatlamlarga qo\'llangan',
  /\.bn-blob-fill\.bn-travel,[\s\S]{0,80}\.bn-blob-gloss\.bn-travel\{[\s\S]{0,120}animation:navBlobTravel/.test(html));

const flash = html.match(/function flashLensTravel\(x\)\{[\s\S]*?\n {2}\}/);
check('flashLensTravel bor', Boolean(flash));
if (flash) {
  const f = flash[0];
  check('miqdor yo\'l uzunligidan o\'lchanadi', /var dist = Math\.abs\(x - prev\)/.test(f));
  check('yuqori chegara bor', /Math\.min\(0\.20,/.test(f));
  /* Birinchi chizilishda harakat yo'q — cho'zilish ham bo'lmasligi
     kerak, aks holda ilova ochilishida tabletka sababsiz silkinardi. */
  check('birinchi chizilishda cho\'zilmaydi', /typeof prev !== "number"/.test(f));
  check('juda qisqa siljish e\'tiborga olinmaydi', /if\(dist < 6\) return;/.test(f));
  check('yuzasi saqlangandek ko\'rinadi', /var squash = 1 - \(stretch - 1\) \* 0\.55;/.test(f));
  /* Sinf taymer bilan olib tashlanadi: `animationend` ga qo'yilsa,
     ketma-ket bosishda `animationcancel` yangi animatsiyani uzib
     qo'yardi. */
  check('sinf keyin olib tashlanadi', /__travelTimer = setTimeout/.test(f));
  check('qayta boshlash uchun oqim majburlanadi', /void el\.offsetWidth;/.test(f));
}
check('moveNavBlob cho\'zilishni ishga tushiradi',
  /flashLensTravel\(x\);[\s\S]{0,80}placeNavLens\(x, navLensWidth\(active\)\)/.test(html));

/* Sudralayotganda va harakat kamaytirilganda cho'zilish bo'lmaydi.
   Bosilganda esa ataylab to'xtatilmaydi: to'xtatilsa, yo'lda
   ketayotgan tabletka bosilgan zahoti shaklini birdan tashlab
   yuborardi. */
for (const [name, re] of [
  ['sudralganda', /\.bottom-nav\.dragging \.bn-blob-fill\.bn-travel/],
  ['harakat kamaytirilganda', /\[data-reduce-motion="1"\] \.bn-blob-fill\.bn-travel/],
]) {
  check(name + ' cho\'zilish o\'chadi', re.test(html));
}
check('bosilganda cho\'zilish uzilmaydi',
  !/\.bottom-nav\.pressed \.bn-blob-(fill|gloss)\.bn-travel/.test(html));

/* ---------- Bosilganda ----------
   Katak butunlay — belgisi va yozuvi bilan birga — siqiladi.
   Ilgari faqat ikonka siqilardi, ya'ni katakning yarmi javob
   berib, yarmi bermagandek bo'lardi. */
check('bosilgan katak siqiladi', /\.bn-item\.bn-down\{[\s\S]{0,160}transform:scale\(0\.9\d\)/.test(html));
check('siqilish animatsiya bilan', /\.bn-item,\.bn-ghost\{[\s\S]*?transition:color[^;]*,\s*\n\s*transform [\d.]+s/.test(html));
/* Bosilishi tez, qaytishi sekinroq: shunda u "qo'yib yuborildi"
   degan tuyg'u beradi. */
const down = html.match(/\.bn-item\.bn-down\{[\s\S]*?\n {2}\}/);
if (down) {
  const dn = +(down[0].match(/transform ([\d.]+)s/) || [])[1];
  const base = +(html.match(/\.bn-item,\.bn-ghost\{[\s\S]*?transform ([\d.]+)s/) || [])[1];
  check('bosilishi qaytishidan tez', dn > 0 && base > 0 && dn < base, { bosilish: dn, qaytish: base });
}
/* Ikonka alohida siqilmaydi — katak bilan birga ketadi, aks holda
   belgi yozuvdan ko'proq kichrayib, katak bir tekis bosilgandek
   ko'rinmasdi. */
check('ikonka alohida siqilmaydi',
  !/\.bn-item\.bn-down \.ic-svg\{/.test(html) && !/\.bn-item:active \.ic-svg\{/.test(html));
check('harakat kamaytirilganda siqilish yo\'q',
  /\[data-reduce-motion="1"\] \.bn-item\{[\s\S]{0,120}transform:none/.test(html));

/* Tabletka faqat O'ZI turgan katak bosilganda siqiladi. */
check('tabletka press-active ga bog\'langan',
  /\.bottom-nav\.press-active \.bn-blob-fill,[\s\S]{0,80}\.bn-blob-gloss\{transform:scale\(0\.9\d\)/.test(html));
check('press-active JS da qo\'yiladi',
  /classList\.toggle\("press-active",[\s\S]{0,120}classList\.contains\("active"\)/.test(html));
check('press-active olib ham tashlanadi',
  (html.match(/classList\.remove\("press-active"\)/g) || []).length >= 2);
/* Linza olib tashlanganda undan qolgan `.pressed` bo'rtishlari
   (scale 1.14) shu yerda turardi: `.press-active` ga o'tilgach
   qoplama ko'tarilib, istalgan katak bosilganda tabletka
   kattalashib ketardi. */
check('eski linza bo\'rtishi qolmadi',
  !/\.bottom-nav\.pressed \.bn-blob-(fill|gloss|mag|rim)\{/.test(html));

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
