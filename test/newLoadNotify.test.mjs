/**
 * Yangi yuk haqida kimga, qachon xabar boradi.
 *
 *     node test/newLoadNotify.test.mjs      (yoki npm test)
 *
 * MUAMMO NIMA EDI. Xabar faqat SAQLANGAN QIDIRUVI bor odamga
 * ketardi. Qidiruv saqlash — ilovaning ichidagi ixtiyoriy amal va
 * deyarli hech kim qilmagan. Natijada yangi yuk chiqardi-yu, hech
 * kim bilmasdi: "haydovchilarga nega yuk yuborilmayapdi" degan
 * savolning sababi aynan shu edi.
 *
 * ENDI QANDAY. Ikki to'lqin:
 *
 *   1-to'lqin, DARHOL          — premium egalariga;
 *   2-to'lqin, BIR SOATDAN KEYIN — qolgan hammaga.
 *
 * Premiumning imtiyozi — vaqt. Yuk hammaga ochiq, faqat kim
 * birinchi taklif yuborishga ulguradi degan farq qoladi.
 *
 * Qidiruvi bor odam faqat o'sha qidiruvga mos yukni oladi: u nima
 * kerakligini aytib qo'ygan. Qidiruvi yo'q odam hammasini oladi.
 *
 * NIMA TEKSHIRILADI. Shu qoidalarning har biri, va eng muhimi
 * ikkita xavf: bir odamga ikki marta yuborilmasligi, hamda ikkinchi
 * to'lqinning jadvalsiz (cron'siz) haqiqatan yetib borishi.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
process.env.TELEGRAM_BOT_USERNAME = 'yoldatestbot';

import {
  db, loadApi, loadApiAll, loadLib, post, telegramMessages, clearOutgoing, runner,
} from './harness.mjs';

const t = runner();
const { flow, check } = t;

const auth = await loadApi('api/auth-phone.js', 'authphone');
const orderMod = await loadApiAll('api/order.js', 'order');
const order = orderMod.default;
const premium = await loadLib('premium.js');

/* ============================================================
   Yordamchilar
   ============================================================ */

/** Odam botni ochib, raqamini ulashgan holat — kod shunda yetadi. */
const linkBotChat = (phone, chatId = '555000111') => {
  db.strings.set(`phoneChat:${phone}`, chatId);
};

/** Telegram botiga ketgan oxirgi xabardan kodni oladi. */
const lastCode = () => {
  const sent = telegramMessages().map((m) => String((m && m.text) || '')).join('\n');
  return (/\b(\d{6})\b/.exec(sent) || [])[1];
};

/** Telefon orqali to'liq ro'yxatdan o'tish — haqiqiy kirish tokeni. */
const registerByPhone = async (phone) => {
  clearOutgoing();
  linkBotChat(phone);
  await post(auth, undefined, {
    action: 'register-start', phone, firstName: 'Bekzod', lastName: 'Rahimov', terms: true,
  });
  const code = lastCode();
  const verified = await post(auth, undefined, { action: 'verify', phone, code });
  const done = await post(auth, undefined, {
    action: 'set-password', phone, setupToken: verified.payload.setupToken, password: 'Yolda2026!',
  });
  return done.payload.phoneToken;
};

/**
 * Ro'yxatdagi odam: profili bor va Telegram'i bog'langan.
 *
 * Ikkalasi ham kerak. `profile_emails` — ikkinchi to'lqin kimga
 * ketishini belgilaydi; `tgChat:` esa bildirishnoma yetib boradigan
 * manzil. Ilova ichidagi yozuv (`notifs:`) ikkalasisiz ham
 * yoziladi, lekin biz ikkala kanalni ham tekshiramiz.
 */
const addPerson = (identity, { search } = {}) => {
  db.strings.set(`profile:${identity}`, JSON.stringify({ displayName: identity }));
  if (!db.sets.has('profile_emails')) db.sets.set('profile_emails', new Set());
  db.sets.get('profile_emails').add(identity);
  db.strings.set(`tgChat:${identity}`, '9' + Math.random().toString().slice(2, 10));
  if (search) db.strings.set(`searches:${identity}`, JSON.stringify([search]));
};

/** Shu odam shu yuk haqida ilovada xabar oldimi. */
const gotInApp = (identity, needle = 'Yangi yuk') => {
  const list = db.lists.get(`notifs:${identity}`) || [];
  return list.filter((raw) => {
    try { return JSON.parse(raw).title === needle; } catch { return false; }
  }).length;
};

let phoneSeq = 0;
const nextPhone = () => `+99890${String(3000000 + (++phoneSeq)).slice(0, 7)}`;

/** Yangi yuk joylaydi va kodini qaytaradi. */
const postLoad = async (token, extra = {}) => {
  const res = await post(order, undefined, {
    phoneToken: token,
    fromCity: 'Toshkent', toCity: 'Samarqand',
    weightKg: 12000, cargoType: 'GENERAL',
    name: 'Alisher', phone: nextPhone(),
    ...extra,
  });
  if (res.statusCode !== 200) throw new Error('yuk joylanmadi: ' + JSON.stringify(res.payload));
  return res.payload.code;
};

/** Bir soat o'tgandek qilamiz: navbatdagi ishning vaqtini orqaga suramiz. */
const fastForward = () => {
  const list = db.lists.get('notify_queue') || [];
  db.lists.set('notify_queue', list.map((raw) => {
    try {
      const job = JSON.parse(raw);
      return JSON.stringify({ ...job, dueAt: Date.now() - 1000 });
    } catch { return raw; }
  }));
  db.strings.set('notify_queue_next', String(Date.now() - 1000));
};

const fresh = () => { db.reset(); clearOutgoing(); };

/* ============================================================
   1. Qidiruvi yo'q haydovchi ham xabar oladi
   ============================================================ */
flow('1. Qidiruvi yo\'q haydovchi ham xabar oladi');
{
  fresh();
  const token = await registerByPhone('+998901110001');
  addPerson('ph:998901110002');          // qidiruvi yo'q — oddiy haydovchi

  const code = await postLoad(token);
  check('yuk joylandi', Boolean(code), code);

  /* Premium emas, ya'ni darhol olmaydi — bu kutilgan holat. */
  check('darhol kelmadi (premium emas)', gotInApp('ph:998901110002') === 0);
  check('navbatga qo\'yildi', (db.lists.get('notify_queue') || []).length === 1,
    db.lists.get('notify_queue'));

  fastForward();
  await orderMod.sweepNotifyQueue();

  check('bir soatdan keyin keldi', gotInApp('ph:998901110002') === 1,
    gotInApp('ph:998901110002'));
  check('Telegram orqali ham ketdi',
    telegramMessages().some((m) => String((m && m.text) || '').includes('Yangi yuk')));
}

/* ============================================================
   2. Premium darhol oladi, qolganlar keyin
   ============================================================ */
flow('2. Premium darhol oladi, qolganlar keyin');
{
  fresh();
  const token = await registerByPhone('+998901110010');
  addPerson('ph:998901110011');
  addPerson('ph:998901110012');
  await premium.grantPremium('ph:998901110011');

  await postLoad(token);

  check('premium darhol oldi', gotInApp('ph:998901110011') === 1,
    gotInApp('ph:998901110011'));
  check('oddiy haydovchi hali olmadi', gotInApp('ph:998901110012') === 0,
    gotInApp('ph:998901110012'));

  fastForward();
  await orderMod.sweepNotifyQueue();

  check('oddiy haydovchi keyin oldi', gotInApp('ph:998901110012') === 1);
  check('premiumga IKKI MARTA yuborilmadi', gotInApp('ph:998901110011') === 1,
    gotInApp('ph:998901110011'));
}

/* ============================================================
   3. Yuk egasiga o'z yukining xabari kelmaydi
   ============================================================ */
flow('3. Yuk egasiga o\'z yukining xabari kelmaydi');
{
  fresh();
  const phone = '+998901110020';
  const token = await registerByPhone(phone);

  /* Egasining shaxsi qo'lda yozilmaydi — koddan olinadi.
     Telefon bilan kirgan odam, agar bot uning raqamini bilsa,
     o'sha Telegram akkaunti bo'lib hisoblanadi (lib/phoneAuth.js):
     ya'ni shaxs `ph:<raqam>` emas, `tg:<chat id>`. Buni qo'lda
     taxmin qilish testni yolg'on qiladi — xato kodda emas, o'sha
     taxminda bo'lib chiqadi. */
  const code = await postLoad(token);
  const owner = db.json(`order:${code}`).ownerIdentity;
  check('egasining shaxsi yozilgan', Boolean(owner), owner);

  addPerson(owner);
  await premium.grantPremium(owner);     // premium bo'lsa ham

  await postLoad(token, { fromCity: 'Toshkent', toCity: 'Buxoro' });
  check('egasiga darhol kelmadi', gotInApp(owner) === 0, gotInApp(owner));

  fastForward();
  await orderMod.sweepNotifyQueue();
  check('egasiga keyin ham kelmadi', gotInApp(owner) === 0, gotInApp(owner));
}

/* ============================================================
   4. Qidiruv saqlagan odam faqat mos yukni oladi
   ============================================================ */
flow('4. Qidiruv saqlagan odam faqat mos yukni oladi');
{
  fresh();
  const token = await registerByPhone('+998901110030');
  // Faqat Buxorodan ketadigan yuklarni kutadi.
  addPerson('ph:998901110031', { search: { fromCity: 'Buxoro' } });
  // Hech narsa saqlamagan.
  addPerson('ph:998901110032');

  await postLoad(token, { fromCity: 'Toshkent', toCity: 'Samarqand' });
  fastForward();
  await orderMod.sweepNotifyQueue();

  check('qidiruviga mos kelmagani yuborilmadi', gotInApp('ph:998901110031') === 0,
    gotInApp('ph:998901110031'));
  check('qidiruvi yo\'q odam oldi', gotInApp('ph:998901110032') === 1);

  await postLoad(token, { fromCity: 'Buxoro', toCity: 'Toshkent' });
  fastForward();
  await orderMod.sweepNotifyQueue();

  check('qidiruviga mos yuk keldi', gotInApp('ph:998901110031') === 1,
    gotInApp('ph:998901110031'));
}

/* ============================================================
   5. Navbat ikki marta bo'shatilsa ham xabar ikkilanmaydi
   ============================================================ */
flow('5. Navbat ikki marta bo\'shatilsa ham xabar ikkilanmaydi');
{
  fresh();
  const token = await registerByPhone('+998901110040');
  addPerson('ph:998901110041');

  await postLoad(token);
  fastForward();
  /* Ikki so'rov bir vaqtda navbatni bo'shatmoqchi bo'ladi —
     amalda shunday bo'lishi mumkin, chunki navbat so'rovlar
     ichida bo'shatiladi. */
  await Promise.all([orderMod.sweepNotifyQueue(), orderMod.sweepNotifyQueue()]);

  check('xabar bir marta keldi', gotInApp('ph:998901110041') === 1,
    gotInApp('ph:998901110041'));
  check('navbat bo\'shadi', (db.lists.get('notify_queue') || []).length === 0,
    db.lists.get('notify_queue'));
}

/* ============================================================
   6. Yuk olingan bo'lsa, ikkinchi to'lqin bekor bo'ladi
   ============================================================ */
flow('6. Yuk olingan bo\'lsa, ikkinchi to\'lqin bekor bo\'ladi');
{
  fresh();
  const token = await registerByPhone('+998901110050');
  addPerson('ph:998901110051');

  const code = await postLoad(token);
  // Yukni kimdir olgan deb belgilaymiz.
  const rec = db.json(`order:${code}`);
  db.strings.set(`order:${code}`, JSON.stringify({ ...rec, status: 'DRIVER_FOUND' }));

  fastForward();
  await orderMod.sweepNotifyQueue();

  check('olingan yuk haqida xabar ketmadi', gotInApp('ph:998901110051') === 0,
    gotInApp('ph:998901110051'));
}

/* ============================================================
   7. Premium muddati tugasa, imtiyoz ham tugaydi
   ============================================================ */
flow('7. Premium muddati tugasa, imtiyoz ham tugaydi');
{
  fresh();
  const token = await registerByPhone('+998901110060');
  addPerson('ph:998901110061');
  // Kechagi kunda tugagan premium.
  await premium.grantPremium('ph:998901110061', Date.now() - 86400000);

  check('isPremium false qaytaradi', (await premium.isPremium('ph:998901110061')) === false);

  await postLoad(token);
  check('muddati tuganga darhol kelmadi', gotInApp('ph:998901110061') === 0);

  fastForward();
  await orderMod.sweepNotifyQueue();
  check('u ham qolganlar bilan birga oldi', gotInApp('ph:998901110061') === 1);
}

/* ============================================================
   8. Premium berish va olib tashlash
   ============================================================ */
flow('8. Premium berish va olib tashlash');
{
  fresh();
  check('boshida premium emas', (await premium.isPremium('ph:998901110070')) === false);

  await premium.grantPremium('ph:998901110070');
  check('berilgach premium', (await premium.isPremium('ph:998901110070')) === true);
  check('ro\'yxatda ko\'rinadi', (await premium.premiumMembers()).includes('ph:998901110070'));

  const state = await premium.premiumState('ph:998901110070');
  check('holati muddatsiz', state.premium === true && state.premiumUntil === undefined, state);

  await premium.revokePremium('ph:998901110070');
  check('olib tashlangach premium emas', (await premium.isPremium('ph:998901110070')) === false);
  check('ro\'yxatdan ham chiqdi', !(await premium.premiumMembers()).includes('ph:998901110070'));
}

t.done(8);
