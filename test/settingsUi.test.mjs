/**
 * Yurakcha, "qidiruvni saqlash" tugmasi va Sozlamalar sahifasi.
 *
 *     node test/settingsUi.test.mjs      (yoki npm test)
 *
 * YURAKCHA. Egasi qo'ygan yurakcha — CHIZIQLI rasm. Ilovadagi
 * ikonkalardan faqat shakli olinadi (niqob), ichi esa shaklga
 * kirmaydi — ya'ni "ichini bo'yash" rasmning o'zidan chiqmaydi.
 * Shuning uchun saqlangan holat uchun alohida, to'ldirilgan
 * belgi bor va qatorlar o'sha belgiga almashadi.
 *
 * SOZLAMALAR. Ilgari hamma qator bitta uzun ro'yxat edi va har
 * birida faqat nom turardi. Endi guruhlangan, har qatorda izoh
 * bor, tungi rejim esa joyida almashadi.
 *
 * ENG MUHIM TASDIQ — BO'SH VA'DA YO'Q. Chizmada "TO'LOVLAR"
 * guruhi bor edi: "To'lov usullari" va "To'lovlar tarixi".
 * Ilovada to'lov tizimi yo'q, ya'ni bu qatorlar bosilganda hech
 * narsa bo'lmasdi. Quyida ular YO'Qligi va qolgan har bir
 * qatorning haqiqiy manzili borligi tekshiriladi.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const html = readFileSync(join(repo, 'index.html'), 'utf8');

let passed = 0;
let failed = 0;
const check = (name, ok, extra) => {
  if (ok) { passed += 1; return; }
  failed += 1;
  console.log(`  ✗ ${name}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`);
};
const flow = (name) => console.log(`\n== ${name} ==`);

/** Berilgan funksiyaning tanasi. */
const body = (sig) => {
  const at = html.indexOf(sig);
  if (at === -1) return '';
  return html.slice(at, html.indexOf('\n  }\n', at));
};

/* ============================================================
   1. Yurakcha
   ============================================================ */
flow('1. Yurakcha');
{
  check('to‘ldirilgan belgi bor', html.includes('<symbol id="iconHeartFilled"'));
  check('ichi haqiqatan to‘ldirilgan', (() => {
    const m = html.match(/<symbol id="iconHeartFilled"[^>]*>([\s\S]*?)<\/symbol>/);
    return Boolean(m) && m[1].includes('fill="currentColor"') && m[1].includes('stroke="none"');
  })());
  check('yordamchi bor', html.includes('function heartIcon(on){'));
  check('yordamchi ikkisini almashtiradi',
    html.includes('return icon(on ? "iconHeartFilled" : "iconHeart");'));

  /* Hech qayerda eski usul qolmasin: u PNG niqob uchun hech
     narsa qilmaydi, ya'ni yurakcha bo'yalmagandek qolardi. */
  check('eski "filled" usuli qolmagan', !/icon\("iconHeart",/.test(html));
  check('o‘lik qoida qolmagan', !/\.lc-fav\.on \.ic-svg\{fill/.test(html));

  // Hamma saqlash tugmalari yangi yordamchidan foydalanadi.
  const n = (html.match(/heartIcon\(/g) || []).length;
  check('hamma joyda ishlatiladi', n >= 9, n);

  // Saqlangan holat qizil bo'lishi kerak.
  check('yuk kartochkasida qizil', /\.load-card \.lc-fav\.on\{color:#EF4444/.test(html));
  check('bosh sahifada qizil', /\.hlc-fav\.on\{color:#EF4444/.test(html));
  check('yuk sahifasida qizil', /\.dt-icon-btn\.on\{color:#EF4444/.test(html));
}

/* ============================================================
   2. Qidiruvni saqlash tugmasi
   ============================================================ */
flow('2. Qidiruvni saqlash');
{
  check('ixcham tugmaga aylangan', html.includes('class="loads-save-chip" id="btnSaveSearch"'));
  check('eski katta havola qolmagan', !/class="link-btn" id="btnSaveSearch"/.test(html));
  check('uslubi bor', html.includes('.loads-save-chip{'));
  check('o‘ngga tekislangan', /\.loads-save-row\{[^}]*justify-content:flex-end/.test(html));
  check('yashirish ishlaydi', html.includes('.loads-save-chip[hidden]{display:none;}'),
    'sinfdagi display brauzerning [hidden] qoidasidan kuchliroq');

  /* Yozuv qisqartirilgan: ilgari u tor ekranda ikki qatorga
     bo'linib, sarlavhadek ko'rinardi. */
  ['Qidiruvni saqlash', 'Сохранить поиск', 'Save this search'].forEach((txt) => {
    check(`yozuv qisqa: ${txt}`, html.includes(`"search.save": "${txt}"`));
  });
}

/* ============================================================
   3. Sozlamalar sahifasi
   ============================================================ */
flow('3. Sozlamalar');
{
  const fn = body('  function renderAccountSettingsPage(){');
  check('sahifa topildi', fn.length > 0);

  check('odam kartochkasi tepada', fn.includes('class="set-me"'));
  check('guruh sarlavhalari', (fn.match(/class="set-group"/g) || []).length === 4,
    (fn.match(/class="set-group"/g) || []).length);
  check('qatorda izoh bor', html.includes('class="set-row-sub"'));
  check('qator yasovchi bor', html.includes('function setRow(opts){'));

  /* TO'LOVLAR guruhi bo'lmasligi kerak — to'lov tizimi yo'q. */
  ['TO\'LOV', 'To\'lov usullari', 'To\'lovlar tarixi', 'ПЛАТЕЖ', 'PAYMENT'].forEach((w) => {
    check(`"${w}" qo‘shilmagan`, !fn.includes(w));
  });

  /* Har bir qator haqiqiy joyga olib borishi kerak: amalsiz
     qator "bosdim, hech narsa bo'lmadi" degani. */
  const rows = [...fn.matchAll(/setRow\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
  check('qatorlar topildi', rows.length >= 12, rows.length);
  const ishsiz = rows.filter((r) =>
    !/attrs: ' (data-settings-page|data-tab-link|data-edit-profile|id)=/.test(r));
  check('ishlamaydigan qator yo‘q', ishsiz.length === 0,
    ishsiz.map((r) => (r.match(/title: "([^"]*)"/) || [])[1]));

  // Tungi rejim joyida almashadi.
  check('tungi rejim kaliti bor', fn.includes('id="darkSwitch"'));
  check('kalit ulangan', html.includes('var darkBtn = container.querySelector("#btnToggleDark");'));
  check('kalit mavzuni almashtiradi', html.includes('setTheme(now ? "light" : "dark");'));
  check('kalit uslubi bor', html.includes('.set-switch[aria-checked="true"]'));
  /* "Avtomatik" tanlovi "Ko'rinish" sahifasida qoladi: kalit
     faqat ikkitadan birini ko'rsata oladi. */
  check('"Ko‘rinish" sahifasi yo‘qolmagan', html.includes('theme: function(){ return { titleKey: "settings.themePageTitle"'));

  // Hech narsa yo'qolmagan.
  ['verify', 'notifications', 'language', 'feedback', 'about', 'terms', 'privacy'].forEach((pg) => {
    check(`"${pg}" sahifasiga yo‘l bor`, fn.includes(`data-settings-page="${pg}"`));
  });
  check('profilni ulashish qoldi', fn.includes('id="btnShareProfile"'));
  check('saqlanganlar qoldi', fn.includes('id="btnOpenSaved"'));
  check('chiqish/o‘chirish qoldi', fn.includes('renderDangerZone()'));

  /* Tildagi qator hozirgi tilni ko'rsatadi — "Til" degan quruq
     nom qaysi til tanlanganini aytmasdi. */
  check('til qatorida hozirgi til', html.includes('function currentLangLabel(){'));
  check('hozirgi til to‘g‘ri o‘qiladi', html.includes('}[currentLang] ||'),
    'oldin mavjud bo‘lmagan `lang` o‘zgaruvchisi o‘qilardi');
}

/* ============================================================
   4. Uch tilda ham yozuvlar bor
   ============================================================ */
flow('4. Tarjimalar');
{
  const keys = ['set.groupProfile', 'set.groupApp', 'set.groupLoads', 'set.groupHelp',
    'set.editProfile', 'set.editProfileSub', 'set.verifySub', 'set.shareSub',
    'set.notifSub', 'set.dark', 'set.darkSub', 'set.linkSub', 'set.linkGoogleSub',
    'set.myLoadsSub', 'set.savedSub', 'set.chatSub', 'set.supportSub',
    'set.feedbackSub', 'set.aboutSub'];
  keys.forEach((k) => {
    const n = (html.match(new RegExp(`"${k.replace('.', '\\.')}":`, 'g')) || []).length;
    check(`${k} — uch tilda`, n === 3, n);
  });

  /* Tasdiqlar soni to'rtta (telefon, shaxs, guvohnoma,
     transport) — izohda uchtasi sanalgan edi. */
  check('tasdiq izohi to‘rttasini sanaydi',
    html.includes('"set.verifySub": "Telefon, shaxs, guvohnoma va transport"'));
}

console.log(`\n${failed ? `${failed} ta xato, ` : ''}${passed} ta tekshiruv — ${failed ? 'XATO' : 'hammasi o\'tdi'}`);
process.exit(failed ? 1 : 0);
