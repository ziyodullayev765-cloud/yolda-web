/**
 * Qo'ng'iroq paneli.
 *
 *     node test/callSheet.test.mjs      (yoki npm test)
 *
 * NIMA UCHUN BU TEST BOR.
 *
 * Yozishma sarlavhasidagi qo'ng'iroq tugmasi ilgari
 * `<a href="tel:...">` edi: bitta tegish — va telefon
 * allaqachon terayotgan bo'lardi. Ikki kamchiligi bor edi.
 *
 * Birinchisi — tasodif: tugma orqaga qaytish va ism
 * tugmalarining yonida turadi, xato tegish darhol qo'ng'iroq
 * bo'lib ketardi.
 *
 * Ikkinchisi va muhimrog'i — odam qanday raqamga qo'ng'iroq
 * qilayotganini bilmasdi. RAQAMNI YO'LDA BERMAYDI: uni
 * suhbatdoshning o'zi shu yozishmada yozgan, ya'ni platforma
 * uni tekshirmagan. Buni qo'ng'iroqdan OLDIN aytish kerak,
 * keyin emas.
 *
 * Shuning uchun endi oraliqda panel turadi. Quyida uning
 * uchta sharti tekshiriladi:
 *
 *   1. tugma `tel:` ga olib bormaydi — panel ochadi;
 *   2. panelda ogohlantirish bor va u raqam tekshirilmaganini
 *      hamda oldindan pul o'tkazmaslikni aytadi;
 *   3. raqam yozishmada aytilmagan bo'lsa, tugma umuman
 *      ko'rinmaydi — YO'LDA raqamni o'zi oshkor qilmaydi.
 *
 * Panelning brauzerdagi haqiqiy xatti-harakati alohida
 * tekshirilgan (scratchpad/callsheet.js, 20 ta tekshiruv);
 * bu yerda manbaning o'zi qo'riqlanadi, chunki bu shartlarni
 * bitta e'tiborsiz tahrir buzib qo'yishi mumkin.
 */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const fails = [];
let pass = 0;
const check = (name, ok, extra) => {
  if (ok) { pass += 1; return; }
  fails.push(name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};

/* ---------- 1. Tugma darhol termaydi ---------- */
check('qo‘ng‘iroq tugmasi — tugma, havola emas',
  /<button type="button" class="chat-call" id="btnChatCall"/.test(html));
check('tugmaga `tel:` yozilmagan',
  !/id="btnChatCall"[^>]*href/.test(html));
check('tugma qo‘ng‘iroq funksiyasini chaqiradi',
  /btnChatCall[\s\S]{0,400}chatCallTap\(\)/.test(html));
check('panel funksiyasi bor', /function openChatCallSheet\(\)/.test(html));

/* ---------- 2. Ogohlantirish ---------- */
const panel = (html.split('function openChatCallSheet()')[1] || '').slice(0, 3600);
check('panel ochilyapti', panel.includes('Sheet.open('), panel.slice(0, 80));
check('OGOHLANTIRISH BOR', /call-note/.test(panel));
check('raqamni YO‘LDA bermagani aytilgan',
  /YO\\'LDA bermadi/.test(panel), panel.slice(0, 200));
check('tekshirilmagani aytilgan', /tekshirmadik/.test(panel));
check('OLDINDAN PUL O‘TKAZMASLIK aytilgan',
  /oldindan pul o\\'tkazmang/i.test(panel));
check('kimning raqami ekani aytilgan', /chatWithName/.test(panel));

/* ---------- 3. Raqam va nusxalash ---------- */
check('raqam `tel:` ga olib boradi', /href="tel:' \+ escapeHtml\(r\.dial\)/.test(panel));
check('raqam ekranda o‘qishga qulay ko‘rinishda',
  /prettyPhoneUz\(r\.dial\)/.test(panel));
check('o‘qishga qulay ko‘rinish funksiyasi bor',
  /function prettyPhoneUz\(raqam\)/.test(html));
/* Bir nechta raqam bo'lsa, qaysi biri yangiroq ekani
   ko'rinib tursin. */
check('qachon yozilgani ko‘rsatiladi', /formatChatTime\(r\.at\)/.test(panel));
check('nusxalash tugmasi bor', /call-copy/.test(panel));
/* Nusxalanadigan narsa TERILADIGAN ko'rinish bo'lishi kerak
   (+998901234567), ekrandagi bo'shliqli ko'rinish emas: odam
   uni boshqa ilovaga qo'yganda ishlashi kerak. */
check('NUSXALANADIGANI — teriladigan ko‘rinish',
  /copyChatText\(btn\.getAttribute\("data-copy"\)\)/.test(panel));
check('nusxalash ekrandagi ko‘rinishni olmaydi',
  !/copyChatText\(prettyPhoneUz/.test(panel));
check('har bir raqamning o‘z nusxalash tugmasi bor',
  /data-copy="/.test(panel));

/* ---------- 4. QAYSI RAQAM TERILADI ----------
   Eng muhim qism. Ilgari bu yerda bug bor edi: funksiya
   yozishmadagi eng oxirgi raqamni olardi — KIM YOZGANIGA
   QARAMASDAN. Natijada o'z raqamini yozgan odam tugmani
   bosganda O'ZIGA qo'ng'iroq qilardi, suhbatdosh uchinchi
   odamning raqamini yozsa esa tugma jimgina o'shani terardi. */
check('raqamlar FAQAT SUHBATDOSHNIKI',
  /function theirPhonesInChat\(messages\)/.test(html));
check('O‘ZIM YOZGAN XABAR CHETLAB O‘TILADI',
  /if\(!m \|\| m\.deleted \|\| m\.fromMe \|\| !m\.text\) continue;/.test(html));
check('eski, kim yozganiga qaramaydigan funksiya olib tashlandi',
  !/lastPhoneInChat/.test(html));

/* Bir nechta raqam bo'lsa — ilova emas, ODAM tanlaydi. */
check('bir nechta raqam yig‘iladi', /MAX_CHAT_PHONES/.test(html));
check('bir xil raqam ikki marta sanalmaydi',
  /korilgan\[kalit\]/.test(html));
check('taqqoslash oxirgi 9 ta raqam bo‘yicha',
  /raqamlar\.slice\(-9\)/.test(html));
check('eng yangisi birinchi turadi',
  /for\(var i = \(messages \|\| \[\]\)\.length - 1; i >= 0; i--\)/.test(html));

const tap = (html.split('function chatCallTap()')[1] || '').slice(0, 700);
check('bosilganda tekshiradigan funksiya bor', tap.length > 50);
check('BITTA RAQAM BO‘LSA — DARHOL TERADI',
  /chatCallNumbers\.length === 1[\s\S]{0,120}dialNumber\(chatCallNumbers\[0\]\.dial\)/.test(tap));
check('BIR NECHTA BO‘LSA — ODAM TANLAYDI',
  /openChatCallSheet\(\)/.test(tap));
check('tugma shu funksiyani chaqiradi',
  /btnChatCall[\s\S]{0,400}chatCallTap\(\)/.test(html));

/* Telegram ichida sahifa iframe'da turadi va `location.href`
   ba'zan to'siladi — havolani yasab bosish ishonchliroq. */
check('terish havola orqali', /function dialNumber\(dial\)/.test(html)
  && /a\.href = "tel:" \+ dial/.test(html));

/* ---------- 5. Raqam yo'q bo'lsa ---------- */
check('raqam ma‘lum bo‘lmasa tugma yashiriladi',
  /chatCallNumbers\s*=\s*theirPhonesInChat\(messages\)[\s\S]{0,220}btn\.hidden\s*=\s*true/.test(html));
check('raqam topilsa ko‘rinadi',
  /btn\.hidden\s*=\s*false;[\s\S]{0,160}btn\.setAttribute\("title"/.test(html));
/* Raqam yo'q bo'lsa panel bo'sh ochilmaydi: odamga sababi
   aytiladi. Bo'sh panel "ishlamayapti" degan taassurot qoldiradi. */
check('raqamsiz chaqirilsa sababi aytiladi',
  /Raqam hali aytilmagan/.test(html));

/* ---------- 6. Ko'rinish ---------- */
check('ogohlantirish uslubi bor', /\.call-note\{/.test(html));
check('raqam qatori uslubi bor', /\.call-num\{/.test(html));
check('nusxalash tugmasi uslubi bor', /\.call-copy\{/.test(html));
/* Nusxalash raqamning YONIDA, ichida emas: butun qatorga
   tegilsa qo'ng'iroq bo'ladi, shunga tegilsa nusxa olinadi. */
check('nusxalash raqamning ichida emas',
  !/<a class="call-num"[\s\S]{0,300}call-copy[\s\S]{0,60}<\/a>/.test(panel));
check('qorong‘i mavzuda ham ko‘rinadi',
  /data-theme="dark"\]\s*\.call-note\{/.test(html));
/* Raqam — tabular, aks holda uning uzunligi har safar
   boshqacha ko'rinadi va qator sakrab turadi. */
check('raqam bir xil kenglikdagi raqamlar bilan',
  /\.call-num\{[^}]*font-variant-numeric:tabular-nums;/.test(html));

/* ---------- Natija ---------- */
if (fails.length) {
  console.log('\n' + fails.length + ' ta xato:');
  fails.forEach((f) => console.log('  XATO ' + f));
  console.log('\n==== ' + pass + ' passed, ' + fails.length + ' failed ====');
  process.exit(1);
}
console.log('\n==== ' + pass + ' passed, 0 failed ====');
