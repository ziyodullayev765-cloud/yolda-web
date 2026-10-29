/**
 * Shikoyat qaysi e'longa tegishli ekani.
 *
 *     node test/reportTarget.test.mjs      (yoki npm test)
 *
 * MUAMMO. E'lon ichidan shikoyat yuborilganda odam hech narsa
 * yozmaydi — "kimga oid" degan maydon bo'sh qoladi. Shu sababli
 * admin panelda "qaysi yuk haqida?" degan savolga javob yo'q
 * edi: kod umuman saqlanmasdi.
 *
 * QOIDA. Nishon alohida ikki maydonda keladi va SAQLANADI:
 * `targetKind` (yuk / mashina / foydalanuvchi) va `targetId`.
 * Tur ro'yxatdan tashqari bo'lsa qabul qilinmaydi — shunda
 * admin panel yasaydigan havola ham ishonchli bo'ladi.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

import { db, loadApi, makeRes, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const ME = 'me@example.com';

const seed = () => {
  db.strings.clear(); db.sets.clear(); db.lists.clear();
  db.strings.set(`profile:${ME}`, JSON.stringify({ username: 'men' }));
};

/* Qo'riqchi bir odamga daqiqada bitta shikoyat qo'yadi —
   har yuborish uchun moduldan yangi nusxa olinadi. */
let nusxa = 0;
const send = async (body) => {
  const api = await loadApi('api/report.js', 'rt' + (nusxa += 1));
  const res = makeRes();
  await api({ method: 'POST', query: {}, body, headers: {} }, res);
  return res;
};

/** Saqlangan yagona shikoyat. */
const saqlangan = () => {
  const keys = [...db.strings.keys()].filter((k) => k.startsWith('report:'));
  return keys.length ? JSON.parse(db.strings.get(keys[keys.length - 1])) : null;
};

/* ---------------------------------------------------------- */
flow('Yukka shikoyat');
{
  seed();
  const res = await send({ googleIdToken: ME, reason: 'FAKE_LOAD',
    targetKind: 'load', targetId: 'YL-1042', targetContact: 'YL-1042',
    description: 'Narxi haqiqatga to‘g‘ri kelmaydi' });
  check('yuborildi', res.statusCode === 200, res.payload);

  const r = saqlangan();
  check('QAYSI YUK EKANI SAQLANDI', r && r.targetId === 'YL-1042', r);
  check('turi ham saqlandi', r && r.targetKind === 'load', r);
  check('sabab va matn joyida',
    r && r.reason === 'FAKE_LOAD' && /haqiqatga/.test(r.description), r);
  check('kim yuborgani yozilgan', r && r.reporterEmail === ME, r);
  check('yangi deb belgilandi', r && r.status === 'NEW', r);
}

flow('Mashinaga shikoyat');
{
  seed();
  await send({ googleIdToken: ME, reason: 'SCAM',
    targetKind: 'truck', targetId: 'T-77', description: 'Rasm o‘g‘irlangan' });
  const r = saqlangan();
  check('mashina id saqlandi', r && r.targetKind === 'truck' && r.targetId === 'T-77', r);
}

flow('BEGONA tur qabul qilinmaydi');
{
  seed();
  await send({ googleIdToken: ME, reason: 'OTHER',
    targetKind: 'javascript:alert(1)', targetId: 'YL-1', description: 'Matn' });
  const r = saqlangan();
  check('noma\'lum tur tashlab yuborildi', r && r.targetKind === '', r);
  /* Id esa qoladi: u shunchaki matn, havola undan yasalmaydi. */
  check('id saqlanaveradi', r && r.targetId === 'YL-1', r);
}

flow('Nishonsiz shikoyat ham ishlaydi');
{
  seed();
  const res = await send({ googleIdToken: ME, reason: 'BEHAVIOR',
    targetContact: '+998901112233', description: 'Qo‘pol gapirdi' });
  check('yuborildi', res.statusCode === 200, res.payload);
  const r = saqlangan();
  check('erkin matn joyida', r && r.targetContact === '+998901112233', r);
  check('nishon bo\'sh', r && r.targetKind === '' && r.targetId === '', r);
}

flow('Uzun id qirqiladi');
{
  seed();
  await send({ googleIdToken: ME, reason: 'OTHER', targetKind: 'load',
    targetId: 'Y'.repeat(200), description: 'Matn' });
  const r = saqlangan();
  check('64 belgidan oshmaydi', r && r.targetId.length === 64, r && r.targetId.length);
}

flow('Kirmagan odam shikoyat yubora olmaydi');
{
  seed();
  const res = await send({ reason: 'SCAM', targetKind: 'load', targetId: 'YL-1',
    description: 'Matn' });
  check('rad etildi', res.statusCode === 401, res.statusCode);
  check('hech narsa yozilmadi', saqlangan() === null, saqlangan());
}

t.done();
