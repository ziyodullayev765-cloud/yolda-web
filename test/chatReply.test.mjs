/**
 * Xabarga javob berish va bir nechta xabarni o'chirish.
 *
 *     node test/chatReply.test.mjs      (yoki npm test)
 *
 * IKKI QOIDA shu yerda tekshiriladi.
 *
 *   1. JAVOB. `replyTo` — begona yozishmadagi xabarning id'si
 *      bo'lsa, u YOZIB QO'YILMAYDI. Aks holda tasodifiy id yuborib,
 *      o'zga odamlarning yozishmasidagi xabarning matnini javob
 *      ko'chirmasi orqali ko'rish mumkin bo'lardi.
 *
 *   2. O'CHIRISH ikki xil:
 *        - "faqat o'zim uchun" — xabar suhbatdoshda QOLADI,
 *          faqat so'ragan odamning ro'yxatidan tushadi;
 *        - "hamma uchun" — faqat O'Z xabarini o'chira oladi.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

import { db, loadApi, makeRes, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const chat = await loadApi('api/chat.js', 'chatreply_chat');

const post = async (action, body) => {
  const res = makeRes();
  await chat({ method: 'POST', query: { action }, body: body || {}, headers: {} }, res);
  return res;
};
const get = async (action, query) => {
  const res = makeRes();
  await chat({ method: 'GET', query: { action, ...(query || {}) }, body: {}, headers: {} }, res);
  return res;
};

const ME = 'me@example.com';
const A = 'a@example.com';
const B = 'b@example.com';

const seed = () => {
  db.strings.clear(); db.sets.clear(); db.lists.clear();
  [[ME, 'men'], [A, 'ali'], [B, 'bek']].forEach(([id, u]) => {
    db.strings.set(`profile:${id}`, JSON.stringify({ username: u, displayName: u }));
    db.strings.set(`username:${u}`, id);
  });
};

/* Spam qo'riqchisi bir odamga 3 soniyada bitta xabar qo'yadi. U
   modul ichidagi xotirada turadi, shuning uchun har bir yuborish
   uchun moduldan yangi nusxa olinadi — tekshiruv soniyalab
   kutib o'tirmasin. Qo'riqchining o'zi alohida tekshiriladi. */
let nusxa = 0;
const send = async (from, toUsername, text, replyTo) => {
  const api = await loadApi('api/chat.js', 'chatreply_send' + (nusxa += 1));
  const res = makeRes();
  await api({ method: 'POST', query: { action: 'send' },
    body: { googleIdToken: from, toUsername, text, replyTo }, headers: {} }, res);
  return res;
};

const thread = async (who, withEmail) =>
  (await get('thread', { googleIdToken: who, withEmail })).payload.messages;

/* ---------------------------------------------------------- */
flow('Javob berish');
{
  seed();
  const birinchi = await send(A, 'men', 'Yuk tayyormi?');
  check('xabar yuborildi', birinchi.statusCode === 200, birinchi.payload);
  const id = birinchi.payload.id;

  const javob = await send(ME, 'ali', 'Ha, tayyor', id);
  check('javob yuborildi', javob.statusCode === 200, javob.payload);

  const list = await thread(ME, A);
  const oxirgi = list[list.length - 1];
  check('javobda replyTo saqlandi', oxirgi.replyTo === id, oxirgi);
  check('birinchi xabarda replyTo yo\'q', list[0].replyTo === null, list[0]);

  /* Suhbatdosh ham xuddi shuni ko'radi. */
  const uniki = await thread(A, ME);
  check('ikkala tomon ham ko\'radi',
    uniki[uniki.length - 1].replyTo === id, uniki[uniki.length - 1]);
}

flow('BEGONA yozishmadagi xabarga javob bo\'lmaydi');
{
  seed();
  const begona = await send(A, 'bek', 'Bu ikkovimizning gapimiz');
  check('begona xabar yozildi', begona.statusCode === 200, begona.payload);

  const urinish = await send(ME, 'ali', 'Javob', begona.payload.id);
  check('xabar o\'tdi', urinish.statusCode === 200, urinish.payload);

  const list = await thread(ME, A);
  check('BEGONA ID YOZILMADI', list[list.length - 1].replyTo === null, list[list.length - 1]);
}

flow('Faqat o\'zim uchun o\'chirish');
{
  seed();
  const bir = await send(A, 'men', 'Birinchi');
  const ikki = await send(ME, 'ali', 'Ikkinchi');

  const res = await post('delete', { googleIdToken: ME, ids: [bir.payload.id], forMe: true });
  check('o\'chirildi', res.statusCode === 200 && res.payload.count === 1, res.payload);

  const meniki = await thread(ME, A);
  check('mening ro\'yxatimdan tushdi',
    !meniki.some((m) => m.id === bir.payload.id), meniki.map((m) => m.text));

  const uniki = await thread(A, ME);
  check('SUHBATDOSHDA XABAR QOLDI',
    uniki.some((m) => m.id === bir.payload.id && m.text === 'Birinchi'),
    uniki.map((m) => m.text));
  check('o\'chirilgan deb belgilanmagan',
    uniki.every((m) => m.deleted === false), uniki);
  check('ikkinchi xabar joyida', meniki.some((m) => m.id === ikki.payload.id), meniki);
}

flow('Hamma uchun o\'chirish — faqat o\'z xabari');
{
  seed();
  const uniki = await send(A, 'men', 'Uning xabari');
  const meniki = await send(ME, 'ali', 'Mening xabarim');

  const yomon = await post('delete', { googleIdToken: ME, ids: [uniki.payload.id], forMe: false });
  check('BEGONA XABARNI HAMMA UCHUN O\'CHIRIB BO\'LMAYDI', yomon.statusCode === 403, yomon.payload);
  const hali = await thread(A, ME);
  check('xabar joyida turibdi',
    hali.some((m) => m.id === uniki.payload.id && m.text === 'Uning xabari'), hali.map((m) => m.text));

  const yaxshi = await post('delete', { googleIdToken: ME, ids: [meniki.payload.id], forMe: false });
  check('o\'z xabarim o\'chdi', yaxshi.statusCode === 200, yaxshi.payload);
  const keyin = await thread(A, ME);
  const o = keyin.find((m) => m.id === meniki.payload.id);
  check('IKKALA TOMONDA HAM O\'CHDI', o && o.deleted === true && o.text === '', o);
}

flow('Bir nechta xabarni bittada o\'chirish');
{
  seed();
  const ids = [];
  for (const matn of ['Bir', 'Ikki', 'Uch']) {
    const r = await send(ME, 'ali', matn);
    ids.push(r.payload.id);
  }
  check('uchtasi yozildi', ids.length === 3 && ids.every(Boolean), ids);

  const res = await post('delete', { googleIdToken: ME, ids, forMe: false });
  check('uchtasi ham o\'chdi', res.statusCode === 200 && res.payload.count === 3, res.payload);
  const list = await thread(A, ME);
  check('hammasi o\'chirilgan ko\'rinadi',
    ids.every((id) => { const m = list.find((x) => x.id === id); return m && m.deleted === true; }),
    list.map((m) => m.deleted));
}

flow('Kirmagan odam va bo\'sh ro\'yxat');
{
  seed();
  const bir = await send(A, 'men', 'Salom');

  const anon = await post('delete', { ids: [bir.payload.id], forMe: true });
  check('kirmagan odam o\'chira olmaydi', anon.statusCode === 401, anon.statusCode);

  const bosh = await post('delete', { googleIdToken: ME, ids: [], forMe: true });
  check('bo\'sh ro\'yxat rad etiladi', bosh.statusCode === 400, bosh.statusCode);

  const yoq = await post('delete', { googleIdToken: ME, ids: ['yoq-bunaqa-id'], forMe: true });
  check('begona id hech narsa qilmaydi', yoq.statusCode === 403, yoq.statusCode);

  const list = await thread(A, ME);
  check('xabar joyida', list.some((m) => m.text === 'Salom'), list.map((m) => m.text));
}

t.done();
