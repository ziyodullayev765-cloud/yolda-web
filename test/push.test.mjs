/**
 * Push bildirishnoma: shifrlash, VAPID imzosi va obunalar.
 *
 *     node test/push.test.mjs      (yoki npm test)
 *
 * ENG MUHIM TEKSHIRUV — RFC 8291 NING O'Z MISOLI. Hujjatning
 * oxirida misol keltirilgan: qanday kalitlar bilan qanday
 * matndan qanday natija chiqishi kerak. Shu misolning kirish
 * qiymatlari berilib, chiqishi hujjatdagi javob bilan BAYTMA-BAYT
 * solishtiriladi.
 *
 * Nega shunday. Shifrni o'zimiz yozdik va uni brauzer ochadi —
 * ya'ni "ishladi" deb aytish uchun haqiqiy brauzer kerak. Uning
 * o'rniga standartning o'z misoli ishlatiladi: natija unga mos
 * tushsa, brauzer ham o'qiy oladi. O'zimiz shifrlab, o'zimiz
 * ochib ko'rish bunga yetmaydi — ikkala tomonda bir xil xato
 * bo'lsa ham o'tib ketaverardi.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

import crypto from 'node:crypto';
import { db, loadLib, loadApi, makeRes, runner, outgoing } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const wp = await loadLib('webpush.js');

/* ---------------------------------------------------------- */
flow('RFC 8291 misoli — baytma-bayt');
{
  /* Hujjatdagi qiymatlar (RFC 8291, §5). */
  const V = {
    message: 'When I grow up, I want to be a watermelon',
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    expected: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZ'
      + 'IIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXz'
      + 'tLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  };

  const out = wp.encryptPayload(V.message, { p256dh: V.uaPublic, auth: V.auth }, {
    serverPrivate: Buffer.from(V.asPrivate, 'base64url'),
    salt: Buffer.from(V.salt, 'base64url'),
  });

  check('STANDARTNING O\'Z MISOLI BILAN MOS', out.toString('base64url') === V.expected,
    out.toString('base64url'));

  /* Teskari yo'l ham ishlashi kerak — brauzer aynan shuni qiladi. */
  const back = wp.decryptPayload(out, {
    uaPrivate: Buffer.from(V.uaPrivate, 'base64url'),
    uaPublic: Buffer.from(V.uaPublic, 'base64url'),
    auth: Buffer.from(V.auth, 'base64url'),
  });
  check('ochilgach asl matn chiqdi', back === V.message, back);
}

flow('Har safar boshqacha shifr');
{
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };

  const a = wp.encryptPayload('salom', sub);
  const b = wp.encryptPayload('salom', sub);
  /* Bir xil matn ikki marta bir xil shifrga aylanmasligi kerak:
     tasodifiy tuz va har safar yangi vaqtinchalik kalit. */
  check('IKKI MARTA BIR XIL CHIQMADI', a.toString('hex') !== b.toString('hex'));
  check('ikkalasi ham ochiladi',
    wp.decryptPayload(a, { uaPrivate: ua.getPrivateKey(), uaPublic: ua.getPublicKey(), auth }) === 'salom'
    && wp.decryptPayload(b, { uaPrivate: ua.getPrivateKey(), uaPublic: ua.getPublicKey(), auth }) === 'salom');

  /* Boshqa odamning kaliti bilan ochilmasligi kerak. */
  const begona = crypto.createECDH('prime256v1');
  begona.generateKeys();
  let failed = false;
  try {
    wp.decryptPayload(a, { uaPrivate: begona.getPrivateKey(), uaPublic: ua.getPublicKey(), auth });
  } catch { failed = true; }
  check('BEGONA KALIT BILAN OCHILMADI', failed);
}

flow('Buzuq obuna qabul qilinmaydi');
{
  const bad = (sub) => {
    try { wp.encryptPayload('x', sub); return false; } catch { return true; }
  };
  check('kalit kalta bo\'lsa', bad({ p256dh: 'AAAA', auth: 'BTBZMqHH6r4Tts7J_aSIgg' }));
  check('auth kalta bo\'lsa', bad({
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'AAAA',
  }));
}

flow('VAPID imzosi');
{
  const priv = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
  const pub = wp.publicFromPrivate(Buffer.from(priv, 'base64url')).toString('base64url');
  const header = wp.vapidHeader('https://fcm.googleapis.com/fcm/send/abc123',
    { publicKey: pub, privateKey: priv, subject: 'mailto:admin@yolda.uz' });

  check('vapid bilan boshlanadi', header.startsWith('vapid t='), header.slice(0, 20));
  const jwt = header.slice(8).split(',')[0];
  const [h, p, sig] = jwt.split('.');
  const head = JSON.parse(Buffer.from(h, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());

  check('ES256 imzosi', head.alg === 'ES256' && head.typ === 'JWT', head);
  check('IMZO XOM 64 BAYT', Buffer.from(sig, 'base64url').length === 64,
    Buffer.from(sig, 'base64url').length);
  check('manzil faqat domen', payload.aud === 'https://fcm.googleapis.com', payload.aud);
  check('yo\'lni oshkor qilmaydi', !jwt.includes('abc123'));
  check('muddati bor va 24 soatdan oshmaydi',
    payload.exp > Date.now() / 1000 && payload.exp < Date.now() / 1000 + 86400, payload.exp);

  /* Imzo haqiqatan shu kalit bilan qo'yilganini tekshiramiz. */
  const raw = Buffer.from(pub, 'base64url');
  const key = crypto.createPublicKey({
    key: {
      kty: 'EC', crv: 'P-256',
      x: raw.subarray(1, 33).toString('base64url'),
      y: raw.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  });
  check('IMZO TO\'G\'RI', crypto.verify('sha256', Buffer.from(`${h}.${p}`, 'utf8'),
    { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));

  check('maxfiy kalit sarlavhada yo\'q', !header.includes(priv));
}

flow('Kalit qo\'yilmagan bo\'lsa hech narsa yubormaydi');
{
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  const before = outgoing.length;
  const r = await wp.sendPush(
    { endpoint: 'https://push.example/x', p256dh: 'a', auth: 'b' }, { title: 'x' });
  check('yuborilmadi', r.ok === false, r);
  check('SO\'ROV UMUMAN KETMADI', outgoing.length === before, outgoing.length - before);
}

/* ---------------------------------------------------------- */
const profileApi = await loadApi('api/profile.js', 'push_profile');
const post = async (action, body) => {
  const res = makeRes();
  await profileApi({ method: 'POST', query: { action }, body, headers: {} }, res);
  return res;
};

const ME = 'me@example.com';
const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/qurilma-1',
  keys: {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  },
};

const seed = () => {
  db.strings.clear(); db.sets.clear(); db.lists.clear();
  outgoing.length = 0;
  db.strings.set(`profile:${ME}`, JSON.stringify({ username: 'me', displayName: 'Men' }));
  process.env.VAPID_PUBLIC_KEY = 'BOqI1qeHf2omoZwUywSy_HGj3lnxISyfADhcvaamREMZTyD1KYHJcmwg421LqdWTCrh6NO1apm8xRGUY40r99N8';
  process.env.VAPID_PRIVATE_KEY = 'pVy2OfNeACp7aWf01VWaTxlss_B8HfXpTbQXyK6Ta7k';
};

flow('Obuna bo\'lish');
{
  seed();
  const res = await post('push-subscribe', { googleIdToken: ME, subscription: SUB, device: 'Telefon' });
  check('obuna saqlandi', res.statusCode === 200, res.payload);
  check('bitta qurilma', res.payload.devices === 1, res.payload);

  const stored = JSON.parse(db.strings.get(`push:${ME}`));
  check('manzil saqlandi', stored[0].endpoint === SUB.endpoint, stored[0]);
  check('kalitlar saqlandi', stored[0].p256dh === SUB.keys.p256dh && stored[0].auth === SUB.keys.auth);

  /* O'sha qurilma qayta obuna bo'lsa — ikki nusxa bo'lmaydi. */
  await post('push-subscribe', { googleIdToken: ME, subscription: SUB });
  check('IKKI NUSXA YOZILMADI', JSON.parse(db.strings.get(`push:${ME}`)).length === 1);

  /* Ikkinchi qurilma — alohida yozuv. */
  const two = await post('push-subscribe', {
    googleIdToken: ME,
    subscription: { endpoint: SUB.endpoint + '-2', keys: SUB.keys },
  });
  check('ikkinchi qurilma qo\'shildi', two.payload.devices === 2, two.payload);
}

flow('Kirmagan odam va buzuq obuna');
{
  seed();
  const anon = await post('push-subscribe', { subscription: SUB });
  check('KIRMAGAN ODAM OBUNA BO\'LMADI', anon.statusCode === 401, anon.statusCode);
  check('hech narsa yozilmadi', !db.strings.has(`push:${ME}`));

  const bad = await post('push-subscribe', {
    googleIdToken: ME, subscription: { endpoint: 'http://ochiq.example/x', keys: SUB.keys },
  });
  check('HTTPS BO\'LMAGAN MANZIL RAD ETILDI', bad.statusCode === 400, bad.statusCode);

  const half = await post('push-subscribe', {
    googleIdToken: ME, subscription: { endpoint: SUB.endpoint },
  });
  check('kalitsiz obuna rad etildi', half.statusCode === 400, half.statusCode);
}

flow('Obunani bekor qilish');
{
  seed();
  await post('push-subscribe', { googleIdToken: ME, subscription: SUB });
  await post('push-subscribe', {
    googleIdToken: ME, subscription: { endpoint: SUB.endpoint + '-2', keys: SUB.keys },
  });

  const one = await post('push-unsubscribe', { googleIdToken: ME, endpoint: SUB.endpoint });
  check('bitta qurilma o\'chdi', one.payload.devices === 1, one.payload);
  check('ikkinchisi qoldi',
    JSON.parse(db.strings.get(`push:${ME}`))[0].endpoint === SUB.endpoint + '-2');

  const all = await post('push-unsubscribe', { googleIdToken: ME });
  check('manzilsiz — hammasi o\'chdi', all.payload.devices === 0, all.payload);
  check('yozuv butunlay ketdi', !db.strings.has(`push:${ME}`));
}

flow('Xabar yuborilganda push ham ketadi');
{
  seed();
  await post('push-subscribe', { googleIdToken: ME, subscription: SUB });
  outgoing.length = 0;

  const notify = await loadLib('notify.js');
  await notify.notifyUser(ME, { text: '<b>Haydovchi topildi</b>\nAli yo‘lga chiqdi', category: 'orders' });

  const pushes = outgoing.filter((o) => o.url.includes('fcm.googleapis.com'));
  check('PUSH YUBORILDI', pushes.length === 1, outgoing.map((o) => o.url));
  check('ilova ichidagi yozuv ham qoldi', (db.lists.get(`notifs:${ME}`) || []).length === 1);
}

flow('O\'chirilgan turkum push\'ga ham tegishli');
{
  seed();
  db.strings.set(`profile:${ME}`, JSON.stringify({
    username: 'me', notify: { orders: false },
  }));
  await post('push-subscribe', { googleIdToken: ME, subscription: SUB });
  outgoing.length = 0;

  const notify = await loadLib('notify.js');
  await notify.notifyUser(ME, { text: '<b>Haydovchi topildi</b>', category: 'orders' });
  check('O\'CHIRILGAN TURKUM YUBORILMADI',
    !outgoing.some((o) => o.url.includes('fcm.googleapis.com')), outgoing.map((o) => o.url));

  /* Boshqa turkum esa ketaveradi. */
  outgoing.length = 0;
  await notify.notifyUser(ME, { text: '<b>Yangi xabar</b>', category: 'chat' });
  check('boshqa turkum ketdi', outgoing.some((o) => o.url.includes('fcm.googleapis.com')));
}

flow('Kalit sahifaga tushmagan');
{
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const { repo } = await import('./harness.mjs');
  const page = readFileSync(join(repo, 'index.html'), 'utf8');
  const sw = readFileSync(join(repo, 'sw.js'), 'utf8');

  check('sahifa maxfiy kalitni bilmaydi', !page.includes('VAPID_PRIVATE_KEY'));
  check('xizmat fayli ham bilmaydi', !sw.includes('VAPID_PRIVATE'));
  check('ochiq kalit serverdan olinadi', page.includes('cfg.vapidPublicKey'));
  check('ruxsat o\'z-o\'zidan so\'ralmaydi',
    !/addEventListener\("load"[\s\S]{0,400}requestPermission/.test(page));
}

t.done();
