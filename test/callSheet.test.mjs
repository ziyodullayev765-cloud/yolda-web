/**
 * Yozishmadagi telefon raqami: O'Z JOYIDA qoladi.
 *
 *     node test/callSheet.test.mjs      (yoki npm test)
 *
 * EGASINING QARORI, so'zma-so'z:
 *
 *   "Telefon o'zini eski holatiga qaytar, kim qaysi nomerda
 *    bo'lsa o'sha nomer tursin o'sha yerda, o'sha eng qulayi
 *    edi. Va kimdir chatga nomer tashlasa tepaga saxranit
 *    bo'lib qolmasin."
 *
 * Ya'ni: raqam qaysi xabarda yozilgan bo'lsa, o'sha xabarda
 * bosiladigan bo'lib turadi — va boshqa hech qayerda.
 *
 * NEGA SARLAVHADAGI TUGMA OLIB TASHLANDI. U yozishmadagi
 * raqamni yuqoriga "qadab" qo'yardi: bir marta aytilgan raqam
 * suhbat davomida sarlavhada osilib turardi. Uning ikkita
 * kamchiligi bor edi va ikkalasi ham amalda chiqdi:
 *
 *   - QAYSI raqam ekani noaniq. Dastlab u kim yozganiga
 *     qaramasdi: odam o'z raqamini yozsa, tugma unga O'ZIGA
 *     qo'ng'iroq qildirardi. Buni egasi topdi.
 *   - Suhbatdosh bir nechta raqam yozsa, qaysi biri tepada
 *     qolishi tasodifga bog'liq edi.
 *
 * Raqam xabarning ichida qolsa, bu savollarning birortasi
 * tug'ilmaydi: odam kim nima yozganini ko'rib turibdi.
 *
 * Shuning uchun bu test ikki narsani qo'riqlaydi:
 *   1. xabar ichidagi raqam BOSILADIGAN bo'lib qoladi;
 *   2. sarlavhada qo'ng'iroq tugmasi QAYTA PAYDO BO'LMAYDI.
 */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const fails = [];
let pass = 0;
const check = (name, ok, extra) => {
  if (ok) { pass += 1; return; }
  fails.push(name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};

/* ---------- 1. Raqam o'z joyida bosiladi ---------- */
check('xabar matnidagi raqam havolaga aylanadi',
  /function linkifyPhones\(text\)/.test(html));
check('va u xabarni chizishda ishlatiladi',
  /cb-body[\s\S]{0,120}linkifyPhones\(m\.text\)/.test(html));

const lf = (html.split('function linkifyPhones(text)')[1] || '').slice(0, 700);
check('havola `tel:` ga olib boradi', /href="tel:' \+ dial/.test(lf));
check('faqat raqam va "+" qoladi', /replace\(\/\\D\/g, ""\)/.test(lf));

/* XAVFSIZLIK. Matn AVVAL qochiriladi, qidiruv shundan keyin
   boshlanadi — aks holda xabar ichiga yozilgan teg havolaga
   aylanib qolardi. */
check('matn AVVAL qochiriladi', /var xavfsiz = escapeHtml/.test(lf));
check('qidiruv qochirishdan KEYIN', lf.indexOf('escapeHtml') < lf.indexOf('PHONE_RE'));

/* Narx raqam deb o'qilmasin: "1 500 000" — pul, raqam emas. */
check('qaysi son raqam ekani tekshiriladi', /looksLikePhone\(/.test(lf));
check('narx shakli rad etiladi',
  /guruhlar\.slice\(1\)\.every/.test(html));

/* ---------- 2. Tepada hech narsa qolmaydi ---------- */
/* EGASI AYNAN SHUNI SO'RADI: "tepaga saxranit bo'lib
   qolmasin". Quyidagilar qaytib kelsa, test darhol yiqiladi. */
check('SARLAVHADA QO‘NG‘IROQ TUGMASI YO‘Q', !/btnChatCall/.test(html));
check('uning uslubi ham olib tashlangan', !/\.chat-call\{/.test(html));
check('raqamni tepaga ko‘taradigan kod yo‘q',
  !/theirPhonesInChat|lastPhoneInChat|syncChatCallBtn/.test(html));
check('qo‘ng‘iroq paneli yo‘q',
  !/openChatCallSheet|chatCallTap|chatCallNumbers/.test(html));
check('panelning uslublari ham yo‘q',
  !/\.call-note\{|\.call-num\{|\.call-copy\{/.test(html));

/* ---------- 3. Qolgan qo'ng'iroqlarga tegilmagan ---------- */
/* Bular yozishmaga aloqasi yo'q va o'z joyida qolishi kerak:
   yukdagi haydovchi raqami, "Mening yukim" dagi mijoz raqami,
   mashina e'lonidagi sotuvchi va Aloqa bo'limidagi yordam
   raqami. */
check('yordam raqami joyida', /id="supportPhoneLink"/.test(html));
check('mashina e’lonidagi sotuvchi raqami joyida',
  /href="tel:'\+escapeHtml\(tk\.phone\)/.test(html));
check('ekrandagi raqamni bosish yordamchisi joyida',
  /function phoneLinkHtml\(phone, cls\)/.test(html));

if (fails.length) {
  console.log('\n' + fails.length + ' ta xato:');
  fails.forEach((f) => console.log('  XATO ' + f));
  console.log('\n==== ' + pass + ' passed, ' + fails.length + ' failed ====');
  process.exit(1);
}
console.log('\n==== ' + pass + ' passed, 0 failed ====');
