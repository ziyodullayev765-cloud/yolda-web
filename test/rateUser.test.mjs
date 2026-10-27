/**
 * Odamga baho qoldirish (?action=rate-user).
 *
 *     node test/rateUser.test.mjs      (yoki npm test)
 *
 * Baho endi OCHIQ: xohlagan odam bera oladi. Ilgari u faqat
 * yetkazilgan buyurtmaning ikki tomoni o'rtasida bo'lardi.
 *
 * Shuning uchun qolgan to'siqlar ayniqsa muhim — ularsiz raqam
 * hech narsani anglatmay qoladi:
 *
 *   1. KIRGAN bo'lish shart. Nomsiz baho shunchaki raqam: kim
 *      qo'yganini bilib bo'lmaydi, demak to'xtatib ham bo'lmaydi.
 *   2. BIR ODAM BIR MARTA. Ikkinchisi eskisining O'RNIGA
 *      yoziladi — aks holda bitta odam birovning bahosini
 *      istagancha ko'tarib yoki tushirib yuborardi.
 *   3. O'ZINI BAHOLAY OLMAYDI.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

import { db, loadApi, makeRes, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const profile = await loadApi('api/profile.js', 'rateuser_profile');

const post = (body) => {
  const res = makeRes();
  return profile({ method: 'POST', query: { action: 'rate-user' }, body: body || {}, headers: {} }, res)
    .then(() => res);
};

const MEN = 'me@example.com';
const BOSHQA = 'other@example.com';
const UCHINCHI = 'third@example.com';

/** Baholanadigan odamni tayyorlaydi. */
const seed = () => {
  db.strings.clear();
  db.lists.clear();
  db.strings.set('username:behruz', BOSHQA);
  db.strings.set(`profile:${BOSHQA}`, JSON.stringify({ username: 'behruz', displayName: 'Behruz' }));
  db.strings.set('username:aziz', MEN);
  db.strings.set(`profile:${MEN}`, JSON.stringify({ username: 'aziz', displayName: 'Aziz' }));
};

const baho = async (who) => {
  const raw = db.strings.get(`profile:${who}`);
  const p = raw ? JSON.parse(raw) : {};
  return { count: p.ownerRatingCount || 0, sum: p.ownerRatingSum || 0 };
};

/* ---------------------------------------------------------- */
flow('Xohlagan odam baho bera oladi');
{
  seed();
  const res = await post({ googleIdToken: MEN, username: 'behruz', stars: 5, comment: 'Yaxshi hamkor' });
  check('qabul qilindi', res.statusCode === 200, res.payload);

  const b = await baho(BOSHQA);
  check('BAHO YOZILDI', b.count === 1 && b.sum === 5, b);
  check('javobda o\'rtacha keladi', res.payload.rating && res.payload.rating.avg === 5, res.payload.rating);
  check('nechta bahodan ekani ham', res.payload.rating.count === 1, res.payload.rating);
  /* Izoh bo'lsa sharhlar ro'yxatiga ham tushadi. */
  check('izoh sharhlarga qo\'shildi', (db.lists.get(`reviews:${BOSHQA}`) || []).length === 1,
    db.lists.get(`reviews:${BOSHQA}`));
}

flow('Kirmagan odam baho bera olmaydi');
{
  seed();
  const res = await post({ username: 'behruz', stars: 5 });
  check('rad etildi', res.statusCode === 401, res.statusCode);
  check('hech narsa yozilmadi', (await baho(BOSHQA)).count === 0, await baho(BOSHQA));
}

flow('O\'ZINI BAHOLAY OLMAYDI');
{
  seed();
  const res = await post({ googleIdToken: MEN, username: 'aziz', stars: 5 });
  check('rad etildi', res.statusCode === 400, res.statusCode);
  check('o\'z bahosi oshmadi', (await baho(MEN)).count === 0, await baho(MEN));
}

flow('BIR ODAM BIR MARTA — ikkinchisi o\'rniga yoziladi');
{
  seed();
  await post({ googleIdToken: MEN, username: 'behruz', stars: 5 });
  const bir = await baho(BOSHQA);
  check('birinchisi yozildi', bir.count === 1 && bir.sum === 5, bir);

  const res = await post({ googleIdToken: MEN, username: 'behruz', stars: 1 });
  check('ikkinchisi ham qabul qilindi', res.statusCode === 200, res.payload);
  check('almashtirilgani aytildi', res.payload.replaced === true, res.payload);

  const ikki = await baho(BOSHQA);
  check('SANOQ OSHMADI', ikki.count === 1, ikki);
  check('YIG\'INDI ALMASHDI, QO\'SHILMADI', ikki.sum === 1, ikki);

  /* Uchinchi odam baho bersa — u ALOHIDA sanaladi. */
  await post({ googleIdToken: UCHINCHI, username: 'behruz', stars: 5 });
  const uch = await baho(BOSHQA);
  check('boshqa odamniki alohida qo\'shiladi', uch.count === 2 && uch.sum === 6, uch);
}

flow('Noto\'g\'ri ma\'lumot o\'tmaydi');
{
  seed();
  const yoq = await post({ googleIdToken: MEN, username: 'yoqodam', stars: 5 });
  check('yo\'q odamga baho berilmaydi', yoq.statusCode === 404, yoq.statusCode);

  const bosh = await post({ googleIdToken: MEN, stars: 5 });
  check('kimni baholash aytilmasa rad etiladi', bosh.statusCode === 400, bosh.statusCode);

  for (const n of [0, 6, -1, 'besh', null]) {
    const r = await post({ googleIdToken: MEN, username: 'behruz', stars: n });
    check('yulduz ' + JSON.stringify(n) + ' qabul qilinmaydi', r.statusCode === 400, r.statusCode);
  }
  check('xato urinishlardan keyin ham toza', (await baho(BOSHQA)).count === 0, await baho(BOSHQA));
}

flow('Izohsiz baho ham ishlaydi');
{
  seed();
  const res = await post({ googleIdToken: MEN, username: 'behruz', stars: 4 });
  check('qabul qilindi', res.statusCode === 200, res.payload);
  check('raqamlar yangilandi', (await baho(BOSHQA)).sum === 4, await baho(BOSHQA));
  /* Bo'sh sharh ro'yxatga yozilmaydi: o'qishga narsa bermaydi. */
  check('bo\'sh sharh ro\'yxatga tushmadi', !db.lists.has(`reviews:${BOSHQA}`),
    db.lists.get(`reviews:${BOSHQA}`));
}

t.done();
