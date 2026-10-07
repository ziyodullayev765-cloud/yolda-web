/**
 * Tepadan pastga tortib yangilash belgisi.
 *
 * Belgi — o'n ikkita tayoqcha. Ular aylanmaydi: har biri navbat
 * bilan so'nib boradi va aylanish shundan ko'rinadi. Shuning uchun
 * bu yerda ikki narsa qotiriladi.
 *
 * BIRINCHISI — tayoqchaning o'z holati `opacity:0`. Ya'ni
 * animatsiya ishlamasa, belgi ko'rinmaydi: xato "chala animatsiya"
 * emas, "hech narsa yo'q" bo'lib chiqadi va uni sezish qiyin.
 *
 * IKKINCHISI — animatsiya `.ptr-live` ga bog'langan. Belgi ikkita
 * (biri butun sahifa uchun, biri xabarlar ro'yxati uchun) va
 * ikkalasi ham doim sahifada turadi. Bog'lanmasa, ko'rinmayotgan
 * ikki belgida yigirma to'rtta animatsiya tinimsiz aylanib
 * yotardi — arzon telefonda bu bekorga sarflangan quvvat.
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

/* ---------- Tayoqchalar ---------- */
const bar = html.match(/\n {2}\.ptr-bar\{[\s\S]*?\n {2}\}/);
check('.ptr-bar qoidasi topildi', Boolean(bar));
if (bar) {
  check('tayoqcha o\'z holatida ko\'rinmaydi', /opacity:0;/.test(bar[0]), bar[0]);
  check('rangni belgidan oladi', /background:currentColor/.test(bar[0]), bar[0]);
  /* Animatsiya tayoqchaning o'z qoidasida BO'LMASLIGI kerak —
     u `.ptr-live` ichida. */
  check('animatsiya tayoqchaga qotirib qo\'yilmagan', !/animation:/.test(bar[0]), bar[0]);
}
check('animatsiya faqat ko\'rinib turganda ketadi',
  /\.ptr-live \.ptr-bar\{animation:ptrFade/.test(html));
check('so\'nish bosqichi aniqlangan', /@keyframes ptrFade\{from\{opacity:1;\}to\{opacity:0\.25;\}\}/.test(html));
/* Harakat kamaytirilganda animatsiya o'chadi — o'shanda tayoqcha
   o'z `opacity:0` iga qaytib, belgi butunlay yo'qolmasligi uchun
   unga qat'iy ko'rinish beriladi. */
check('harakat kamaytirilganda ham ko\'rinadi',
  /\[data-reduce-motion="1"\] \.ptr-live \.ptr-bar\{animation:none;opacity:0\.5\d;\}/.test(html));

/* ---------- O'n ikkita o'rin va navbat ---------- */
const rules = [...html.matchAll(
  /\.ptr-bar:nth-child\((\d+)\)\{transform:rotate\((\d+)deg\) translate\(0,-130%\);animation-delay:(-?[\d.]+)s;\}/g)];
check('o\'n ikkita tayoqchaning qoidasi bor', rules.length === 12, rules.length);
if (rules.length === 12) {
  const n = rules.map((r) => +r[1]);
  const deg = rules.map((r) => +r[2]);
  check('raqamlari 1 dan 12 gacha', n.join() === [1,2,3,4,5,6,7,8,9,10,11,12].join(), n);
  /* Har biri 30 daraja burilgan: 12 × 30 = 360. */
  check('doira teng bo\'lingan', deg.join() === [0,30,60,90,120,150,180,210,240,270,300,330].join(), deg);
  /* Kechikishlar foydalanuvchi yuborgan ko'rinishda. Davomiylik 1s
     bo'lgani uchun -1.1 va -1 aslida -0.1 va 0 bilan bir xil, ya'ni
     ikki juft tayoqcha bir vaqtda so'nadi. Bu ataylab shunday —
     agar kimdir "tuzatmoqchi" bo'lsa, bu test uni to'xtatib,
     avval so'rashga majbur qiladi. */
  const delays = rules.map((r) => +r[3]);
  check('kechikishlar yuborilgan ko\'rinishda',
    delays.join() === [0,-1.1,-1,-0.9,-0.8,-0.7,-0.6,-0.5,-0.4,-0.3,-0.2,-0.1].join(), delays);
}

/* ---------- Belgining o'zi ---------- */
const ptr = html.match(/\n {2}\.ptr\{[\s\S]*?\n {2}\}/);
check('.ptr qoidasi topildi', Boolean(ptr));
if (ptr) {
  check('ekran tepasida, ko\'rinmas holda turadi',
    /position:fixed/.test(ptr[0]) && /opacity:0/.test(ptr[0]), ptr[0]);
  check('teginishni ushlamaydi', /pointer-events:none/.test(ptr[0]), ptr[0]);
  /* Yashil emas, kulrang: bu holat belgisi, brend rangi emas. */
  check('neytral rangda', /color:var\(--muted\)/.test(ptr[0]), ptr[0]);
}

/* ---------- Qayerda ishlaydi ----------
   Telegram ichida pastga tortish — Telegram'ning o'z harakati:
   ilovani pastga surib yopadi. Ilova `tg.disableVerticalSwipes()`
   ni chaqiradi, ya'ni o'sha harakat bo'sh turadi va uni o'zimiz
   ishlatsak bo'ladi.

   Lekin bu metod Telegram 7.7 dan boshlab bor. Eskiroq mijozda
   chaqiruv jimgina o'tib ketadi va pastga tortish hamon ilovani
   yopadi — o'sha yerda tortib yangilash qo'shilsa, ikkisi urishib,
   ilova ko'z oldida yopilardi.

   Shuning uchun shart metod bor-yo'qligida emas, u HAQIQATAN
   ishlaganida: `isVerticalSwipesEnabled` aynan `false` bo'lishi
   kerak. Mana shu shartni qotirib qo'yamiz — "Telegram bo'lsa
   bo'ldi" degan yengil shartga almashtirib yuborilmasin. */
check('qayerda ishlashi bitta joyda hal qilinadi', /function pagePtrEnabled\(\)\{/.test(html));
const gate = html.match(/function pagePtrEnabled\(\)\{[\s\S]*?\n {2}\}/);
if (gate) {
  check('Telegram ichida ham ishlaydi', /isTelegramWebApp\) return telegramSwipesOff\(\)/.test(gate[0]), gate[0]);
  check('tashqarida faqat o\'rnatilgan ilovada', /return installAlreadyDone\(\);/.test(gate[0]), gate[0]);
}
const swipes = html.match(/function telegramSwipesOff\(\)\{[\s\S]*?\n {2}\}/);
check('telegramSwipesOff topildi', Boolean(swipes));
if (swipes) {
  /* `!== true` emas, aynan `=== false`: eski mijozda bu xossa
     umuman yo'q (undefined) va u "o'chirilgan" degani emas. */
  check('aynan false ekani tekshiriladi',
    /isVerticalSwipesEnabled === false/.test(swipes[0]), swipes[0]);
}
check('eski "Telegramda qo\'shilmaydi" sharti qolmadi',
  !/if\(!installAlreadyDone\(\) \|\| isTelegramWebApp\) return;/.test(html));
check('tortib yangilash Telegram aniqlangandan keyin ishga tushadi',
  /initTelegramWebApp\(\);[\s\S]*?initPullToRefresh\(\);/.test(html));
/* Xabarlar ro'yxatining o'z yangilashi bilan urishmasin. */
check('xabarlar ro\'yxatiga tegmaydi', /if\(chatListPullable\(\)\) return;/.test(html));

/* ---------- Yangilashning o'zi ----------
   Ilgari bu `location.reload()` edi va aynan shu animatsiyani
   o'ldirardi: sahifa qayta yuklanganda CSS animatsiyasi to'xtaydi,
   brauzer esa yangi sahifa chizilgunicha oxirgi kadrni ushlab
   turadi — ekranda qotib qolgan aylana ko'rinardi. Bundan tashqari
   "Yuk joylash" formasida yozilgani ham yo'qolardi. */
check('ochiq bo\'limni yangilaydigan funksiya bor', /function refreshCurrentTab\(\)\{/.test(html));
const rc = html.match(/function refreshCurrentTab\(\)\{[\s\S]*?\n {2}\}/);
if (rc) {
  /* Har bir bo'lim o'z yuklovchisiga ulangan bo'lishi kerak —
     aks holda tortib yangilash jim turadi. */
  for (const [tab, re] of [
    ['home', /renderHomeMatch\(\); renderHomeTrucks\(\)/],
    ['loads', /renderLoadsTab\(\)/],
    ['trucks', /renderTrucksTab\(\)/],
    ['myload', /loadMyLoad\(true\)/],
    ['life', /lifeItems = null; renderLife\(\)/],
    ['chat', /loadChatInbox\(true\)/],
    ['profile', /renderProfile\(\)/],
  ]) {
    check(tab + ' bo\'limi yangilanadi', re.test(rc[0]), tab);
  }
  /* Kesh chetlab o'tilmasa, "yangila" bosilgani bilan hech narsa
     qayta olinmasdi. */
  check('kesh chetlab o\'tiladi', /delete tabLoadedAt\[tab\]/.test(rc[0]));
}
check('yangilash sahifani qayta yuklamaydi',
  !/setTimeout\(function\(\)\{ location\.reload\(\); \}, 220\)/.test(html));
/* "Yuk joylash" bo'limiga tegilmasin: odam formani to'ldirib
   o'tirgan bo'lishi mumkin. */
check('"Yuk joylash" bo\'limi yangilanmaydi',
  Boolean(rc) && !/=== "order"/.test(rc[0]));

const run = html.match(/function ptrRefresh\(onDone\)\{[\s\S]*?\n {2}\}/);
check('ptrRefresh topildi', Boolean(run));
if (run) {
  /* Javob juda tez kelsa aylana ko'rinmay o'tib ketardi; tarmoq
     javob bermasa esa abadiy aylanib qolardi. */
  check('eng kam va eng ko\'p turish vaqti bor', /var MIN = \d+, MAX = \d+;/.test(run[0]));
  check('so\'rovlar tugaganda to\'xtaydi', /watch\.pending <= 0/.test(run[0]));
  check('yangi versiya tekshiriladi', /ptrCheckUpdate\(/.test(run[0]));
}
/* Aylana ma'lumot kelguncha turishi uchun so'rovlar sanaladi.
   Har bir bo'lim uchun alohida "tugadi" signali yozilsa, yangi
   bo'lim qo'shilganda esdan chiqib ketardi. */
check('so\'rovlar sanaladi', /function wrapFetchForPtr\(\)/.test(html));
check('sanash faqat yangilash davomida', /var w = ptrWatch;\s*\n\s*if\(w && p/.test(html));
/* Yangi versiya bo'lsa — qayta yuklash saqlanadi, chunki
   o'rnatilgan ilovada yangi kodni olishning boshqa yo'li yo'q. */
check('yangi versiya bo\'lsa qayta yuklanadi',
  /function ptrCheckUpdate\(onReady\)\{[\s\S]*?location\.reload\(\)/.test(html));
check('yangi versiya faqat haqiqatan bo\'lsa',
  /var sw = waiting\(\);\s*\n\s*if\(!sw\) return false;/.test(html));

/* ---------- JS tomoni ---------- */
check('belgi bitta joyda yasaladi', /function makePtrIndicator\(\)\{/.test(html));
const make = html.match(/function makePtrIndicator\(\)\{[\s\S]*?\n {2}\}/);
if (make) {
  check('o\'n ikkita tayoqcha qo\'yiladi',
    /for\(var i = 0; i < 12; i\+\+\)/.test(make[0]) && /ptr-bar/.test(make[0]), make[0]);
}
/* Ikkala tortib yangilash ham shu belgidan foydalanadi — ilgari
   ularning har biri o'z nusxasini yozib qo'ygandi. */
check('ikkala tortish ham shu belgidan foydalanadi',
  (html.match(/makePtrIndicator\(\)/g) || []).length === 3);
check('eski o\'q belgisi qolmadi', !html.includes('ptr-spin') && !html.includes('ptrSpin'));
/* Tortish paytida belgi aylanib turishi kerak: tayoqchaning o'z
   holati ko'rinmas, ya'ni `ptr-live` qo'yilmasa ekranda bo'sh joy
   bo'lardi. */
check('tortilganda aylanish yoqiladi',
  (html.match(/classList\.add\("ptr-live"\)/g) || []).length === 2);
check('qaytgach aylanish o\'chadi',
  (html.match(/classList\.remove\("ptr-live"\)/g) || []).length === 2);
/* Belgining o'zini yana burash ortiqcha — ikkita harakat
   urishib ketardi. */
check('ustiga yana burash qo\'shilmagan', !/translateY\([^)]*\) rotate\(/.test(html));

if (fails.length) {
  console.log('ptr: ' + fails.length + ' ta xato');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('ptr: ' + passed + ' ta tekshiruv o\'tdi');
