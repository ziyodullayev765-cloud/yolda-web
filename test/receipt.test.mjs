/**
 * Yuk tashish kvitansiyasi.
 *
 *     node test/receipt.test.mjs      (yoki npm test)
 *
 * KVITANSIYA NIMA EMAS. Bu to'lov cheki emas. Ilovada to'lov
 * tizimi yo'q: pul tomonlar o'rtasida to'g'ridan o'tadi va
 * platforma hech narsa ushlamaydi. Shuning uchun quyida
 * "to'landi" degan hech qanday maydon yo'qligi ham alohida
 * tekshiriladi — bunday maydon paydo bo'lsa, qog'oz bo'lmagan
 * to'lovni bo'lgan qilib ko'rsatib qo'yardi.
 *
 * KIMGA BERILADI. Faqat shu tashuvning ikki tomoniga. Kodni
 * bilgan begona odam ko'rmasligi kerak: kvitansiyada ikkala
 * tomonning telefon raqami turadi.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

import { db, loadApi, makeRes, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const orderApi = await loadApi('api/order.js', 'receipt_order');

const get = async (query) => {
  const res = makeRes();
  await orderApi({ method: 'GET', query, body: {}, headers: {} }, res);
  return res;
};

const OWNER = 'ph:998901112233';
const DRIVER = 'ph:998909998877';

const seed = (over = {}) => {
  db.strings.clear(); db.sets.clear(); db.lists.clear();

  db.strings.set('profile:' + OWNER, JSON.stringify({
    displayName: 'Behruz Zokirov', username: 'behruz', phone: '+998901112233', role: 'OWNER',
  }));
  db.strings.set('profile:' + DRIVER, JSON.stringify({
    displayName: 'Alisher Normatov', username: 'alisher', phone: '+998909998877',
    role: 'DRIVER', verified: true, vehicleType: 'ISUZU', plateNumber: '01A777AA',
  }));

  db.strings.set('order:YD1', JSON.stringify({
    code: 'YD1',
    ownerIdentity: OWNER,
    name: 'Behruz Z.',
    phone: '+998901112233',
    fromCity: 'Toshkent', toCity: 'Samarqand',
    fromAddress: 'Sergeli tumani', toAddress: 'Markaziy omborxona',
    distanceKm: 310,
    cargoType: 'CONSTRUCTION',
    weightKg: 3500, volumeM3: 12,
    amount: 1500000, agreedAmount: 1750000,
    status: 'DELIVERED',
    createdAt: 1760000000000,
    deliveredAt: 1760300000000,
    updatedAt: 1760300000000,
    driver: {
      name: 'Alisher N.', identity: DRIVER, phone: '+998909998877', verified: true,
    },
    ...over,
  }));
};

/* ---------------------------------------------------------- */
flow('Yuk beruvchi kvitansiyani oladi');
{
  seed();
  const res = await get({ action: 'receipt', code: 'YD1', phoneToken: 'tok' });
  // phoneToken harness'da shaxsga aylanmaydi — kod+telefon yo'li bilan.
  const byPhone = await get({ action: 'receipt', code: 'YD1', phone: '+998901112233' });

  check('kod+telefon bilan ochiladi', byPhone.statusCode === 200, byPhone.payload);
  const r = byPhone.payload.receipt;
  check('roli — yuk beruvchi', byPhone.payload.role === 'owner');
  check('kod', r.code === 'YD1');
  check('yo\'nalish', r.fromCity === 'Toshkent' && r.toCity === 'Samarqand');
  check('manzillar', r.fromAddress === 'Sergeli tumani' && r.toAddress === 'Markaziy omborxona');
  check('masofa', r.distanceKm === 310);
  check('og\'irlik', r.weightKg === 3500);
  check('hajm', r.volumeM3 === 12);
  check('yuk turi nomi bor', typeof r.cargoLabel === 'string' && r.cargoLabel.length > 0, r.cargoLabel);
  check('yetkazilgan sana', r.deliveredAt === 1760300000000);
  void res;
}

flow('Summa — KELISHILGAN narx, e\'londagi emas');
{
  seed();
  const r = (await get({ action: 'receipt', code: 'YD1', phone: '+998901112233' })).payload.receipt;
  check('kelishilgan summa olinadi', r.amount === 1750000, r.amount);
  check('kelishilgani belgilangan', r.agreed === true);

  seed({ agreedAmount: 0 });
  const r2 = (await get({ action: 'receipt', code: 'YD1', phone: '+998901112233' })).payload.receipt;
  check('kelishuv bo\'lmasa e\'londagi narx', r2.amount === 1500000, r2.amount);
  check('kelishilmagani belgilangan', r2.agreed === false);
}

flow('Platforma pulga tegmasligi ochiq yozilgan');
{
  seed();
  const r = (await get({ action: 'receipt', code: 'YD1', phone: '+998901112233' })).payload.receipt;
  check('platforma orqali o\'tmagani aytilgan', r.settlement.throughPlatform === false, r.settlement);
  check('platforma haqi nol', r.settlement.platformFee === 0, r.settlement);

  /* Eng muhim tasdiq: "to'landi", "to'lov usuli", "karta" kabi
     maydonlar BO'LMASLIGI kerak. Ular paydo bo'lsa, kvitansiya
     bo'lmagan to'lovni bo'lgan qilib ko'rsatardi. */
  const flat = JSON.stringify(r).toLowerCase();
  const banned = ['paid', 'paymentmethod', 'paymentstatus', 'card', 'uzcard', 'humo', 'transactionid'];
  banned.forEach((w) => check('"' + w + '" maydoni yo\'q', flat.indexOf(w) === -1, flat.slice(0, 120)));
}

flow('Ikkala tomon ham ko\'rinadi');
{
  seed();
  const r = (await get({ action: 'receipt', code: 'YD1', phone: '+998901112233' })).payload.receipt;
  check('yuk beruvchi ismi profildan', r.owner.name === 'Behruz Zokirov', r.owner);
  check('yuk beruvchi telefoni', r.owner.phone === '+998901112233');
  check('haydovchi ismi', r.driver.name === 'Alisher N.', r.driver);
  check('haydovchi telefoni', r.driver.phone === '+998909998877');
  check('tasdiqlangani', r.driver.verified === true);
  check('mashina turi profildan', r.driver.vehicleType === 'ISUZU');
  check('davlat raqami profildan', r.driver.plateNumber === '01A777AA');
}

flow('Yetkazilmaganiga kvitansiya yo\'q');
{
  for (const status of ['NEW', 'ON_THE_WAY', 'CANCELLED']) {
    seed({ status });
    const res = await get({ action: 'receipt', code: 'YD1', phone: '+998901112233' });
    check(status + ' holatida berilmaydi', res.statusCode === 409, res.statusCode);
    check(status + ' holatida ma\'lumot ham chiqmaydi', !res.payload.receipt);
  }
}

flow('Begona odam ko\'ra olmaydi');
{
  seed();
  const noAuth = await get({ action: 'receipt', code: 'YD1' });
  check('shaxssiz so\'rov rad etiladi', noAuth.statusCode === 404, noAuth.statusCode);

  const wrongPhone = await get({ action: 'receipt', code: 'YD1', phone: '+998900000000' });
  check('boshqa telefon rad etiladi', wrongPhone.statusCode === 404, wrongPhone.statusCode);
  /* "Ruxsat yo'q" emas, aynan "topilmadi": aks holda kod
     to'g'riligini begona ham bilib olardi. */
  check('xato xabari kodni oshkor qilmaydi',
    !/ruxsat/i.test(String(wrongPhone.payload.error || '')), wrongPhone.payload);

  const noCode = await get({ action: 'receipt' });
  check('kodsiz so\'rov rad etiladi', noCode.statusCode === 400, noCode.statusCode);

  const missing = await get({ action: 'receipt', code: 'YOQ', phone: '+998901112233' });
  check('mavjud bo\'lmagan buyurtma', missing.statusCode === 404, missing.statusCode);
}

flow('Taxmin yozilmaydi');
{
  seed({ distanceKm: 0, volumeM3: null, fromAddress: '', toAddress: '' });
  const r = (await get({ action: 'receipt', code: 'YD1', phone: '+998901112233' })).payload.receipt;
  check('masofa noma\'lum bo\'lsa null', r.distanceKm === null, r.distanceKm);
  check('hajm noma\'lum bo\'lsa null', r.volumeM3 === null, r.volumeM3);
  check('manzil yo\'q bo\'lsa bo\'sh', r.fromAddress === '' && r.toAddress === '');
}

flow('Haydovchisiz yakunlangan buyurtma');
{
  seed({ driver: null });
  const res = await get({ action: 'receipt', code: 'YD1', phone: '+998901112233' });
  check('yiqilmaydi', res.statusCode === 200, res.statusCode);
  check('haydovchi null', res.payload.receipt.driver === null);
}

t.done();
