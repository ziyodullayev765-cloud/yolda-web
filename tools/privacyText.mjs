/**
 * Maxfiylik siyosati matnini index.html dan o'qish.
 *
 * Matn ikki joyda ko'rinadi: ilova ichidagi Sozlamalar sahifasida va
 * ochiq `maxfiylik.html` sahifasida (Play Market uning manzilini
 * so'raydi). Ikkita nusxa bo'lsa, biri ertami-kechmi eskiradi va
 * foydalanuvchiga noto'g'ri va'da beriladi — shuning uchun manba
 * bitta: index.html dagi `privacy.body` kaliti. `maxfiylik.html`
 * o'sha matndan yasaladi, test esa ikkisi bir xilligini tekshiradi.
 *
 * Nega brauzer emas: bu modul `npm test` ichida ham ishlaydi, u yerda
 * esa faqat Node bor. Shuning uchun kalit qo'lda o'qiladi — tuzilishi
 * oddiy va o'zgarmas:
 *
 *       "privacy.body":
 *         "<h4>1. ...</h4>..."
 *         + "<h4>2. ...</h4>..."
 *         + "...",
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const LANGS = ['uz', 'ru', 'en'];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `privacy.body` ning uchta nusxasi — faylda qaysi tartibda tursa,
 * i18n lug'atlari ham shu tartibda: uz, ru, en.
 *
 * @returns {{uz: string, ru: string, en: string}}
 */
export const readPrivacyBodies = (htmlPath = join(repoRoot, 'index.html')) => {
  const lines = readFileSync(htmlPath, 'utf8').split('\n');
  const bodies = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '"privacy.body":') continue;

    const parts = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      let piece = lines[j].trim();
      if (piece.startsWith('+ ')) piece = piece.slice(2).trim();

      const last = piece.endsWith(',');
      if (last) piece = piece.slice(0, -1);
      if (!piece.startsWith('"') || !piece.endsWith('"')) {
        throw new Error(`privacy.body: kutilmagan qator ${j + 1}: ${lines[j]}`);
      }
      parts.push(JSON.parse(piece));
      if (last) break;
    }
    if (j >= lines.length) throw new Error('privacy.body: yopilmagan qiymat');
    bodies.push(parts.join(''));
    i = j;
  }

  if (bodies.length !== LANGS.length) {
    throw new Error(`privacy.body ${LANGS.length} marta kutilgan edi, ${bodies.length} ta topildi`);
  }
  return Object.fromEntries(LANGS.map((l, k) => [l, bodies[k]]));
};

/** Sahifa sarlavhalari — ilovadagi `settings.privacy` bilan bir xil. */
export const TITLES = {
  uz: { title: 'Maxfiylik siyosati', lang: "O'zbekcha", back: 'Ilovaga qaytish' },
  ru: { title: 'Политика конфиденциальности', lang: 'Русский', back: 'Вернуться в приложение' },
  en: { title: 'Privacy Policy', lang: 'English', back: 'Back to the app' },
};
