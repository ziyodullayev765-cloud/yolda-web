/**
 * YO'LDA belgisi.
 *
 *     node test/logo.test.mjs      (yoki npm test)
 *
 * BITTA FAYL. Belgi ilovaning o'n joyida ko'rinadi: kutish
 * ekrani, tepadagi qator, kirish ekrani, kvitansiya, admin
 * panel, ochiq hujjatlar, Play Market rasmi. Ilgari ularning
 * ba'zisida belgi QO'LDA chizilgan edi — belgi o'zgarsa, bir
 * nechta joy eskisi bilan qolib ketardi.
 *
 * Endi hammasi `icons/logo.png` ga qaraydi. Shu test eski
 * chizmaning qaytib kelishini va biror joyning chetda qolishini
 * ushlaydi.
 *
 * ESKI CHIZMA nimaga o'xshardi: yashil kafel ustida oq yo'l
 * (`M18 86 L42 24 H58 L82 86 Z`). Shu yo'lning izi hech qayerda
 * qolmasligi kerak.
 */
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { repo, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const read = (name) => readFileSync(join(repo, name), 'utf8');
const LOGO = '/icons/logo.png';
const ESKI = 'M18 86 L42 24';

/* ---------------------------------------------------------- */
flow('Belgi fayli joyida');
{
  const file = join(repo, 'icons/logo.png');
  check('icons/logo.png bor', existsSync(file));
  const bytes = readFileSync(file);
  check('haqiqiy PNG', bytes.slice(1, 4).toString() === 'PNG', bytes.slice(0, 8));
  /* IHDR: 16-24 baytlarda eni va bo'yi, 25-chida rang turi.
     Rang turi 3 — palitra, 6 — to'liq rang + shaffoflik. */
  const w = bytes.readUInt32BE(16);
  const h = bytes.readUInt32BE(20);
  const colorType = bytes[25];
  check('kvadratga yaqin', Math.abs(w - h) <= 2, { w, h });
  check('o‘lchami yetarli', w >= 256, { w, h });
  check('shaffoflikni ko‘taradi', colorType === 3 || colorType === 6, colorType);
  check('og‘ir emas', statSync(file).size < 120 * 1024, statSync(file).size);
}

/* ---------------------------------------------------------- */
flow('Ilovadagi hamma joy shu faylga qaraydi');
{
  const page = read('index.html');

  // Sahifadagi ikki belgi — ikkalasi ham rasm.
  ['logoMarkFlat', 'logoMark'].forEach((id) => {
    const m = page.match(new RegExp(`<symbol id="${id}"[\\s\\S]*?</symbol>`));
    check(id + ' bor', Boolean(m));
    if (m) check(id + ' yangi belgini ko‘rsatadi', m[0].includes(LOGO), m[0].slice(0, 120));
  });

  check('kutish ekrani ham', /<img class="splash-mark" src="\/icons\/logo\.png"/.test(page));
  check('kvitansiya ham', page.includes('img.src = "/icons/logo.png"'));
  check('kvitansiya belgini kutib chizadi', page.includes('loadRcptLogo()'));

  check('admin panel ham', read('admin.html').includes(LOGO));
  check('maxfiylik sahifasi ham', read('maxfiylik.html').includes(LOGO));
  check('hisobni o‘chirish sahifasi ham', read('hisob-ochirish.html').includes(LOGO));
  check('ochiq sahifalar qolipi ham', read('tools/pageShell.mjs').includes(LOGO));
  check('Play Market rasmi ham', read('tools/storeGraphic.mjs').includes("'icons', 'logo.png'"));
}

/* ---------------------------------------------------------- */
flow('Eski chizmadan iz qolmagan');
{
  const files = [
    'index.html', 'admin.html', 'maxfiylik.html', 'hisob-ochirish.html',
    'tools/pageShell.mjs', 'tools/storeGraphic.mjs',
  ];
  const qolgan = files.filter((f) => read(f).includes(ESKI));
  check('ESKI BELGI HECH QAYERDA YO‘Q', qolgan.length === 0, qolgan);
}

/* ---------------------------------------------------------- */
flow('Telefon va brauzer ikonkalari');
{
  /* Shaffof: brauzer yorlig'i va Android. Oq fonli: iOS
     (shaffoflikni bilmaydi, bo'sh joyni qora qiladi) va
     "maskable" (Android chetini kesadi, shuning uchun belgi
     kichikroq va orqasi to'ldirilgan). */
  const kutilgan = {
    'icons/favicon-32.png': { size: 32, alpha: true },
    'icons/icon-192.png': { size: 192, alpha: true },
    'icons/icon-512.png': { size: 512, alpha: true },
    'icons/apple-touch-icon.png': { size: 180, alpha: false },
    'icons/icon-maskable-512.png': { size: 512, alpha: false },
  };

  Object.keys(kutilgan).forEach((name) => {
    const file = join(repo, name);
    if (!existsSync(file)) { check(name + ' bor', false); return; }
    const b = readFileSync(file);
    const w = b.readUInt32BE(16);
    const h = b.readUInt32BE(20);
    check(name + ' o‘lchami', w === kutilgan[name].size && h === w, { w, h });

    /* Palitrali PNG da shaffoflik alohida `tRNS` bo'lagida
       keladi — faqat rang turiga qarash yetmaydi. */
    const hasTrns = b.includes(Buffer.from('tRNS'));
    const colorType = b[25];
    const shaffof = colorType === 6 || colorType === 4 || (colorType === 3 && hasTrns);
    check(name + (kutilgan[name].alpha ? ' shaffof' : ' to‘ldirilgan'),
      shaffof === kutilgan[name].alpha, { colorType, hasTrns });
  });

  const man = JSON.parse(read('manifest.webmanifest'));
  const srcs = man.icons.map((i) => i.src);
  check('manifest shu ikonkalarni ko‘rsatadi',
    srcs.includes('/icons/icon-192.png') && srcs.includes('/icons/icon-512.png')
    && srcs.includes('/icons/icon-maskable-512.png'), srcs);

  const page = read('index.html');
  check('brauzer yorlig‘i ulangan', page.includes('href="/icons/favicon-32.png"'));
  check('iOS ikonkasi ulangan', page.includes('href="/icons/apple-touch-icon.png"'));
}

t.done();
