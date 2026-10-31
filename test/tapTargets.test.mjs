/**
 * Tegish maydoni va panellarning silliqligi.
 *
 *     node test/tapTargets.test.mjs      (yoki npm test)
 *
 * ============================================================
 * 1. TEGISH MAYDONI
 * ------------------------------------------------------------
 * Ilovani boshdan-oxir aylanib chiqqanda 22 ta tugmaning
 * bosiladigan maydoni 36px dan kichik chiqdi. Eng kichiklari
 * ikonkali tugmalar edi: lentadagi strelka 19×27, yuk
 * kartochkasidagi yurak 26×26.
 *
 * Ularni KATTALASHTIRIB bo'lmaydi: yurak kartochkaning o'zidan
 * ko'proq joy egallardi. Shuning uchun ko'rinish o'sha-o'sha
 * qoladi, faqat ko'rinmas maydon kengayadi — `::after` orqali.
 * U `position:absolute`, ya'ni layout'ga umuman ta'sir
 * qilmaydi va hech bir element joyidan siljimaydi.
 *
 * ============================================================
 * 2. PANELLAR
 * ------------------------------------------------------------
 * Menyular ochilganda suzib chiqardi, yopilganda esa bir zumda
 * yo'q bo'lardi — ko'z buni "uzilish" deb o'qiydi. Endi ikkala
 * tomoni ham animatsiya bilan.
 *
 * Chiqish kirishdan tezroq (0.14s va 0.18s): kutilayotgan
 * narsa sekin keladi, kerak bo'lmagani tez ketadi.
 */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const fails = [];
let pass = 0;
const check = (name, ok, extra) => {
  if (ok) { pass += 1; return; }
  fails.push(name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};

/* ---------- 1. Tegish maydoni ---------- */
const kichiklar = ['.nav-chev-btn', '.load-card .lc-fav', '.htc-fav',
  '.hlc-fav', '.tc-fav', '.chat-row-more', '.pf-id-num'];

const afterBlok = (() => {
  const i = html.indexOf('.pf-id-num::after{');
  return i === -1 ? '' : html.slice(html.lastIndexOf('.nav-chev-btn::after', i), html.indexOf('}', i));
})();

kichiklar.forEach((sel) => {
  check('tegish maydoni kengaytirilgan: ' + sel,
    html.includes(sel + '::after'), sel);
});
check('maydon 44px', /width:44px;height:44px/.test(afterBlok), afterBlok.slice(-120));
check('LAYOUT‘GA TEGMAYDI (absolute)', /position:absolute/.test(afterBlok));
check('tugmaning o‘z enidan kichik bo‘lmaydi',
  /min-width:100%;min-height:100%/.test(afterBlok));

/* `.tc-fav` va `.hlc-fav` allaqachon `position:absolute` —
   ularga `position:relative` berilsa, joyidan uchib ketardi. */
check('allaqachon joylashtirilganlariga `relative` berilmagan',
  !/\.tc-fav,\s*\n?\s*\.hlc-fav[^}]*position:relative/.test(html));

/* ---------- 2. Panellar ---------- */
check('hisob menyusi kirish animatsiyasi', /@keyframes navMenuIn/.test(html));
check('HISOB MENYUSI CHIQISH ANIMATSIYASI', /@keyframes navMenuOut/.test(html));
check('xabar menyusi kirish animatsiyasi', /@keyframes cbMenuIn/.test(html));
check('XABAR MENYUSI CHIQISH ANIMATSIYASI', /@keyframes cbMenuOut/.test(html));
check('pardasi ham silliq ketadi', /\.cb-menu-veil\.closing/.test(html));

/* Chiqish kirishdan tezroq bo'lsin. */
const vaqt = (sel) => {
  const m = html.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    + '\\{animation:\\w+ ([\\d.]+)s'));
  return m ? parseFloat(m[1]) : null;
};
const kir = html.match(/animation:navMenuIn ([\d.]+)s/);
check('chiqish kirishdan tez', vaqt('.nav-menu.closing') < parseFloat(kir[1]),
  { chiqish: vaqt('.nav-menu.closing'), kirish: kir && kir[1] });

/* Yopilayotgan menyu bosilmasin — oraliqda tegib ketish
   noto'g'ri amalni ishga tushirardi. */
check('yopilayotgan menyu bosilmaydi',
  /\.nav-menu\.closing\{[^}]*pointer-events:none/.test(html)
  && /\.cb-menu\.closing\{[^}]*pointer-events:none/.test(html));

/* ---------- 3. Harakat kamaytirilganda ---------- */
check('harakat kamaytirilganini biladigan funksiya bor',
  /function prefersReducedMotion\(\)/.test(html));
const prm = (html.split('function prefersReducedMotion()')[1] || '').slice(0, 400);
check('ilovaning o‘z sozlamasi hisobga olinadi', /getNotifPrefs\(\)\.motion/.test(prm));
check('TELEFONNING TIZIM SOZLAMASI HAM', /prefers-reduced-motion: reduce/.test(prm));
check('menyular uni so‘raydi',
  (html.match(/prefersReducedMotion\(\)/g) || []).length >= 3);

/* Zaxira: `animationend` kelmasa menyu ochiq qolib ketmasin
   (fon tabda hodisa kelmaydi). */
check('animatsiya hodisasi kelmasa ham yopiladi',
  /setTimeout\(tugadi, 220\)/.test(html));

if (fails.length) {
  console.log('\n' + fails.length + ' ta xato:');
  fails.forEach((f) => console.log('  XATO ' + f));
  console.log('\n==== ' + pass + ' passed, ' + fails.length + ' failed ====');
  process.exit(1);
}
console.log('\n==== ' + pass + ' passed, 0 failed ====');
