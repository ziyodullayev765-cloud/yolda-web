/**
 * Shriftlar: ishlatilgani YUKLANGAN bo'lsin.
 *
 *     node test/fonts.test.mjs      (yoki npm test)
 *
 * NIMA UCHUN BU TEST BOR.
 *
 * Bu `--r3` va `--line` bilan BIR XIL turdagi xato — brauzer
 * hech narsa demaydi, shunchaki boshqa narsa chizadi.
 *
 *   `font-family:'Sora'` SAKKIZ joyda yozilgan edi, lekin
 *   Sora hech qachon yuklanmagan: sahifa faqat Space Grotesk,
 *   Inter va JetBrains Mono ni oladi. Natijada o'sha sakkiz
 *   joy — ochilish ekranidagi YO'LDA yozuvi, yozishmadagi
 *   harfli doiralar, LIFE bo'limining uchta sarlavhasi va
 *   "Mening yukim" dagi uchta element — qurilmaning o'z
 *   shriftida chiqardi. iPhone'da bir xil, Android'da
 *   boshqacha, kompyuterda yana boshqacha.
 *
 *   Ikkinchisi: `font-weight:800` yozilgan, lekin Inter 700
 *   gacha yuklangan edi. Brauzer eng yaqinini oladi, ya'ni
 *   700 — demak 800 yozish BEKOR edi. Qalinroq ko'rinsin
 *   deb yozilgan joylar qalinroq chiqmasdi.
 *
 * Ikkalasi ham ko'z bilan topilmadi — kod o'qib topildi.
 * Bu test shuning uchun bor.
 */
import { readFileSync } from 'node:fs';

const fails = [];
let pass = 0;
const check = (name, ok, extra) => {
  if (ok) { pass += 1; return; }
  fails.push(name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};

/* Brauzer o'zi beradigan nomlar — ularni yuklash shart emas. */
const TIZIM = new Set([
  'sans-serif', 'serif', 'monospace', 'system-ui', 'inherit', 'ui-monospace',
  '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica neue',
  'helvetica', 'arial', 'menlo', 'monaco', 'consolas', 'courier new', 'emoji',
  'apple color emoji', 'segoe ui emoji', 'noto color emoji', 'cursive', 'fantasy',
  'sfmono-regular', 'ui-sans-serif', 'ui-serif',
]);

/* Nomsiz (raqamsiz) qalinliklar — ular har qanday shriftda bor. */
const SOZ_QALINLIK = new Set(['normal', 'bold', 'bolder', 'lighter', 'inherit']);

const files = ['index.html', 'admin.html'];

for (const file of files) {
  const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');

  /* ---------- Yuklanganlar ---------- */
  /* Google Fonts manzili: family=Space+Grotesk:wght@500;600;700 */
  const yuklangan = new Map();   // nom (kichik harfda) → qalinliklar to'plami
  for (const m of src.matchAll(/family=([^&"']+)/g)) {
    const [nomQismi, wghtQismi] = m[1].split(':');
    const nom = decodeURIComponent(nomQismi).replace(/\+/g, ' ').toLowerCase();
    const wght = /wght@([\d;,.]+)/.exec(wghtQismi || '');
    /* MUHIM — ikki xil so'rash usuli, ikki xil natija.
       Bu TEKSHIRILDI: Google'ning javobi o'qib ko'rildi.

         `wght@400;500;600;700`  → AYNAN shu to'rt qalinlik,
                                   har biri alohida fayl;
         `wght@400..800`         → o'zgaruvchan shrift,
                                   oradagi hamma qiymat.

       Birinchisida 650 yozish BEKOR: brauzer eng yaqinini,
       ya'ni 700 ni oladi. Shuning uchun nuqta-nuqta bo'lsa
       oraliq, aks holda ro'yxat sifatida saqlanadi. */
    const matn = wght ? wght[1] : '400';
    const oraliqli = /\.\./.test(matn);
    const rows = matn.split(/[;,]/).filter(Boolean);
    if (oraliqli) {
      const sonlar = rows.flatMap((r) => r.split('..').map(Number));
      yuklangan.set(nom, { kind: 'oraliq', min: Math.min(...sonlar), max: Math.max(...sonlar) });
    } else {
      yuklangan.set(nom, { kind: 'royxat', bor: new Set(rows.map(Number)) });
    }
  }
  /* O'z faylidan yuklanganlar ham hisobga olinadi. */
  for (const m of src.matchAll(/@font-face\{[^}]*font-family:\s*['"]?([^;'"}]+)/g)) {
    const nom = m[1].trim().toLowerCase();
    if (!yuklangan.has(nom)) yuklangan.set(nom, { kind: 'oraliq', min: 1, max: 1000 });
  }

  /* ---------- Ishlatilganlar ---------- */
  /* Faqat QO'SHTIRNOQDAGI nomlar tekshiriladi: tirnoqsiz
     yozilganlar tizim nomlari (-apple-system, sans-serif). */
  const ishlatilgan = new Set();
  for (const m of src.matchAll(/font-family:\s*([^;}"\n]+)/g)) {
    for (const bolak of m[1].split(',')) {
      /* JS satri ichida tirnoq `\'` ko'rinishida yoziladi —
         kesma chiziq olib tashlanadi, aks holda nom
         topilmay qoladi. */
      const t = bolak.trim().replace(/\\/g, '').replace(/^['"]|['"]$/g, '').toLowerCase();
      if (!t || TIZIM.has(t) || t.startsWith('var(')) continue;
      ishlatilgan.add(t);
    }
  }

  const yoq = [...ishlatilgan].filter((n) => !yuklangan.has(n)).sort();
  check(file + ': ishlatilgan har bir shrift yuklangan', yoq.length === 0, yoq);

  /* ---------- Qalinliklar ---------- */
  /* Agar sahifada yuklanmagan qalinlik yozilsa, brauzer eng
     yaqinini oladi va yozilgan raqam bekor bo'ladi — hech
     qayerda xato chiqmaydi, shunchaki boshqa narsa chiziladi.
     Aynan shu `font-weight:800` (Inter 700 gacha edi) va
     `font-weight:650` (bunday fayl umuman yo'q) bilan sodir
     bo'lgandi. */
  const manbalar = [...yuklangan.values()];
  const mavjud = (n) => manbalar.some((o) => (o.kind === 'oraliq'
    ? n >= o.min && n <= o.max
    : o.bor.has(n)));

  const yoqQalinlik = new Set();
  for (const m of src.matchAll(/font-weight:\s*([\w.]+)/g)) {
    const v = m[1].toLowerCase();
    if (SOZ_QALINLIK.has(v)) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (!mavjud(n)) yoqQalinlik.add(n);
  }
  /* Faqat shrift yuklaydigan fayllar uchun ma'noli: admin
     tizim shriftida ishlaydi, unda hamma qalinlik mavjud. */
  if (yuklangan.size > 0) {
    check(file + ': yozilgan har bir qalinlik yuklangan',
      yoqQalinlik.size === 0, [...yoqQalinlik].sort((a, b) => a - b));
  } else {
    check(file + ': tizim shriftida ishlaydi (yuklash shart emas)',
      ishlatilgan.size === 0, [...ishlatilgan]);
  }
}

/* Ilovaning o'zida uchta shrift aynan kutiladi. Agar kimdir
   manzildan birini olib tashlasa, yuqoridagi tekshiruv ham
   ishlaydi — lekin bu yerda NIMA kutilayotgani yozib
   qo'yilgan, shunda sabab ko'rinib turadi. */
{
  const app = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  ['Space+Grotesk', 'Inter', 'JetBrains+Mono'].forEach((f) => {
    check('manzilda shrift bor: ' + f, app.includes('family=' + f));
  });
  check('Sora qaytib kelmadi (yuklanmagan shrift edi)', !/['"]Sora['"]/.test(app));
  check('Inter 800 gacha yuklangan (qalin raqamlar uchun)',
    /family=Inter:wght@[\d;]*800/.test(app));
}

if (fails.length) {
  console.log('\n' + fails.length + ' ta xato:');
  fails.forEach((f) => console.log('  XATO ' + f));
  console.log('\n==== ' + pass + ' passed, ' + fails.length + ' failed ====');
  process.exit(1);
}
console.log('\n==== ' + pass + ' passed, 0 failed ====');
