/**
 * Yuk beruvchi o'z haydovchisiga qo'ng'iroq qila olishi.
 *
 *     node test/driverCall.test.mjs      (yoki npm test)
 *
 * MUAMMO NIMA EDI. Haydovchi yuk beruvchiga qo'ng'iroq qila
 * olardi (`?action=my-load` uning raqamini qaytaradi), teskarisi
 * esa yo'q edi: yuk sahifasi (`?action=detail`) hech kimning
 * telefonini qaytarmasdi. Ya'ni yuk beruvchi o'z yukini olgan
 * haydovchiga ilovadan qo'ng'iroq qila olmasdi.
 *
 * QAYSI RAQAM. Odamning ro'yxatdan o'tgan raqami — u ilovaga
 * aynan shu raqam bilan kirgan va u tasdiqlangan. Taklifdagi
 * nusxa eskirgan bo'lishi mumkin.
 *
 * KIMGA. Faqat yukning EGASIGA. Kod yukni ko'rgan har kimda
 * bor: agar raqam hammaga qaytsa, uni yig'ib olish mumkin
 * bo'lardi. Quyida shu alohida tekshiriladi.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

import { db, loadApi, makeRes, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const orderApi = await loadApi('api/order.js', 'drivercall_order');

const get = async (query) => {
  const res = makeRes();
  await orderApi({ method: 'GET', query, body: {}, headers: {} }, res);
  return res;
};

const OWNER = 'owner@example.com';
/* Harness Google tokenini to'g'ridan email deb oladi, shuning
   uchun ikkala tomon ham email bilan kiradi. */
const DRIVER = 'driver@example.com';

const seed = (over = {}) => {
  db.strings.clear(); db.sets.clear(); db.lists.clear();

  db.strings.set('profile:' + OWNER, JSON.stringify({
    displayName: 'Behruz', username: 'behruz', phone: '+998901112233',
  }));
  db.strings.set('profile:' + DRIVER, JSON.stringify({
    displayName: 'Alisher', username: 'alisher',
    // Ro'yxatdan o'tgan raqam — taklifdagi eski nusxadan boshqa.
    phone: '+998909998877',
    vehicleType: 'ISUZU', plateNumber: '01A777AA', verified: true,
  }));

  db.strings.set('order:YD1', JSON.stringify({
    code: 'YD1',
    ownerIdentity: OWNER,
    googleEmail: OWNER,
    name: 'Behruz Z.',
    phone: '+998901112233',
    fromCity: 'Toshkent', toCity: 'Samarqand',
    cargoType: 'CONSTRUCTION', weightKg: 3500, amount: 1500000,
    status: 'ON_THE_WAY',
    createdAt: Date.now(),
    driver: {
      name: 'Alisher N.', identity: DRIVER,
      // Ataylab eski/bo'sh: profildagi raqam ustun bo'lishi kerak.
      phone: '+998900000000',
      telegramUsername: 'alisher_old', verified: true,
    },
    ...over,
  }));
};

/* Google bilan kirgan odamni harness qanday taniydi —
   `googleIdToken` qiymati to'g'ridan email bo'ladi. */
const asOwner = { googleIdToken: OWNER };
const asDriver = { googleIdToken: DRIVER };

/* ---------------------------------------------------------- */
flow('Yuk egasi haydovchining aloqasini ko\'radi');
{
  seed();
  const res = await get({ action: 'detail', code: 'YD1', ...asOwner });
  check('sahifa ochiladi', res.statusCode === 200, res.payload);
  const dc = res.payload.driverContact;
  check('haydovchi aloqasi bor', Boolean(dc), res.payload);
  check('ismi', dc.name === 'Alisher N.', dc);
  check('RO\'YXATDAN O\'TGAN raqam', dc.phone === '+998909998877', dc);
  check('taklifdagi eski raqam emas', dc.phone !== '+998900000000', dc);
  check('profildagi username', dc.username === 'alisher', dc);
  check('mashina turi', dc.vehicleType === 'ISUZU', dc);
  check('davlat raqami', dc.plateNumber === '01A777AA', dc);
  check('tasdiqlangani', dc.verified === true, dc);
}

flow('Begona odam ko\'rmaydi');
{
  seed();
  const stranger = await get({ action: 'detail', code: 'YD1', googleIdToken: 'boshqa@example.com' });
  check('begonaga aloqa qaytmaydi', stranger.payload.driverContact === null, stranger.payload.driverContact);

  const anon = await get({ action: 'detail', code: 'YD1' });
  check('kirmagan odamga ham qaytmaydi', anon.payload.driverContact === null, anon.payload.driverContact);
  check('lekin sahifa baribir ochiladi', anon.statusCode === 200);

  const driverSide = await get({ action: 'detail', code: 'YD1', ...asDriver });
  check('haydovchining o\'ziga ham bu yerda qaytmaydi',
    driverSide.payload.driverContact === null, driverSide.payload.driverContact);

  /* Hech qaysi javobda raqam umuman bo'lmasligi kerak — biror
     boshqa maydon orqali ham sizib chiqmasin. */
  const flat = JSON.stringify(anon.payload);
  check('javobda telefon raqami umuman yo\'q',
    flat.indexOf('998909998877') === -1 && flat.indexOf('998901112233') === -1, flat.slice(0, 160));
}

flow('Haydovchi biriktirilmagan bo\'lsa');
{
  seed({ driver: null, status: 'NEW' });
  const res = await get({ action: 'detail', code: 'YD1', ...asOwner });
  check('aloqa qatori yo\'q', res.payload.driverContact === null, res.payload.driverContact);
  check('sahifa baribir ochiladi', res.statusCode === 200);
}

flow('Haydovchining profili yo\'q bo\'lsa');
{
  seed();
  db.strings.delete('profile:' + DRIVER);
  const res = await get({ action: 'detail', code: 'YD1', ...asOwner });
  const dc = res.payload.driverContact;
  check('yiqilmaydi', res.statusCode === 200 && Boolean(dc), res.payload);
  check('taklifdagi raqamga qaytadi', dc.phone === '+998900000000', dc);
  check('taklifdagi username ga qaytadi', dc.username === 'alisher_old', dc);
}

flow('Raqam umuman yo\'q bo\'lsa');
{
  seed({ driver: { name: 'Alisher N.', identity: DRIVER, phone: '', verified: false } });
  db.strings.set('profile:' + DRIVER, JSON.stringify({ username: 'alisher' }));
  const res = await get({ action: 'detail', code: 'YD1', ...asOwner });
  const dc = res.payload.driverContact;
  /* Sayt tomonida bo'sh raqamga tugma chizilmaydi — bu yerda
     faqat bo'sh satr qaytishini tasdiqlaymiz, null emas: sayt
     "username bor, telefon yo'q" holatini ajrata olishi kerak. */
  check('telefon bo\'sh satr', dc.phone === '', dc);
  check('username baribir bor', dc.username === 'alisher', dc);
}

flow('Haydovchi yuk beruvchining RO\'YXATDAN O\'TGAN raqamini ko\'radi');
{
  seed();
  /* `my-load` haydovchining faol yukini topishi uchun kalit. */
  db.strings.set(`driverLoad:${DRIVER}`, 'YD1');

  const res = await get({ action: 'my-load', ...asDriver });
  check('yuk topildi', res.statusCode === 200 && Boolean(res.payload.load), res.payload);
  const owner = res.payload.load.owner;
  check('profildagi raqam ustun', owner.phone === '+998901112233', owner);
  check('ismi profildan', owner.name === 'Behruz', owner);
}

t.done();
