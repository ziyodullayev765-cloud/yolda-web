/**
 * OCHIQ ENDPOINTLARNING CHEGARALARI.
 *
 *     node test/openEndpoints.test.mjs      (yoki npm test)
 *
 * Ikkita endpoint ataylab kirish talab qilmaydi va bu to'g'ri:
 *
 *   /api/support     — kira olmagan odam ham yoza olishi kerak;
 *   /api/auth-phone  — kod so'rash kirishdan OLDIN bo'ladi.
 *
 * Lekin "ochiq" degani "cheksiz" degani emas. Ularda ilgari
 * faqat xotiradagi throttle bor edi, u esa:
 *
 *   - har bir lambda NUSXASIDA alohida ishlaydi, ya'ni bir
 *     vaqtda ishga tushgan o'nta nusxa o'nta budjet beradi;
 *   - `x-forwarded-for` ga tayanadi, uni esa so'rovda yozib
 *     yuborish mumkin.
 *
 * Shuning uchun bu yerda BAZADAGI chegaralar sinaladi: ular
 * hamma nusxa uchun bitta va chetlab o'tilmaydi.
 *
 * Nega bu muhim:
 *
 *   - `support_messages` cheksiz o'sardi. Upstash bepul tarifida
 *     256 MB joy bor — bitta odam bazani to'ldirib, ilovani
 *     butunlay to'xtatib qo'yishi mumkin edi.
 *   - `register-start` / `login-start` raqam ro'yxatda bormi
 *     degan savolga javob beradi (409 / 404), ya'ni raqamlarni
 *     aylanib chiqish vositasi. Bundan ham yomoni: har bir
 *     urinish, raqam botga ulangan bo'lsa, uning HAQIQIY
 *     egasiga Telegram xabari yuborardi.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

import { db, loadApi, makeRes, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const support = await loadApi('api/support.js', 'open_support');
const authPhone = await loadApi('api/auth-phone.js', 'open_authphone');

const yoz = async (message, ip) => {
  const res = makeRes();
  await support({
    method: 'POST',
    headers: ip ? { 'x-forwarded-for': ip } : {},
    body: { name: 'Odam', contact: '+998901112233', message },
  }, res);
  return res;
};

const kodSora = async (phone, ip, action = 'register-start') => {
  const res = makeRes();
  await authPhone({
    method: 'POST',
    headers: ip ? { 'x-forwarded-for': ip } : {},
    body: {
      action, phone, firstName: 'Aziz', lastName: 'Karimov', terms: true,
    },
  }, res);
  return res;
};

/* ---------------------------------------------------------- */
flow('Murojaat yoziladi');
{
  db.reset();
  const res = await yoz('Ilova ochilmayapti');
  check('qabul qilindi', res.statusCode === 200, res.payload);
  const list = db.lists.get('support_messages') || [];
  check('bazaga tushdi', list.length === 1, list.length);
  check('matni saqlandi', JSON.parse(list[0]).message === 'Ilova ochilmayapti');
}

flow('Ro\'yxat cheksiz o\'smaydi');
{
  /* ENG MUHIM TASDIQ. Chegaradan ko'p yozilsa, eng eskisi tushib
     ketadi — ro'yxat esa o'sha uzunlikda qoladi. */
  db.reset();
  /* `isThrottled` bitta IP ga daqiqada bitta xabar beradi, lekin
     u xotirada va IP bo'yicha — shuning uchun har safar boshqa
     IP ishlatiladi. Aynan shu "chetlab o'tish" mumkinligi bu
     testning sababi. */
  for (let i = 0; i < 55; i += 1) {
    await yoz('xabar ' + i, '10.0.0.' + i);
  }
  const list = db.lists.get('support_messages') || [];
  check('yozuvlar ketdi', list.length > 0, list.length);
  check('ro‘yxat 500 dan oshmaydi', list.length <= 500, list.length);
  check('eng yangisi boshida', JSON.parse(list[0]).message === 'xabar 54', JSON.parse(list[0]).message);
}

flow('Soatlik chegara hamma nusxa uchun bitta');
{
  db.reset();
  /* Hisoblagich bazada: har bir so'rov o'sha kalitni oshiradi,
     ya'ni IP ni almashtirish ham, lambda almashishi ham yordam
     bermaydi. */
  let oxirgi = null;
  for (let i = 0; i < 70; i += 1) {
    oxirgi = await yoz('xabar ' + i, '172.16.0.' + i);
  }
  check('chegaraga yetildi', oxirgi.statusCode === 429, oxirgi.statusCode);
  check('va ochiq aytildi', /ko.p murojaat|birozdan/i.test(oxirgi.payload.error || ''),
    oxirgi.payload);
  /* Rad etilgan xabar YOZILMAYDI — aks holda chegaraning ma'nosi
     qolmasdi. */
  const list = db.lists.get('support_messages') || [];
  check('rad etilgani bazaga tushmadi', list.length === 60, list.length);
}

flow('Kod so\'rash bitta manzildan cheklangan');
{
  db.reset();
  const IP = '203.0.113.7';
  /* Har safar BOSHQA raqam: raqam bo'yicha chegara (soatiga 5 ta)
     to'siq bo'lmasligi kerak — aynan IP bo'yicha chegarani
     sinayapmiz. */
  let oxirgi = null;
  let tusdi = 0;
  for (let i = 0; i < 35; i += 1) {
    oxirgi = await kodSora('+99890' + String(1000000 + i), IP);
    if (oxirgi.statusCode === 429) tusdi += 1;
  }
  check('chegaraga yetildi', oxirgi.statusCode === 429, oxirgi.statusCode);
  check('30 tadan keyin to‘sildi', tusdi === 5, tusdi);
  check('xabar tushunarli', /ko.p urinish/i.test(oxirgi.payload.error || ''), oxirgi.payload);
}

flow('Boshqa manzil o\'z budjeti bilan keladi');
{
  /* Chegara IP bo'yicha, ya'ni bir odam to'silgani boshqa
     odamning kirishiga to'sqinlik qilmaydi. Aks holda bitta
     hujumchi hammani ilovadan chiqarib qo'yardi. */
  db.reset();
  for (let i = 0; i < 31; i += 1) await kodSora('+99890' + String(2000000 + i), '198.51.100.1');
  const boshqa = await kodSora('+998903334455', '198.51.100.2');
  check('boshqa manzil o‘tdi', boshqa.statusCode === 200, boshqa.payload);
}

flow('Manzil bilinmasa kirish to\'silmaydi');
{
  /* `x-forwarded-for` yo'q bo'lsa (mahalliy ishga tushirish,
     g'ayrioddiy proxy) odamni ilovadan chiqarib qo'yish eng
     yomon yo'l bo'lardi. */
  db.reset();
  for (let i = 0; i < 35; i += 1) await kodSora('+99890' + String(3000000 + i));
  const yana = await kodSora('+998904445566');
  check('manzilsiz so‘rov to‘silmadi', yana.statusCode !== 429, yana.statusCode);
}

flow('Chegara faqat kod yuboradigan amallarga tegishli');
{
  /* `login` kod yubormaydi va uning o'z chegarasi bor
     (`allowLoginAttempt`, raqam bo'yicha). Uni IP chegarasiga
     qo'shib qo'yish parolini to'g'ri bilgan odamni ham
     chiqarib yuborardi. */
  db.reset();
  for (let i = 0; i < 35; i += 1) await kodSora('+99890' + String(4000000 + i), '192.0.2.9');

  const res = makeRes();
  await authPhone({
    method: 'POST',
    headers: { 'x-forwarded-for': '192.0.2.9' },
    body: { action: 'login', phone: '+998905556677', password: 'parol1234' },
  }, res);
  check('kirish 429 bilan to‘silmadi', res.statusCode !== 429, res.statusCode);
}

flow('Xavfsizlik sarlavhalari joyida');
{
  /* `vercel.json` dagi sarlavhalar — kodda emas, sozlamada, ya'ni
     ularni tasodifan o'chirib qo'yish oson va buni hech narsa
     sezmaydi. Shuning uchun shu yerda tekshiriladi. */
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const { repo } = await import('./harness.mjs');
  const conf = JSON.parse(readFileSync(join(repo, 'vercel.json'), 'utf8'));

  const qoida = (source) => conf.headers.find((h) => h.source === source);
  const sarlavha = (source, key) => {
    const r = qoida(source);
    const h = r && r.headers.find((x) => x.key.toLowerCase() === key.toLowerCase());
    return h ? h.value : null;
  };

  check('hamma sahifada nosniff', sarlavha('/(.*)', 'X-Content-Type-Options') === 'nosniff');
  check('HSTS qo‘yilgan', /max-age=\d{7,}/.test(sarlavha('/(.*)', 'Strict-Transport-Security') || ''),
    sarlavha('/(.*)', 'Strict-Transport-Security'));
  check('Permissions-Policy bor', Boolean(sarlavha('/(.*)', 'Permissions-Policy')));
  check('to‘lov API si o‘chirilgan', /payment=\(\)/.test(sarlavha('/(.*)', 'Permissions-Policy') || ''));

  /* ADMIN PANELNI IFRAME GA OLIB BO'LMAYDI. Aks holda begona
     sayt uni ko'rinmas qilib ustiga tugma qo'yib, admin o'zi
     bilmagan amalni bosishi mumkin edi (clickjacking). */
  ['/admin', '/admin.html'].forEach((yol) => {
    check(yol + ' iframe ga olinmaydi', sarlavha(yol, 'X-Frame-Options') === 'DENY',
      sarlavha(yol, 'X-Frame-Options'));
    check(yol + ' uchun frame-ancestors none',
      /frame-ancestors 'none'/.test(sarlavha(yol, 'Content-Security-Policy') || ''),
      sarlavha(yol, 'Content-Security-Policy'));
    check(yol + ' keshlanmaydi', /no-store/.test(sarlavha(yol, 'Cache-Control') || ''),
      sarlavha(yol, 'Cache-Control'));
  });

  /* ILOVANING O'ZIGA `DENY` QO'YIB BO'LMAYDI: u Telegram Mini App
     ichida, ya'ni iframe'da ishlaydi. Shuning uchun umumiy
     qoidada X-Frame-Options BO'LMASLIGI kerak — bu tekshiruv
     "ehtiyot bo'lib" uni qo'shib qo'yishdan saqlaydi. */
  check('umumiy qoida iframe ni to‘smaydi (Telegram uchun)',
    sarlavha('/(.*)', 'X-Frame-Options') === null,
    sarlavha('/(.*)', 'X-Frame-Options'));
}

t.done();
