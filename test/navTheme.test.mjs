/**
 * Pastki panel mavzu bilan o'zgarmasin.
 *
 *     node test/navTheme.test.mjs      (yoki npm test)
 *
 * NIMA SO'RALGANDI.
 *
 *   "Qorong'u rejimda pastki panel qora bo'lmasin, u o'zgarmasin"
 *
 * Ilgari panel tunda qora shishaga aylanardi. Qora fon ustida
 * qora panel — chegarasi ko'rinmaydi, "suzib turgan" ko'rinish
 * yo'qoladi va panel sahifaning davomidek bo'lib qoladi.
 *
 * YECHIM IKKI QISMDAN IBORAT va ikkalasi ham shu yerda
 * qo'riqlanadi.
 *
 * 1. RANGLAR PANELNING O'ZIGA BIRIKTIRILDI. CSS o'zgaruvchisi
 *    eng yaqin ota-elementdan olinadi, shuning uchun
 *    `.bottom-nav{--nav-glass:...}` mavzu nima desa ham panel
 *    ichida ustun turadi. Bir joyda — panel ichidagi hamma
 *    narsa (yozuv, belgi, "orqaga" doirasi, tomchi) to'g'ri
 *    rangga tushadi.
 *
 *    Bu yerdagi qiymatlar YORUG' mavzuning aynan nusxasi.
 *    Shuning uchun test ularni `:root` dagi asl qiymat bilan
 *    solishtiradi: yorug'dagi panel rangi o'zgartirilsa-yu, bu
 *    ro'yxat unutilsa, ikkisi jimgina ajralib ketardi.
 *
 * 2. TUNDA SHISHA XIRA. Shisha shaffof: rangi ostidagi
 *    sahifadan ham keladi. Faqat tokenlarni tenglashtirish
 *    yetarli bo'lmadi — panel qora bo'lmay qoldi-yu, KULRANG
 *    chiqdi. Buni ko'z emas, o'lchov ko'rsatdi: panelning o'z
 *    rasmi olinib, o'rtacha yorqinligi hisoblandi — yorug'da
 *    255, tunda 241. Shuning uchun tunda shisha to'liq xira
 *    qilindi.
 *
 * Bu faylda CSS tekshiriladi. Chizilgan natijaning o'zi
 * brauzerda o'lchangan (scratchpad/panel.js): yorug' 255,
 * qorong'u 255.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const fails = [];
let pass = 0;
const check = (name, ok, extra) => {
  if (ok) { pass += 1; return; }
  fails.push(name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};

/* `.bottom-nav{ ... }` ning TOKENLAR turgan nusxasi. Faylda
   `.bottom-nav{` oltita joyda uchraydi (tartib, zaxira fon,
   Telegram, yashirish, tungi qoida va mana shu). Kerakligini
   ikkita token BIRGA e'lon qilinganidan bilamiz.

   `--nav-glass` ning o'zi yetarli emas edi: tartib qoidasi uni
   `var(--nav-glass)` deb ISHLATADI, ya'ni matn sifatida u ham
   mos keladi. Avval shu xatoga tushib, test 23 ta soxta xato
   bergandi. Shuning uchun ikki nuqta ham talab qilinadi. */
const panelBlok = (() => {
  let i = -1;
  for (;;) {
    i = src.indexOf('.bottom-nav{', i + 1);
    if (i === -1) return '';
    const blok = src.slice(i, src.indexOf('}', i));
    if (blok.includes('--nav-glass:') && blok.includes('--nav-filter:')) return blok;
  }
})();

check('panelning o‘z rang ro‘yxati bor', panelBlok.length > 0);

/* Yorug' mavzu — `:root{` ichidagi birinchi e'lonlar. */
const yorugBlok = src.slice(src.indexOf(':root{'), src.indexOf('--s1:4px'));

const qiymat = (blok, token) => {
  const m = new RegExp(token.replace(/[-]/g, '\\-') + ':\\s*([^;]+);').exec(blok);
  return m ? m[1].trim() : null;
};

/* ---------- 1. Panelning qiymatlari yorug' mavzunikiga teng ---------- */
const NAV_TOKENS = [
  '--nav-glass', '--nav-filter', '--nav-sheen-top', '--nav-sheen-mid', '--nav-sheen-bot',
  '--nav-edge-top', '--nav-edge-bot', '--nav-inner-glow', '--nav-drop', '--nav-solid',
  '--nav-brd', '--nav-lens', '--nav-lens-hot', '--nav-lens-brd', '--nav-lens-brd-hot',
];
NAV_TOKENS.forEach((t) => {
  const a = qiymat(panelBlok, t);
  const b = qiymat(yorugBlok, t);
  check('panelda ' + t + ' yorug‘ mavzunikiga teng', a !== null && a === b, { panel: a, yorug: b });
});

/* Panel ichidagi yozuv va yuzalar ham yorug' qiymatda: oq
   shishada oq yozuv ko'rinmay qolardi. */
const MATN_TOKENS = ['--ink', '--ink-soft', '--muted', '--border', '--card', '--paper-dark',
  '--route', '--route-dark'];
MATN_TOKENS.forEach((t) => {
  const a = qiymat(panelBlok, t);
  const b = qiymat(yorugBlok, t);
  check('panelda ' + t + ' yorug‘ mavzunikiga teng', a !== null && a === b, { panel: a, yorug: b });
});

/* ---------- 2. Tungi qoida faqat bitta: shishaning xiraligi ---------- */
/* Panelga tegadigan har qanday boshqa tungi qoida — panelning
   yana ikkiga bo'linishi degani. Shuning uchun ularning
   hammasi sanaladi. */
const tungi = [...src.matchAll(/:root\[data-theme="dark"\][^{\n]*\{/g)]
  .map((m) => m[0])
  .filter((sel) => /\.bn-|\.bottom-nav/.test(sel));

check('panelga tegadigan tungi qoida ATIGI BITTA', tungi.length === 1, tungi);
check('va u aynan panelning o‘zi',
  tungi.length === 1 && /:root\[data-theme="dark"\] \.bottom-nav\{/.test(tungi[0]), tungi);

/* Ko'p qatorli tanlagichlar (`,` bilan yangi qatorda) ham
   tekshiriladi — yuqoridagi naqsh ularni ushlamaydi. */
const kopQatorli = [...src.matchAll(/:root\[data-theme="dark"\]\s+\.(bn-[\w-]+|bottom-nav)[^;{]*,/g)]
  .map((m) => m[0].trim());
check('ko‘p qatorli tungi tanlagich ham qolmadi', kopQatorli.length === 0, kopQatorli);

/* O'sha bitta qoida nima qilayotgani: shishani xira qiladi. */
const tungiPanel = (() => {
  const i = src.indexOf(':root[data-theme="dark"] .bottom-nav{');
  return i === -1 ? '' : src.slice(i, src.indexOf('}', i));
})();
check('tungi qoida shishani XIRA qiladi',
  /--nav-glass:\s*#FFFFFF/i.test(tungiPanel), tungiPanel.slice(0, 120));
check('tungi qoida boshqa hech narsaga tegmaydi',
  (tungiPanel.match(/--/g) || []).length === 1, tungiPanel.slice(0, 160));

/* ---------- 3. Sabablari kodda yozilganmi ---------- */
/* Ikkalasi ham "nega bunday" deb so'raladigan qarorlar:
   biri mavzu ro'yxatida emas panelda turibdi, ikkinchisi esa
   mavzuga bog'liq. Sababsiz keyingi odam ularni "tartibga
   solib" buzadi. */
check('nega panelda — yozilgan', /PANEL MAVZU BILAN O'ZGARMAYDI/.test(src));
check('nega tunda xira — yozilgan va o‘lchov bilan',
  /yorug'da 255, tunda 241/.test(src));

if (fails.length) {
  console.log('\n' + fails.length + ' ta xato:');
  fails.forEach((f) => console.log('  XATO ' + f));
  console.log('\n==== ' + pass + ' passed, ' + fails.length + ' failed ====');
  process.exit(1);
}
console.log('\n==== ' + pass + ' passed, 0 failed ====');
