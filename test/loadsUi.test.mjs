/**
 * Yuklar ro'yxati va yuk sahifasining tuzilishi.
 *
 *     node test/loadsUi.test.mjs      (yoki npm test)
 *
 * NEGA KERAK. Ikkala ekran ham qayta chizildi: kartochkada endi
 * chapda belgi, o'ngda narx, o'rtada yo'nalish va ikki qator fakt;
 * yuk sahifasida esa yuqori maydon, to'rt fakt bir qatorda va
 * pastda bitta katta tugma.
 *
 * ENG MUHIM TASDIQ — TELEFON RAQAMI. E'lon hammaga ochiq, lekin
 * raqam shaxsiy ma'lumot: server uni yuk olinmaguncha bermaydi
 * (api/order.js, getLoadDetail). Chizmada aloqa qatorida raqam
 * turardi; agar u shu yerga qo'yilsa, har bir e'lon egasining
 * raqami butun internetga ochilgan bo'lardi. Shuning uchun quyida
 * raqam SO'RALMAGANI ham, CHIZILMAGANI ham tekshiriladi.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const html = readFileSync(join(repo, 'index.html'), 'utf8');
const api = readFileSync(join(repo, 'api/order.js'), 'utf8');

let passed = 0;
let failed = 0;
const check = (name, ok, extra) => {
  if (ok) { passed += 1; return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`);
};
const flow = (name) => console.log(`\n== ${name} ==`);

/** `loadCardHtml` ning tanasi. */
const cardFn = (() => {
  const at = html.indexOf('function loadCardHtml(o){');
  return html.slice(at, html.indexOf('\n  }\n', at));
})();
/** `renderLoadDetail` ning tanasi. */
const detailFn = (() => {
  const at = html.indexOf('function renderLoadDetail(d){');
  return html.slice(at, html.indexOf('\n  }\n', at));
})();

/* ============================================================
   1. Kartochka
   ============================================================ */
flow('1. Yuk kartochkasi');
{
  check('belgi maydoni chapda', cardFn.includes('class="lc-thumb"'));
  check('matn ustuni', cardFn.includes('class="lc-body"'));
  check('o‘ng ustun', cardFn.includes('class="lc-side"'));
  check('narx o‘ng ustunda',
    cardFn.indexOf('class="lc-side"') < cardFn.indexOf('class="lc-price"'));
  check('strelka bor', cardFn.includes('class="lc-chev"'));
  check('ikki qator fakt', (cardFn.match(/class="lc-row"/g) || []).length === 2);

  /* Yo'nalish strelkasi atrofida HAQIQIY bo'shliq bo'lishi kerak.
     Usiz "Toshkent→Samarqand" brauzer uchun bitta so'z bo'lib
     qoladi va tor ustunga sig'masa ham yangi qatorga o'tmaydi —
     narxning ustiga chiqib ketadi. */
  check('yo‘nalish uzilishi mumkin',
    cardFn.includes("+' <span class=\"arrow\">→</span> '+"), 'strelka atrofida bo‘shliq');
  check('sahifada ham shunday',
    detailFn.includes("+' <span class=\"arrow\">→</span> '+"));
  check('strelkaga chetdan surish berilmagan',
    !/\.lc-route \.arrow\{[^}]*margin/.test(html), 'bo‘shliq matnning o‘zida');

  // Saqlash tugmasi yo'qolmagan va o'z ko'rinishi bor.
  check('saqlash tugmasi qoldi', cardFn.includes('data-fav="'));
  check('saqlash tugmasining uslubi bor', html.includes('.load-card .lc-fav{'),
    'usiz brauzer uni oddiy to‘rtburchak tugma qilib chizardi');

  check('"Yangi" belgisi nuqta bilan', html.includes('.load-card .lc-badge.fresh::before'));
  check('mos yuk foizi qoldi', cardFn.includes('match-badge'));
}

/* ============================================================
   2. Shahar tanlagichlari
   ============================================================ */
flow('2. Shahar tanlagichlari');
{
  check('qator bor', html.includes('id="loadsCityChips"'));
  check('kelgan e\'lonlardan hisoblanadi', html.includes('function renderLoadCityChips'));
  /* Shaharlar qo'lda yozilsa, bosilganda bo'sh ro'yxat chiqishi
     mumkin edi — tanlagich bor, lekin unda hech narsa yo'q.
     Shuning uchun ro'yxat kelgan e'lonlardan sanaladi. Tekshiruv
     butun faylga emas, aynan shu funksiyaga qaraydi: sahifada
     boshqa (haqiqatan ham qo'lda yozilgan) shahar ro'yxatlari
     bor — tanlash oynasi va mashhur yo'nalishlar. */
  const chipsFn = (() => {
    const at = html.indexOf('function renderLoadCityChips(loads){');
    return html.slice(at, html.indexOf('\n  }\n', at));
  })();
  check('qo‘lda yozilmagan',
    !/["']Toshkent["']|["']Samarqand["']/.test(chipsFn), 'ro‘yxat ma\'lumotdan keladi');
  check('e\'lonlardan sanaladi', chipsFn.includes('count[o.fromCity]'));
  /* Filtr qo'llangach javobda faqat o'sha shahar qoladi —
     tanlagichlar o'shanda bittaga tushib qolmasligi kerak, aks
     holda boshqa shaharga qaytish yo'li yo'qolardi. */
  check('tanlanganda ro‘yxat qisqarmaydi', chipsFn.includes('if(!loadsState.fromCity){'));
  check('filtr oynasi bilan bitta holat',
    html.includes('loadsState.fromCity = city;') && html.includes('fromSel.value = city;'));

  /* `hidden` atributi yetarli emas edi: sinfdagi `display:flex`
     brauzerning `[hidden]{display:none}` qoidasidan kuchliroq. */
  check('yashirish ishlaydi', html.includes('.loads-cities[hidden]{display:none;}'));
  /* Yuqoridan bo'shliq shart: usiz qator qidiruv kartochkasining
     pastki chekkasiga yopishib qolardi (o'lchangan: 0px). */
  check('yuqoridan bo\'shliq bor',
    /\.loads-cities\{[^}]*margin:var\(--s4\) 0 var\(--s3\)/.test(html),
    'kartochka bilan oralig\'i');
  check('yuk sahifasida yashiriladi',
    html.includes('"backhaulBanner", "loadsCityChips"'));
}

/* ============================================================
   3. Yuk sahifasi
   ============================================================ */
flow('3. Yuk sahifasi');
{
  check('yuqori maydon', detailFn.includes('class="ld-hero"'));
  check('ko‘tarilgan varaq', detailFn.includes('class="ld-sheet"'));
  check('orqaga tugmasi', detailFn.includes('id="btnDetailBack"'));
  check('saqlash qoldi', detailFn.includes('id="btnDetailFav"'));
  check('ulashish qoldi', detailFn.includes('id="btnDetailShare"'));

  check('to‘rtta fakt', detailFn.includes('class="ld-stats"'));
  check('to‘rttasi bir qatorda',
    /\.ld-stats\{[^}]*grid-template-columns:repeat\(4,1fr\)/.test(html));

  check('yo‘nalish qatori', detailFn.includes('id="rowRoute"'));
  check('aloqa qatori', detailFn.includes('id="rowContact"'));
  check('manzil yo‘qolmagan', detailFn.includes('addressLineHtml'));
  check('qolgan faktlar qoldi', detailFn.includes('class="detail-grid"'));
  check('buyurtma kodi ko‘rinadi', detailFn.includes('order.trackCodeLabel'));

  /* Asosiy qadam — taklif yuborish. */
  check('katta tugma bor', detailFn.includes('class="ld-cta" id="btnDetailOffer"'));
  check('tugma taklif oynasini ochadi', detailFn.includes('openOfferSheet(d)'));
  check('tugmaning yozuvi', detailFn.includes('data-i18n="loads.sendOffer"'));
  /* Olingan yukka tugma qoldirilsa, bosilganda hech narsa
     bo'lmasdi — o'rniga sababi yoziladi. */
  check('olingan yukka tugma yo‘q', detailFn.includes('openForOffers'));
  check('sababi aytiladi', detailFn.includes('data-i18n="loads.taken"'));
  check('xabar yozish qoldi', detailFn.includes('id="btnDetailMessage"'));
  check('takliflar ro‘yxati qoldi', detailFn.includes('id="offersBox"'));

  /* Pastki panel ekranga yopishib turadi: varaqning pastki
     bo'shlig'i yetmasa, oxirigacha aylantirilganda ham tugma
     panel ostida qolardi. */
  check('tugma panel ostida qolmaydi',
    /\.ld-sheet\{[^}]*padding:var\(--s5\) var\(--s4\) calc\(var\(--nav-top\)/.test(html));
}

/* ============================================================
   4. Telefon raqami ochilib qolmasin
   ============================================================ */
flow('4. Maxfiylik');
{
  /* Server ochiq e'lon uchun raqam bermaydi — avval shuni
     tasdiqlaymiz, aks holda quyidagi tekshiruvlar bo'sh gap. */
  const detailApi = (() => {
    const at = api.indexOf('const getLoadDetail = async (req, res) => {');
    return api.slice(at, api.indexOf('\n};', at));
  })();
  check('server raqam bermaydi', !/\bphone\b/.test(detailApi), 'api/order.js getLoadDetail');
  check('server izohni ham bermaydi', !/\bnote\b/.test(detailApi));

  // Sahifa ham raqam chizmaydi va so'ramaydi.
  check('sahifa raqam chizmaydi', !/d\.phone/.test(detailFn));
  check('sahifa izoh chizmaydi', !/d\.note/.test(detailFn));
  /* Aloqa ilova ichidagi yozishuv orqali — bu yo'l allaqachon
     bor va raqamni ochmaydi. */
  check('aloqa yozishuv orqali', detailFn.includes('goToChatWith(d.ownerUsername'));
  check('nusxalash tugmasi yo‘q', !/data-copy-phone|navigator\.clipboard/.test(detailFn));
}

/* ============================================================
   5. Uch tilda ham yozuvlar bor
   ============================================================ */
flow('5. Tarjimalar');
{
  const keys = ['loads.statWeight', 'loads.statQty', 'loads.statDate', 'loads.statDistance',
    'loads.route', 'loads.contact', 'loads.detailsTitle',
    'loads.priceProposed', 'loads.priceEstimate'];
  keys.forEach((k) => {
    const n = (html.match(new RegExp(`"${k.replace('.', '\\.')}":`, 'g')) || []).length;
    check(`${k} — uch tilda`, n === 3, n);
  });
}

/* ============================================================
   6. O'lik uslublar qolmagan
   ============================================================ */
flow('6. Qoldiq yo\'q');
{
  /* Qayta chizishdan keyin ishlatilmaydigan qoida qolsa, keyin
     uni o'qigan odam u hali ham ishlaydi deb o'ylaydi. */
  ['detail-route-big', 'detail-price'].forEach((c) => {
    check(`${c} olib tashlangan`, !html.includes(c), c);
  });
}

console.log(`\n${failed ? `${failed} ta xato, ` : ''}${passed} ta tekshiruv — ${failed ? 'XATO' : 'hammasi o\'tdi'}`);
process.exit(failed ? 1 : 0);
