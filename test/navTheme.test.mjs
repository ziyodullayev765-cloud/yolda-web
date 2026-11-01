/**
 * Qorong'u rejimda pastki panel QORA bo'lmasin.
 *
 *     node test/navTheme.test.mjs      (yoki npm test)
 *
 * MUAMMO NIMA EDI.
 *
 * Tunda panelning yuzasi rgba(18,18,20,0.62) edi va yorqinlik
 * 0.70 ga bosilardi. Brauzerda o'lchanganda panel 25 ga
 * tushardi — sahifaning o'zi esa 0. Ya'ni qora fonda qora
 * panel: chegarasi bilinmaydi, u suzib turganga emas,
 * sahifaning davomiga o'xshaydi.
 *
 * NEGA OQ EMAS.
 *
 * Avval panel ikkala rejimda ham oq qilib ko'rildi. Qora
 * sahifada u yorug' plita bo'lib ajralib ketdi va qorong'u
 * dizaynga yarashmadi — egasi ko'rib rad etdi. Tungi rejimda
 * panel ham qorong'u bo'lishi kerak, faqat FONDAN KO'TARILGAN.
 *
 * QOIDA SHU: panel ilovaning o'z tungi palitrasidagi eng
 * ochiq pog'ona bo'lsin.
 *
 *     sahifa        #000000   →   0
 *     kartochka     #1C1C1E   →  28   (--card)
 *     ko'tarilgan   #2C2C2E   →  44   (--paper-dark)
 *     PANEL                   →  52+
 *
 * Panel kartochkalardan ham yuqorida suzadi, demak u eng ochiq
 * bo'lishi kerak. Lekin oq emas: shu fayl ikkala chetni ham
 * qo'riqlaydi.
 *
 * Bu yerda CSS tekshiriladi. Chizilgan natija brauzerda
 * o'lchangan (scratchpad/panel.js): yorug'da 255, tunda 55.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const fails = [];
let pass = 0;
const check = (name, ok, extra) => {
  if (ok) { pass += 1; return; }
  fails.push(name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};

/* Mavzu bloklari. Yorug' — birinchi `:root{`, tungi —
   `[data-theme="dark"]` bo'lgani. */
const yorugBlok = src.slice(src.indexOf(':root{'), src.indexOf('--s1:4px'));
const tungiBosh = src.indexOf(':root[data-theme="dark"]');
const tungiBlok = src.slice(tungiBosh, src.indexOf('\n  }', tungiBosh));

const qiymat = (blok, token) => {
  const m = new RegExp(token.replace(/-/g, '\\-') + ':\\s*([^;]+);').exec(blok);
  return m ? m[1].trim() : null;
};

/* "#1C1C1E" yoki "rgba(44,44,48,0.88)" → yorqinlik 0..255.
   Shaffof rang QORA fon ustida hisoblanadi, chunki tungi
   rejimda panel aynan shunday turadi. */
const yorqin = (s) => {
  if (!s) return null;
  let r; let g; let b; let a = 1;
  const hex = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (hex) {
    r = parseInt(hex[1].slice(0, 2), 16);
    g = parseInt(hex[1].slice(2, 4), 16);
    b = parseInt(hex[1].slice(4, 6), 16);
  } else {
    const n = s.match(/[\d.]+/g);
    if (!n || n.length < 3) return null;
    [r, g, b] = n.slice(0, 3).map(Number);
    if (n.length > 3) a = Number(n[3]);
  }
  return Math.round((0.299 * r + 0.587 * g + 0.114 * b) * a);
};

/* ---------- Palitraning pog'onalari ---------- */
const card = yorqin(qiymat(tungiBlok, '--card'));
const paperDark = yorqin(qiymat(tungiBlok, '--paper-dark'));
const panel = yorqin(qiymat(tungiBlok, '--nav-glass'));

check('tungi mavzuda --card topildi', card !== null, card);
check('tungi mavzuda --paper-dark topildi', paperDark !== null, paperDark);
check('tungi mavzuda --nav-glass topildi', panel !== null, panel);

/* ---------- 1. Panel QORA emas ---------- */
/* Eski qiymat (rgba(18,18,20,0.62)) bu yerda 12 berardi —
   ya'ni bu chegara aynan o'sha xatoni ushlaydi. */
check('PANEL QORA EMAS (kartochkadan ham ochiq)',
  panel !== null && card !== null && panel > card,
  { panel, card });
check('panel ko‘tarilgan yuza darajasida yoki undan ochiq',
  panel !== null && paperDark !== null && panel >= paperDark,
  { panel, paperDark });

/* ---------- 2. Panel OQ ham emas ---------- */
/* Yuqori cheti ham kerak: aks holda "qora bo'lmasin" degan
   talab panelni yana oq plitaga aylantirib yuborardi —
   egasi buni allaqachon ko'rib rad etgan. */
check('PANEL OQ EMAS (hamon qorong‘u rejim)',
  panel !== null && panel < 120, panel);

/* ---------- 3. Qirrasi ko'rinadi ---------- */
/* Qora fonda panelning chegarasi bilinib turishi kerak:
   rang farqining o'zi yetarli emas. */
const brd = qiymat(tungiBlok, '--nav-brd');
const brdAlfa = brd ? Number((brd.match(/[\d.]+/g) || []).slice(-1)[0]) : null;
check('panel chegarasi bor va sezilarli', brdAlfa !== null && brdAlfa >= 0.18,
  { brd, brdAlfa });

/* ---------- 4. Yorqinlik butunlay bosilmaydi ---------- */
/* `brightness(0.70)` ostidagi hamma narsani o'ldirardi va
   panelning qoraligiga eng ko'p hissa qo'shgan narsa ham
   o'sha edi. */
const filtr = qiymat(tungiBlok, '--nav-filter');
const bright = filtr ? Number((/brightness\(([\d.]+)\)/.exec(filtr) || [])[1]) : null;
check('tunda yorqinlik o‘ldirilmaydi', bright !== null && bright >= 0.85,
  { filtr, bright });

/* ---------- 5. Yorug' rejim tegilmagan ---------- */
/* Hamma ish tungi mavzuda bo'ldi — yorug'dagi panel o'z
   holida qolishi kerak edi. */
check('yorug‘ rejimdagi panel o‘zgarmadi',
  qiymat(yorugBlok, '--nav-glass') === 'rgba(255,255,255,0.58)',
  qiymat(yorugBlok, '--nav-glass'));
check('yorug‘ rejimdagi yorqinlik o‘zgarmadi',
  /brightness\(1\.06\)/.test(qiymat(yorugBlok, '--nav-filter') || ''),
  qiymat(yorugBlok, '--nav-filter'));

/* ---------- 6. Sababi kodda yozilgan ---------- */
/* Raqamlar o'ylab topilgani emas, o'lchovdan. Buni yozib
   qo'ymasa, keyingi odam ularni "chiroyliroq" qilib
   o'zgartiradi va panel yana qorayadi. */
check('nega bunday — o‘lchov bilan yozilgan',
  /PANEL QORA EMAS — KO'TARILGAN YUZA/.test(src));
check('oq variant sinalgani ham yozilgan',
  /Oq ham sinaldi/.test(src));

if (fails.length) {
  console.log('\n' + fails.length + ' ta xato:');
  fails.forEach((f) => console.log('  XATO ' + f));
  console.log('\n==== ' + pass + ' passed, ' + fails.length + ' failed ====');
  process.exit(1);
}
console.log('\n==== ' + pass + ' passed, 0 failed ====');
