/**
 * Telegram xabarlaridagi buyurtma kodi bosilganda nusxalanishi.
 *
 *     node test/orderCode.test.mjs      (yoki npm test)
 *
 * NEGA MUHIM. Buyurtma kodi — odam ilovaga QO'LDA kiritadigan
 * yagona narsa: kuzatish ham, kvitansiya ham shu kod bilan
 * ochiladi. Telegram'da `<b>` bilan yozilgan matn shunchaki
 * qalin ko'rinadi, `<code>` esa bosilganda nusxalanadi. Farqi
 * bitta belgi, foydasi esa katta: odam sakkizta belgini
 * ko'chirib yozib o'tirmaydi va xato qilmaydi.
 *
 * NEGA MANBANI O'QIB TEKSHIRAMIZ. Bu xabarlar `.catch(() => {})`
 * bilan tugaydi — bildirishnoma asosiy amalni buzmasligi uchun.
 * Ya'ni kod `<b>` ga qaytib qolsa, hech qayerda hech narsa
 * ko'rinmaydi: xato ham, log ham yo'q. Shuning uchun qoida
 * manbadan o'qib tasdiqlanadi.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'api', 'order.js'), 'utf8');

let passed = 0;
const fails = [];
const check = (name, ok, extra) => {
  if (ok) { passed += 1; console.log('  PASS ' + name); return; }
  fails.push(name);
  console.log('  FAIL ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)));
};

console.log('\n── Telegram xabarlaridagi buyurtma kodi');

/* Kod uchta nom bilan yoziladi: `code`, `order.code`,
   `offer.orderCode`. Uchalasi ham `<code>` ichida bo'lishi kerak. */
const CODE_EXPRS = ['esc(code)', 'esc(order.code)', 'esc(offer.orderCode)'];

const bolded = [];
const coded = [];
for (const expr of CODE_EXPRS) {
  const literal = '${' + expr + '}';
  let at = 0;
  for (;;) {
    at = src.indexOf(literal, at);
    if (at === -1) break;
    const before = src.slice(Math.max(0, at - 10), at);
    const after = src.slice(at + literal.length, at + literal.length + 10);
    if (before.endsWith('<b>') && after.startsWith('</b>')) {
      bolded.push({ expr, line: src.slice(0, at).split('\n').length });
    }
    if (before.endsWith('<code>') && after.startsWith('</code>')) {
      coded.push({ expr, line: src.slice(0, at).split('\n').length });
    }
    at += literal.length;
  }
}

check('kod hech qayerda <b> ichida emas', bolded.length === 0, bolded);
check('kod <code> ichida yoziladi', coded.length >= 8, coded.length);

/* Ochilmagan yoki noto'g'ri yopilgan teg Telegram'da butun
   xabarni rad ettiradi ("can't parse entities"), ya'ni odam
   xabarni UMUMAN olmaydi. */
const opens = (src.match(/<code>/g) || []).length;
const closes = (src.match(/<\/code>/g) || []).length;
check('har bir <code> yopilgan', opens === closes, { opens, closes });

/* `<code>` ichidagi matn ham qalqonlangan bo'lishi kerak:
   kodda `<` yoki `&` bo'lsa xabar buziladi. Bizda kod har doim
   `esc(...)` dan o'tadi — shuni tasdiqlaymiz. */
const rawInside = src.match(/<code>\$\{(?!esc\()/g);
check('<code> ichida faqat qalqonlangan qiymat', !rawInside, rawInside);

console.log(`\n==== ${passed} passed, ${fails.length} failed ====`);
process.exit(fails.length ? 1 : 0);
