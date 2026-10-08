/**
 * Tashuv daftari — haydovchining hisob-kitobi.
 *
 *     node test/earnings.test.mjs      (yoki npm test)
 *
 * NEGA ALOHIDA DAFTAR. Yetkazilgan yuklarni buyurtmalar
 * ro'yxatidan (`order_codes`) sanasa ham bo'lardi, lekin u
 * ro'yxat oxirgi 300 ta bilan cheklangan: ilovada ishlar
 * ko'paygan sari eski tashuvlar undan tushib qolardi va hisobot
 * jimgina kamayib borardi. Hisob-kitobda bu eng yomon xato —
 * noto'g'ri raqam ham ishonchli ko'rinadi.
 *
 * Shuning uchun quyida ikki narsa alohida tasdiqlanadi:
 *
 *   - yuk YETKAZILGANDA daftarga yozuv tushishi;
 *   - daftar buyurtmalar ro'yxatiga BOG'LIQ EMASligi — ro'yxat
 *     tozalansa ham hisobot o'zgarmasligi.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
process.env.TELEGRAM_BOT_USERNAME = 'yoldatestbot';

import { db, loadApi, loadLib, get, post, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const order = await loadApi('api/order.js', 'order_earnings');
const earnings = await loadLib('earnings.js');

/* Harness Google tokeninfo'ni o'rnida javob beradi: token matni =
   pochta manzili, ya'ni shaxs ham o'sha. */
const DRIVER = 'driver1@example.com';
const OWNER = 'shipper@example.com';
const AS_DRIVER = { googleIdToken: DRIVER };

/** Yetkazilgan buyurtmani to'g'ridan bazaga qo'yadi. */
const seedDelivered = (code, from, to, amount, km, deliveredAt) => {
  db.strings.set(`order:${code}`, JSON.stringify({
    code, fromCity: from, toCity: to, amount, agreedAmount: amount, distanceKm: km,
    status: 'DELIVERED', deliveredAt, ownerIdentity: OWNER,
    driver: { identity: DRIVER, name: 'Bekzod' },
  }));
  const list = db.lists.get('order_codes') || [];
  list.unshift(code);
  db.lists.set('order_codes', list);
};

const ledger = () =>
  (db.lists.get(`earnings:${DRIVER}`) || []).map((x) => JSON.parse(x));

const fresh = () => { db.reset(); };

/* ============================================================
   1. Hisobot yasash — sof hisob
   ============================================================ */
flow('1. Hisobot yasash');
{
  const OCT = Date.UTC(2026, 9, 10);
  const SEP = Date.UTC(2026, 8, 5);
  const entries = [
    { code: 'A', fromCity: 'Toshkent', toCity: 'Samarqand', amount: 900000, distanceKm: 300, deliveredAt: OCT },
    { code: 'B', fromCity: 'Toshkent', toCity: 'Samarqand', amount: 100000, distanceKm: 300, deliveredAt: OCT },
    { code: 'C', fromCity: 'Buxoro', toCity: 'Nukus', amount: 500000, distanceKm: 700, deliveredAt: SEP },
  ];
  const r = earnings.summarise(entries, OCT);

  check('shu oy summasi', r.thisMonth.amount === 1000000, r.thisMonth);
  check('shu oy soni', r.thisMonth.count === 2, r.thisMonth);
  check('jami summa', r.totals.amount === 1500000, r.totals);
  check('jami tashuv', r.totals.count === 3, r.totals);
  check('jami masofa', r.totals.distanceKm === 1300, r.totals);

  check('ikki oy', r.months.length === 2, r.months.map((m) => m.key));
  check('yangi oy tepada', r.months[0].key === '2026-10', r.months[0]);
  check('eski oy summasi', r.months[1].amount === 500000, r.months[1]);

  check('eng ko\'p borilgan manzil', r.topCities[0].city === 'Samarqand', r.topCities);
  check('manzil soni', r.topCities[0].count === 2, r.topCities[0]);
  check('ikkinchi manzil', r.topCities[1].city === 'Nukus', r.topCities);

  /* Tashuv bo'lmagan oyda ham "shu oy" ko'rinishi kerak: bo'sh
     ro'yxat emas, aniq nol. */
  const bosh = earnings.summarise([], Date.UTC(2026, 10, 1));
  check('bo\'sh oyda ham shu oy bor', bosh.thisMonth && bosh.thisMonth.count === 0, bosh.thisMonth);
  check('bo\'sh oyda jami nol', bosh.totals.amount === 0 && bosh.totals.count === 0, bosh.totals);
  check('bo\'sh oyda manzil yo\'q', bosh.topCities.length === 0);

  // Buzuq kiritmalar yiqitmasin.
  check('null yiqitmaydi', earnings.summarise(null).totals.count === 0);
  check('summasiz yozuv nolga tushadi',
    earnings.summarise([{ code: 'X', deliveredAt: OCT }], OCT).totals.amount === 0);
}

/* ============================================================
   2. Yuk yetkazilganda daftarga yoziladi
   ============================================================ */
flow('2. Yetkazilganda daftarga yoziladi');
{
  fresh();
  db.strings.set(`order:YL-1`, JSON.stringify({
    code: 'YL-1', fromCity: 'Toshkent', toCity: 'Buxoro', amount: 700000,
    agreedAmount: 850000, distanceKm: 580, status: 'ON_THE_WAY',
    ownerIdentity: OWNER, driver: { identity: DRIVER, name: 'Bekzod' },
  }));
  db.strings.set(`activeLoad:${DRIVER}`, 'YL-1');

  const res = await post(order, 'advance', { code: 'YL-1', ...AS_DRIVER });
  check('yetkazildi', res.payload && res.payload.status === 'DELIVERED', res.payload);

  const L = ledger();
  check('daftarga bitta yozuv tushdi', L.length === 1, L);
  check('kelishilgan narx yozildi', L[0] && L[0].amount === 850000, L[0]);
  check('yo\'nalish yozildi', L[0] && L[0].toCity === 'Buxoro', L[0]);
  check('masofa yozildi', L[0] && L[0].distanceKm === 580, L[0]);
  check('sana yozildi', L[0] && L[0].deliveredAt > 0, L[0]);
}

/* ============================================================
   3. Endpoint
   ============================================================ */
flow('3. Hisobot endpointi');
{
  fresh();
  const now = Date.now();
  seedDelivered('D-1', 'Toshkent', 'Samarqand', 900000, 300, now - 2 * 86400000);
  seedDelivered('D-2', 'Toshkent', 'Samarqand', 600000, 300, now - 5 * 86400000);
  seedDelivered('D-3', 'Buxoro', 'Nukus', 400000, 700, now - 9 * 86400000);
  // Boshqa haydovchining yuki — hisobga kirmasligi kerak.
  db.strings.set('order:D-9', JSON.stringify({
    code: 'D-9', fromCity: 'Xiva', toCity: 'Termiz', amount: 999999, distanceKm: 900,
    status: 'DELIVERED', deliveredAt: now, driver: { identity: 'tg:999', name: 'Boshqa' },
  }));
  (db.lists.get('order_codes') || []).unshift('D-9');

  const anon = await get(order, { action: 'earnings' });
  check('kirmasdan ko\'rib bo\'lmaydi', anon.statusCode === 401, anon.statusCode);

  const r1 = await get(order, { action: 'earnings', ...AS_DRIVER });
  check('javob keldi', r1.payload && r1.payload.ok, r1.payload);
  check('uchta tashuv', r1.payload.totals.count === 3, r1.payload.totals);
  check('jami summa', r1.payload.totals.amount === 1900000, r1.payload.totals);
  check('boshqaning yuki kirmadi',
    !(r1.payload.entries || []).some((e) => e.code === 'D-9'),
    (r1.payload.entries || []).map((e) => e.code));
  check('hamma tashuvlar ro\'yxati', (r1.payload.entries || []).length === 3);
  check('yangisi tepada', r1.payload.entries[0].code === 'D-1', r1.payload.entries.map((e) => e.code));
  check('eng ko\'p manzil', r1.payload.topCities[0].city === 'Samarqand', r1.payload.topCities);

  /* ENG MUHIMI: endi daftar to'ldirilgan. Buyurtmalar ro'yxati
     tozalansa ham (haqiqatda u oxirgi 300 ta bilan cheklangan)
     hisobot o'zgarmasligi kerak. */
  db.lists.set('order_codes', []);
  db.keysLike('order:').forEach((k) => db.strings.delete(k));

  const r2 = await get(order, { action: 'earnings', ...AS_DRIVER });
  check('buyurtmalar o\'chsa ham hisobot turadi', r2.payload.totals.count === 3, r2.payload.totals);
  check('summa ham o\'zgarmadi', r2.payload.totals.amount === 1900000, r2.payload.totals);

  // Ikkinchi marta to'ldirishga urinmaydi.
  check('bir marta to\'ldiriladi', db.strings.get(`earnings_seeded:${DRIVER}`) === '1');
}

/* ============================================================
   4. Eski tashuvi yo'q odam
   ============================================================ */
flow('4. Hali tashuvi yo\'q odam');
{
  fresh();
  const r = await get(order, { action: 'earnings', ...AS_DRIVER });
  check('javob keladi', r.payload && r.payload.ok, r.payload);
  check('ro\'yxat bo\'sh', (r.payload.entries || []).length === 0);
  check('jami nol', r.payload.totals.count === 0 && r.payload.totals.amount === 0, r.payload.totals);
  check('shu oy bor', Boolean(r.payload.thisMonth), r.payload.thisMonth);
}

t.done(4);
