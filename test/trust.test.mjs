/**
 * Ishonch darajasi.
 *
 *     node test/trust.test.mjs      (yoki npm test)
 *
 * ENG MUHIM QOIDA. Daraja — "bu odam halol" degan kafolat EMAS,
 * balki TEKSHIRIB BO'LADIGAN narsalarning yig'indisi. Shuning
 * uchun bu yerda ikki xil narsa sinaladi:
 *
 *   1. hisobning o'zi to'g'rimi;
 *   2. va, undan ham muhimi, HECH NARSA O'YLAB TOPILMAYDIMI.
 *      Ma'lumot bo'lmasa, o'rniga "namuna" qiymat qo'yilmasligi
 *      kerak: bo'sh profil bo'sh ko'rinsin.
 *
 * Yana bir shart: daraja PROFILNING O'ZIDAN hisoblanadi, bazada
 * alohida saqlanmaydi. Shuning uchun u eskirib qolmaydi va
 * "qachon qayta hisoblash kerak" degan savol tug'ilmaydi.
 */
import { trustOf, LEVEL_LABELS, MIN_RATINGS, DELIVERY_FULL } from '../lib/trust.js';

const fails = [];
let pass = 0;
const check = (name, ok, extra) => {
  if (ok) { pass += 1; return; }
  fails.push(name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
};
const flow = (name) => console.log('\n── ' + name);

const ver = (...kinds) => {
  const out = {};
  kinds.forEach((k) => { out[k] = { status: 'VERIFIED', at: 1, reviewedAt: 1, reason: '' }; });
  return out;
};
const item = (tr, key) => tr.items.find((x) => x.key === key);

/* ---------------------------------------------------------- */
flow('Bo\'sh profil');
{
  const tr = trustOf({});
  check('daraja — Yangi', tr.level === 'NEW', tr.level);
  check('ball nol', tr.score === 0, tr.score);
  check('jami 100', tr.max === 100, tr.max);
  check('nomi o‘zbekcha', tr.label === LEVEL_LABELS.NEW, tr.label);
  check('izohi bor', Boolean(tr.note));
  /* HECH NARSA O'YLAB TOPILMAYDI. */
  check('hamma band "yo‘q"', tr.items.every((x) => !x.done), tr.items);
  check('YETKAZISH SONI TO‘QILMAYDI',
    item(tr, 'DELIVERED').detail === 'Hali yo‘q', item(tr, 'DELIVERED'));
  check('BAHO TO‘QILMAYDI',
    item(tr, 'RATING').detail === 'Hali yo‘q', item(tr, 'RATING'));
  check('a‘zolik sanasi yo‘q bo‘lsa null', tr.joinedAt === null, tr.joinedAt);
}

flow('Hech narsa noto\'g\'ri turdagi ma\'lumotdan buzilmaydi');
{
  /* Baza buzilgan yoki eski bo'lsa ham daraja chiqishi kerak:
     profil ochilmay qolishi bu yerdagi eng yomon natija. */
  const yomon = [null, undefined, 'matn', 42, [],
    { deliveredCount: 'ko‘p', ratingCount: -3, ratingSum: NaN, verifications: 'ha' }];
  let hammasi = true;
  yomon.forEach((p) => {
    try {
      const tr = trustOf(p);
      if (!tr || !tr.level || tr.score < 0 || tr.score > tr.max) hammasi = false;
    } catch { hammasi = false; }
  });
  check('buzuq yozuv ham daraja beradi', hammasi);
  check('manfiy sanoq ballga aylanmaydi',
    trustOf({ deliveredCount: -50 }).score === 0,
    trustOf({ deliveredCount: -50 }).score);
}

flow('Tasdiqlar');
{
  check('telefon — 20',
    trustOf({ verifications: ver('PHONE') }).score === 20);
  check('shaxs hujjati — 25 (eng og‘iri)',
    trustOf({ verifications: ver('IDENTITY') }).score === 25);
  check('guvohnoma — 10',
    trustOf({ verifications: ver('LICENSE') }).score === 10);
  check('texnik pasport — 10',
    trustOf({ verifications: ver('TRANSPORT') }).score === 10);

  /* FAQAT TASDIQLANGANI SANALADI. Kutilayotgan yoki rad etilgan
     so'rov ball bermaydi — aks holda "so'rov yuboraman" degan
     bitta harakat ishonch yasab berardi. */
  const kutmoqda = trustOf({ verifications: { PHONE: { status: 'PENDING' } } });
  check('KUTILAYOTGANI BALL BERMAYDI', kutmoqda.score === 0, kutmoqda.score);
  const rad = trustOf({ verifications: { IDENTITY: { status: 'REJECTED' } } });
  check('RAD ETILGANI BALL BERMAYDI', rad.score === 0, rad.score);

  /* Eski yozuvlar: `verified: true` doim "shaxsi tekshirilgan"
     degani bo'lgan (lib/verification.js). Shu odamlar bor
     ballidan ayrilmasligi kerak. */
  const eski = trustOf({ verified: true });
  check('eski `verified` shaxs tasdig‘i deb o‘qiladi',
    item(eski, 'IDENTITY').done && eski.score === 25, eski.score);
}

flow('Yetkazilgan yuklar');
{
  check('bittasi ham sanaladi', trustOf({ deliveredCount: 1 }).score === 2,
    trustOf({ deliveredCount: 1 }).score);
  check('yarmi — yarim ball',
    trustOf({ deliveredCount: DELIVERY_FULL / 2 }).score === 10);
  check('to‘lasi — 20', trustOf({ deliveredCount: DELIVERY_FULL }).score === 20);
  /* 100 ta yuk 10 tadan "o'n barobar ishonchli" degani emas. */
  check('CHEGARADAN KEYIN OSHMAYDI',
    trustOf({ deliveredCount: 500 }).score === 20,
    trustOf({ deliveredCount: 500 }).score);
  check('aniq soni ko‘rsatiladi',
    item(trustOf({ deliveredCount: 14 }), 'DELIVERED').detail === '14 ta');
}

flow('Baho');
{
  /* Bitta beshlik hech narsa demaydi: o'rtacha uchun kamida
     MIN_RATINGS ta ovoz kerak. */
  const bitta = trustOf({ ratingCount: 1, ratingSum: 5 });
  check('BITTA BAHO BALL BERMAYDI', bitta.score === 0, bitta.score);
  check('lekin yashirilmaydi ham',
    /1 ta baho/.test(item(bitta, 'RATING').detail), item(bitta, 'RATING').detail);

  const uchta = trustOf({ ratingCount: MIN_RATINGS, ratingSum: 5 * MIN_RATINGS });
  check('uchta beshlik — to‘liq 15', uchta.score === 15, uchta.score);
  check('o‘rtacha ko‘rsatiladi',
    item(uchta, 'RATING').detail === '3 ta bahodan 5', item(uchta, 'RATING').detail);

  const past = trustOf({ ratingCount: 4, ratingSum: 8 });   // 2,0
  check('past baho — kam ball', past.score === 6, past.score);
  check('kasr vergul bilan',
    item(past, 'RATING').detail === '4 ta bahodan 2', item(past, 'RATING').detail);

  const kasr = trustOf({ ratingCount: 4, ratingSum: 19 });  // 4,75 → 4,8
  check('kasr o‘zbekcha yoziladi',
    /4,8/.test(item(kasr, 'RATING').detail), item(kasr, 'RATING').detail);

  /* Ikkala tomondagi baho qo'shiladi: odam bir yukda haydovchi,
     boshqasida yuk beruvchi bo'lishi mumkin. */
  const ikki = trustOf({ ratingCount: 2, ratingSum: 10, ownerRatingCount: 2, ownerRatingSum: 8 });
  check('ikkala tomon qo‘shiladi',
    /4 ta bahodan 4,5/.test(item(ikki, 'RATING').detail), item(ikki, 'RATING').detail);
}

flow('Darajalar');
{
  const daraja = (p) => trustOf(p).level;
  check('bo‘sh — Yangi', daraja({}) === 'NEW');
  check('faqat telefon — Boshlang‘ich',
    daraja({ verifications: ver('PHONE') }) === 'BASIC');
  check('telefon + pasport — Ishonchli (45)',
    daraja({ verifications: ver('PHONE', 'IDENTITY') }) === 'TRUSTED');

  /* "Tasdiqlangan" — eng baland so'z. U hujjatlarsiz yoki ish
     tarixisiz chiqmasligi kerak. */
  const tolaHujjat = { verifications: ver('PHONE', 'IDENTITY', 'LICENSE', 'TRANSPORT') };
  check('faqat hujjatlar — 65, hali Ishonchli',
    trustOf(tolaHujjat).score === 65 && daraja(tolaHujjat) === 'TRUSTED',
    trustOf(tolaHujjat).score);
  check('hujjat + ish tarixi — Tasdiqlangan',
    daraja({ ...tolaHujjat, deliveredCount: 5 }) === 'PROVEN');

  const hammasi = trustOf({
    ...tolaHujjat, deliveredCount: 30,
    ratingCount: 9, ratingSum: 45,
  });
  check('hammasi bo‘lsa — 100', hammasi.score === 100, hammasi.score);
  check('va Tasdiqlangan', hammasi.level === 'PROVEN');
  check('balldan oshib ketmaydi', hammasi.score <= hammasi.max);
}

flow('Cheklangan hisob');
{
  /* Bu admin chiqargan QAROR va u hamma narsadan ustun turadi:
     hujjatlari to'liq bo'lsa ham daraja hisoblanmaydi. */
  const tr = trustOf({
    verifications: ver('PHONE', 'IDENTITY', 'LICENSE', 'TRANSPORT'),
    deliveredCount: 50, ratingCount: 20, ratingSum: 100,
  }, { banned: true });
  check('daraja — Cheklangan', tr.level === 'BANNED', tr.level);
  check('BALL NOLGA TUSHADI', tr.score === 0, tr.score);
  check('ro‘yxat ko‘rsatilmaydi', tr.items.length === 0, tr.items);
  check('sababi aytiladi', /cheklangan/i.test(tr.note), tr.note);
}

flow('Ro\'yxat to\'liq — yo\'q narsa ham ko\'rinadi');
{
  /* Ilgari ommaviy profilda faqat BOR tasdiqlar ro'yxati
     chiqardi: pasporti tasdiqlanmagan odam bilan tasdiqlangan
     odam deyarli bir xil ko'rinardi. Endi ro'yxat doim to'liq. */
  const tr = trustOf({ verifications: ver('PHONE') });
  check('oltita band bor', tr.items.length === 6, tr.items.length);
  check('tasdiqlangani belgilangan', item(tr, 'PHONE').done);
  check('TASDIQLANMAGANI HAM QATORDA TURADI',
    tr.items.some((x) => !x.done), tr.items.map((x) => x.key));
  check('har birida sarlavha bor', tr.items.every((x) => Boolean(x.label)));
  check('har birida eng ko‘pi bor', tr.items.every((x) => x.max > 0));
  check('ballar eng ko‘pidan oshmaydi', tr.items.every((x) => x.points <= x.max));
}

flow('A\'zolik muddati');
{
  /* Ballga kirmaydi — uzoq turish o'zi ishonch bermaydi. Lekin
     ko'rsatiladi: odam o'zi hisobga olsin. */
  const eski = trustOf({ joinedAt: 1600000000000 });
  const yangi = trustOf({ joinedAt: Date.now() });
  check('muddat ballga ta’sir qilmaydi', eski.score === yangi.score && eski.score === 0);
  check('lekin qaytariladi', eski.joinedAt === 1600000000000, eski.joinedAt);
}

/* ============================================================
   EKRANDAGI TOMONI
   ------------------------------------------------------------
   Daraja IKKI joyda ko'rinadi — ilovadagi ommaviy profilda va
   admin paneldagi foydalanuvchi sahifasida. Ikkalasi ham
   SERVERDAGI hisobni ko'rsatishi kerak: panel yoki ilova uni
   qaytadan hisoblasa, bir kuni ular albatta ajralib ketardi.

   Ikkalasining ham brauzerdagi haqiqiy xatti-harakati alohida
   tekshirilgan (scratchpad/trustui.js — 25 ta, trustadmin.js —
   11 ta). Bu yerda manbaning o'zi qo'riqlanadi.
   ============================================================ */
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const profileApi = readFileSync(new URL('../api/profile.js', import.meta.url), 'utf8');
const adminApi = readFileSync(new URL('../api/admin-data.js', import.meta.url), 'utf8');

flow('Server beradi, mijoz hisoblamaydi');
{
  check('ommaviy profil darajani qaytaradi',
    /trustOf\(profile, \{ banned \}\)/.test(profileApi) && /\n\s*trust,/.test(profileApi));
  check('cheklangani serverda tekshiriladi',
    /kvSismember\('banned'/.test(profileApi));
  check('admin ro‘yxati ham o‘sha hisobdan',
    /trust: trustOf\(profile, \{ banned \}\)/.test(adminApi));

  /* ENG MUHIMI: ikkala ekran ham o'z hisobini yuritmaydi. */
  check('ILOVA O‘ZI HISOBLAMAYDI',
    !/function trustOf/.test(app) && !/TRUST_WEIGHTS|trustScore\s*=/.test(app));
  check('PANEL HAM HISOBLAMAYDI',
    !/function trustOf/.test(admin) && !/TRUST_WEIGHTS|trustScore\s*=/.test(admin));
}

flow('Ilovadagi ko\'rinish');
{
  check('chizadigan funksiya bor', /function trustHtml\(tr\)/.test(app));
  check('ommaviy profilga qo‘shilgan', /\+ trustHtml\(trust\)/.test(app));
  check('javobdan olinadi', /publicProfileHtml\(res\.body\.profile, res\.body\.reviews, res\.body\.trust\)/.test(app));

  const fn = (app.split('function trustHtml(tr)')[1] || '').slice(0, 2600);
  /* Daraja YAKKA ko'rsatilmaydi — tarkibi doim yonida. */
  check('TARKIBI RO‘YXAT BO‘LIB CHIQADI', /trust-list/.test(fn));
  check('tasdiqlanmagani ham qatorda', /iconCircle/.test(fn));
  check('aniq fakt ko‘rsatiladi', /it\.detail/.test(fn));
  /* ENG MUHIM QATOR: daraja kafolat emas. */
  check('KAFOLAT EMASLIGI AYTILGAN', /kafolat emas/.test(fn));
  check('cheklangan hisob alohida', /BANNED/.test(fn));

  check('eski "Tasdiqlangan" ro‘yxati olib tashlandi',
    !/publicVerifyHtml/.test(app));
  check('uslublari bor',
    /\.trust-badge\{/.test(app) && /\.trust-list li\{/.test(app));
  check('qorong‘i mavzu uchun ham',
    /data-theme="dark"\]\s*\.trust-badge\.lv-PROVEN\{/.test(app));
  check('bo‘sh doira belgisi qo‘shildi', /<symbol id="iconCircle"/.test(app));
}

flow('Admin paneldagi ko\'rinish');
{
  check('jadvalda ustun bor', /key:"trust", label:"Ishonch"/.test(admin));
  check('saralash ball bo‘yicha', /u\.trust && u\.trust\.score/.test(admin));
  check('kartochka funksiyasi bor', /function trustCard\(tr\)/.test(admin));
  check('foydalanuvchi sahifasiga qo‘shilgan',
    /var trust = trustCard\(user\.trust\)/.test(admin));
  check('kartochka sahifada chizilyapti',
    /\+ trust \+ docs \+ activity/.test(admin));

  const fn = (admin.split('function trustCard(tr)')[1] || '').slice(0, 1800);
  check('to‘liq tarkibi ko‘rsatiladi', /tr\.items/.test(fn));
  check('aniq fakt ham', /it\.detail/.test(fn));
  check('cheklangan hisobda ro‘yxat yo‘q', /BANNED/.test(fn));
}

/* ---------------------------------------------------------- */
if (fails.length) {
  console.log('\n' + fails.length + ' ta xato:');
  fails.forEach((f) => console.log('  XATO ' + f));
  console.log('\n==== ' + pass + ' passed, ' + fails.length + ' failed ====');
  process.exit(1);
}
console.log('\n==== ' + pass + ' passed, 0 failed ====');
