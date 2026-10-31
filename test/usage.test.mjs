/**
 * Admin: "Baza yuklanishi" bo'limi.
 *
 *     node test/usage.test.mjs      (yoki npm test)
 *
 * NIMA UCHUN BU BO'LIM KENGAYTIRILDI.
 *
 * Ilgari u uchta raqam ko'rsatardi: egallangan joy, buyruqlar
 * soni, kalitlar soni. Ular savolning faqat YARMIGA javob
 * berardi — "qancha to'lgan". Ikkinchi yarmi, "NIMA bilan
 * to'lgan", yo'q edi. Qaror esa aynan ikkinchisiga bog'liq:
 * 4812 ta kalit degani hech narsa demaydi, "2140 tasi yozishma
 * xabarlari" degani esa aniq ish.
 *
 * Fayl ombori (R2) umuman ko'rinmasdi. Holbuki rasmlar va
 * ovozli xabarlar aynan o'sha yerda va ular Redis'dan ancha
 * ko'p joy egallaydi.
 *
 * HECH NARSA O'YLAB TOPILMAYDI:
 *   - R2 ning chegarasi ko'rsatilmaydi, chunki u tarifga
 *     bog'liq va biz uni bilmaymiz. Raqamning o'zi beriladi;
 *   - ombor katta bo'lsa to'liq sanalmaydi (5000 ta fayl
 *     chegarasi) va o'shanda "kamida" deb belgilanadi;
 *   - buyruqlar soni taxminiy ekani ilgaridan aytilgan.
 */
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/admin-data.js', import.meta.url), 'utf8');
const storage = readFileSync(new URL('../lib/storage.js', import.meta.url), 'utf8');

const fails = [];
let pass = 0;
const check = (name, ok, extra) => {
  if (ok) { pass += 1; return; }
  fails.push(name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};

/* ---------- 1. Server: kalitlar turi bo'yicha ---------- */
check('kalit turlari ro‘yxati bor', /const KEY_GROUPS = \[/.test(api));
check('guruhlaydigan funksiya bor', /const groupKeys = \(names\)/.test(api));
/* Har bir tur uchun alohida so'rov yuborilsa, o'n beshta buyruq
   sarflanardi. Bitta `KEYS *` va serverda ajratish arzonroq. */
check('BITTA so‘rov bilan olinadi', /kvKeys\('\*'\)/.test(api));
check('turlar ro‘yxatda yo‘q bo‘lsa "Boshqa" ga tushadi',
  /label: 'Boshqa'/.test(api));
check('"Boshqa" da namuna nomlar ko‘rsatiladi', /samples: boshqa\.slice\(0, 5\)/.test(api));
check('vaqtinchalik kalitlar alohida belgilanadi', /const TEMPORARY = new Set/.test(api));
/* Auditda topilgan eski kesh — endi panelda ko'rinadi. */
check('eski qidiruv keshi ro‘yxatda', /search_cities:/.test(api));

/* ---------- 2. Server: fayl ombori ---------- */
check('ombordagi fayllar sanaladi', /export const listObjects = async/.test(storage));
check('SigV4 savol qismini qo‘llab-quvvatlaydi', /const canonicalQuery = \(query\)/.test(storage));
check('imzoga savol qismi kiradi',
  /\[method, uri, qs, canonicalHeaders/.test(storage));
check('manzilga ham qo‘shiladi', /\$\{qs \? `\?\$\{qs\}` : ''\}/.test(storage));
/* Bucket'ning o'ziga murojaatda yo'l oxirida chiziqcha
   qolmasligi kerak — aks holda imzo mos kelmaydi. */
check('kalitsiz so‘rovda yo‘l to‘g‘ri', /key \? `\/\$\{BUCKET\}\/\$\{encodeKey\(key\)\}` : `\/\$\{BUCKET\}`/.test(storage));
check('sahifalar soni cheklangan', /const MAX_PAGES = 5/.test(storage));
check('chegaraga yetilsa ochiq aytiladi', /truncated: true/.test(storage));
check('xato tashlamaydi — panel ochilaversin', /catch \(err\) \{\s*return \{ ok: false/.test(storage));
check('papka bo‘yicha guruhlanadi', /byPrefix\[papka\]/.test(storage));

check('usage javobiga fayllar qo‘shilgan', /files: storageFiles/.test(api));
check('R2 CHEGARASI O‘YLAB TOPILMAYDI',
  /chegarasi tarifga bog'liq va biz uni\s*\n?\s*\*?\s*bilmaymiz/.test(api)
  || /foiz KO'RSATILMAYDI/.test(api));

/* ---------- 3. Panel ---------- */
check('uchta bo‘lim chiziladi',
  /Upstash chegaralari/.test(admin)
  && /Nima joy egallayapti/.test(admin)
  && /Fayl ombori \(R2\)/.test(admin));
check('papkalar o‘zbekcha nomlangan', /var FOLDER_NAMES = \{/.test(admin));
check('ulushi foizda ko‘rsatiladi', /g\.count \/ jami/.test(admin));
check('vaqtinchalik yorlig‘i', /vaqtinchalik/.test(admin));

/* Ma'lumot kelmasa — jim qolmaslik kerak. */
check('kalitlar ro‘yxati o‘qilmasa, sababi aytiladi',
  /Ro'yxat o'qilmadi/.test(admin));
check('va qolgan raqamlar to‘g‘riligi aytiladi', /baribir to'g'ri/.test(admin));
check('R2 sozlanmagan bo‘lsa — nima yetishmayotgani aytiladi',
  /kalitlari qo'yilmagan/.test(admin));
check('to‘liq sanalmagan bo‘lsa "kamida" deyiladi', /"kamida"/.test(admin));

if (fails.length) {
  console.log('\n' + fails.length + ' ta xato:');
  fails.forEach((f) => console.log('  XATO ' + f));
  console.log('\n==== ' + pass + ' passed, ' + fails.length + ' failed ====');
  process.exit(1);
}
console.log('\n==== ' + pass + ' passed, 0 failed ====');
