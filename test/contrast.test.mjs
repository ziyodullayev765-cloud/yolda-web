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

/* ============================================================
   Ichki ekranlar
   ------------------------------------------------------------
   Kirish ekranidan keyin topilganlar. Ular axe-core bilan
   to'qqizta bo'limda, ikkala mavzuda o'lchandi.
   ============================================================ */

/** `:root` yoki `[data-theme="dark"]` blokidagi token. */
const mavzuToken = (nom, tungi) => {
  const blok = tungi
    ? /:root\[data-theme="dark"\]\{([\s\S]*?)\n  \}/.exec(html)
    : /\n  :root\{([\s\S]*?)\n  \}/.exec(html);
  if (!blok) return null;
  const m = new RegExp('--' + nom + ':\\s*(#[0-9A-Fa-f]{3,6})').exec(blok[1]);
  return m ? m[1].toUpperCase() : null;
};

/* 7. To'ldirilgan yashil fonda turadigan yozuv.

   Yorug'da `--route` to'q (#09864B) — u yerda OQ yozuv to'g'ri.
   Tungida esa u yorqin (#2DD480) va oq yozuv 1.93:1 ga tushadi,
   demak u yerda to'q siyoh kerak. Javob mavzuga qarab boshqacha
   bo'lgani uchun u token qilib olingan. */
const routeY = mavzuToken('route', false);
const routeT = mavzuToken('route', true);
const onRouteY = mavzuToken('on-route', false);
const onRouteT = mavzuToken('on-route', true);
check('yashil fon uchun yozuv rangi bor',
  Boolean(routeY && routeT && onRouteY && onRouteT),
  JSON.stringify({ routeY, routeT, onRouteY, onRouteT }));
check('YORUG\'DA yashil tugmadagi yozuv o\'qiladi', nisbat(onRouteY, routeY) >= AA,
  onRouteY + ' / ' + routeY + ' — ' + nisbat(onRouteY, routeY).toFixed(2) + ':1');
check('TUNGIDA yashil tugmadagi yozuv o\'qiladi', nisbat(onRouteT, routeT) >= AA,
  onRouteT + ' / ' + routeT + ' — ' + nisbat(onRouteT, routeT).toFixed(2) + ':1');

/* 8. "Yangi" nishoni: `--accepted` va `--stamp-dark` ikkala
      mavzuda ham och, shuning uchun u yerda doim to'q siyoh. */
[['accepted', false], ['accepted', true], ['stamp-dark', false], ['stamp-dark', true]]
  .forEach(([nom, tungi]) => {
    const fon = mavzuToken(nom, tungi);
    const siyohi = mavzuToken('on-accepted', tungi);
    const qayerda = (tungi ? 'tungi' : 'yorug\'') + ' --' + nom;
    check('nishondagi yozuv o\'qiladi (' + qayerda + ')',
      Boolean(fon && siyohi) && nisbat(siyohi, fon) >= AA,
      siyohi + ' / ' + fon + (fon && siyohi ? ' — ' + nisbat(siyohi, fon).toFixed(2) + ':1' : ''));
  });

/* 9. Oq fonda turadigan yashil yozuv (yuk kartochkasidagi
      "Yangi" belgisi). Nishon foni uchun olingan yashil bu yerda
      juda och edi: 3.29:1. */
const yashilYozuv = mavzuToken('green-ink', false);
check('oq fonda yashil yozuv o\'qiladi',
  Boolean(yashilYozuv) && nisbat(yashilYozuv, OQ) >= AA,
  yashilYozuv + ' — ' + (yashilYozuv ? nisbat(yashilYozuv, OQ).toFixed(2) : '?') + ':1');

/* 10. Suhbat avatarlari: har bir tus ustida OQ harf turadi. */
const palitra = (() => {
  const m = /var CHAT_AVATAR_COLORS = \[([\s\S]*?)\];/.exec(html);
  return m ? (m[1].match(/#[0-9A-Fa-f]{6}/g) || []) : [];
})();
check('avatar palitrasi topildi', palitra.length >= 8, palitra.length);
const yomon = palitra.filter((c) => nisbat(OQ, c) < AA);
check('HAR BIR AVATAR TUSIDA OQ HARF O\'QILADI', yomon.length === 0,
  yomon.map((c) => c + ' (' + nisbat(OQ, c).toFixed(2) + ':1)').join(', '));

/* 11. IKKILAMCHI YOZUV — ilovadagi eng ko'p takrorlanadigan
       kamchilik edi: yorug'da 31 ta joy, tungida 18 ta. */
const kartaY = '#FFFFFF';    // yorug' kartochka foni
const kartaT = '#1C1C1E';    // tungi kartochka foni
/* Life bo'limining ranglari `:root` da emas, `.life` blokida —
   u yerda ikkala mavzu ketma-ket yozilgan. */
const lifeToken = (nom, tungi) => {
  const hamma = [...html.matchAll(new RegExp('--' + nom + ':\\s*(#[0-9A-Fa-f]{3,6})', 'g'))]
    .map((m) => m[1].toUpperCase());
  return hamma.length >= 2 ? hamma[tungi ? 1 : 0] : (hamma[0] || null);
};

[['muted', false, kartaY, mavzuToken], ['muted', true, kartaT, mavzuToken],
 ['lf-dim', false, kartaY, lifeToken], ['lf-dim', true, kartaT, lifeToken]]
  .forEach(([nom, tungi, fon, oqi]) => {
    const rang = oqi(nom, tungi);
    const qayerda = (tungi ? 'tungi' : 'yorug\'') + ' --' + nom;
    check('ikkilamchi yozuv o\'qiladi (' + qayerda + ')',
      Boolean(rang) && nisbat(rang, fon) >= AA,
      rang + ' / ' + fon + (rang ? ' — ' + nisbat(rang, fon).toFixed(2) + ':1' : ''));
  });

/* 12. Yashil yozuv och yashil yuzalarda ham o'qilsin: chiplar,
       "tasdiqlandi" nishoni. Fonlar — o'sha yashilning 8–13%
       darajadagi ko'rinishi. */
[['#E8F6ED', 'tasdiq nishoni'], ['#EFFAF5', 'suhbat chipi'], ['#EBF7F2', 'yordam chipi']]
  .forEach(([fon, nom]) => {
    check('yashil yozuv o\'qiladi (' + nom + ')',
      Boolean(yashilYozuv) && nisbat(yashilYozuv, fon) >= AA,
      yashilYozuv + ' / ' + fon + (yashilYozuv ? ' — ' + nisbat(yashilYozuv, fon).toFixed(2) + ':1' : ''));
  });

/* 13. Mashina markasi: harf o'z rangining OCH ko'rinishida
       yoziladi. Ikkisi juda yaqin bo'lsa farq yo'qoladi, shuning
       uchun harf bir pog'ona to'qlashtiriladi (0.8). Shu qoida
       palitradagi HAR BIR rang uchun yetarlimi — shuni
       tekshiramiz. */
const toqroq = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const q = (v) => Math.round(v * k).toString(16).padStart(2, '0');
  return '#' + q((n >> 16) & 255) + q((n >> 8) & 255) + q(n & 255);
};
const yuvilgan = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  const q = (v) => Math.round(v * a + 255 * (1 - a)).toString(16).padStart(2, '0');
  return '#' + q((n >> 16) & 255) + q((n >> 8) & 255) + q(n & 255);
};
const markKoef = (() => {
  const m = /Math\.round\(r \* ([\d.]+)\)/.exec(html);
  return m ? Number(m[1]) : null;
})();
check('marka harfi to\'qlashtiriladi', markKoef !== null && markKoef < 1, markKoef);
const markYomon = palitra.filter((c) =>
  nisbat(toqroq(c, markKoef || 1), yuvilgan(c, 0.13)) < AA);
check('MARKA HARFI HAR BIR RANGDA O\'QILADI', markYomon.length === 0,
  markYomon.map((c) => c + ' (' + nisbat(toqroq(c, markKoef || 1), yuvilgan(c, 0.13)).toFixed(2) + ':1)').join(', '));

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
