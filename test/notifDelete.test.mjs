/**
 * Bildirishnomani o'chirish.
 *
 *     node test/notifDelete.test.mjs      (yoki npm test)
 *
 * ENG MUHIM QOIDA: odam FAQAT O'ZINIKINI o'chira oladi. Kimniki
 * ekani so'rovdan emas, kirish belgisidan aniqlanadi — ya'ni
 * boshqa odamning id sini yuborib ham unikiga tegib bo'lmaydi.
 *
 * Ikkinchi qoida: o'chirish faqat RO'YXATDAN olib tashlaydi.
 * Buyurtma, taklif yoki xabarning o'ziga tegmaydi — bildirishnoma
 * ularning nusxasi emas, xabarnomasi.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

import { db, loadApi, makeRes, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const profile = await loadApi('api/profile.js', 'notifdel_profile');

const post = async (action, body) => {
  const res = makeRes();
  await profile({ method: 'POST', query: { action }, body: body || {}, headers: {} }, res);
  return res;
};

const ME = 'me@example.com';
const BOSHQA = 'other@example.com';

/** Ro'yxatga bildirishnoma qo'yadi (eng yangisi birinchi). */
const seed = (identity, ids) => {
  db.lists.set(`notifs:${identity}`, ids.map((id, i) => JSON.stringify({
    id, title: 'Sarlavha ' + id, body: 'Matn ' + id, at: Date.now() - i * 1000,
  })));
};

const list = async (who) => (await post('notifications', { googleIdToken: who })).payload.notifications;

/* ---------------------------------------------------------- */
flow('Bitta bildirishnoma o\'chadi');
{
  db.lists.clear();
  seed(ME, ['n1', 'n2', 'n3']);
  const res = await post('notification-delete', { googleIdToken: ME, id: 'n2' });
  check('so\'rov qabul qilindi', res.statusCode === 200, res.payload);

  const qolgan = res.payload.notifications.map((i) => i.id);
  check('O\'SHANING O\'ZI KETDI', !qolgan.includes('n2'), qolgan);
  check('qolganlari joyida', qolgan.join() === 'n1,n3', qolgan);
  /* Javob yangi ro'yxatni ham qaytaradi — ilova ikkinchi so'rov
     yubormasin va sanoq ham darhol to'g'rilansin. */
  check('javobda yangi ro\'yxat bor', Array.isArray(res.payload.notifications));
  check('sanoq ham keladi', typeof res.payload.unread === 'number', res.payload.unread);
}

flow('Yo\'q bildirishnoma xato emas');
{
  db.lists.clear();
  seed(ME, ['n1']);
  const res = await post('notification-delete', { googleIdToken: ME, id: 'yoq' });
  /* Odam ikki marta bosgan yoki yozuv chegaradan chiqib ketgan
     bo'lishi mumkin — bu xato emas. */
  check('xato qaytmaydi', res.statusCode === 200, res.statusCode);
  check('ro\'yxat tegilmadi', res.payload.notifications.map((i) => i.id).join() === 'n1');

  const bosh = await post('notification-delete', { googleIdToken: ME });
  check('id berilmasa rad etiladi', bosh.statusCode === 400, bosh.statusCode);
}

flow('BEGONANIKIGA TEGIB BO\'LMAYDI');
{
  db.lists.clear();
  seed(ME, ['n1']);
  seed(BOSHQA, ['x1', 'x2']);

  // Boshqa odamning yozuvi id sini yuboramiz.
  const res = await post('notification-delete', { googleIdToken: ME, id: 'x1' });
  check('so\'rov o\'tdi, lekin', res.statusCode === 200, res.statusCode);
  check('BEGONANIKI JOYIDA QOLDI',
    (await list(BOSHQA)).map((i) => i.id).join() === 'x1,x2', await list(BOSHQA));
  check('o\'ziniki ham tegilmadi', (await list(ME)).map((i) => i.id).join() === 'n1');

  const anon = await post('notification-delete', { id: 'n1' });
  check('kirmagan odam o\'chira olmaydi', anon.statusCode === 401, anon.statusCode);
}

flow('Hammasini o\'chirish');
{
  db.lists.clear();
  seed(ME, ['n1', 'n2', 'n3']);
  seed(BOSHQA, ['x1']);

  const res = await post('notifications-clear', { googleIdToken: ME });
  check('bo\'shadi', res.payload.notifications.length === 0, res.payload.notifications);
  check('sanoq nolga tushdi', res.payload.unread === 0, res.payload.unread);
  check('ro\'yxat haqiqatan bo\'shadi', (await list(ME)).length === 0);
  check('BEGONANIKI JOYIDA', (await list(BOSHQA)).map((i) => i.id).join() === 'x1');

  const anon = await post('notifications-clear', {});
  check('kirmagan odam tozalay olmaydi', anon.statusCode === 401, anon.statusCode);
}

flow('O\'chirish boshqa narsalarga tegmaydi');
{
  db.lists.clear();
  db.strings.clear();
  seed(ME, ['n1']);
  // Yonida turgan ma'lumotlar — bildirishnoma ularning nusxasi emas.
  db.strings.set('order:YL-TEST', JSON.stringify({ code: 'YL-TEST', status: 'OPEN' }));
  db.lists.set(`convo:${ME}|a@b.c`, ['msg1']);

  await post('notifications-clear', { googleIdToken: ME });
  check('buyurtma joyida', db.strings.has('order:YL-TEST'));
  check('yozishma joyida', db.lists.has(`convo:${ME}|a@b.c`));
}

t.done();
