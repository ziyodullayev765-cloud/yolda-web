/**
 * Maxfiylik siyosati ikki joyda bir xil turadimi.
 *
 * Ilova ichida matn `privacy.body` kalitidan chiqadi, Play Market
 * uchun esa ochiq `maxfiylik.html` sahifasi kerak. Ikkitasi
 * ajralib ketsa — foydalanuvchi bir narsani o'qib, platforma
 * boshqasini qiladi. Bu to'plam shuni ushlab turadi: siyosat
 * matni o'zgartirilgan, lekin sahifa qayta yasalmagan bo'lsa,
 * test yiqiladi.
 *
 * Shu bilan birga sahifaning o'zi Play talablariga javob
 * berishini tekshiradi: kirishsiz ochiladi, uchala tilda bor,
 * tashqi skript yuklamaydi.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readPrivacyBodies, LANGS, TITLES } from '../tools/privacyText.mjs';
import { buildPrivacyHtml } from '../tools/buildPrivacy.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = join(repo, 'maxfiylik.html');

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log('  PASS ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail === undefined ? '' : '  → ' + JSON.stringify(detail))); }
};

console.log('\n== ochiq maxfiylik sahifasi ==');

check('sahifa mavjud', existsSync(pagePath), pagePath);
if (!existsSync(pagePath)) {
  console.log('\n  `node tools/buildPrivacy.mjs` ishga tushiring.\n');
  process.exit(1);
}

const page = readFileSync(pagePath, 'utf8');
const bodies = readPrivacyBodies();

/* ---- Eng muhimi: sahifa ilovadagi matndan yasalganmi ---- */
check('sahifa ilovadagi matn bilan bir xil (qayta yasash kerak emas)',
  page === buildPrivacyHtml(bodies),
  'index.html dagi privacy.body o\'zgargan — `node tools/buildPrivacy.mjs` ni ishga tushiring');

/* ---- Uchala til ham to'liq ichida ---- */
for (const lang of LANGS) {
  check(`${lang}: matn to'liq joylashgan`, page.includes(bodies[lang]),
    { len: bodies[lang].length });
  check(`${lang}: sarlavha bor`, page.includes(TITLES[lang].title), TITLES[lang].title);
  check(`${lang}: bo'lim bor`, page.includes(`id="doc-${lang}"`), lang);
}

/* ---- Play talablari ---- */
console.log('\n== Play Market talablari ==');

/* Sahifa hech narsa so'ramaydi: forma ham, maydon ham yo'q.
   (Matnning o'zida "parol" so'zi uchraydi — u "parol yo'q" deb
   tushuntiradi, shuning uchun so'zlarga qarab bo'lmaydi.) */
check('kirish so\'ramaydi: forma va kiritish maydoni yo\'q',
  !/<form\b/i.test(page) && !/<input\b/i.test(page) && !/type="password"/i.test(page));

/* Skriptsiz brauzerda ham o'qiladigan bo'lsin: o'zbekcha matn
   boshidanoq ochiq, qolgani `hidden`. */
check('skriptsiz ham bitta til ochiq turadi',
  /<article id="doc-uz" lang="uz">/.test(page) && !/<article id="doc-uz"[^>]*hidden/.test(page));
check('qolgan tillar yashirilgan',
  /<article id="doc-ru" lang="ru" hidden>/.test(page) && /<article id="doc-en" lang="en" hidden>/.test(page));

/* Tashqaridan hech narsa yuklanmasin: tekshiruvchining internetida
   ham, foydalanuvchinikida ham sahifa darhol ochilishi kerak. */
const external = [...page.matchAll(/(?:src|href)="(https?:)?\/\/([^"]+)"/g)]
  .map((m) => m[2])
  .filter((u) => !u.startsWith('t.me/'));
check('tashqi skript/uslub yuklanmaydi', external.length === 0, external);

check('sahifa qidiruvga ochiq', /name="robots" content="index/.test(page));
check('mobil ekranga moslangan', /name="viewport"/.test(page));
check('aloqa ma\'lumoti bor', page.includes('+998 94 440 20 90'));

/* ---- Matn endi haqiqatga mos ---- */
console.log('\n== matn ilovaning haqiqiy xatti-harakatiga mos ==');

for (const lang of LANGS) {
  const body = bodies[lang];
  /* Telegram guruhiga yuk chiqarish olib tashlangan — siyosat
     endi buni va'da qilmasligi kerak. */
  const claimsGroup = /(guruhiga chiqadi|публикуется в группе|published to the YO'LDA drivers' group)/.test(body);
  check(`${lang}: ochiq Telegram guruhi haqidagi eski va'da yo'q`, !claimsGroup);

  /* Telefon orqali kirish bor — siyosat uni aytishi kerak. */
  const mentionsPhoneLogin = /(Telefon orqali|По номеру телефона|With a phone number)/.test(body);
  check(`${lang}: telefon orqali kirish oshkor qilingan`, mentionsPhoneLogin);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
