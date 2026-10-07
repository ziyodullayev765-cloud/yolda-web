/**
 * Play Market so'ragan ikkita ochiq hujjat sahifasi.
 *
 *   /maxfiylik      — maxfiylik siyosati
 *   /hisob-ochirish — akkauntni o'chirish tartibi
 *
 * Ikkalasi ham kirishsiz ochilishi va ilovaning haqiqiy
 * xatti-harakatiga mos bo'lishi kerak.
 *
 * Maxfiylik matni ilovaning ichida ham turadi (privacy.body).
 * Ikkitasi ajralib ketsa — foydalanuvchi bir narsani o'qib,
 * platforma boshqasini qiladi. Shuning uchun sahifa o'sha
 * matndan yasaladi, test esa qayta yasash unutilmaganini
 * tekshiradi.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readPrivacyBodies, TITLES } from '../tools/privacyText.mjs';
import { buildPrivacyHtml } from '../tools/buildPrivacy.mjs';
import { buildDeletionHtml } from '../tools/buildDeletion.mjs';
import { HEADINGS as DEL_HEADINGS, BODIES as DEL_BODIES } from '../tools/deletionText.mjs';
import { LANGS } from '../tools/pageShell.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail === undefined ? '' : '  → ' + JSON.stringify(detail))); }
};

/** Ikkala sahifaga ham tegishli umumiy talablar. */
const checkShared = (name, page) => {
  /* Sahifa hech narsa so'ramaydi: forma ham, maydon ham yo'q.
     (Matnda "parol" so'zi uchraydi — u "parol yo'q" deb
     tushuntiradi, shuning uchun so'zlarga qarab bo'lmaydi.) */
  check(`${name}: kirish so'ramaydi (forma va kiritish maydoni yo'q)`,
    !/<form\b/i.test(page) && !/<input\b/i.test(page) && !/type="password"/i.test(page));

  check(`${name}: skriptsiz ham bitta til ochiq turadi`,
    /<article id="doc-uz" lang="uz">/.test(page) && !/<article id="doc-uz"[^>]*hidden/.test(page));
  check(`${name}: qolgan tillar yashirilgan`,
    /<article id="doc-ru" lang="ru" hidden>/.test(page) && /<article id="doc-en" lang="en" hidden>/.test(page));

  /* Tashqaridan hech narsa yuklanmasin: tekshiruvchining
     internetida ham sahifa darhol ochilishi kerak. */
  const external = [...page.matchAll(/(?:src|href)="(https?:)?\/\/([^"]+)"/g)]
    .map((m) => m[2])
    .filter((u) => !u.startsWith('t.me/'));
  check(`${name}: tashqi skript/uslub yuklanmaydi`, external.length === 0, external);

  check(`${name}: qidiruvga ochiq`, /name="robots" content="index/.test(page));
  check(`${name}: mobil ekranga moslangan`, /name="viewport"/.test(page));
  check(`${name}: aloqa ma'lumoti bor`, page.includes('+998 94 440 20 90'));
};

/* ============================================================ */
console.log('\n== maxfiylik siyosati (/maxfiylik) ==');

const privacyPath = join(repo, 'maxfiylik.html');
check('sahifa mavjud', existsSync(privacyPath), privacyPath);
if (!existsSync(privacyPath)) {
  console.log('\n  `node tools/buildPrivacy.mjs` ishga tushiring.\n');
  process.exit(1);
}

const privacy = readFileSync(privacyPath, 'utf8');
const bodies = readPrivacyBodies();

check('sahifa ilovadagi matn bilan bir xil (qayta yasash kerak emas)',
  privacy === buildPrivacyHtml(bodies),
  'index.html dagi privacy.body o\'zgargan — `node tools/buildPrivacy.mjs` ni ishga tushiring');

for (const lang of LANGS) {
  check(`${lang}: matn to'liq joylashgan`, privacy.includes(bodies[lang]), { len: bodies[lang].length });
  check(`${lang}: sarlavha bor`, privacy.includes(TITLES[lang].title), TITLES[lang].title);
}
checkShared('maxfiylik', privacy);

/* ============================================================ */
console.log('\n== akkauntni o\'chirish (/hisob-ochirish) ==');

const deletionPath = join(repo, 'hisob-ochirish.html');
check('sahifa mavjud', existsSync(deletionPath), deletionPath);
if (!existsSync(deletionPath)) {
  console.log('\n  `node tools/buildDeletion.mjs` ishga tushiring.\n');
  process.exit(1);
}

const deletion = readFileSync(deletionPath, 'utf8');
check('sahifa manba matn bilan bir xil (qayta yasash kerak emas)',
  deletion === buildDeletionHtml(),
  'tools/deletionText.mjs o\'zgargan — `node tools/buildDeletion.mjs` ni ishga tushiring');

for (const lang of LANGS) {
  check(`${lang}: matn to'liq joylashgan`, deletion.includes(DEL_BODIES[lang]), { len: DEL_BODIES[lang].length });
  check(`${lang}: sarlavha bor`, deletion.includes(DEL_HEADINGS[lang]), DEL_HEADINGS[lang]);
}
checkShared('hisob-ochirish', deletion);

/* Google talabi: sahifa paket nomini, nimalar o'chishini va
   nimalar qolishini aniq aytishi kerak. */
check('paket nomi yozilgan', deletion.includes('uz.yolda.app'));
for (const lang of LANGS) {
  const body = DEL_BODIES[lang];
  check(`${lang}: ilovasiz ham so'rov yuborish yo'li bor`,
    /t\.me\/ziyodullayv/.test(body) && /\+998 94 440 20 90/.test(body));
  check(`${lang}: nima o'chishi sanab o'tilgan`, /<h4>3\./.test(body) && /<ul>/.test(body));
  check(`${lang}: nima qolishi aytilgan`, /<h4>4\./.test(body));
}

/* ============================================================ */
console.log('\n== matn ilovaning haqiqiy xatti-harakatiga mos ==');

for (const lang of LANGS) {
  const body = bodies[lang];
  /* Telegram guruhiga yuk chiqarish olib tashlangan — siyosat
     endi buni va'da qilmasligi kerak. */
  check(`${lang}: ochiq Telegram guruhi haqidagi eski va'da yo'q`,
    !/(guruhiga chiqadi|публикуется в группе|published to the YO'LDA drivers' group)/.test(body));

  /* Telefon orqali kirish bor — siyosat uni aytishi kerak. */
  check(`${lang}: telefon orqali kirish oshkor qilingan`,
    /(Telefon orqali|По номеру телефона|With a phone number)/.test(body));
}

/* O'chirish sahifasi lib/deleteAccount.js ning haqiqiy xulqini
   yozadimi: yo'ldagi yuk o'chirishni to'xtatadi, username
   bo'shamaydi, tugagan buyurtmalar anonim bo'lib qoladi. */
const CLAIMS = {
  uz: [/yo'lda ketayotgan yuk/i, /boshqa odamga berilmaydi/i, /olib tashlanadi/i],
  ru: [/груз в пути/i, /не передаётся другому/i, /удаляются/i],
  en: [/load in transit/i, /not handed to anyone else/i, /stripped from it/i],
};
for (const lang of LANGS) {
  for (const re of CLAIMS[lang]) {
    check(`${lang}: "${re.source.slice(0, 32)}" aytilgan`, re.test(DEL_BODIES[lang]));
  }
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
