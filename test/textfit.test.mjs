/**
 * Yozuvlar joyiga sig'adimi va ortiqchasi qaytib kelmadimi.
 *
 * Bu to'plam ikki xil narsani qotirib qo'yadi.
 *
 * BIRINCHISI — sig'maslik. Uchta joyda matn qutisidan chiqib
 * ketardi va uchalasining sababi bir xil: flex ichidagi element
 * sukut bo'yicha O'Z MATNIDAN kichik bo'lishga ko'nmaydi
 * (`min-width:auto`), matn esa bir qatorga majbur qilingan. Shunda
 * element torayishdan bosh tortadi va butun qatorni ekrandan
 * chiqarib yuboradi:
 *
 *   - bosh sahifadagi ikkita katta tugma: ruschada
 *     "Разместить груз" tugmaning ichidan chiqib, "+" belgisi
 *     chetda qirqilib qolardi;
 *   - mashinalardagi qidiruv qatori: ichki o'ramada `min-width:0`
 *     yo'q edi, shuning uchun `.hsb-value` dagi ellipsis hech
 *     qachon ishlamasdi va qator ekrandan 30px chiqib ketardi;
 *   - buyurtma qadamlari: birinchi va oxirgi qadamning yozuvi
 *     qatordan tashqariga chiqib, ekran chetiga tiqilardi.
 *
 * Bunday xatolar o'zbekchada ko'rinmaydi — ular faqat yozuv
 * uzunroq bo'lgan tilda chiqadi, shuning uchun ko'zdan oson
 * qochadi. Qoidalar esa bir qarashda zararsiz ko'rinadi.
 *
 * IKKINCHISI — ortiqcha yozuvlar. Sarlavhani boshqa so'zlar bilan
 * takrorlaydigan izohlar olib tashlandi. Ular qaytib kelmasligi
 * uchun kalitlarining o'zi ham yo'q qilindi.
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

/* ---------- 1. Bosh sahifadagi ikkita tugma ---------- */
const ctas = html.match(/\.home \.hero-card \.hero-card-ctas\{[^}]*\}/);
check('hero tugmalar qatori topildi', Boolean(ctas));
/* `nowrap` bo'lsa tugmalar hech qachon pastga tushmaydi va
   matndan kichik bo'lishga majbur bo'ladi. */
check('sig\'masa pastga tushadi', Boolean(ctas) && /flex-wrap:wrap/.test(ctas[0]), ctas && ctas[0]);
const ctaBtn = html.match(/\.home \.hero-card \.hero-card-ctas \.hc-btn\{[\s\S]*?\}/);
check('hero tugma qoidasi topildi', Boolean(ctaBtn));
if (ctaBtn) {
  check('tugma o\'z yozuvidan kichik bo\'lmaydi',
    /min-width:min-content/.test(ctaBtn[0]) && !/min-width:0/.test(ctaBtn[0]), ctaBtn[0]);
}

/* ---------- 2. Mashinalardagi qidiruv qatori ---------- */
check('qidiruv matni uchun alohida uya bor', /\.home-search-bar \.hsb-slot\{[^}]*min-width:0/.test(html));
check('uya egiluvchan', /\.home-search-bar \.hsb-slot\{[^}]*flex:1/.test(html));
/* Ilgari bu o'rama HTML ichida `style="flex:1;text-align:left;"`
   bilan yozilgan edi — `min-width` esa yo'q edi. */
check('ichki o\'ramada inline style qolmadi', !/style="flex:1;text-align:left;?"/.test(html));
check('uya markupda ishlatilgan', /<span class="hsb-slot">/.test(html));
/* Ellipsis ishlashi uchun uchlikning o'zi ham kerak. */
check('qidiruv matni kesilsa uchlik qo\'yiladi',
  /\.trucks-topbar \.home-search-bar \.hsb-value\{[^}]*text-overflow:ellipsis/.test(html));
/* Matn ichidagi "..." ortiqcha: uchlikni CSS qo'yadi. */
const ph = [...html.matchAll(/"trucks\.searchPlaceholder":\s*"([^"]*)"/g)].map((m) => m[1]);
check('qidiruv matni uchta tilda bor', ph.length === 3, ph);
check('matn ichida ortiqcha uchlik yo\'q', ph.every((v) => !v.includes('...')), ph);

/* ---------- 3. Buyurtma qadamlari ---------- */
const steps = html.match(/\.wizard-steps\{[^}]*\}/);
check('qadamlar qatori topildi', Boolean(steps));
if (steps) {
  /* Yozuv doiradan kengroq va ikki yoniga chiqadi, shuning uchun
     qatorning o'zida yon bo'shliq bo'lishi kerak. */
  const pad = steps[0].match(/padding:0 (\d+)px/);
  check('qatorning yon bo\'shlig\'i bor', Boolean(pad) && +pad[1] >= 8, steps[0]);
}

/* ---------- 4. Olib tashlangan ortiqcha yozuvlar ---------- */
for (const key of ['home.matchSub', 'home.trucksSub', 'home.matchEyebrow']) {
  check(key + ' butunlay yo\'q', !html.includes(key));
}
/* Kalit bilan birga uni chizadigan element va o'lik CSS ham
   ketgan bo'lishi kerak. */
check('life-entry-s qoldiqlari yo\'q', !html.includes('life-entry-s'));
/* Sarlavha esa joyida qolsin — izoh olib tashlandi, sarlavha emas. */
for (const key of ['home.matchTitle', 'home.trucksTitle', 'nav.trucks']) {
  check(key + ' joyida', html.includes(key));
}
/* Bo'sh holat sarlavhani takrorlamasin. Sarlavha "mos yuklar"
   deb turganda, ostida yana "sizga mos yuklar topilmadi" deyish
   bir ekranda uchinchi takror bo'lardi. */
const empty = [...html.matchAll(/"home\.matchEmpty":\s*"([^"]*)"/g)].map((m) => m[1]);
check('bo\'sh holat uchta tilda bor', empty.length === 3, empty);
check('bo\'sh holat qisqa', empty.every((v) => v.length <= 30), empty);

if (fails.length) {
  console.log('textfit: ' + fails.length + ' ta xato');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('textfit: ' + passed + ' ta tekshiruv o\'tdi');
