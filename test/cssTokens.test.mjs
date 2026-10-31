/**
 * CSS tokenlari: ishlatilgani e'lon qilingan bo'lsin.
 *
 *     node test/cssTokens.test.mjs      (yoki npm test)
 *
 * NIMA UCHUN BU TEST BOR.
 *
 * CSS yaroqsiz qiymatda XATO BERMAYDI — u qoidani jimgina
 * tashlab yuboradi. Shuning uchun e'lon qilinmagan token
 * ishlatilsa, hech narsa sinmaydi, hech qayerda xato
 * ko'rinmaydi: shunchaki o'sha uslub yo'q bo'lib qoladi.
 *
 * Aynan shu ikki marta sodir bo'ldi:
 *
 *   `--r3`   — men o'ylab topgan nom. `border-radius:var(--r3)`
 *              yaroqsiz, demak radius 0 bo'lib qoldi va
 *              qo'ng'iroq panelidagi qatorlar QIRRALI chiqdi.
 *              Egasi buni ko'rib aytdi.
 *
 *   `--line` — ancha oldindan turgan. Yettita joyda
 *              `border:1px solid var(--line)` yozilgan edi va
 *              o'sha yettita chegara umuman chizilmasdi:
 *              bildirishnomalar, takliflar, safar qatorlari,
 *              saqlangan qidiruv, narx izohi, sharhlar va
 *              saqlangan haydovchilar.
 *
 * Ikkalasi ham ko'z bilan topilgan, kod bilan emas. Bu test
 * shuning uchun bor: endi uchinchisi o'z-o'zidan tutiladi.
 */
import { readFileSync } from 'node:fs';

const fails = [];
let pass = 0;
const check = (name, ok, extra) => {
  if (ok) { pass += 1; return; }
  fails.push(name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};

/* Ba'zi tokenlar CSS'da emas, JAVASCRIPT'da qo'yiladi
   (`el.style.setProperty`) — ular animatsiya va o'lchov uchun.
   Ular e'lon qilinmagani normal: qiymatni kod beradi. */
const JS_TOKENS = new Set([
  '--i',              // ro'yxatdagi tartib raqami (animatsiya kechikishi)
  '--lx', '--ly',     // linza markazi
  '--nh', '--nw',     // o'lchangan balandlik/kenglik
  '--mark', '--mark-ink', '--mark-soft', '--mark-size',  // mashina belgisi rangi
  '--ptr-progress',   // tortib yangilash
  '--squash', '--stretch',  // bosilganda siqilish
  '--tg-bottom',      // Telegram oynasining pastki chekkasi
]);

const files = ['index.html', 'admin.html'];

for (const file of files) {
  const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');

  /* E'lonlar — `<style>` ichida ham, JS yozadigan inline
     uslublarda ham bo'lishi mumkin, shuning uchun butun fayl
     bo'ylab qidiriladi. */
  const aniqlangan = new Set(
    [...src.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
  );
  /* ZAXIRASIZ ishlatilganlari. `var(--x, 12px)` da token
     yo'q bo'lsa zaxira ishlaydi, ya'ni uslub baribir
     chiziladi — bunday ishlatish xavfli emas. Xavflisi
     `var(--x)`: token yo'q bo'lsa, butun qoida tashlab
     yuboriladi va hech kim sezmaydi. Aynan shunisi
     tekshiriladi. */
  const zaxirasiz = new Set(
    [...src.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((m) => m[1]),
  );

  const yoq = [...zaxirasiz]
    .filter((t) => !aniqlangan.has(t) && !JS_TOKENS.has(t))
    .sort();

  check(file + ': zaxirasiz ishlatilgan token hammasi e’lon qilingan',
    yoq.length === 0, yoq);
  check(file + ': kamida bitta token e’lon qilingan', aniqlangan.size > 10, aniqlangan.size);
}

/* Radius tokenlarining o'zi joyida turibdimi. `--r3` xatosi
   aynan shu nomlardan birini xato yozishdan kelib chiqqan edi.

   (Ilgari bu yerda qo'ng'iroq panelining radiuslari ham
    tekshirilardi. Panel egasining talabi bilan olib tashlandi —
    raqam endi o'z xabarida qoladi, tepada hech narsa
    qadalmaydi. Qarang: test/callSheet.test.mjs) */
{
  const app = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  ['--r-sm', '--r-md', '--r-lg', '--r-xl', '--r-pill'].forEach((t) => {
    check('radius tokeni bor: ' + t, new RegExp(t + ':\\s*\\d').test(app));
  });
}

if (fails.length) {
  console.log('\n' + fails.length + ' ta xato:');
  fails.forEach((f) => console.log('  XATO ' + f));
  console.log('\n==== ' + pass + ' passed, ' + fails.length + ' failed ====');
  process.exit(1);
}
console.log('\n==== ' + pass + ' passed, 0 failed ====');
