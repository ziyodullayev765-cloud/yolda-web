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

/* ---------- Halqa ----------
   Belgi — halqa: ostida xira iz, ustida chiziladigan yoy.
   Ilgari o'n ikkita tayoqcha edi va ular bittalab yonardi;
   aylanishi esa sakrab-sakrab, qo'pol ko'rinardi. */
const arc = html.match(/\n {2}\.ptr-arc\{[\s\S]*?\n {2}\}/);
check('.ptr-arc qoidasi topildi', Boolean(arc));
if (arc) {
  check('rangni belgidan oladi', /stroke:currentColor/.test(arc[0]), arc[0]);
  /* Yoyning boshi TEPADA. SVG da nol nuqta o'ngda, shuning uchun
     chorak aylana burib qo'yiladi. */
  check('yoy tepadan boshlanadi', /transform:rotate\(-90deg\)/.test(arc[0]), arc[0]);
  /* Uzunlik — aylananing o'zi: 2πr, r = 18 → 113.1.
     O'LCHOV BIRLIGI SHART: `stroke-dashoffset` CSS da uzunlik
     kutadi va birliksiz son butun qoidani yaroqsiz qiladi — yoy
     esa doim to'liq chizilgan bo'lib qolardi. */
  check('yoy uzunligi halqaga teng', /stroke-dasharray:113\.1px;/.test(arc[0]), arc[0]);
  check('uzunlik masofadan keladi',
    /stroke-dashoffset:calc\(113\.1px - 113\.1px \* var\(--ptr-progress, 0\)\)/.test(arc[0]), arc[0]);
}
check('ostida xira iz bor', /\.ptr-track\{stroke:currentColor;opacity:0\.\d+;\}/.test(html));

/* ---------- Chegara: titrash va bir aylanish ----------
   Chegaraga yetganda telefon bir titraydi va halqa bir marta
   aylanib qo'yadi — "endi qo'yib yuborsangiz bo'ladi". */
check('chegarada bir aylanadi',
  /\.ptr-armed \.ptr-ring\{animation:ptrSnap [\d.]+s cubic-bezier\([^)]*\) 1;\}/.test(html));
check('bir aylanish — to\'liq doira',
  /@keyframes ptrSnap\{from\{transform:rotate\(0deg\);\}to\{transform:rotate\(360deg\);\}\}/.test(html));
const prog = html.match(/function ptrProgress\(el, dist, threshold\)\{[\s\S]*?\n {2}\}/);
check('ptrProgress topildi', Boolean(prog));
if (prog) {
  check('chegarada titraydi', /haptic\("medium"\)/.test(prog[0]), prog[0]);
  /* Faqat bir marta: barmoq chegara atrofida qimirlab tursa,
     telefon tinimsiz titrab turmasligi kerak. */
  check('titrash bir martadan', /if\(!el\.classList\.contains\("ptr-armed"\)\)/.test(prog[0]), prog[0]);
  check('orqaga surilsa belgi qaytadi', /el\.classList\.remove\("ptr-armed"\)/.test(prog[0]), prog[0]);
  /* Teginish bo'shlig'i hisobdan chiqariladi: brauzer taxminan
     15 pikseldan keyin xabar beradi. */
  check('teginish bo\'shlig\'i hisobga olinadi', /dist - PTR_SLOP/.test(prog[0]), prog[0]);
}
check('ikkala tortish ham shu hisobdan foydalanadi',
  (html.match(/ptrProgress\(\w+, eased, THRESHOLD\)/g) || []).length === 2);

/* ---------- Qo'yib yuborilgandan keyingi aylanish ----------
   Ikki harakat bir vaqtda: halqa aylanadi, yoy esa
   cho'zilib-qisqaradi. Davomiyliklari teng emas, shuning uchun
   naqsh takrorlanmaydi va aylanish "tirik" ko'rinadi. */
check('halqa tekis aylanadi',
  /\.ptr-live \.ptr-ring\{animation:ptrRotate [\d.]+s linear infinite;\}/.test(html));
check('yoy cho\'zilib-qisqaradi',
  /\.ptr-live \.ptr-arc\{\s*\n\s*animation:ptrDash [\d.]+s ease-in-out infinite;/.test(html));
const dash = html.match(/@keyframes ptrDash\{[\s\S]*?\n {2}\}/);
check('ptrDash topildi', Boolean(dash));
if (dash) {
  check('yoy qisqadan uzunga va qaytadi',
    /0%\{stroke-dasharray:2px/.test(dash[0]) && /50%\{stroke-dasharray:80px/.test(dash[0])
    && /100%\{stroke-dasharray:2px/.test(dash[0]), dash[0]);
}
/* Harakat kamaytirilganda hech narsa aylanmaydi, lekin belgi
   ko'rinib turadi — ish ketayotgani bilinsin. */
check('harakat kamaytirilganda aylanmaydi',
  /\[data-reduce-motion="1"\] \.ptr-armed \.ptr-ring,/.test(html)
  && /@media \(prefers-reduced-motion: reduce\)\{\s*\n\s*\.ptr-armed \.ptr-ring,\.ptr-live \.ptr-ring,\.ptr-live \.ptr-arc\{animation:none;\}/.test(html));

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

/* ---------- Ekranning o'zi ham suriladi ----------
   Belgi yolg'iz tushib kelsa, sahifaning ustiga qo'yilgandek
   ko'rinadi. Tanish harakat boshqacha: ekran barmoq ortidan
   pastga suriladi va bo'shagan joyda belgi turadi. */
const pull = html.match(/function ptrPull\(px, smooth\)\{[\s\S]*?\n {2}\}/);
check('ptrPull topildi', Boolean(pull));
if (pull) {
  check('suriladigan narsa — bo\'limlar', /querySelector\("main"\)/.test(pull[0]), pull[0]);
  /* `transform` qo'yilgan element o'z ichidagi `position:fixed`
     lar uchun yangi tayanch bo'lib qoladi — hatto `translateY(0)`
     da ham. Shuning uchun tortish tugagach uslub BUTUNLAY
     tozalanadi. */
  check('tinch turganda uslub tozalanadi',
    /main\.style\.transform = "";/.test(pull[0]) && /main\.style\.transition = "";/.test(pull[0]),
    pull[0]);
  check('qaytishi yumshoq', /cubic-bezier/.test(pull[0]), pull[0]);
}
/* Ikkala tortish ham ekranni suradi: tortayotganda masofaga
   qarab, yangilash davomida esa qat'iy balandlikda ushlab
   turadi. */
check('tortayotganda suriladi',
  (html.match(/ptrPull\(eased \* PTR_PULL_RESIST, false\)/g) || []).length === 2);
check('yangilash davomida ushlab turiladi',
  (html.match(/ptrPull\(PTR_HOLD, true\)/g) || []).length === 2);
check('qaytgach joyiga qaytadi',
  (html.match(/ptrPull\(0, true\)/g) || []).length === 2);
/* Belgi bo'shliqning O'RTASIDA turadi; bo'shliq sarlavha ostidan
   boshlanadi, shuning uchun uning o'rni o'lchanadi — sarlavha
   balandligi tilga va qurilmaga qarab o'zgaradi. */
check('belgi bo\'shliq o\'rtasida', /function ptrSpot\(gap\)\{\s*\n\s*return Math\.round\(ptrTop\(\) \+ gap \/ 2 - 22\);/.test(html));
check('sarlavha o\'lchanadi', /function ptrTop\(\)\{[\s\S]*?querySelector\("nav\.nav"\)/.test(html));
/* Ochiq suhbatda tortish — eski xabarlarni ko'rish. Ustiga,
   suhbat to'liq ekranda `<main>` ichida turadi: ekranni surish
   uni ham surib yuborardi. */
check('ochiq suhbatda sahifa tortilmaydi',
  /if\(document\.querySelector\("\.chat-fullscreen"\)\) return;/.test(html));

/* ---------- Chegaradan nariga qimirlamaydi ----------
   Telefon titradi, halqa yopildi — javob berildi. Shundan keyin
   ham ekran cho'zilib ketsa, bu "yana bir narsa bo'ladi" degan
   yolg'on ishora bo'lardi; qo'l esa baribir bir joyda to'xtaydi. */
check('eng ko\'p surilish — chegaraning o\'zi',
  (html.match(/var MAX = THRESHOLD;/g) || []).length === 2,
  (html.match(/var MAX = THRESHOLD;/g) || []).length);
/* Masofa: barmoq yetarlicha yurishi kerak, aks holda ro'yxatni
   bir surganda ham yangilanib ketardi. */
const chegara = [...html.matchAll(/var THRESHOLD = (\d+);/g)].map((m) => +m[1]);
check('ikkala tortishning ham chegarasi bor', chegara.length === 2, chegara);
check('chegara yetarlicha uzoq', chegara.every((v) => v >= 75), chegara);

/* ---------- Belgi ekranning ostida ----------
   Tortilganda bo'limlar pastga suriladi va belgi ochilgan
   bo'shliqda ko'rinadi; qaytganda esa ekran uning ustini yopadi.
   Ilgari u eng ustda turardi va qaytayotgan ekranning ustiga
   chiqib qolardi. */
if (ptr) {
  check('belgi manfiy qavatda', /z-index:-1;/.test(ptr[0]), ptr[0]);
}
/* Buning uchun bo'limlarning O'Z FONI bo'lishi shart: fon
   shaffof bo'lsa, ostidagi belgi ko'rinib turaverardi. */
check('bo\'limlarning foni bor', /\n {2}main\{background:var\(--paper\);\}/.test(html));

/* ---------- Yangi versiyani ilovaning o'zi ko'radi ----------
   O'rnatilgan ilova kunlab yopilmaydi: sahifa qaytadan
   ochilmagach, kod birinchi ochilgan kunidagicha qolib ketardi.

   Eski yo'l `registration.waiting` ga qarardi — "yangi xizmat
   fayli navbatda turibdimi". Lekin xizmat faylimiz o'rnatilishi
   bilan boshqaruvni oladi (`skipWaiting`), ya'ni navbatda hech
   qachon turmaydi va tekshiruv doim "yangilik yo'q" derdi.
   Haqiqiy signal — boshqaruv almashgani. */
check('boshqaruv almashuvi kuzatiladi',
  /addEventListener\("controllerchange", function\(\)\{\s*\n\s*if\(!controlled\)\{ controlled = true; return; \}/.test(html));
check('xizmat fayli o\'zi boshqaruvni oladi',
  /self\.skipWaiting\(\)/.test(readFileSync(join(here, '..', 'sw.js'), 'utf8')));
/* Qayta yuklash xavfsiz paytda: forma to'ldirilayotganda yoki
   oyna ochiq turganda emas. */
const safe = html.match(/function safeToReload\(\)\{[\s\S]*?\n {2}\}/);
check('xavfsizlik tekshiruvi bor', Boolean(safe));
if (safe) {
  check('"Yuk joylash" formasiga tegilmaydi', /visibleTabName\(\) === "order"/.test(safe[0]), safe[0]);
  check('ochiq oynada ham tegilmaydi', /sheetRoot/.test(safe[0]), safe[0]);
  check('bot ekrani ochiq bo\'lsa ham', /data-ai-open/.test(safe[0]), safe[0]);
}
/* Qulay paytlar: bo'lim almashuvi va ilovaning fondan qaytishi. */
check('qulay paytda qo\'llanadi',
  (html.match(/applyNewVersion\(\);/g) || []).length >= 3,
  (html.match(/applyNewVersion\(\);/g) || []).length);
/* Fondan qaytganda tekshiruv kechiktirilmasin: odatdagi tinch
   tekshiruv 30 soniyada bir marta, uzoq turib qaytganda esa
   darhol. */
check('uzoq turib qaytganda darhol tekshiriladi',
  /check\(hiddenAt && Date\.now\(\) - hiddenAt > 10000\)/.test(html));

/* ---------- JS tomoni ---------- */
check('belgi bitta joyda yasaladi', /function makePtrIndicator\(\)\{/.test(html));
const make = html.match(/function makePtrIndicator\(\)\{[\s\S]*?\n {2}\}/);
if (make) {
  check('halqa chiziladi',
    /ptr-ring/.test(make[0]) && /ptr-track/.test(make[0]) && /ptr-arc/.test(make[0]), make[0]);
}
/* Ikkala tortib yangilash ham shu belgidan foydalanadi — ilgari
   ularning har biri o'z nusxasini yozib qo'ygandi. */
check('ikkala tortish ham shu belgidan foydalanadi',
  (html.match(/makePtrIndicator\(\)/g) || []).length === 3);
/* `.ptr-live` endi "o'zi aylanmoqda" degani: u faqat barmoq
   qo'yib yuborilgandan keyin qo'yiladi (ikki tortishda ikkitadan
   bir marta), tortish paytida esa olib tashlanadi — o'shanda
   burchakni barmoqning o'zi boshqaradi.

   Shuning uchun qo'yilishi ikki marta, olib tashlanishi to'rt
   marta uchraydi: ikkitasi tortish paytida, ikkitasi qaytganda. */
check('faqat qo\'yib yuborilgach yoqiladi',
  (html.match(/classList\.add\("ptr-live"\)/g) || []).length === 2,
  (html.match(/classList\.add\("ptr-live"\)/g) || []).length);
check('tortish paytida va qaytgach o\'chadi',
  (html.match(/classList\.remove\("ptr-live"\)/g) || []).length === 4,
  (html.match(/classList\.remove\("ptr-live"\)/g) || []).length);
/* Belgining o'zini yana burash ortiqcha — ikkita harakat
   urishib ketardi.

   Tekshiruv AYNAN tortish belgisining uslublariga qaraydi:
   ilgari u butun faylni ko'rardi va ilovaning boshqa joyidagi
   (masalan yordamchining quvonchi) begona animatsiya ham shu
   qolipga tushib, testni yiqitib qo'yardi. */
const ptrCss = (html.match(/\.ptr-[a-z-]*\{[^}]*\}/g) || []).join('\n')
  + '\n' + (html.match(/@keyframes ptr[A-Za-z]*\{[\s\S]*?\n {2}\}/g) || []).join('\n');
check('tortish belgisining uslublari topildi', ptrCss.length > 40, ptrCss.length);
/* Ikki harakat ikki qatlamda: tashqi element FAQAT suriladi,
   ichkaridagi g'ildirak FAQAT aylanadi. Bitta `transform` da
   ikkalasi bo'lsa, ular bir-birini bosib ketardi. */
check('surish va aylanish aralashmagan', !/translateY\([^)]*\) rotate\(/.test(ptrCss));

/* ---- Bir harakat ichida ikkinchi marta tortish ----
   Odam belgini bir marta tushirib, yangilanishga yetkazmasdan
   joyiga qaytarsa va YANA tortsa — tushishi kerak. Ilgari
   `dy <= 0` bo'lgani uchun kuzatish butunlay to'xtardi, barmoq
   esa ko'tarilmagani uchun yangi "touchstart" kelmasdi: ikkinchi
   tortish umuman ishlamay qolardi.

   Ikki nusxada ham shunday — sahifada va xabarlar ro'yxatida. */
check('JOYIGA QAYTGANDA KUZATISH TO\'XTAMAYDI',
  (html.match(/if\(dy <= 0\)\{ draw\(0\); return; \}/g) || []).length === 2,
  (html.match(/if\(dy <= 0\)/g) || []).length);
check('bekor qilish faqat yonlamasiga surishda yoki sahifa surilganda',
  (html.match(/if\(window\.scrollY > 0 \|\| \(dy > 0 && dx > dy\)\)\{ pulling = false; reset\(\); return; \}/g) || []).length === 2);
/* Eski shart qolib ketmasin. */
check('eski shart olib tashlandi', !/dy <= 0 \|\| dx > dy/.test(html));

if (fails.length) {
  console.log('ptr: ' + fails.length + ' ta xato');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('ptr: ' + passed + ' ta tekshiruv o\'tdi');
