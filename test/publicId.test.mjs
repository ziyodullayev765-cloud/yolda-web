/**
 * Har bir odamning o'z raqami.
 *
 *     node test/publicId.test.mjs      (yoki npm test)
 *
 * NEGA KERAK. Odamni ajratish uchun uchta narsa bor edi va
 * uchalasi ham bu ish uchun yaramaydi: ichki shaxs (`tg:123`,
 * `ph:998...`) — bu kalit, ko'rsatish uchun emas; `username` —
 * ixtiyoriy va o'zgaradi; telefon raqami — uni birovga aytish
 * shaxsiy ma'lumotni berish degani.
 *
 * Shuning uchun qisqa, o'zgarmas raqam beriladi: 100001, 100002...
 *
 * ENG MUHIM TASDIQ — RAQAM O'ZGARMASLIGI. Odam uni birovga aytib
 * qo'yadi; ertaga boshqa raqam bo'lsa, aytilgani yolg'on bo'lib
 * qoladi. Shuning uchun quyida raqam profil saqlangandan keyin
 * ham, qayta kirgandan keyin ham o'sha ekani tekshiriladi.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
process.env.TELEGRAM_BOT_USERNAME = 'yoldatestbot';

import { db, loadApi, loadLib, post, telegramMessages, clearOutgoing, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const auth = await loadApi('api/auth-phone.js', 'authphone');
const profileApi = await loadApi('api/profile.js', 'profile');
const publicId = await loadLib('publicId.js');

const linkBotChat = (phone, chatId) => { db.strings.set(`phoneChat:${phone}`, String(chatId)); };
const lastCode = () => {
  const sent = telegramMessages().map((m) => String((m && m.text) || '')).join('\n');
  return (/\b(\d{6})\b/.exec(sent) || [])[1];
};

/** To'liq ro'yxatdan o'tish; har bir odam o'z Telegram suhbati bilan. */
const register = async (phone, chatId) => {
  clearOutgoing();
  linkBotChat(phone, chatId);
  await post(auth, undefined, {
    action: 'register-start', phone, firstName: 'Bekzod', lastName: 'Rahimov', terms: true,
  });
  const code = lastCode();
  const v = await post(auth, undefined, { action: 'verify', phone, code });
  const done = await post(auth, undefined, {
    action: 'set-password', phone, setupToken: v.payload.setupToken, password: 'Yolda2026!',
  });
  return done.payload.phoneToken;
};

/** Shu shaxsning profilidagi raqam. */
const idOf = (identity) => {
  const p = db.json(`profile:${identity}`);
  return p ? p.publicId : undefined;
};

const fresh = () => { db.reset(); clearOutgoing(); };

/* ============================================================
   1. Telefon bilan ro'yxatdan o'tganda raqam beriladi
   ============================================================ */
flow('1. Telefon bilan ro\'yxatdan o\'tganda raqam beriladi');
{
  fresh();
  await register('+998901110001', 700001);
  const id = idOf('tg:700001');
  check('raqam berildi', Number.isFinite(id), id);
  check('olti xonali', String(id).length === 6, id);
  check('100000 dan katta', id > 100000, id);
  check('teskari indeks yozildi',
    db.strings.get(`publicId:${id}`) === 'tg:700001', db.strings.get(`publicId:${id}`));
}

/* ============================================================
   2. Har kimga boshqa raqam
   ============================================================ */
flow('2. Har kimga boshqa raqam');
{
  fresh();
  await register('+998901110010', 700010);
  await register('+998901110011', 700011);
  await register('+998901110012', 700012);

  const ids = ['tg:700010', 'tg:700011', 'tg:700012'].map(idOf);
  check('uchalasiga ham berildi', ids.every(Number.isFinite), ids);
  check('hammasi har xil', new Set(ids).size === 3, ids);
  check('ketma-ket', ids[1] === ids[0] + 1 && ids[2] === ids[1] + 1, ids);
}

/* ============================================================
   3. Raqam O'ZGARMAYDI
   ============================================================ */
flow('3. Raqam o\'zgarmaydi');
{
  fresh();
  const token = await register('+998901110020', 700020);
  const first = idOf('tg:700020');

  // Profilni saqlaydi — raqamga tegilmasligi kerak.
  await post(profileApi, undefined, { phoneToken: token, displayName: 'Bobur', city: 'Toshkent' });
  check('profil saqlangach o\'sha', idOf('tg:700020') === first, idOf('tg:700020'));

  // Profilni o'qiydi — bu ham raqamni almashtirmasligi kerak.
  await post(profileApi, undefined, { phoneToken: token });
  check('o\'qilgach ham o\'sha', idOf('tg:700020') === first, idOf('tg:700020'));

  /* Parolni tiklab qayta kirish ham xuddi shu profilga tushadi.
     Bu yerda `upsertProfile` yana ishlaydi — raqam bor bo'lgani
     uchun unga tegmasligi kerak. */
  clearOutgoing();
  await post(auth, undefined, { action: 'reset-start', phone: '+998901110020' });
  const code = lastCode();
  const v = await post(auth, undefined, { action: 'verify', phone: '+998901110020', code });
  if (v.payload && v.payload.setupToken) {
    await post(auth, undefined, {
      action: 'set-password', phone: '+998901110020',
      setupToken: v.payload.setupToken, password: 'Yolda2027!',
    });
  }
  check('parol tiklangach ham o\'sha', idOf('tg:700020') === first, idOf('tg:700020'));
}

/* ============================================================
   4. Raqami yo'q eski odam ilovani ochganda oladi
   ============================================================ */
flow('4. Raqami yo\'q eski odam ilovani ochganda oladi');
{
  fresh();
  const token = await register('+998901110030', 700030);
  // Bu o'zgarishgacha ro'yxatdan o'tgan odamni taqlid qilamiz.
  const p = db.json('profile:tg:700030');
  delete p.publicId;
  db.strings.set('profile:tg:700030', JSON.stringify(p));
  check('raqami yo\'q', idOf('tg:700030') === undefined);

  // Ilovani ochish = profilni o'qish (hech narsa o'zgartirmasdan).
  const read = await post(profileApi, undefined, { phoneToken: token });
  check('o\'qigandayoq raqam berildi', Number.isFinite(idOf('tg:700030')), idOf('tg:700030'));
  check('javobda ham qaytdi', Number.isFinite(read.payload.profile.publicId),
    read.payload.profile && read.payload.profile.publicId);
}

/* ============================================================
   5. Raqam bo'yicha egasini topish
   ============================================================ */
flow('5. Raqam bo\'yicha egasini topish');
{
  fresh();
  await register('+998901110040', 700040);
  const id = idOf('tg:700040');

  check('raqam bo\'yicha topiladi',
    (await publicId.identityByPublicId(id)) === 'tg:700040');
  check('matn ko\'rinishida ham topiladi',
    (await publicId.identityByPublicId('ID ' + id)) === 'tg:700040');
  check('yo\'q raqam null qaytaradi',
    (await publicId.identityByPublicId(999999)) === null,
    await publicId.identityByPublicId(999999));
  check('bo\'sh so\'rov null qaytaradi', (await publicId.identityByPublicId('')) === null);
}

/* ============================================================
   6. ensurePublicId ikki marta raqam bermaydi
   ============================================================ */
flow('6. ensurePublicId ikki marta raqam bermaydi');
{
  fresh();
  const p = {};
  const first = await publicId.ensurePublicId('tg:900001', p);
  check('birinchi marta berdi', first === true && Number.isFinite(p.publicId), p);

  const before = p.publicId;
  const second = await publicId.ensurePublicId('tg:900001', p);
  check('ikkinchi marta bermadi', second === false);
  check('raqam o\'zgarmadi', p.publicId === before, p.publicId);
}

t.done(6);
