/**
 * `hisob-ochirish.html` ni yasaydi.
 *
 *     node tools/buildDeletion.mjs
 *
 * Google Play akkaunt o'chirish uchun OCHIQ manzilni talab qiladi:
 * ilovani o'chirib tashlagan odam ham so'rov yubora olishi kerak.
 * Matn tools/deletionText.mjs da, u esa lib/deleteAccount.js ga
 * qarab yozilgan.
 */
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { HEADINGS, BODIES } from './deletionText.mjs';
import { renderPage } from './pageShell.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const buildDeletionHtml = () => renderPage({
  slug: 'deletion',
  title: "YO'LDA — Akkauntni o'chirish",
  description: "YO'LDA akkauntini qanday o'chirish, qaysi ma'lumot o'chadi va nimasi qoladi.",
  headings: HEADINGS,
  bodies: BODIES,
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(repoRoot, 'hisob-ochirish.html');
  writeFileSync(out, buildDeletionHtml());
  console.log('yozildi:', out);
}
