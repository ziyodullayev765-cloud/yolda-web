/**
 * Kirish ekranidagi rang kontrasti.
 *
 *     node test/contrast.test.mjs      (yoki npm test)
 *
 * NIMA UCHUN BU TEST BOR.
 *
 * Lighthouse ikkita xato topdi va ikkalasi ham birinchi ekranda
 * edi: "Kirish" tugmasidagi oq yozuv yashil fonda 2.64:1, "Mehmon
 * sifatida" yozuvi esa oq fonda 3.19:1. WCAG AA talabi — oddiy
 * matn uchun 4.5:1. Ya'ni yorug' joyda yoki ko'zi xiraroq odam
 * uchun ilovaning ENG BIRINCHI tugmasi yomon o'qilardi.
 *
 * Rang — "chiroyli ko'rinadi" degan tuyg'u bilan tanlanadi va
 * shuning uchun jimgina orqaga qaytib qolishi oson. Bu test shuni
 * ushlab turadi: endi rangni o'zgartirmoqchi bo'lgan odam avval
 * hisobni ko'radi.
 *
 * Hisob WCAG 2.1 ning o'z formulasi bo'yicha — taxmin emas.
 */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const fails = [];
let pass = 0;
const check = (name, ok, extra) => {
  if (ok) { pass += 1; return; }
  fails.push(name + (extra !== undefined ? '  → ' + extra : ''));
};

/* ---------- WCAG 2.1 ---------- */
const kanal = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const yorqinlik = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * kanal((n >> 16) & 255)
       + 0.7152 * kanal((n >> 8) & 255)
       + 0.0722 * kanal(n & 255);
};
/** Ikki rang orasidagi kontrast nisbati (1 dan 21 gacha). */
const nisbat = (a, b) => {
  const x = yorqinlik(a);
  const y = yorqinlik(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/* O'zimizni tekshiramiz: formula to'g'ri ishlayaptimi. */
check('formula: qora va oq 21:1', Math.round(nisbat('#000000', '#FFFFFF')) === 21);
check('formula: bir xil rang 1:1', Math.round(nisbat('#45B45F', '#45B45F')) === 1);

/* ---------- Kirish ekranining ranglari ---------- */
const token = (nom) => {
  const m = new RegExp('--' + nom + ':\\s*(#[0-9A-Fa-f]{6})').exec(html);
  return m ? m[1].toUpperCase() : null;
};

const yashil = token('au-green');
const yashilToq = token('au-green-dark');
const xira = token('au-muted');
const siyoh = token('au-ink');
const OQ = '#FFFFFF';

check('ranglar topildi', Boolean(yashil && yashilToq && xira && siyoh),
  JSON.stringify({ yashil, yashilToq, xira, siyoh }));

const AA = 4.5;

/* 1. "Kirish" tugmasi: oq yozuv yashil fonda. */
const tugma = nisbat(OQ, yashil);
check('TUGMADAGI OQ YOZUV O\'QILADI (AA 4.5:1)', tugma >= AA,
  yashil + ' — ' + tugma.toFixed(2) + ':1');

/* 2. O'sha yashil havolada MATN bo'lib ham ishlatiladi (.au-link),
      ya'ni u oq fonda ham o'qilishi kerak. Aynan shu sabab
      tugmaning rangini emas, TOKENNING o'zini o'zgartirdik. */
check('yashil matn ham o\'qiladi', nisbat(yashil, OQ) >= AA,
  yashil + ' — ' + nisbat(yashil, OQ).toFixed(2) + ':1');

/* 3. Bosilgandagi to'q yashil undan ham to'q bo'lsin. */
check('bosilganda rang to\'qlashadi', yorqinlik(yashilToq) < yorqinlik(yashil),
  yashil + ' → ' + yashilToq);
check('to\'q yashilda ham oq yozuv o\'qiladi', nisbat(OQ, yashilToq) >= AA,
  yashilToq + ' — ' + nisbat(OQ, yashilToq).toFixed(2) + ':1');

/* 4. "Mehmon sifatida davom etish" — oq fonda xira kulrang. */
const mehmon = nisbat(xira, OQ);
check('XIRA YOZUV O\'QILADI (AA 4.5:1)', mehmon >= AA,
  xira + ' — ' + mehmon.toFixed(2) + ':1');

/* 5. Asosiy matn — bu allaqachon yaxshi edi, shunday qolsin. */
check('asosiy matn qora fonda emas, oq fonda to\'q', nisbat(siyoh, OQ) >= 7,
  siyoh + ' — ' + nisbat(siyoh, OQ).toFixed(2) + ':1');

/* 6. Eski ranglar QIYMAT sifatida qaytib kelmasin. Izohlarda
      ular haqida yozilgani — xato emas, tarix. */
const qiymat = (rang) => new RegExp(':\\s*' + rang + '\\b', 'i').test(html);
check('eski och yashil (#45B45F) ishlatilmaydi', !qiymat('#45B45F'));
check('eski xira kulrang (#8A9199) ishlatilmaydi', !qiymat('#8A9199'));

if (fails.length) {
  console.log('contrast: ' + fails.length + ' ta xato');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('contrast: ' + pass + ' ta tekshiruv o\'tdi'
  + '  (tugma ' + tugma.toFixed(2) + ':1, mehmon ' + mehmon.toFixed(2) + ':1)');
