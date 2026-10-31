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

import { db, loadApi, loadLib, makeRes, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const chat = await loadApi('api/chat.js', 'chatpin_chat');

/* Yozishmalar ro'yxati suhbatdoshning identity sini EMAS, belgisini
   qaytaradi (lib/chatAlias.js): Google bilan kirgan odam uchun
   identity — haqiqiy pochta manzili edi va u begonaga ko'rinib
   turardi. Test shu belgi bilan solishtiradi. */
const { aliasOf } = await loadLib('chatAlias.js');
const al = (id) => aliasOf(id);

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
  check('ro\'yxatda bitta', res.payload.pinned.join(',') === al(A), res.payload);

  const list = await inbox();
  const row = list.conversations.find((c) => c.email === al(A));
  check('ro\'yxatda belgilangan', row && row.pinned === true, row);
  check('birinchi o\'rinda', list.conversations[0].email === al(A), list.conversations.map((c) => c.email));
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
  check('qadalgani birinchi', list.conversations[0].email === al(A), list.conversations.map((c) => c.email));
  check('qadalmaganlari vaqt bo\'yicha', list.conversations[1].email === al(B),
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
  check('A endi qadalmagan', !(await inbox()).pinned.includes(al(A)));
}

flow('Suhbatdoshning pochta manzili mijozga berilmaydi');
{
  /* Ilgari ro'yxatda `email: "a@example.com"` turardi. Google
     bilan kirgan odam uchun bu uning HAQIQIY pochta manzili edi,
     ya'ni istalgan `@username` ga bitta xabar yozib, manzilini
     o'qib olish mumkin edi. Endi o'rnida belgi turadi. */
  seed();
  const list = await inbox();
  const hammasi = JSON.stringify(list);
  check('javobda "@example.com" umuman yo\'q', !hammasi.includes('@example.com'), hammasi.slice(0, 200));
  check('har bir satrda belgi turadi',
    list.conversations.every((c) => /^u_[A-Za-z0-9_-]{22}$/.test(c.email)),
    list.conversations.map((c) => c.email));
  check('har kimning belgisi o\'zining',
    new Set(list.conversations.map((c) => c.email)).size === list.conversations.length);

  /* Belgi haqiqatan ishlaydi: mijoz uni qaytarib yuborganda
     suhbat topiladi. Aks holda yozishma umuman ochilmasdi. */
  const pinned = await post('pin', { googleIdToken: ME, withEmail: al(A), on: true });
  check('belgi bilan qadaldi', pinned.statusCode === 200, pinned.payload);
  check('va to\'g\'ri odam qadaldi',
    (db.strings.get(`chatPins:${ME}`) || '').includes(A),
    db.strings.get(`chatPins:${ME}`));

  /* O'ylab topilgan belgi hech narsa ochmaydi. */
  const soxta = await post('pin', { googleIdToken: ME, withEmail: `u_${'A'.repeat(22)}`, on: true });
  check('soxta belgi rad etildi', soxta.statusCode === 400 || soxta.statusCode === 404, soxta.statusCode);
}

flow('Keshdagi eski sahifa ham ishlaydi');
{
  /* Eski sahifa hali identity yuborishi mumkin — u ham qabul
     qilinadi. Teshik javobda identity BERILISHI edi, uni qabul
     qilish emas; yangi javoblarda u yo'q, ya'ni bu yo'l eski
     sahifalar yopilishi bilan o'z-o'zidan tugaydi. */
  seed();
  const res = await post('pin', { googleIdToken: ME, withEmail: A, on: true });
  check('identity bilan ham qadaladi', res.statusCode === 200, res.payload);
  check('natija bir xil', (db.strings.get(`chatPins:${ME}`) || '').includes(A));
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
  check('mening ro\'yxatimdan ketdi', !mine.conversations.some((c) => c.email === al(A)),
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
  check('avval qadalgan', (await inbox()).pinned.includes(al(A)));
  await post('hide', { googleIdToken: ME, withEmail: A });
  check('qadalganlardan ham ketdi', !(await inbox()).pinned.includes(al(A)));
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

/**
 * Odam qidirish.
 *
 * Username og'zaki "@ali" deb aytiladi va odam aynan shunday
 * yozadi. Bazada esa "@" yo'q — belgi olib tashlanmasa, aytilgan
 * username bo'yicha hech kim topilmasdi.
 */
flow('Qidiruv: "@" belgisi to\'siq bo\'lmasin');
{
  seed();
  db.strings.set('username:ali_haydovchi', A);
  db.strings.set('username:sardor_yuk', B);
  db.strings.set(`profile:${A}`, JSON.stringify({ username: 'ali_haydovchi', displayName: 'Ali Valiyev', role: 'DRIVER' }));
  db.strings.set(`profile:${B}`, JSON.stringify({ username: 'sardor_yuk', displayName: 'Sardor Nazarov' }));

  const find = async (q) => (await get('search', { googleIdToken: ME, q })).payload.users.map((u) => u.username);

  check('"@" bilan topiladi', (await find('@sardor')).includes('sardor_yuk'), await find('@sardor'));
  check('"@"siz ham topiladi', (await find('sardor')).includes('sardor_yuk'));
  check('ikkalasi bir xil natija',
    JSON.stringify(await find('@ali')) === JSON.stringify(await find('ali')));
  check('"@" uzunlikni yeb qo\'ymaydi', (await find('@a')).length === 0);

  const one = (await get('search', { googleIdToken: ME, q: '@ali' })).payload.users[0];
  check('ism ham beriladi', one.name === 'Ali Valiyev', one);
  check('pochta berilmaydi', !JSON.stringify(one).includes('@example.com'), one);
  check('telefon berilmaydi', !('phone' in one), one);

  const anon = await get('search', { q: '@ali' });
  check('kirmagan odam qidira olmaydi', anon.statusCode === 401, anon.statusCode);
}

flow('Qidiruvda boshidan mos kelgani yuqorida');
{
  seed();
  db.strings.set('username:xolali', A);
  db.strings.set('username:ali', B);
  db.strings.set(`profile:${A}`, JSON.stringify({ username: 'xolali' }));
  db.strings.set(`profile:${B}`, JSON.stringify({ username: 'ali' }));
  const users = (await get('search', { googleIdToken: ME, q: '@ali' })).payload.users;
  check('ikkalasi ham topildi', users.length === 2, users);
  check('avval @ali', users[0].username === 'ali', users.map((u) => u.username));
}

t.done();
