/**
 * To'lovlar: hisob, Payme va Click.
 *
 *     node test/payments.test.mjs      (yoki npm test)
 *
 * BU YERDA PUL BOR, shuning uchun tekshiruvlar boshqacha:
 *
 *   1. SUMMA. To'lov tizimi aytgan summa hisobdagi bilan AYNAN
 *      mos tushishi kerak. Bir tiyin kam bo'lsa ham rad etiladi.
 *   2. IMZO. Kalitsiz yoki noto'g'ri imzo bilan kelgan so'rov
 *      hech narsa o'zgartira olmaydi.
 *   3. IKKI MARTA BERILMAYDI. To'lov tizimlari bitta so'rovni
 *      qayta yuborishi odatiy hol — mahsulot ikki marta
 *      berilmasligi kerak.
 *   4. KALIT YO'Q BO'LSA — hech narsa ishlamaydi. Yarim
 *      ishlaydigan to'lov eng yomon holat.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

import crypto from 'node:crypto';
import { db, loadApi, loadLib, makeRes, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const pay = await loadApi('api/pay.js', 'pay_api');
const profileApi = await loadApi('api/profile.js', 'pay_profile');
const payments = await loadLib('payments.js');
const premium = await loadLib('premium.js');

const ME = 'me@example.com';
const PAYME_KEY = 'payme-sir-kalit';
const CLICK_SECRET = 'click-sir-kalit';

const setEnv = () => {
  process.env.PAYME_MERCHANT_ID = 'merchant-123';
  process.env.PAYME_KEY = PAYME_KEY;
  process.env.CLICK_SERVICE_ID = '777';
  process.env.CLICK_MERCHANT_ID = '888';
  process.env.CLICK_SECRET_KEY = CLICK_SECRET;
};

const seed = (settings) => {
  db.strings.clear(); db.sets.clear(); db.lists.clear();
  setEnv();
  db.strings.set(`profile:${ME}`, JSON.stringify({ username: 'me' }));
  db.strings.set('admin_settings', JSON.stringify(settings || {
    premiumPrice1m: 50000, premiumPrice3m: 135000, premiumPrice12m: 480000,
  }));
};

const basic = (key) => 'Basic ' + Buffer.from(`Paycom:${key}`, 'utf8').toString('base64');

const payme = async (method, params, key = PAYME_KEY) => {
  const res = makeRes();
  await pay({
    method: 'POST', query: { provider: 'payme' },
    body: { jsonrpc: '2.0', id: 1, method, params },
    headers: { authorization: basic(key) },
  }, res);
  return res;
};

const clickSign = (parts) => crypto.createHash('md5').update(parts.join('')).digest('hex');

const click = async (fields) => {
  const res = makeRes();
  await pay({ method: 'POST', query: { provider: 'click' }, body: fields, headers: {} }, res);
  return res;
};

const profilePost = async (action, body) => {
  const res = makeRes();
  await profileApi({ method: 'POST', query: { action }, body, headers: {} }, res);
  return res;
};

const newInvoice = async (product = 'premium_1m') => {
  const res = await profilePost('pay-start', { googleIdToken: ME, product });
  return res;
};

/* ---------------------------------------------------------- */
flow('Hisob ochish');
{
  seed();
  const res = await newInvoice();
  check('hisob ochildi', res.statusCode === 200, res.payload);
  check('summa SERVERDAN olindi', res.payload.invoice.amount === 50000, res.payload.invoice);
  check('muddati aytilgan', res.payload.invoice.days === 30, res.payload.invoice);
  check('to‘lov manzili berildi', String(res.payload.url).startsWith('https://'), res.payload.url);
  check('MAXFIY KALIT MANZILDA YO‘Q', !res.payload.url.includes(PAYME_KEY), null);

  /* Mijoz yuborgan summa e'tiborga olinmasligi kerak. */
  const hiyla = await profilePost('pay-start', {
    googleIdToken: ME, product: 'premium_12m', amount: 1000, price: 1000,
  });
  check('MIJOZNING SUMMASI O‘QILMADI', hiyla.payload.invoice.amount === 480000,
    hiyla.payload.invoice);

  const yoq = await profilePost('pay-start', { googleIdToken: ME, product: 'bunday_yoq' });
  check('yo‘q mahsulot rad etildi', yoq.statusCode === 400, yoq.statusCode);

  const anon = await profilePost('pay-start', { product: 'premium_1m' });
  check('kirmagan odam hisob ocholmaydi', anon.statusCode === 401, anon.statusCode);
}

flow('Narx belgilanmagan bo\'lsa — sotilmaydi');
{
  seed({ premiumPrice1m: 0 });
  const res = await newInvoice();
  check('hisob ochilmadi', res.statusCode === 400, res.statusCode);
  check('sababi aytildi', String(res.payload.error).includes('sotuvda yo'), res.payload);

  const opts = await profilePost('pay-options', {});
  check('ro‘yxatda ham yo‘q',
    !opts.payload.products.some((p) => p.key === 'premium_1m'), opts.payload.products);
}

flow('To\'lov tizimi ulanmagan bo\'lsa');
{
  seed();
  delete process.env.PAYME_MERCHANT_ID;
  delete process.env.PAYME_KEY;
  delete process.env.CLICK_SERVICE_ID;
  delete process.env.CLICK_MERCHANT_ID;

  const res = await newInvoice();
  check('HISOB OCHILMADI', res.statusCode === 503, res.statusCode);
  check('sababi ochiq aytildi', res.payload.notReady === true, res.payload);

  const opts = await profilePost('pay-options', {});
  check('mahsulot ham ko‘rsatilmadi', opts.payload.products.length === 0, opts.payload);
  setEnv();
}

/* ---------------------------------------------------------- */
flow('Payme: to\'liq yo\'l');
{
  seed();
  const started = await newInvoice();
  const id = started.payload.invoice.id;
  const tiyin = 50000 * 100;

  const check1 = await payme('CheckPerformTransaction', { amount: tiyin, account: { invoice: id } });
  check('tekshiruvdan o‘tdi', check1.payload.result && check1.payload.result.allow === true, check1.payload);

  const create = await payme('CreateTransaction', { id: 'TXN-1', time: Date.now(), amount: tiyin, account: { invoice: id } });
  check('tranzaksiya ochildi', create.payload.result.state === 1, create.payload);

  check('HALI PREMIUM EMAS', (await premium.isPremium(ME)) === false);

  const perform = await payme('PerformTransaction', { id: 'TXN-1' });
  check('to‘lov yakunlandi', perform.payload.result.state === 2, perform.payload);
  check('PREMIUM BERILDI', (await premium.isPremium(ME)) === true);

  const state = await payme('CheckTransaction', { id: 'TXN-1' });
  check('holat 2', state.payload.result.state === 2, state.payload);
  check('to‘langan vaqt bor', state.payload.result.perform_time > 0, state.payload);

  /* Odam o'z hisobining holatini ko'ra oladi. */
  const mine = await profilePost('pay-state', { googleIdToken: ME, id });
  check('odamga ham ko‘rindi', mine.payload.state === 'PAID', mine.payload);
  const begona = await profilePost('pay-state', { googleIdToken: 'begona@example.com', id });
  check('BEGONAGA KO‘RINMADI', begona.statusCode === 404, begona.statusCode);
}

flow('Payme: summa mos kelmasa');
{
  seed();
  const started = await newInvoice();
  const id = started.payload.invoice.id;

  const kam = await payme('CheckPerformTransaction', { amount: 100, account: { invoice: id } });
  check('KAM SUMMA RAD ETILDI', kam.payload.error.code === -31001, kam.payload);

  const bir = await payme('CheckPerformTransaction', { amount: 50000 * 100 - 1, account: { invoice: id } });
  check('bir tiyin kam ham rad etildi', bir.payload.error.code === -31001, bir.payload);

  const create = await payme('CreateTransaction', { id: 'T', amount: 1, account: { invoice: id } });
  check('ochishda ham tekshiriladi', create.payload.error.code === -31001, create.payload);
  check('PREMIUM BERILMADI', (await premium.isPremium(ME)) === false);
}

flow('Payme: kalitsiz hech narsa qilib bo\'lmaydi');
{
  seed();
  const started = await newInvoice();
  const id = started.payload.invoice.id;

  for (const key of ['', 'boshqa-kalit', PAYME_KEY + 'x']) {
    const res = await payme('CreateTransaction',
      { id: 'T', amount: 50000 * 100, account: { invoice: id } }, key);
    check('rad etildi: ' + (key || 'bo‘sh'), res.payload.error.code === -32504, res.payload);
  }
  check('hisob tegilmadi', (await payments.readInvoice(id)).state === 'NEW');
  check('premium berilmadi', (await premium.isPremium(ME)) === false);
}

flow('Payme: ikki marta berilmaydi');
{
  seed();
  const started = await newInvoice();
  const id = started.payload.invoice.id;
  const tiyin = 50000 * 100;
  await payme('CreateTransaction', { id: 'TXN-2', amount: tiyin, account: { invoice: id } });
  await payme('PerformTransaction', { id: 'TXN-2' });

  const until1 = Number(await db.strings.get(`premium:${ME}`));
  /* O'sha so'rov qayta keldi — tizimlar shunday qiladi. */
  const again = await payme('PerformTransaction', { id: 'TXN-2' });
  check('qayta so‘rov xato bermadi', again.payload.result.state === 2, again.payload);
  const until2 = Number(await db.strings.get(`premium:${ME}`));
  check('MUDDAT IKKI MARTA QO‘SHILMADI', until1 === until2, { until1, until2 });

  /* To'langan hisobga yangi tranzaksiya ochib bo'lmaydi. */
  const yangi = await payme('CheckPerformTransaction', { amount: tiyin, account: { invoice: id } });
  check('to‘langan hisob qayta sotilmadi', yangi.payload.error.code === -31008, yangi.payload);
}

flow('Payme: bekor qilish');
{
  seed();
  const started = await newInvoice();
  const id = started.payload.invoice.id;
  const tiyin = 50000 * 100;
  await payme('CreateTransaction', { id: 'TXN-3', amount: tiyin, account: { invoice: id } });
  const cancel = await payme('CancelTransaction', { id: 'TXN-3', reason: 3 });
  check('bekor qilindi', cancel.payload.result.state === -1, cancel.payload);
  check('premium berilmadi', (await premium.isPremium(ME)) === false);

  const perform = await payme('PerformTransaction', { id: 'TXN-3' });
  check('BEKOR QILINGANDAN KEYIN TO‘LANMAYDI',
    perform.payload.error.code === -31008, perform.payload);
  check('baribir premium yo‘q', (await premium.isPremium(ME)) === false);
}

flow('Payme: yo\'q hisob va yo\'q metod');
{
  seed();
  const yoq = await payme('CheckPerformTransaction', { amount: 1, account: { invoice: 'yoq' } });
  check('hisob topilmadi', yoq.payload.error.code === -31050, yoq.payload);

  const txn = await payme('PerformTransaction', { id: 'bunday-txn-yoq' });
  check('tranzaksiya topilmadi', txn.payload.error.code === -31003, txn.payload);

  const metod = await payme('BundayMetodYoq', {});
  check('metod topilmadi', metod.payload.error.code === -32601, metod.payload);
}

/* ---------------------------------------------------------- */
flow('Click: to\'liq yo\'l');
{
  seed();
  const started = await newInvoice();
  const id = started.payload.invoice.id;
  const common = {
    click_trans_id: '9001', service_id: '777', click_paydoc_id: '1',
    merchant_trans_id: id, amount: '50000', sign_time: '2026-10-14 10:00:00',
  };

  const prep = { ...common, action: '0', error: '0' };
  prep.sign_string = clickSign([prep.click_trans_id, prep.service_id, CLICK_SECRET,
    prep.merchant_trans_id, prep.amount, prep.action, prep.sign_time]);
  const p1 = await click(prep);
  check('tayyorlandi', p1.payload.error === 0, p1.payload);
  check('hali premium emas', (await premium.isPremium(ME)) === false);

  const done = { ...common, action: '1', error: '0', merchant_prepare_id: id };
  done.sign_string = clickSign([done.click_trans_id, done.service_id, CLICK_SECRET,
    done.merchant_trans_id, done.merchant_prepare_id, done.amount, done.action, done.sign_time]);
  const p2 = await click(done);
  check('yakunlandi', p2.payload.error === 0, p2.payload);
  check('PREMIUM BERILDI', (await premium.isPremium(ME)) === true);
}

flow('Click: imzo va summa');
{
  seed();
  const started = await newInvoice();
  const id = started.payload.invoice.id;

  const bad = {
    click_trans_id: '9002', service_id: '777', merchant_trans_id: id,
    amount: '50000', action: '0', error: '0', sign_time: 'x',
    sign_string: 'd41d8cd98f00b204e9800998ecf8427e',
  };
  const r1 = await click(bad);
  check('NOTO‘G‘RI IMZO RAD ETILDI', r1.payload.error === -1, r1.payload);
  check('hisob tegilmadi', (await payments.readInvoice(id)).state === 'NEW');

  /* To'g'ri imzo, lekin summa boshqa. */
  const low = {
    click_trans_id: '9003', service_id: '777', merchant_trans_id: id,
    amount: '1000', action: '0', error: '0', sign_time: 'x',
  };
  low.sign_string = clickSign([low.click_trans_id, low.service_id, CLICK_SECRET,
    low.merchant_trans_id, low.amount, low.action, low.sign_time]);
  const r2 = await click(low);
  check('KAM SUMMA RAD ETILDI', r2.payload.error === -2, r2.payload);
  check('premium berilmadi', (await premium.isPremium(ME)) === false);
}

flow('Click: to\'lov bekor qilinsa');
{
  seed();
  const started = await newInvoice();
  const id = started.payload.invoice.id;
  const f = {
    click_trans_id: '9004', service_id: '777', merchant_trans_id: id,
    merchant_prepare_id: id, amount: '50000', action: '1', error: '-5',
    sign_time: 'x',
  };
  f.sign_string = clickSign([f.click_trans_id, f.service_id, CLICK_SECRET,
    f.merchant_trans_id, f.merchant_prepare_id, f.amount, f.action, f.sign_time]);
  const res = await click(f);
  check('bekor qilindi', res.payload.error === -9, res.payload);
  check('PREMIUM BERILMADI', (await premium.isPremium(ME)) === false);
  check('hisob bekor deb belgilandi',
    (await payments.readInvoice(id)).state === 'CANCELLED');
}

/* ---------------------------------------------------------- */
flow('Premium muddati QO\'SHILADI, almashtirilmaydi');
{
  seed();
  /* Odamda allaqachon 10 kun qolgan. */
  const tenDays = Date.now() + 10 * 86400000;
  await premium.grantPremium(ME, tenDays);

  const started = await newInvoice('premium_1m');
  const id = started.payload.invoice.id;
  const tiyin = 50000 * 100;
  await payme('CreateTransaction', { id: 'TXN-9', amount: tiyin, account: { invoice: id } });
  await payme('PerformTransaction', { id: 'TXN-9' });

  const until = Number(await db.strings.get(`premium:${ME}`));
  const expected = tenDays + 30 * 86400000;
  check('ESKI KUNLAR YO‘QOLMADI', Math.abs(until - expected) < 5000,
    { until, expected, farq: until - expected });
}

flow('Ayni paytda kelgan ikki so\'rov premiumni ikkilantirmaydi');
{
  /* Holatni O'QIB-YOZISH yetarli emas edi: ikkita `PerformTransaction`
     bir vaqtda kelsa, ikkalasi ham hali `HOLD` ni ko'rib, ikkalasi
     ham premium qo'shardi — odam bir marta to'lab ikki oy olardi.
     Endi navbat Redis'dagi `SADD` bilan egallanadi (atomik). */
  seed({ premiumPrice1m: 50000 });
  const started = await newInvoice('premium_1m');
  const id = started.payload.invoice.id;
  const tiyin = 50000 * 100;
  await payme('CreateTransaction', { id: 'TXN-RACE', amount: tiyin, account: { invoice: id } });

  /* Ikkalasi BIR PAYTDA ketadi: `await` alohida qo'yilsa, bu
     shunchaki ketma-ket ikki so'rov bo'lardi va eski kod ham
     o'tib ketardi. */
  const [bir, ikki] = await Promise.all([
    payme('PerformTransaction', { id: 'TXN-RACE' }),
    payme('PerformTransaction', { id: 'TXN-RACE' }),
  ]);
  check('ikkalasiga ham xato qaytmadi', !bir.payload.error && !ikki.payload.error,
    { bir: bir.payload, ikki: ikki.payload });

  const until = Number(await db.strings.get(`premium:${ME}`));
  const kun = Math.round((until - Date.now()) / 86400000);
  check('MUDDAT BIR MARTA QO‘SHILDI', kun === 30, kun);
}

flow('Pul qaytarilsa premium ham qaytadi');
{
  /* Ilgari `markCancelled` faqat holatni yozardi: to'langandan
     keyin bekor qilingan hisobda (Payme holati −2) odam pulni
     ham, premiumni ham olib qolardi. */
  seed({ premiumPrice1m: 50000 });
  const started = await newInvoice('premium_1m');
  const tiyin = 50000 * 100;
  await payme('CreateTransaction', { id: 'TXN-REF', amount: tiyin, account: { invoice: started.payload.invoice.id } });
  await payme('PerformTransaction', { id: 'TXN-REF' });
  check('avval premium berildi', Number(await db.strings.get(`premium:${ME}`)) > Date.now());

  await payme('CancelTransaction', { id: 'TXN-REF', reason: 5 });
  check('PREMIUM OLIB TASHLANDI', !db.strings.has(`premium:${ME}`),
    db.strings.get(`premium:${ME}`));
  check('to‘plamdan ham chiqdi', !(db.sets.get('premium_users') || new Set()).has(ME));
}

flow('Boshqa, haqiqiy oylar qaytarishda yo\'qolmaydi');
{
  /* Odamda ikkita to'langan oy bo'lsa va bittasi qaytarilsa,
     ikkinchisi joyida qolishi kerak — faqat qaytarilganining
     kunlari ayiriladi. */
  seed({ premiumPrice1m: 50000 });
  const tiyin = 50000 * 100;

  const bir = await newInvoice('premium_1m');
  await payme('CreateTransaction', { id: 'T-1', amount: tiyin, account: { invoice: bir.payload.invoice.id } });
  await payme('PerformTransaction', { id: 'T-1' });

  const ikki = await newInvoice('premium_1m');
  await payme('CreateTransaction', { id: 'T-2', amount: tiyin, account: { invoice: ikki.payload.invoice.id } });
  await payme('PerformTransaction', { id: 'T-2' });
  const ikkiKun = Math.round((Number(await db.strings.get(`premium:${ME}`)) - Date.now()) / 86400000);
  check('ikki oy yig‘ildi', ikkiKun === 60, ikkiKun);

  await payme('CancelTransaction', { id: 'T-2', reason: 5 });
  const qolganKun = Math.round((Number(await db.strings.get(`premium:${ME}`)) - Date.now()) / 86400000);
  check('BIR OY QOLDI, premium o‘chmadi', qolganKun === 30, qolganKun);
}

flow('Admin qo\'lda bergan muddatsiz premiumga tegilmaydi');
{
  /* Muddatsiz premium ("0") to'lovdan kelmagan: qaytarilgan
     to'lovning unga aloqasi yo'q va uni o'chirib yuborish
     adminning qaroriga qarshi borish bo'lardi. */
  seed({ premiumPrice1m: 50000 });
  const started = await newInvoice('premium_1m');
  const tiyin = 50000 * 100;
  await payme('CreateTransaction', { id: 'TXN-INF', amount: tiyin, account: { invoice: started.payload.invoice.id } });
  await payme('PerformTransaction', { id: 'TXN-INF' });

  // Admin oraliqda muddatsiz qilib qo'ydi.
  await premium.grantPremium(ME);
  check('muddatsiz bo‘ldi', db.strings.get(`premium:${ME}`) === '0');

  await payme('CancelTransaction', { id: 'TXN-INF', reason: 5 });
  check('MUDDATSIZ PREMIUM JOYIDA', db.strings.get(`premium:${ME}`) === '0',
    db.strings.get(`premium:${ME}`));
}

flow('Kalit kodga yozilmagan');
{
  const { readFileSync, readdirSync } = await import('fs');
  const { join } = await import('path');
  const { repo } = await import('./harness.mjs');

  const page = readFileSync(join(repo, 'index.html'), 'utf8');
  check('sahifa Payme kalitini bilmaydi', !page.includes('PAYME_KEY'));
  check('sahifa Click kalitini bilmaydi', !page.includes('CLICK_SECRET'));

  /* Maxfiy kalit NOMI ham ikki joydan ortiq uchramasligi kerak:
     uni haqiqatan tekshiradigan api/pay.js va "ulanganmi" degan
     savolga javob beradigan lib/payments.js. Boshqa fayl kalitga
     qo'l ursa — bu kalitning tarqalishi boshlanishi. */
  const files = [
    ...readdirSync(join(repo, 'api')).filter((f) => f.endsWith('.js')).map((f) => 'api/' + f),
    ...readdirSync(join(repo, 'lib')).filter((f) => f.endsWith('.js')).map((f) => 'lib/' + f),
  ];
  const touching = (name) =>
    files.filter((f) => readFileSync(join(repo, f), 'utf8').includes(name));

  check('PAYME_KEY faqat ikki faylda',
    touching('PAYME_KEY').join(',') === 'api/pay.js,lib/payments.js', touching('PAYME_KEY'));
  check('CLICK_SECRET_KEY faqat pay.js da',
    touching('CLICK_SECRET_KEY').join(',') === 'api/pay.js', touching('CLICK_SECRET_KEY'));
}

t.done();
