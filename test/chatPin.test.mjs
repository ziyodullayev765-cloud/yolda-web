/**
 * Yozishmani qadash va ro'yxatdan olib tashlash.
 *
 *     node test/chatPin.test.mjs      (yoki npm test)
 *
 * ENG MUHIM QOIDA. Yozishma IKKI KISHINIKI. Shuning uchun
 * "o'chirish" — faqat o'z ro'yxatimdan olib tashlash: xabarlar
 * suhbatdoshda qoladi va uning ro'yxatidan yo'qolmaydi. Bir
 * tomon ikkinchisining yozishmasini o'chira olsa, bu odamning
 * ma'lumotini uning ruxsatisiz yo'q qilish bo'lardi.
 *
 * Qadash ham bir tomonli: men kimnidir yuqoriga qadaganim unga
 * ko'rinmaydi.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

import { db, loadApi, makeRes, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const chat = await loadApi('api/chat.js', 'chatpin_chat');

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
const C = 'c@example.com';
const D = 'd@example.com';
const E = 'e@example.com';

const seed = () => {
  db.strings.clear(); db.sets.clear(); db.lists.clear();
  [ME, A, B, C, D, E].forEach((id, i) => {
    db.strings.set(`profile:${id}`, JSON.stringify({
      username: id.split('@')[0], displayName: 'Odam ' + i,
    }));
  });
  db.sets.set(`inbox:${ME}`, new Set([A, B, C, D, E]));
  db.sets.set(`inbox:${A}`, new Set([ME]));
};

const inbox = async () => (await get('inbox', { googleIdToken: ME })).payload;

/* ---------------------------------------------------------- */
flow('Qadash');
{
  seed();
  const res = await post('pin', { googleIdToken: ME, withEmail: A, on: true });
  check('qadaldi', res.statusCode === 200, res.payload);
  check('ro\'yxatda bitta', res.payload.pinned.join(',') === A, res.payload);

  const list = await inbox();
  const row = list.conversations.find((c) => c.email === A);
  check('ro\'yxatda belgilangan', row && row.pinned === true, row);
  check('birinchi o\'rinda', list.conversations[0].email === A, list.conversations.map((c) => c.email));
  check('chegarasi aytilgan', list.maxPins === 4, list.maxPins);
}

flow('Qadalganlar doim yuqorida');
{
  seed();
  /* B ning xabari eng yangi bo'lsa ham, qadalgan A undan
     yuqorida turishi kerak. */
  db.strings.set('msg:m1', JSON.stringify({ id: 'm1', from: B, to: ME, text: 'salom', at: 9999 }));
  db.lists.set(`convo:${[ME, B].sort().join('|')}`, ['m1']);

  await post('pin', { googleIdToken: ME, withEmail: A, on: true });
  const list = await inbox();
  check('qadalgani birinchi', list.conversations[0].email === A, list.conversations.map((c) => c.email));
  check('qadalmaganlari vaqt bo\'yicha', list.conversations[1].email === B,
    list.conversations.map((c) => c.email));
}

flow('To\'rttadan ko\'p qadalmaydi');
{
  seed();
  for (const who of [A, B, C, D]) {
    const r = await post('pin', { googleIdToken: ME, withEmail: who, on: true });
    check('qadaldi: ' + who, r.statusCode === 200, r.payload);
  }
  const over = await post('pin', { googleIdToken: ME, withEmail: E, on: true });
  check('beshinchisi rad etildi', over.statusCode === 409, over.statusCode);
  check('chegara aytildi', over.payload.max === 4, over.payload);
  check('ro\'yxat to\'rtta qoldi', (await inbox()).pinned.length === 4);

  // Bittasini bo'shatgach, yangisi sig'adi.
  await post('pin', { googleIdToken: ME, withEmail: A, on: false });
  const ok = await post('pin', { googleIdToken: ME, withEmail: E, on: true });
  check('bo\'shatilgach sig\'di', ok.statusCode === 200, ok.payload);
  check('A endi qadalmagan', !(await inbox()).pinned.includes(A));
}

flow('Begona suhbatni qadab bo\'lmaydi');
{
  seed();
  const res = await post('pin', { googleIdToken: ME, withEmail: 'begona@example.com', on: true });
  check('rad etildi', res.statusCode === 404, res.statusCode);
  check('hech narsa yozilmadi', (await inbox()).pinned.length === 0);

  const anon = await post('pin', { withEmail: A, on: true });
  check('kirmagan odam qada olmaydi', anon.statusCode === 401, anon.statusCode);
}

flow('O\'chirish — faqat O\'Z ro\'yxatimdan');
{
  seed();
  db.strings.set('msg:m1', JSON.stringify({ id: 'm1', from: A, to: ME, text: 'salom', at: 1000 }));
  db.lists.set(`convo:${[ME, A].sort().join('|')}`, ['m1']);
  db.strings.set(`chatUnread:${ME}:${A}`, '3');

  const res = await post('hide', { googleIdToken: ME, withEmail: A });
  check('o\'chirildi', res.statusCode === 200, res.payload);

  const mine = await inbox();
  check('mening ro\'yxatimdan ketdi', !mine.conversations.some((c) => c.email === A),
    mine.conversations.map((c) => c.email));
  check('o\'qilmaganlar sanog\'i ham ketdi', !db.strings.has(`chatUnread:${ME}:${A}`));

  /* ENG MUHIM TASDIQ. */
  check('XABARLAR O\'CHMADI', db.strings.has('msg:m1'));
  check('yozishma kaliti joyida', db.lists.has(`convo:${[ME, A].sort().join('|')}`));
  check('suhbatdoshning ro\'yxatida qoldi',
    (db.sets.get(`inbox:${A}`) || new Set()).has(ME));
}

flow('O\'chirilgan suhbat qadalganlar ro\'yxatidan ham chiqadi');
{
  seed();
  await post('pin', { googleIdToken: ME, withEmail: A, on: true });
  check('avval qadalgan', (await inbox()).pinned.includes(A));
  await post('hide', { googleIdToken: ME, withEmail: A });
  check('qadalganlardan ham ketdi', !(await inbox()).pinned.includes(A));
}

flow('O\'chirishda ham begonaga tegilmaydi');
{
  seed();
  const res = await post('hide', { googleIdToken: ME, withEmail: 'begona@example.com' });
  check('rad etildi', res.statusCode === 404, res.statusCode);
  const anon = await post('hide', { withEmail: A });
  check('kirmagan odam o\'chira olmaydi', anon.statusCode === 401, anon.statusCode);
  check('ro\'yxat tegilmadi', (await inbox()).conversations.length === 5);
}

t.done();
