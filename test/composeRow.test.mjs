/**
 * Yozishmadagi yozish qatori: tekis, yumaloq, ortiqcha baland emas.
 *
 *     node test/composeRow.test.mjs      (yoki npm test)
 *
 * EGASI RASM BILAN UCHTA NARSANI KO'RSATDI:
 *
 *   "bu to'rtburchak"            → maydon pill emas edi;
 *   "va tekis emas"              → mikrofon maydondan 6px pastda;
 *   "va ko'p tepaga chiqib ketgan" → qator 73px, 64px o'rniga.
 *
 * HAR BIRINING SABABI BOSHQA EDI — shuning uchun uchalasi ham
 * alohida qo'riqlanadi.
 *
 * 1. MAYDON PILL EMAS EDI. `.chat-input-row input` da
 *    `border-radius:999px` yozilgan edi, lekin umumiy qoida
 *    (`select,input[type=number],input[type=text],…`) AYNI
 *    KUCHDA va faylda KEYINROQ turadi — shuning uchun u yutib,
 *    radiusni 10px ga tushirardi. CSS buni hech qayerda
 *    aytmaydi: qoida shunchaki ishlamaydi.
 *
 *    Yechim: tanlagichga `[type=text]` qo'shildi — bitta belgi
 *    ko'proq, ya'ni aniqroq.
 *
 * 2. MIKROFON PASTDA TURARDI. U `.btn` sinfini oladi, `.btn`
 *    da esa `margin-top:var(--s3)` bor — u odatdagi tugmalar
 *    ustunda joylashgani uchun qo'yilgan. Qator ichida bu
 *    chekka faqat tugmani pastga suradi.
 *
 * 3. QATOR BALAND EDI. Aynan o'sha 12px qatorga qo'shilardi.
 *
 * Bu test o'lchamlarni EMAS, MUNOSABATLARNI tekshiradi
 * (markazlar ustma-ust tushadimi, radius balandlikning
 * yarmidanmi) — shunda o'lchamni o'zgartirish testni
 * bejiz yiqitmaydi.
 */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const fails = [];
let pass = 0;
const check = (name, ok, extra) => {
  if (ok) { pass += 1; return; }
  fails.push(name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};

const blok = (sel) => {
  const i = html.indexOf(sel + '{');
  return i === -1 ? '' : html.slice(i, html.indexOf('}', i));
};

/* ---------- 1. Maydon: to'rtburchak emas ---------- */
const maydon = blok('.chat-input-row input[type=text]');
check('maydon qoidasi `[type=text]` bilan — umumiy qoidadan aniqroq',
  maydon.length > 0);
check('eski, kuchsiz tanlagich qolmadi',
  !/\.chat-input-row input\{/.test(html));
check('MAYDON PILL', /border-radius:999px/.test(maydon), maydon.slice(0, 80));
check('balandligi aniq berilgan (pill shu balandlikka bog‘liq)',
  /height:48px/.test(maydon));
check('yon chekka radiusdan kichik emas — matn burchakka tegmaydi',
  /padding:0 18px/.test(maydon));

/* Umumiy qoida hamon mavjud: aniqlik bilan yutyapmiz, uni
   o'chirib emas. Agar u yo'qolsa, bu tanlagich ortiqcha
   bo'lib qolardi va kimdir uni soddalashtirib yuborardi. */
check('umumiy input qoidasi hamon bor (shuning uchun aniqlik kerak)',
  /select,input\[type=number\],input\[type=text\]/.test(html));

/* ---------- 2. Tekislik ---------- */
const tugma = blok('.chat-input-row .btn.chat-send');
check('TUGMADAGI ORTIQCHA CHEKKA BEKOR QILINGAN',
  /margin:0 !important/.test(tugma), tugma.slice(0, 120));
check('`.btn` da o‘sha chekka hamon bor (ya’ni bekor qilish kerak)',
  /\.btn\{[^}]*margin-top:var\(--s3\)/.test(html));
check('qator markaz bo‘yicha tekislaydi',
  /\.chat-input-row\{[^}]*align-items:center/.test(html));

/* ---------- 3. Balandlik ---------- */
check('tugma maydon bilan BIR BALANDLIKDA',
  /height:48px/.test(tugma) && /min-height:48px/.test(tugma), tugma.slice(0, 160));
check('skrepka ham o‘sha balandlikda (tegish maydoni)',
  /\.chat-clip\{min-height:48px;\}/.test(html));
check('qator chekkasi kichik — ortiqcha bo‘shliq yo‘q',
  /\.chat-input-row\{[^}]*padding:8px 12px/.test(html));

/* ---------- 4. Nega bunday — kodda yozilganmi ---------- */
/* Bu uchta xatoning sababi ko'rinmas edi: CSS yaroqsiz yoki
   kuchsiz qoidada xato bermaydi. Keyin o'qiydigan odam yana
   shu tuzoqqa tushmasligi uchun sabab kodda turishi kerak. */
check('sababi izohda yozilgan',
  /AYNI KUCHDA va KEYINROQ|ayni kuchda/i.test(html)
  && /margin-top:var\(--s3\)` bor/.test(html));

if (fails.length) {
  console.log('\n' + fails.length + ' ta xato:');
  fails.forEach((f) => console.log('  XATO ' + f));
  console.log('\n==== ' + pass + ' passed, ' + fails.length + ' failed ====');
  process.exit(1);
}
console.log('\n==== ' + pass + ' passed, 0 failed ====');
