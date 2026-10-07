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

/* ---------- Panel ustida qalqon bo'lmasin ----------
   Bildirishnoma (toast) aynan pastki panelning o'rniga tushardi:
   panel pastdan 20px da, balandligi 63px — ikkisi deyarli to'liq
   ustma-ust kelardi. `pointer-events:auto` bilan u panelni to'rt
   soniyaga yopib qo'yardi: odam Profilni bosadi — hech narsa
   bo'lmaydi, ikkinchi marta bosadi — ochiladi.

   Bu xato brauzer testlaridan ham qochib yurgan edi, chunki ular
   `#toastHost` ni tozalab olardi. Shuning uchun ikkala shart ham
   shu yerda qotiriladi. */
check('panelning joyi bitta joyda hisoblanadi', /--nav-top:calc\(/.test(html));
check('Telegram ichida ham hisoblanadi',
  /\[data-tg="1"\]\{\s*--nav-top:calc\([^;]*--tg-bottom/.test(html));
const toastHost = html.match(/#toastHost\{[\s\S]*?\n {2}\}/);
check('#toastHost qoidasi topildi', Boolean(toastHost));
if (toastHost) {
  check('bildirishnoma panel ustida turadi', /bottom:calc\(var\(--nav-top\)/.test(toastHost[0]),
    toastHost[0].match(/bottom:[^;]*/));
}
const toast = html.match(/\n {2}\.toast\{[\s\S]*?\n {2}\}/);
check('.toast qoidasi topildi', Boolean(toast));
if (toast) {
  /* Bildirishnomada bosiladigan narsa yo'q — u o'zi ketadi. */
  check('bildirishnoma teginishni ushlamaydi', /pointer-events:none/.test(toast[0]),
    toast[0].match(/pointer-events:[^;]*/));
}

/* ---------- Bosishni panelning o'zi hal qiladi ----------
   Ilgari bo'lim almashuvi brauzerning "click" hodisasiga
   qoldirilgandi. Lekin brauzer click ni har doim ham yubormaydi:
   barmoq uzilmay turib ikkinchisi tushsa, teginish ko'p barmoqli
   deb hisoblanadi va click umuman kelmaydi. Tez bosganda aynan
   shunday bo'ladi, shuning uchun bo'lim ochilmay qolardi.

   Shuning uchun `finish()` endi barmoq uzilgan katakni o'zi
   topadi — sudrashda ham, oddiy bosishda ham. */
/* Faylda `finish(e)` nomli bir nechta funksiya bor (yon tomonga
   surish ham shunday nomlangan) — bizga pastki paneldagisi kerak,
   uni `wasDragging` dan tanib olamiz. */
const finishFn = [...html.matchAll(/function finish\(e\)\{[\s\S]*?\n {4}\}/g)]
  .map((m) => m[0]).filter((s) => s.includes('wasDragging'));
check('panelning finish() i topildi', finishFn.length === 1, finishFn.length);
if (finishFn.length === 1) {
  const f = finishFn[0];
  check('oddiy bosishda ham katak topiladi', /var item = wasDragging \? target : null;/.test(f), f.slice(0, 200));
  check('barmoq uzilgan joydan olinadi', /item = itemAt\(e\.clientX\)/.test(f));
  /* Panel tashqarisida uzilsa — bekor qilingan bosish. */
  check('panel tashqarisida ochilmaydi', /e\.clientY >= box\.top/.test(f) && /e\.clientY <= box\.bottom/.test(f));
  /* Panelning o'zi ochgandan keyin brauzerning clicki yutilishi
     kerak, aks holda bo'lim ikki marta almashardi. */
  check('keyingi click yutiladi', /dragEndedAt = Date\.now\(\);[\s\S]{0,200}var item = wasDragging/.test(f));
  check('eski "clickka qoldirish" yo\'li qolmadi', !/if\(!wasDragging\)\{ moveNavBlob\(\); return; \}/.test(f));
}
/* Ustma-ust tushgan teginishda navbat yangisiga o'tadi: odam
   oxirgi tekkan katagini kutadi. Ilgari ikkinchi barmoq butunlay
   e'tiborsiz qolardi (`return`). */
check('ustma-ust teginishda navbat yangisiga o\'tadi',
  !/\} else if\(pointerId !== null\)\{\s*return;\s*\}/.test(html));
/* Uzilib qolgan teginishdan keyin katak yashil bo'lib qolmasin. */
check('yangi teginish eski yashil belgini tozalaydi',
  /setArmed\(null\);\s*\n\s*pointerId = e\.pointerId;/.test(html));

/* ---------- Belgilar bir xil o'lchamda ----------
   Besh belgining to'rttasi 16 birlik joy egallaydi (4 dan 20
   gacha). "+" 14 da, quloqchinlar esa 19 da edi — panelda biri
   kichik, biri keng bo'lib ko'rinardi. */
const plus = html.match(/<symbol id="iconPlus"[^>]*>(.*?)<\/symbol>/);
check('iconPlus topildi', Boolean(plus));
if (plus) check('"+" qolganlari bilan bir o\'lchamda', /M12 4V20M4 12H20/.test(plus[1]), plus[1]);
const hp = html.match(/<symbol id="iconHeadphones"[\s\S]*?<\/symbol>/);
check('iconHeadphones topildi', Boolean(hp));
if (hp) {
  /* Quloqliklar 4 dan 20 gacha: chapdagisi 4 da boshlanadi,
     o'ngdagisi 16+4=20 da tugaydi. */
  const rects = [...hp[0].matchAll(/<rect x="([\d.]+)"[^>]*width="([\d.]+)"/g)]
    .map((m) => [+m[1], +m[1] + +m[2]]);
  check('quloqchinlar 16 birlik kenglikda',
    rects.length === 2 && Math.min(...rects.map((r) => r[0])) === 4
    && Math.max(...rects.map((r) => r[1])) === 20, rects);
}
/* "+" ga alohida qalinlik berilmasin: u faqat o'lchov farqini
   yashirish uchun qo'yilgandi. */
check('"+" ga alohida chiziq qalinligi berilmagan',
  !/\.bn-item--primary \.bn-fab \.ic-svg\{[^}]*stroke-width/.test(html));

/* ---------- Qorong'u rejimda yashil kamaytirildi ---------- */
check('qorong\'uda tanlangan katak oq',
  /\[data-theme="dark"\] \.bn-item\.active,[\s\S]{0,80}\.bn-ghost\.active\{color:#FFFFFF/.test(html));
/* Yorug' rejimda yashil qoladi — bu brendning rangi. */
check('yorug\'da yashil joyida', /\.bn-item\.active,\.bn-ghost\.active\{color:var\(--route\);\}/.test(html));

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
