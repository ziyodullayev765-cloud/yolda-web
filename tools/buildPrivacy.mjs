/**
 * `maxfiylik.html` ni yasaydi.
 *
 *     node tools/buildPrivacy.mjs
 *
 * Play Market ilovani qabul qilishi uchun maxfiylik siyosati ochiq
 * manzilda, kirishsiz ochiladigan sahifada turishi shart. Shu sahifa
 * ilovadagi matnning aynan o'zidan yasaladi (tools/privacyText.mjs),
 * ya'ni ikkita boshqa-boshqa hujjat paydo bo'lmaydi.
 *
 * Matn o'zgartirilsa index.html tahrirlanadi va shu buyruq qayta
 * ishga tushiriladi; test/privacy.test.mjs esa buni unutib
 * qo'yilmaganini tekshiradi.
 */
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readPrivacyBodies, TITLES } from './privacyText.mjs';
import { renderPage, LANGS } from './pageShell.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const buildPrivacyHtml = (bodies = readPrivacyBodies()) => renderPage({
  slug: 'privacy',
  title: "YO'LDA — Maxfiylik siyosati",
  description: "YO'LDA platformasining maxfiylik siyosati: qanday ma'lumot yig'iladi, nima uchun ishlatiladi va kimga ko'rinadi.",
  headings: Object.fromEntries(LANGS.map((l) => [l, TITLES[l].title])),
  bodies,
});

/* Faqat to'g'ridan-to'g'ri ishga tushirilganda yozadi. Test shu
   moduldan `buildPrivacyHtml` ni oladi va diskdagi fayl bilan
   solishtiradi — import faylni qayta yozib yuborsa, test hech
   qachon xato topmasdi. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(repoRoot, 'maxfiylik.html');
  writeFileSync(out, buildPrivacyHtml());
  console.log('yozildi:', out);
}
