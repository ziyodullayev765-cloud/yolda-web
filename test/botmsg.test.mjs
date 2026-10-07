/**
 * Botning MarkdownV2 xabarlari Telegram qabul qiladigan ko'rinishdami.
 *
 * Nega bu alohida tekshiriladi: `telegram('sendMessage', ...)`
 * chaqiruvlari `.catch(() => {})` bilan tugaydi — bildirishnoma
 * asosiy amalni buzmasligi uchun ataylab shunday. Lekin shu sababli
 * Telegram «Bad Request: can't parse entities» deb rad qilsa, hech
 * qayerda hech narsa ko'rinmaydi: na log, na xato. Haydovchi botni
 * ochadi, /start bosadi va JAVOB OLMAYDI — sabab esa bitta
 * qalqonlanmagan nuqta bo'lishi mumkin.
 *
 * Aynan shunday xato bor edi: matnda `\‘` yozilgan edi, ya'ni
 * qiyshiq qo'shtirnoq oldida qalqon. Telegram hujjatiga ko'ra
 * qalqon faqat 1..126 kodli belgilarga qo'yiladi, loyihaning o'z
 * `escapeMd()` si ham faqat ASCII belgilarni qalqonlaydi.
 *
 * Shuning uchun bu yerda haqiqiy tekshiruvchi bor: xabar matni
 * qoidaga mos ekani belgima-belgi o'qib chiqiladi.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'api', 'telegram.js'), 'utf8');

let passed = 0;
const fails = [];
const check = (name, ok, extra) => {
  if (ok) { passed += 1; return; }
  fails.push(name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)));
};

/* Telegram MarkdownV2 da qalqon talab qiladigan belgilar. `*` bu
   ro'yxatda yo'q, chunki u qalin yozuv uchun ataylab ishlatiladi —
   u alohida, juftligi bo'yicha tekshiriladi. */
const MUST_ESCAPE = '_[]()~`>#+-=|{}.!';

/**
 * Matnni belgima-belgi o'qib, qoida buzilgan joylarni qaytaradi.
 * @returns {{at:number, why:string, near:string}[]}
 */
const lintMarkdownV2 = (text) => {
  const bad = [];
  const near = (i) => text.slice(Math.max(0, i - 14), i + 14);
  let stars = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === undefined) { bad.push({ at: i, why: 'oxirida yolg\'iz qalqon', near: near(i) }); break; }
      /* Qalqon faqat 1..126 kodli belgiga qo'yiladi. Qiyshiq
         qo'shtirnoq, tire va o'q — bularning kodi kattaroq. */
      const code = next.codePointAt(0);
      if (code > 126) {
        bad.push({ at: i, why: 'ASCII bo\'lmagan belgi qalqonlangan: ' + next + ' (U+'
          + code.toString(16).toUpperCase() + ')', near: near(i) });
      }
      i += 1;        // qalqonlangan belgi o'tkazib yuboriladi
      continue;
    }
    if (ch === '*') { stars += 1; continue; }
    if (MUST_ESCAPE.includes(ch)) {
      bad.push({ at: i, why: 'qalqonlanmagan «' + ch + '»', near: near(i) });
    }
  }
  if (stars % 2 !== 0) bad.push({ at: -1, why: 'qalin yozuv yulduzchalari juft emas: ' + stars, near: '' });
  return bad;
};

/* Tekshiruvchining o'zi ishlayotganiga ishonch: ataylab buzilgan
   matnlarni topa olishi kerak, to'g'risini esa tinch qo'yishi. */
check('tekshiruvchi qalqonlanmagan nuqtani topadi', lintMarkdownV2('Salom.').length === 1);
check('tekshiruvchi ASCII bo\'lmagan qalqonni topadi', lintMarkdownV2('qo\\‘ying').length === 1);
check('tekshiruvchi juft bo\'lmagan yulduzchani topadi', lintMarkdownV2('*qalin').length === 1);
check('tekshiruvchi to\'g\'ri matnga tegmaydi',
  lintMarkdownV2('Salom\\! Bu *YO‘LDA* — yuk bozori\\.').length === 0,
  lintMarkdownV2('Salom\\! Bu *YO‘LDA* — yuk bozori\\.'));

/* ---------- Haqiqiy xabarlar ----------
   Manbadan `text: [...].join('\n')` ko'rinishidagi bloklarni
   olamiz: botning MarkdownV2 xabarlari shunday yozilgan. */
const blocks = [...src.matchAll(/text:\s*\[([\s\S]*?)\]\.join\('\\n'\)/g)];
check('xabar bloklari topildi', blocks.length >= 1, blocks.length);

const texts = [];
for (const [i, block] of blocks.entries()) {
  /* Blok ichidagi qatorlar: '...' yoki "..." . Qator ichidagi
     `\\.` manbada ikkita belgi — matnda bittasi, shuning uchun
     JSON.parse bilan haqiqiy qiymatga aylantiriladi. */
  const lines = [...block[1].matchAll(/(['"])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => {
    const raw = m[0];
    try {
      return JSON.parse(m[1] === '"' ? raw : '"' + raw.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"');
    } catch { return null; }
  });
  check('blok ' + (i + 1) + ': qatorlar o\'qildi',
    lines.length > 0 && lines.every((l) => l !== null), { qatorlar: lines.length });
  if (lines.some((l) => l === null)) continue;

  const text = lines.join('\n');
  texts.push(text);
  const bad = lintMarkdownV2(text);
  check('blok ' + (i + 1) + ': MarkdownV2 qoidasiga mos', bad.length === 0, bad.slice(0, 4));
}
/* Tekshiruvlar XABAR MATNI bo'yicha boradi, manba bo'yicha emas:
   manbada izohlar ham bor va ularda eski matn misol sifatida
   keltirilgan. */
const hammasi = texts.join('\n');

/* ---------- Eski yolg'on matn qaytib kelmasin ----------
   Haydovchilar guruhi olib tashlangan. Botning birinchi xabari esa
   uzoq vaqt «yuklar guruhga tushadi» deb turdi — botni ochgan
   haydovchi birinchi o'qiydigan gap shu edi. */
check('bot guruh haqida gapirmaydi',
  !/guruh/i.test(hammasi) && !/Men olaman/.test(hammasi),
  hammasi.split('\n').filter((l) => /guruh/i.test(l) || /Men olaman/.test(l)));
check('bot yuklar ilovada ekanini aytadi', /Yangi yuklar \*ilovada\* chiqadi/.test(hammasi));
/* Xabar kelishi uchun qidiruv saqlanishi kerak — shuni aytmasa,
   haydovchi jim turgan botdan sababini bilmaydi. */
check('qidiruvni saqlash kerakligi aytilgan', /qidiruvingizni saqlab/.test(hammasi));

if (fails.length) {
  console.log('botmsg: ' + fails.length + ' ta xato');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('botmsg: ' + passed + ' ta tekshiruv o\'tdi');
