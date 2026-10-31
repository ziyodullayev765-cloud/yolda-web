/**
 * Uzun matn uchun ko'p qatorli maydon.
 *
 *     node test/textFields.test.mjs      (yoki npm test)
 *
 * MUAMMO NIMA EDI. Fikr bildirish formasida 500 belgilik
 * xabar BIR QATORLI maydonga yozilardi. Odam nima yozganini
 * ko'rmasdi: matn chapga surilib ketaverar, oldingi gaplarni
 * o'qish uchun kursorni orqaga haydash kerak bo'lardi.
 *
 * Xuddi shu holat yana sakkizta joyda bor edi: shikoyat
 * matni, murojaat xabari, bio, baho izohi, taklif izohi,
 * buyurtma izohi va ikkita "sabab" maydoni.
 *
 * MANZIL maydoni bundan mustasno: u bir qatorli bo'lishi
 * kerak, chunki manzil bitta satr.
 * YOZISHMA maydoni ham: u — chat kompozeri.
 *
 * DIQQAT, O'TKAZISHDAGI TUZOQ: `<input value="...">` dan
 * `<textarea>` ga o'tganda qiymat ATRIBUTDAN ELEMENT ICHIGA
 * ko'chishi kerak. Aks holda eski bio va buyurtma izohi
 * jimgina yo'qolardi — forma ochiladi, maydon esa bo'sh.
 */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const fails = [];
let pass = 0;
const check = (name, ok, extra) => {
  if (ok) { pass += 1; return; }
  fails.push(name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};

/* ---------- 1. Uzun matn — ko'p qatorli ---------- */
const kopQatorli = [
  ['fReportDesc', 'shikoyat matni'],
  ['fSupportMessage', 'murojaat xabari'],
  ['fFeedbackMsg', 'fikr bildirish'],
  ['fBio', 'bio'],
  ['fGiveUpReason', 'voz kechish sababi'],
  ['fOfferNote', 'taklif izohi'],
  ['fNote', 'buyurtma izohi'],
  ['fTrackReason', 'kuzatuv sababi'],
];
kopQatorli.forEach(([id, nom]) => {
  check(nom + ' — textarea', new RegExp('<textarea id="' + id + '"').test(html), id);
  check(nom + ' — endi input emas',
    !new RegExp('<input type="text" id="' + id + '"').test(html), id);
});
/* Baho izohi id'si o'zgaruvchi bilan yasaladi. */
check('baho izohi — textarea', /<textarea id="'\+p\+'Comment"/.test(html));

/* ---------- 2. Bir qatorli qolishi kerak bo'lganlar ---------- */
check('MANZIL bir qatorli qoladi',
  /<input type="text" id="fAddr'\+which\+'"/.test(html));
check('YOZISHMA maydoni bir qatorli qoladi',
  /<input type="text" id="fChatMessage"/.test(html));

/* Boshqa hech bir uzun maydon qolmasin. */
const qolgan = [...html.matchAll(/<input type="text" id="(\w+)"[^>]*maxlength="(\d{3,})"/g)]
  .map((m) => ({ id: m[1], max: Number(m[2]) }))
  .filter((x) => x.id !== 'fChatMessage' && !x.id.startsWith('fAddr'));
check('BOSHQA UZUN MAYDON QOLMADI', qolgan.length === 0, qolgan);

/* ---------- 3. Eski qiymat yo'qolmasin ---------- */
/* `value="..."` atributi `<textarea>` da ISHLAMAYDI. Shuning
   uchun qiymat element ichida bo'lishi shart. */
check('BIO QIYMATI ELEMENT ICHIDA',
  /<textarea id="fBio"[^>]*>'\+escapeHtml\(p\.bio \|\| ""\)\+'<\/textarea>/.test(html));
check('BUYURTMA IZOHI QIYMATI ELEMENT ICHIDA',
  /<textarea id="fNote"[^>]*>'\+escapeHtml\(state\.note\)\+'<\/textarea>/.test(html));
check('textarea ga `value` atributi qolmagan',
  !/<textarea[^>]*\svalue="/.test(html));

/* ---------- 4. Balandlik ---------- */
check('uzun maydonlar to‘liq balandlikda (4 qator)',
  (html.match(/<textarea id="f(ReportDesc|SupportMessage|FeedbackMsg)"[^>]*rows="4"/g) || []).length === 3);
check('qisqaroqlari pastroq sinf bilan',
  /class="ta-sm"/.test(html));
check('pastroq sinf uchun uslub bor',
  /textarea\.ta-sm\{min-height:62px;\}/.test(html));
/* Kerak bo'lsa odam o'zi cho'zsin. */
check('cho‘zilishi mumkin', /textarea\{[^}]*resize:vertical/.test(html));

/* ---------- 5. Cheklov saqlangan ---------- */
check('belgilar chegarasi saqlandi',
  (html.match(/<textarea[^>]*maxlength="\d+"/g) || []).length >= 9);

if (fails.length) {
  console.log('\n' + fails.length + ' ta xato:');
  fails.forEach((f) => console.log('  XATO ' + f));
  console.log('\n==== ' + pass + ' passed, ' + fails.length + ' failed ====');
  process.exit(1);
}
console.log('\n==== ' + pass + ' passed, 0 failed ====');
