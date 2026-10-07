/**
 * YIGIRMA OQIM — odamning yo'li boshidan oxirigacha.
 *
 *     node test/flows.test.mjs      (yoki npm test)
 *
 * Qolgan to'plamlar modullarni alohida sinaydi: "bu funksiya shu
 * holatda nima qaytaradi". Bu to'plam boshqacha savol beradi:
 * "odam ilovaga kirib, yuk joylab, haydovchi tanlab, yukni
 * yetkazib, baho qoldira oladimi — boshidan oxirigacha?"
 *
 * Shuning uchun bu yerda modullar emas, ENDPOINTLAR chaqiriladi
 * va hammasi bitta bazani bo'lishadi (test/harness.mjs). Oraliq
 * natijalar qo'lda yozib qo'yilmaydi: bir qadamda chiqqan kod
 * keyingi qadamga o'tadi, xuddi haqiqiy ilovadagi kabi.
 *
 * Tarmoqqa hech narsa chiqmaydi, lekin kodning o'zi to'liq
 * ishlaydi: telefon orqali olingan token haqiqiy `lib/identity.js`
 * da tekshiriladi, Google tokeni haqiqiy `lib/google.js` da.
 *
 * Oqimlar ro'yxati:
 *
 *    1. Telefon raqami bilan ro'yxatdan o'tish
 *    2. Noto'g'ri kod bilan kirib bo'lmaydi
 *    3. Kod bir marta ishlaydi
 *    4. Kirmagan odam hech narsa qila olmaydi
 *    5. Profil yaratish va username band qilish
 *    6. Yuk joylash va narxning hisoblanishi
 *    7. Ochiq ro'yxatda telefon raqam ko'rinmaydi
 *    8. Yuklarni filtrlash
 *    9. Haydovchi taklif yuboradi
 *   10. Haydovchi boshqalarning narxini ko'rmaydi
 *   11. Taklif qabul qilinadi va raqamlar ochiladi
 *   12. Band haydovchiga ikkinchi yuk berilmaydi
 *   13. "Mening yukim" bitta yukni to'liq beradi
 *   14. Bosqichlar zanjiri: topildi → yetkazildi
 *   15. Begona odam bosqichni sura olmaydi
 *   16. Haydovchi yukdan voz kechadi
 *   17. Yuk beruvchi haydovchini bo'shatadi va bekor qiladi
 *   18. Yetkazilgach ikkala tomon baho qoldiradi
 *   19. Xabarlashuv va o'qilmagan xabarlar
 *   20. Akkauntni o'chirish: shaxsiy ketadi, tarix anonim qoladi
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
process.env.TELEGRAM_BOT_USERNAME = 'yoldatestbot';

import {
  db, loadApi, post, get, telegramMessages, clearOutgoing, runner,
} from './harness.mjs';

const t = runner();
const { flow, check } = t;

const auth = await loadApi('api/auth-phone.js', 'authphone');
const order = await loadApi('api/order.js', 'order');
const chat = await loadApi('api/chat.js', 'chat');
const profile = await loadApi('api/profile.js', 'profile');

/* ============================================================
   Yordamchilar
   ============================================================ */

/**
 * Odam botni ochib, raqamini ulashgan holat.
 *
 * Busiz kod yetib bormaydi: `deliverCode` avval `phoneChat:<raqam>`
 * ni qidiradi va topmasa javobda "botga boring" deb aytadi (delivery
 * "bot"). Bu ataylab shunday — bot odamni tanimasa, unga yozib
 * bo'lmaydi. Oqim testlarida esa odam botni allaqachon ochgan
 * bo'lishi kerak, shuning uchun bog'lanish shu yerda tayyorlanadi.
 */
const linkBotChat = (phone, chatId = '555000111') => {
  db.strings.set(`phoneChat:${phone}`, chatId);
};

/**
 * Hisobini Telegram bilan bog'lagan odam.
 *
 * Bildirishnoma aynan shu kalit orqali yetib boradi (lib/notify.js):
 * bog'lanish bo'lmasa, bot xabar yuboradigan joy yo'q va hech narsa
 * ketmaydi. Ya'ni "xabar bordi" degan tasdiq faqat bog'langan
 * hisobda ma'noga ega.
 */
const linkTelegram = (identity, chatId) => {
  db.strings.set(`tgChat:${identity}`, String(chatId));
};

/** Telegram botiga ketgan oxirgi xabardan kodni oladi. */
const lastCode = () => {
  const sent = telegramMessages().map((m) => String(m && m.text || '')).join('\n');
  return (/\b(\d{6})\b/.exec(sent) || [])[1];
};

/**
 * Telefon orqali to'liq ro'yxatdan o'tish: kod so'rash → kodni
 * tasdiqlash → parol qo'yish. Oxirida haqiqiy kirish tokeni.
 */
const registerByPhone = async (phone, password = 'Yolda2026!') => {
  clearOutgoing();
  linkBotChat(phone);
  const started = await post(auth, undefined, {
    action: 'register-start', phone, firstName: 'Bekzod', lastName: 'Rahimov', terms: true,
  });
  if (started.statusCode !== 200) throw new Error('register-start: ' + JSON.stringify(started.payload));

  const code = lastCode();
  if (!code) throw new Error('kod yuborilmadi');

  const verified = await post(auth, undefined, { action: 'verify', phone, code });
  if (!verified.payload || !verified.payload.setupToken) {
    throw new Error('setupToken berilmadi: ' + JSON.stringify(verified.payload));
  }

  const done = await post(auth, undefined, {
    action: 'set-password', phone, setupToken: verified.payload.setupToken, password,
  });
  if (!done.payload || !done.payload.phoneToken) {
    throw new Error('token berilmadi: ' + JSON.stringify(done.payload));
  }
  return { token: done.payload.phoneToken, code, setupToken: verified.payload.setupToken, password };
};

/* Profilni saqlash — `action` siz oddiy POST (api/profile.js
   oxiridagi dispatcher'ga qarang: `save` butunlay boshqa narsa,
   u saralanganlarni qo'shadi). */
const makeProfile = async (creds, fields) => post(profile, undefined, { ...creds, ...fields });

/* Yuk joylashda bir xil raqamdan ketma-ket yuborish XOTIRADAGI
   cheklagich bilan to'xtatiladi (api/order.js, `isThrottled`). U
   modul ichida yashaydi, ya'ni bazani tozalash uni nolga
   qaytarmaydi. Shuning uchun har bir yuk o'z raqami bilan
   joylanadi — xuddi haqiqatda har bir yukni boshqa odam
   joylagandek. */
let phoneSeq = 0;
const nextPhone = () => `+99890${String(2000000 + (++phoneSeq)).slice(0, 7)}`;

/** Yangi yuk joylaydi. */
const postLoad = async (creds, extra = {}) => post(order, undefined, {
  ...creds,
  fromCity: 'Toshkent', toCity: 'Samarqand',
  weightKg: 12000, cargoType: 'GENERAL',
  name: 'Alisher', phone: nextPhone(),
  ...extra,
});

/** Telegram botiga ketgan xabarlar ichida shu matn bormi. */
const notified = (needle) => telegramMessages()
  .some((m) => String(m && m.text || '').includes(needle));

/* Har bir oqim toza bazadan boshlanadi: biri ikkinchisiga
   tasodifan ta'sir qilmasin. */
const fresh = () => { db.reset(); clearOutgoing(); };

/* ============================================================
   1. Telefon raqami bilan ro'yxatdan o'tish
   ============================================================ */
flow('1. Telefon raqami bilan ro\'yxatdan o\'tish');
{
  fresh();
  const phone = '+998901110001';

  clearOutgoing();
  linkBotChat(phone);
  const started = await post(auth, undefined, {
    action: 'register-start', phone, firstName: 'Bekzod', lastName: 'Rahimov', terms: true,
  });
  check('kod so\'raldi', started.statusCode === 200, started.payload);
  check('kod Telegram orqali yetkazildi', started.payload.delivery === 'telegram',
    started.payload.delivery);

  const msgs = telegramMessages();
  check('bot xabar yubordi', msgs.length >= 1, msgs.length);
  const code = lastCode();
  check('kod 6 xonali', /^\d{6}$/.test(String(code)), msgs[0] && msgs[0].text);

  /* ENG MUHIM TASDIQ: kodning o'zi hech qachon frontendga
     qaytmaydi — faqat Telegram orqali boradi. */
  check('kod javobda YO\'Q',
    Boolean(code) && !JSON.stringify(started.payload).includes(code), started.payload);

  /* Bazada kodning o'zi emas, qaytarib bo'lmaydigan hash'i turadi. */
  const stored = [...db.strings.entries()]
    .filter(([k]) => /otp|code/i.test(k))
    .map(([, v]) => v).join('');
  check('kod bazada ochiq saqlanmaydi', Boolean(code) && !stored.includes(code),
    { stored: stored.slice(0, 60) });

  const verified = await post(auth, undefined, { action: 'verify', phone, code });
  check('kod tasdiqlandi', verified.statusCode === 200, verified.payload);
  check('parol qo\'yish uchun vaqtinchalik token berildi',
    Boolean(verified.payload && verified.payload.setupToken));

  /* Faqat kod bilan kirib bo'lmaydi — parol qo'yish shart. */
  const weak = await post(auth, undefined, {
    action: 'set-password', phone, setupToken: verified.payload.setupToken, password: '123',
  });
  check('zaif parol qabul qilinmaydi', weak.statusCode === 400, weak.payload);

  const done = await post(auth, undefined, {
    action: 'set-password', phone, setupToken: verified.payload.setupToken, password: 'Yolda2026!',
  });
  check('parol qo\'yildi va kirildi', done.statusCode === 200, done.payload);
  check('kirish tokeni berildi', Boolean(done.payload && done.payload.phoneToken));

  /* Token haqiqiy identity.js da tekshiriladi — soxta emas. */
  const me = await get(order, { action: 'my-load', phoneToken: done.payload.phoneToken });
  check('token boshqa endpointda ham ishlaydi', me.statusCode === 200, me.statusCode);

  /* Endi parol bilan qayta kirish mumkin. */
  const back = await post(auth, undefined, { action: 'login', phone, password: 'Yolda2026!' });
  check('parol bilan qayta kirildi', back.statusCode === 200, back.payload);

  const wrong = await post(auth, undefined, { action: 'login', phone, password: 'boshqa' });
  check('noto\'g\'ri parol rad etildi', wrong.statusCode === 401, wrong.statusCode);
  check('javob raqam bor-yo\'qligini oshkor qilmaydi',
    /noto|Raqam yoki parol/i.test(String(wrong.payload && wrong.payload.error)), wrong.payload);
}

/* ============================================================
   2. Noto'g'ri kod bilan kirib bo'lmaydi
   ============================================================ */
flow('2. Noto\'g\'ri kod bilan kirib bo\'lmaydi');
{
  fresh();
  const phone = '+998901110002';
  clearOutgoing();
  linkBotChat(phone);
  await post(auth, undefined, {
    action: 'register-start', phone, firstName: 'Bekzod', lastName: 'Rahimov', terms: true,
  });
  const right = lastCode();

  const bad = await post(auth, undefined, { action: 'verify', phone, code: '000000' });
  check('noto\'g\'ri kod rad etildi', bad.statusCode === 400, bad.statusCode);
  check('vaqtinchalik token berilmadi', !(bad.payload && bad.payload.setupToken), bad.payload);
  check('nechta urinish qolgani aytildi',
    Number.isFinite(bad.payload && bad.payload.attemptsLeft), bad.payload);

  /* Cheksiz urinib ko'rib bo'lmaydi: urinishlar tugagach kod
     butunlay kuchini yo'qotadi — to'g'risi ham ishlamaydi. */
  let last = bad;
  for (let i = 0; i < 6; i++) {
    last = await post(auth, undefined, { action: 'verify', phone, code: '111111' });
  }
  check('urinishlar soni cheklangan', last.statusCode === 400, last.statusCode);

  const tooLate = await post(auth, undefined, { action: 'verify', phone, code: right });
  check('urinishlar tugagach to\'g\'ri kod ham ishlamaydi',
    tooLate.statusCode === 400, { status: tooLate.statusCode, body: tooLate.payload });
}

/* ============================================================
   3. Kod bir marta ishlaydi
   ============================================================ */
flow('3. Kod bir marta ishlaydi');
{
  fresh();
  const phone = '+998901110003';
  const { token, code, setupToken, password } = await registerByPhone(phone);
  check('ro\'yxatdan o\'tildi', Boolean(token));

  const again = await post(auth, undefined, { action: 'verify', phone, code });
  check('o\'sha kod ikkinchi marta ishlamaydi', again.statusCode === 400, again.statusCode);

  /* Parol qo'yish uchun berilgan vaqtinchalik token ham ikkinchi
     marta ishlamaydi: akkaunt allaqachon yaratilgan. */
  const reuse = await post(auth, undefined, {
    action: 'set-password', phone, setupToken, password: 'Boshqa2026!',
  });
  check('vaqtinchalik token qayta ishlatilmaydi', reuse.statusCode === 409, reuse.statusCode);
  check('eski parol hali ham ishlaydi',
    (await post(auth, undefined, { action: 'login', phone, password })).statusCode === 200);

  /* Ro'yxatdan o'tgan raqamga qaytadan ro'yxatdan o'tib bo'lmaydi. */
  const dup = await post(auth, undefined, {
    action: 'register-start', phone, firstName: 'Kim', lastName: 'Dir', terms: true,
  });
  check('raqam ikki marta ro\'yxatdan o\'tmaydi', dup.statusCode === 409, dup.statusCode);
}

/* ============================================================
   4. Kirmagan odam hech narsa qila olmaydi
   ============================================================ */
flow('4. Kirmagan odam hech narsa qila olmaydi');
{
  fresh();
  const cases = [
    ['yuk joylash', await postLoad({})],
    ['taklif yuborish', await post(order, 'offer', { code: 'YL1', price: 900000 })],
    ['bosqichni surish', await post(order, 'advance', { code: 'YL1' })],
    ['voz kechish', await post(order, 'giveup', { code: 'YL1' })],
    ['xabar yuborish', await post(chat, 'send', { toUsername: 'kimdir', text: 'salom' })],
    ['profilni saqlash', await post(profile, 'save', { username: 'kimdir' })],
    ['akkauntni o\'chirish', await post(profile, 'delete-account', { confirm: true })],
  ];
  for (const [what, res] of cases) {
    check(`${what} — 401`, res.statusCode === 401, { what, status: res.statusCode });
  }

  /* Ochiq ro'yxat esa kirishsiz ham ko'rinadi — Play tekshiruvchisi
     ham, yangi kelgan odam ham avval shuni ko'radi. */
  const list = await get(order, { action: 'list' });
  check('ochiq yuklar ro\'yxati kirishsiz ko\'rinadi', list.statusCode === 200, list.statusCode);
}

/* ============================================================
   5. Profil yaratish va username band qilish
   ============================================================ */
flow('5. Profil yaratish va username band qilish');
{
  fresh();
  const a = { googleIdToken: 'driver1@example.com' };
  const b = { googleIdToken: 'driver2@example.com' };

  const made = await makeProfile(a, { username: 'bekzod', displayName: 'Bekzod Rahimov', city: 'Toshkent', role: 'DRIVER' });
  check('profil saqlandi', made.statusCode === 200, made.payload);
  check('username yozildi', db.strings.get('username:bekzod') === 'driver1@example.com',
    db.strings.get('username:bekzod'));

  const clash = await makeProfile(b, { username: 'Bekzod' });
  check('band username boshqaga berilmaydi', clash.statusCode >= 400, clash.statusCode);
  check('egasi o\'zgarmadi', db.strings.get('username:bekzod') === 'driver1@example.com');

  /* O'z profilini o'zgartirish mumkin, begonanikini — yo'q. */
  const rename = await makeProfile(a, { displayName: 'Bekzod R.' });
  check('o\'z profilini o\'zgartira oladi', rename.statusCode === 200, rename.payload);
  check('yangi ism saqlandi',
    (db.json('profile:driver1@example.com') || {}).displayName === 'Bekzod R.');
}

/* ============================================================
   6. Yuk joylash va narxning hisoblanishi
   ============================================================ */
flow('6. Yuk joylash va narxning hisoblanishi');
{
  fresh();
  const shipper = { googleIdToken: 'shipper@example.com' };

  const res = await postLoad(shipper);
  check('yuk joylandi', res.statusCode === 200, res.payload);
  check('kod berildi', /^YL/.test(String(res.payload.code)), res.payload.code);
  check('narx hisoblandi', Number(res.payload.amount) > 0, res.payload.amount);
  check('masofa topildi', Number(res.payload.distanceKm) === 300, res.payload.distanceKm);

  const saved = db.json(`order:${res.payload.code}`);
  check('holati NEW', saved.status === 'NEW', saved.status);
  check('egasi yozildi', saved.ownerIdentity === 'shipper@example.com', saved.ownerIdentity);

  /* Noto'g'ri ma'lumot qabul qilinmaydi. */
  const noWeight = await postLoad(shipper, { weightKg: 0 });
  check('og\'irliksiz yuk rad etildi', noWeight.statusCode === 400, noWeight.statusCode);
  const sameCity = await postLoad(shipper, { toCity: 'Toshkent' });
  check('bir xil shahar rad etildi', sameCity.statusCode === 400, sameCity.statusCode);
}

/* ============================================================
   7. Ochiq ro'yxatda telefon raqam ko'rinmaydi
   ============================================================ */
flow('7. Ochiq ro\'yxatda telefon raqam ko\'rinmaydi');
{
  fresh();
  const shipper = { googleIdToken: 'shipper@example.com' };
  const phone = nextPhone();
  const made = await postLoad(shipper, { phone });
  const code = made.payload.code;
  const bare = phone.replace('+', '');

  const list = await get(order, { action: 'list' });
  const blob = JSON.stringify(list.payload);
  check('yuk ro\'yxatda bor', blob.includes(code), code);
  check('telefon raqam ro\'yxatda YO\'Q', !blob.includes(bare), 'raqam ko\'rinib qoldi');
  check('pochta manzili ro\'yxatda YO\'Q', !blob.includes('shipper@example.com'));

  const detail = await get(order, { action: 'detail', code });
  const dblob = JSON.stringify(detail.payload);
  check('yuk sahifasida ham raqam yo\'q', !dblob.includes(bare));
  check('yuk sahifasida pochta yo\'q', !dblob.includes('shipper@example.com'));
}

/* ============================================================
   8. Yuklarni filtrlash
   ============================================================ */
flow('8. Yuklarni filtrlash');
{
  fresh();
  const shipper = { googleIdToken: 'shipper@example.com' };
  await postLoad(shipper, { toCity: 'Samarqand', weightKg: 12000 });
  await postLoad(shipper, { fromCity: 'Buxoro', toCity: 'Nukus', weightKg: 3000 });

  const all = await get(order, { action: 'list' });
  check('ikkala yuk ham ro\'yxatda', (all.payload.loads || []).length === 2,
    (all.payload.loads || []).length);

  const byCity = await get(order, { action: 'list', fromCity: 'Buxoro' });
  const cities = (byCity.payload.loads || []).map((l) => l.fromCity);
  check('shahar bo\'yicha filtr ishlaydi',
    cities.length === 1 && cities[0] === 'Buxoro', cities);

  const heavy = await get(order, { action: 'list', minWeight: '10000' });
  const weights = (heavy.payload.loads || []).map((l) => l.weightKg);
  check('og\'irlik bo\'yicha filtr ishlaydi',
    weights.length === 1 && weights[0] === 12000, weights);
}

/* ============================================================
   9. Haydovchi taklif yuboradi
   ============================================================ */
flow('9. Haydovchi taklif yuboradi');
{
  fresh();
  const shipper = { googleIdToken: 'shipper@example.com' };
  const driver = { googleIdToken: 'driver1@example.com' };
  await makeProfile(shipper, { username: 'alisher', displayName: 'Alisher' });
  await makeProfile(driver, { username: 'bekzod', displayName: 'Bekzod', phone: '+998901119988' });

  const code = (await postLoad(shipper)).payload.code;

  const own = await post(order, 'offer', { ...shipper, code, price: 900000 });
  check('o\'z yukiga taklif yuborib bo\'lmaydi', own.statusCode === 400, own.statusCode);

  const noPrice = await post(order, 'offer', { ...driver, code });
  check('narxsiz taklif rad etildi', noPrice.statusCode === 400, noPrice.statusCode);

  clearOutgoing();
  const sent = await post(order, 'offer', { ...driver, code, price: 900000, eta: 'Ertaga ertalab' });
  check('taklif yuborildi', sent.statusCode === 200, sent.payload);
  check('holati PENDING', sent.payload.offer.status === 'PENDING', sent.payload.offer);
  check('haydovchining ismi taklifga ko\'chdi',
    sent.payload.offer.driverName === 'Bekzod', sent.payload.offer.driverName);

  /* Bir haydovchidan ikkita kutilayotgan taklif bo'lmaydi —
     yuk beruvchi bir odamdan ikkita narx ko'rmasin. */
  const again = await post(order, 'offer', { ...driver, code, price: 850000 });
  check('qayta yuborilgan taklif yangilandi', again.payload.updated === true, again.payload);
  check('narx yangilandi', again.payload.offer.price === 850000, again.payload.offer.price);
}

/* ============================================================
   10. Haydovchi boshqalarning narxini ko'rmaydi
   ============================================================ */
flow('10. Haydovchi boshqalarning narxini ko\'rmaydi');
{
  fresh();
  const shipper = { googleIdToken: 'shipper@example.com' };
  const d1 = { googleIdToken: 'driver1@example.com' };
  const d2 = { googleIdToken: 'driver2@example.com' };
  await makeProfile(d1, { username: 'bekzod', displayName: 'Bekzod' });
  await makeProfile(d2, { username: 'sardor', displayName: 'Sardor' });

  const code = (await postLoad(shipper)).payload.code;
  await post(order, 'offer', { ...d1, code, price: 900000 });
  await post(order, 'offer', { ...d2, code, price: 820000 });

  const owner = await get(order, { action: 'offers', code, ...shipper });
  check('yuk beruvchi ikkala taklifni ko\'radi',
    (owner.payload.offers || []).length === 2, (owner.payload.offers || []).length);

  const mine = await get(order, { action: 'offers', code, ...d1 });
  const seen = (mine.payload.offers || []);
  check('haydovchi faqat o\'z taklifini ko\'radi', seen.length === 1, seen.length);
  check('raqobatchining narxi ko\'rinmaydi',
    !JSON.stringify(seen).includes('820000'), seen);
}

/* ============================================================
   11. Taklif qabul qilinadi va raqamlar ochiladi
   ============================================================ */
flow('11. Taklif qabul qilinadi va raqamlar ochiladi');
{
  fresh();
  const shipper = { googleIdToken: 'shipper@example.com' };
  const driver = { googleIdToken: 'driver1@example.com' };
  await makeProfile(shipper, { username: 'alisher', displayName: 'Alisher Qodirov' });
  await makeProfile(driver, { username: 'bekzod', displayName: 'Bekzod' });
  // Haydovchi hisobini Telegram bilan bog'lagan — bildirishnoma
  // unga aynan shu yo'l bilan yetadi.
  linkTelegram('driver1@example.com', 777001);

  const phone = nextPhone();
  const code = (await postLoad(shipper, { phone })).payload.code;
  const offer = (await post(order, 'offer', { ...driver, code, price: 900000 })).payload.offer;

  /* Begona odam taklifni qabul qila olmaydi. */
  const stranger = await post(order, 'accept-offer', { googleIdToken: 'nobody@example.com', id: offer.id });
  check('begona odam taklifni qabul qila olmaydi', stranger.statusCode >= 400, stranger.statusCode);

  clearOutgoing();
  const accepted = await post(order, 'accept-offer', { ...shipper, id: offer.id });
  check('taklif qabul qilindi', accepted.statusCode === 200, accepted.payload);

  const saved = db.json(`order:${code}`);
  check('holat DRIVER_FOUND', saved.status === 'DRIVER_FOUND', saved.status);
  check('haydovchi biriktirildi',
    saved.driver && saved.driver.identity === 'driver1@example.com', saved.driver);
  check('kelishilgan narx saqlandi', saved.agreedAmount === 900000, saved.agreedAmount);

  /* Raqam aynan shu paytda, faqat tanlangan haydovchiga boradi. */
  check('haydovchiga mijozning raqami yuborildi', notified(phone.replace('+', '')));

  const mine = await get(order, { action: 'my-load', ...driver });
  check('"Mening yukim"da raqam ochiq',
    mine.payload.load && mine.payload.load.owner.phone === phone,
    mine.payload.load && mine.payload.load.owner);
}

/* ============================================================
   12. Band haydovchiga ikkinchi yuk berilmaydi
   ============================================================ */
flow('12. Band haydovchiga ikkinchi yuk berilmaydi');
{
  fresh();
  const shipper = { googleIdToken: 'shipper@example.com' };
  const driver = { googleIdToken: 'driver1@example.com' };
  await makeProfile(driver, { username: 'bekzod', displayName: 'Bekzod' });

  const a = (await postLoad(shipper, { toCity: 'Samarqand' })).payload.code;
  const b = (await postLoad(shipper, { toCity: 'Buxoro' })).payload.code;
  const offerA = (await post(order, 'offer', { ...driver, code: a, price: 900000 })).payload.offer;
  const offerB = (await post(order, 'offer', { ...driver, code: b, price: 950000 })).payload.offer;

  const first = await post(order, 'accept-offer', { ...shipper, id: offerA.id });
  check('birinchi taklif qabul qilindi', first.statusCode === 200, first.payload);

  const second = await post(order, 'accept-offer', { ...shipper, id: offerB.id });
  check('ikkinchisi rad etildi', second.statusCode === 409, second.statusCode);
  check('sabab tushunarli',
    /boshqa yukni/.test(String(second.payload && second.payload.error)), second.payload);
  check('ikkinchi yuk hali ham ochiq', db.json(`order:${b}`).status === 'NEW');

  /* Haydovchi bo'shagach ikkinchisi qabul qilinadi. */
  await post(order, 'giveup', { ...driver, code: a });
  const retry = await post(order, 'accept-offer', { ...shipper, id: offerB.id });
  check('bo\'shagach qabul qilindi', retry.statusCode === 200, retry.payload);
}

/* ============================================================
   13. "Mening yukim" bitta yukni to'liq beradi
   ============================================================ */
flow('13. "Mening yukim" bitta yukni to\'liq beradi');
{
  fresh();
  const shipper = { googleIdToken: 'shipper@example.com' };
  const driver = { googleIdToken: 'driver1@example.com' };
  await makeProfile(shipper, { username: 'alisher', displayName: 'Alisher Qodirov' });
  await makeProfile(driver, { username: 'bekzod', displayName: 'Bekzod' });

  const empty = await get(order, { action: 'my-load', ...driver });
  check('yuk yo\'q paytda bo\'sh qaytadi', empty.payload.load === null, empty.payload);

  /* Mashina turi erkin matn emas — api/order.js dagi ro'yxatdan
     bo'lishi kerak (VEHICLE_TYPES). */
  const code = (await postLoad(shipper, {
    truckType: 'YARIM_TREYLER', pickupDate: '2026-10-12',
  })).payload.code;
  const offer = (await post(order, 'offer', { ...driver, code, price: 2400000 })).payload.offer;
  await post(order, 'accept-offer', { ...shipper, id: offer.id });

  const mine = await get(order, { action: 'my-load', ...driver });
  const L = mine.payload.load;
  check('yuk qaytdi', Boolean(L) && L.code === code, L && L.code);
  check('yo\'nalish bor', L.fromCity === 'Toshkent' && L.toCity === 'Samarqand', L);
  check('kelishilgan narx ko\'rsatiladi', L.amount === 2400000 && L.agreed === true,
    { amount: L.amount, agreed: L.agreed });
  check('hozirgi bosqich va keyingi qadam bor',
    L.status === 'DRIVER_FOUND' && L.nextStatus === 'PICKING_UP',
    { status: L.status, next: L.nextStatus });
  check('yuk beruvchining ismi profildan olindi',
    L.owner.name === 'Alisher Qodirov', L.owner);

  /* Begonaga ham, kirmaganga ham berilmaydi. */
  const other = await get(order, { action: 'my-load', googleIdToken: 'nobody@example.com' });
  check('begonada yuk yo\'q', other.payload.load === null, other.payload);
  const anon = await get(order, { action: 'my-load' });
  check('kirmaganga berilmaydi', anon.statusCode === 401, anon.statusCode);
}

/* ============================================================
   14. Bosqichlar zanjiri: topildi → yetkazildi
   ============================================================ */
flow('14. Bosqichlar zanjiri: topildi → yetkazildi');
{
  fresh();
  const shipper = { googleIdToken: 'shipper@example.com' };
  const driver = { googleIdToken: 'driver1@example.com' };
  await makeProfile(driver, { username: 'bekzod', displayName: 'Bekzod' });

  const code = (await postLoad(shipper)).payload.code;
  const offer = (await post(order, 'offer', { ...driver, code, price: 900000 })).payload.offer;
  await post(order, 'accept-offer', { ...shipper, id: offer.id });

  const chain = ['PICKING_UP', 'LOADED', 'ON_THE_WAY', 'DELIVERED'];
  for (const want of chain) {
    const step = await post(order, 'advance', { ...driver, code });
    check(`bosqich → ${want}`, step.statusCode === 200 && step.payload.status === want,
      { status: step.statusCode, got: step.payload && step.payload.status, want });
  }

  const done = db.json(`order:${code}`);
  check('yetkazilgan sana yozildi', Number(done.deliveredAt) > 0, done.deliveredAt);
  check('yetkazilgan yuklar soni oshdi',
    (db.json('profile:driver1@example.com') || {}).deliveredCount === 1,
    db.json('profile:driver1@example.com'));

  const past = await post(order, 'advance', { ...driver, code });
  check('yetkazilgandan keyin suriladigan bosqich yo\'q', past.statusCode === 409, past.statusCode);

  const after = await get(order, { action: 'my-load', ...driver });
  check('"Mening yukim" bo\'shadi', after.payload.load === null, after.payload);
}

/* ============================================================
   15. Begona odam bosqichni sura olmaydi
   ============================================================ */
flow('15. Begona odam bosqichni sura olmaydi');
{
  fresh();
  const shipper = { googleIdToken: 'shipper@example.com' };
  const driver = { googleIdToken: 'driver1@example.com' };
  await makeProfile(driver, { username: 'bekzod', displayName: 'Bekzod' });

  const code = (await postLoad(shipper)).payload.code;
  const offer = (await post(order, 'offer', { ...driver, code, price: 900000 })).payload.offer;
  await post(order, 'accept-offer', { ...shipper, id: offer.id });

  /* Kodni yukni ko'rgan har kim biladi — demak kod huquq bermaydi. */
  const stranger = await post(order, 'advance', { googleIdToken: 'nobody@example.com', code });
  check('begona odam sura olmaydi', stranger.statusCode === 403, stranger.statusCode);

  const owner = await post(order, 'advance', { ...shipper, code });
  check('yuk egasi ham sura olmaydi', owner.statusCode === 403, owner.statusCode);
  check('holat o\'zgarmadi', db.json(`order:${code}`).status === 'DRIVER_FOUND');
}

/* ============================================================
   16. Haydovchi yukdan voz kechadi
   ============================================================ */
flow('16. Haydovchi yukdan voz kechadi');
{
  fresh();
  const shipper = { googleIdToken: 'shipper@example.com' };
  const driver = { googleIdToken: 'driver1@example.com' };
  await makeProfile(driver, { username: 'bekzod', displayName: 'Bekzod' });
  // Yuk beruvchi Telegram bilan bog'langan — xabar unga yetadi.
  linkTelegram('shipper@example.com', 777002);

  const code = (await postLoad(shipper)).payload.code;
  const offer = (await post(order, 'offer', { ...driver, code, price: 900000 })).payload.offer;
  await post(order, 'accept-offer', { ...shipper, id: offer.id });
  await post(order, 'advance', { ...driver, code });   // PICKING_UP

  clearOutgoing();
  const up = await post(order, 'giveup', { ...driver, code, reason: 'Mashina buzildi' });
  check('voz kechildi', up.statusCode === 200, up.payload);

  const back = db.json(`order:${code}`);
  check('yuk yana ochiq', back.status === 'NEW', back.status);
  check('haydovchi ajratildi', back.driver === null, back.driver);
  check('jurnalga yozildi',
    back.releases && back.releases[0].by === 'DRIVER' && back.releases[0].reason === 'Mashina buzildi',
    back.releases);
  check('yuk beruvchiga xabar berildi', notified('voz kechdi'));

  const stranger = await post(order, 'giveup', { googleIdToken: 'nobody@example.com', code });
  check('begona odam voz kecha olmaydi', stranger.statusCode === 403, stranger.statusCode);
}

/* ============================================================
   17. Yuk beruvchi haydovchini bo'shatadi va bekor qiladi
   ============================================================ */
flow('17. Yuk beruvchi haydovchini bo\'shatadi va bekor qiladi');
{
  fresh();
  const shipper = { googleIdToken: 'shipper@example.com' };
  const driver = { googleIdToken: 'driver1@example.com' };
  await makeProfile(driver, { username: 'bekzod', displayName: 'Bekzod' });

  const code = (await postLoad(shipper)).payload.code;
  const offer = (await post(order, 'offer', { ...driver, code, price: 900000 })).payload.offer;
  await post(order, 'accept-offer', { ...shipper, id: offer.id });

  const byStranger = await post(order, 'release', { googleIdToken: 'nobody@example.com', code });
  check('begona odam bo\'shata olmaydi', byStranger.statusCode === 404, byStranger.statusCode);

  const released = await post(order, 'release', { ...shipper, code, reason: 'Javob bermayapti' });
  check('haydovchi bo\'shatildi', released.statusCode === 200, released.payload);
  check('yuk yana ochiq', db.json(`order:${code}`).status === 'NEW');
  check('jurnalda egasi bo\'shatgani yozildi',
    db.json(`order:${code}`).releases[0].by === 'OWNER');

  const cancelled = await post(order, 'cancel', { ...shipper, code, reason: 'Kerak bo\'lmay qoldi' });
  check('buyurtma bekor qilindi', cancelled.statusCode === 200, cancelled.payload);
  check('holat CANCELLED', db.json(`order:${code}`).status === 'CANCELLED');

  const list = await get(order, { action: 'list' });
  check('bekor qilingan yuk ochiq ro\'yxatda ko\'rinmaydi',
    !JSON.stringify(list.payload).includes(code), code);
}

/* ============================================================
   18. Yetkazilgach ikkala tomon baho qoldiradi
   ============================================================ */
flow('18. Yetkazilgach ikkala tomon baho qoldiradi');
{
  fresh();
  const shipper = { googleIdToken: 'shipper@example.com' };
  const driver = { googleIdToken: 'driver1@example.com' };
  await makeProfile(shipper, { username: 'alisher', displayName: 'Alisher' });
  await makeProfile(driver, { username: 'bekzod', displayName: 'Bekzod' });

  const phone = nextPhone();
  const code = (await postLoad(shipper, { phone })).payload.code;
  const offer = (await post(order, 'offer', { ...driver, code, price: 900000 })).payload.offer;
  await post(order, 'accept-offer', { ...shipper, id: offer.id });

  const early = await post(order, 'rate', { ...shipper, code, phone, side: 'DRIVER', stars: 5 });
  check('yetkazilmasdan baho qo\'yib bo\'lmaydi', early.statusCode === 400, early.statusCode);

  for (let i = 0; i < 4; i++) await post(order, 'advance', { ...driver, code });

  const rateDriver = await post(order, 'rate', {
    ...shipper, code, phone, side: 'DRIVER', stars: 5, comment: 'Vaqtida yetkazdi',
  });
  check('yuk beruvchi haydovchini baholadi', rateDriver.statusCode === 200, rateDriver.payload);

  const rateOwner = await post(order, 'rate', { ...driver, code, side: 'OWNER', stars: 4 });
  check('haydovchi yuk beruvchini baholadi', rateOwner.statusCode === 200, rateOwner.payload);

  const dp = db.json('profile:driver1@example.com');
  check('baho haydovchining profiliga tushdi',
    dp.ratingCount === 1 && dp.ratingSum === 5, { count: dp.ratingCount, sum: dp.ratingSum });

  const twice = await post(order, 'rate', {
    ...shipper, code, phone, side: 'DRIVER', stars: 1,
  });
  check('ikkinchi marta baholab bo\'lmaydi', twice.statusCode === 409, twice.statusCode);
}

/* ============================================================
   19. Xabarlashuv va o'qilmagan xabarlar
   ============================================================ */
flow('19. Xabarlashuv va o\'qilmagan xabarlar');
{
  fresh();
  const a = { googleIdToken: 'driver1@example.com' };
  const b = { googleIdToken: 'shipper@example.com' };
  await makeProfile(a, { username: 'bekzod', displayName: 'Bekzod' });
  await makeProfile(b, { username: 'alisher', displayName: 'Alisher' });

  const nobody = await post(chat, 'send', { ...a, toUsername: 'yoqodam', text: 'salom' });
  check('yo\'q odamga yozib bo\'lmaydi', nobody.statusCode === 404, nobody.statusCode);

  const self = await post(chat, 'send', { ...a, toUsername: 'bekzod', text: 'salom' });
  check('o\'ziga yozib bo\'lmaydi', self.statusCode === 400, self.statusCode);

  const sent = await post(chat, 'send', { ...a, toUsername: 'alisher', text: 'Yuk tayyormi?' });
  check('xabar yuborildi', sent.statusCode === 200, sent.payload);

  const inbox = await get(chat, { action: 'inbox', ...b });
  const convo = (inbox.payload.conversations || [])[0];
  check('qabul qiluvchining ro\'yxatida chiqdi', Boolean(convo), inbox.payload);
  check('o\'qilmagan deb belgilandi', convo && convo.unread === 1, convo && convo.unread);
  check('oxirgi xabar matni ko\'rinadi',
    convo && convo.lastText === 'Yuk tayyormi?', convo && convo.lastText);

  const thread = await get(chat, { action: 'thread', withUsername: 'bekzod', ...b });
  check('yozishma ochildi', (thread.payload.messages || []).length === 1,
    (thread.payload.messages || []).length);

  const after = await get(chat, { action: 'inbox', ...b });
  check('ochilgach o\'qilmagan nolga tushdi',
    (after.payload.conversations || [])[0].unread === 0,
    (after.payload.conversations || [])[0]);

  /* Uchinchi odam begona yozishmani ocha olmaydi. */
  const peek = await get(chat, { action: 'thread', withUsername: 'bekzod', googleIdToken: 'nobody@example.com' });
  check('begona odam yozishmani ko\'rmaydi',
    peek.statusCode !== 200 || (peek.payload.messages || []).length === 0,
    { status: peek.statusCode, n: (peek.payload.messages || []).length });
}

/* ============================================================
   20. Akkauntni o'chirish: shaxsiy ketadi, tarix anonim qoladi
   ============================================================ */
flow('20. Akkauntni o\'chirish: shaxsiy ketadi, tarix anonim qoladi');
{
  fresh();
  const shipper = { googleIdToken: 'shipper@example.com' };
  const driver = { googleIdToken: 'driver1@example.com' };
  const phone = nextPhone();
  await makeProfile(shipper, { username: 'alisher', displayName: 'Alisher Qodirov', phone });
  await makeProfile(driver, { username: 'bekzod', displayName: 'Bekzod' });

  /* Yetkazilgan buyurtma — ikki tomonning umumiy tarixi. */
  const code = (await postLoad(shipper, { phone })).payload.code;
  const offer = (await post(order, 'offer', { ...driver, code, price: 900000 })).payload.offer;
  await post(order, 'accept-offer', { ...shipper, id: offer.id });
  for (let i = 0; i < 4; i++) await post(order, 'advance', { ...driver, code });

  /* Xabarni boshqa odam yozadi: xabar yuborishda ham xotiradagi
     cheklagich bor (api/chat.js, `isThrottled`) va u modul ichida
     yashaydi — 19-oqimdagi yuboruvchi shu yerda ham cheklangan
     bo'lardi. */
  const writer = { googleIdToken: 'driver3@example.com' };
  await makeProfile(writer, { username: 'sardor', displayName: 'Sardor' });
  const wrote = await post(chat, 'send', { ...writer, toUsername: 'alisher', text: 'Yetkazdim' });
  check('suhbatdosh xabar yozdi', wrote.statusCode === 200, wrote.payload);

  const noConfirm = await post(profile, 'delete-account', { ...shipper });
  check('tasdiqsiz o\'chirilmaydi', noConfirm.statusCode >= 400, noConfirm.statusCode);

  const gone = await post(profile, 'delete-account', { ...shipper, confirm: true });
  check('akkaunt o\'chirildi', gone.statusCode === 200, gone.payload);

  check('profil o\'chdi', db.json('profile:shipper@example.com') === null);
  check('saqlangan qidiruvlar o\'chdi', db.strings.get('searches:shipper@example.com') === undefined);
  check('yozishmalar ro\'yxati o\'chdi', db.strings.get('inbox:shipper@example.com') === undefined);

  /* Buyurtma qoladi, lekin shaxssiz. */
  const kept = db.json(`order:${code}`);
  check('buyurtma tarixda qoldi', Boolean(kept), code);
  check('ism olib tashlandi', kept.name !== 'Alisher', kept.name);
  check('telefon olib tashlandi', !kept.phone, kept.phone);
  check('egasi belgilandi', kept.ownerDeleted === true, kept.ownerDeleted);
  check('yo\'nalish va holat joyida',
    kept.fromCity === 'Toshkent' && kept.status === 'DELIVERED',
    { from: kept.fromCity, status: kept.status });

  /* Username boshqaga berilmaydi: eski baholar yangi egasiniki
     bo'lib ko'rinmasligi kerak. */
  const taken = await makeProfile({ googleIdToken: 'driver2@example.com' }, { username: 'alisher' });
  check('username boshqaga berilmaydi', taken.statusCode >= 400, taken.statusCode);

  /* Suhbatdoshning xabari joyida — u begona odamning narsasi emas. */
  check('suhbatdoshda xabar qoldi', db.keysLike('msg:').length === 1, db.keysLike('msg:').length);
}

t.done(20);
