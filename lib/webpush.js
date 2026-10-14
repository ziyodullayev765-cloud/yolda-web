/**
 * Web Push — brauzer bildirishnomasi.
 *
 * Ilova yopiq turganda ham xabar yetib borsin degan yagona standart
 * yo'l shu. Telegram o'rnini bosmaydi: ikkalasi yonma-yon ishlaydi,
 * chunki hamma ham Telegram bilan kirmaydi.
 *
 * ============================================================
 * NEGA KUTUBXONA EMAS, O'ZIMIZ YOZDIK
 * ------------------------------------------------------------
 * Loyihada umuman tashqi paket yo'q (R2 imzosi ham qo'lda
 * yozilgan — lib/storage.js). Bitta bildirishnoma uchun butun
 * bog'liqliklar daraxtini olib kelish shu yo'ldan chekinish
 * bo'lardi. Protokolning o'zi esa ikki hujjatda to'liq yozilgan:
 *
 *   RFC 8291 — xabarni shifrlash (aes128gcm)
 *   RFC 8292 — serverni tanitish (VAPID)
 *   RFC 8188 — shifrlangan tananing ko'rinishi
 *
 * ============================================================
 * QANDAY ISHLAYDI
 * ------------------------------------------------------------
 * Brauzer obuna bo'lganda uchta narsa beradi:
 *
 *   endpoint — push xizmatining manzili (Google, Mozilla, Apple)
 *   p256dh   — brauzerning ochiq kaliti (65 bayt)
 *   auth     — faqat brauzer va biz biladigan 16 bayt
 *
 * XABARNI PUSH XIZMATI O'QIY OLMAYDI. Biz har safar yangi
 * vaqtinchalik kalit juftligini yasaymiz, brauzerning ochiq
 * kaliti bilan umumiy sirni hisoblaymiz va xabarni o'sha bilan
 * shifrlaymiz. Google ham, Mozilla ham faqat shifrlangan baytni
 * ko'radi — ichida nima borligini bilmaydi.
 *
 * VAPID esa boshqa narsa: u push xizmatiga "bu xabarni aynan
 * YO'LDA serveri yubordi" deyish uchun. Har bir so'rov
 * maxfiy kalit bilan imzolanadi.
 *
 * ============================================================
 * MAXFIY KALIT
 * ------------------------------------------------------------
 * `VAPID_PRIVATE_KEY` — faqat server muhitida. Brauzerga
 * `VAPID_PUBLIC_KEY` ketadi va u ochiq bo'lishi KERAK: obuna
 * aynan shu kalitga bog'lanadi.
 * ============================================================
 */
import crypto from 'node:crypto';

const CURVE = 'prime256v1';
const RECORD_SIZE = 4096;
/* Push xizmati xabarni shuncha vaqt saqlab turadi. Telefon
   o'chiq bo'lsa ham yoqilgach yetib boradi; bundan keyin esa
   xabar eskiradi. */
export const DEFAULT_TTL = 6 * 60 * 60;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (str) => Buffer.from(String(str), 'base64url');

/** HKDF-Expand, L ≤ 32 — bizga shundan ortig'i kerak emas. */
const hkdfExpand = (prk, info, length) => {
  const mac = crypto.createHmac('sha256', prk);
  mac.update(info);
  mac.update(Buffer.from([1]));
  return mac.digest().subarray(0, length);
};

const hkdfExtract = (salt, ikm) =>
  crypto.createHmac('sha256', salt).update(ikm).digest();

/** Xom (65 baytli) ochiq kalitdan Node tushunadigan kalit obyekti. */
const publicKeyFromRaw = (raw) => {
  const key = Buffer.from(raw);
  if (key.length !== 65 || key[0] !== 4) {
    throw new Error('p256dh kaliti 65 baytli bo‘lishi kerak');
  }
  return crypto.createPublicKey({
    key: {
      kty: 'EC', crv: 'P-256',
      x: b64u(key.subarray(1, 33)),
      y: b64u(key.subarray(33, 65)),
    },
    format: 'jwk',
  });
};

/** 32 baytli xom maxfiy kalitdan kalit obyekti. */
const privateKeyFromRaw = (raw, publicRaw) => {
  const d = Buffer.from(raw);
  if (d.length !== 32) throw new Error('Maxfiy kalit 32 baytli bo‘lishi kerak');
  const pub = Buffer.from(publicRaw);
  return crypto.createPrivateKey({
    key: {
      kty: 'EC', crv: 'P-256',
      d: b64u(d),
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65)),
    },
    format: 'jwk',
  });
};

/** Maxfiy kalitdan unga mos ochiq kalit (65 bayt). */
export const publicFromPrivate = (privateRaw) => {
  const d = Buffer.from(privateRaw);
  const ecdh = crypto.createECDH(CURVE);
  ecdh.setPrivateKey(d);
  return ecdh.getPublicKey();
};

/**
 * Xabarni RFC 8291 bo'yicha shifrlaydi.
 *
 * `salt` va `serverKeys` faqat sinov uchun beriladi — odatiy
 * ishlashda ikkalasi ham har safar yangidan yasaladi.
 */
export const encryptPayload = (payload, { p256dh, auth }, opts = {}) => {
  const uaPublicRaw = unb64u(p256dh);
  const authSecret = unb64u(auth);
  if (authSecret.length !== 16) throw new Error('auth 16 baytli bo‘lishi kerak');

  const ecdh = crypto.createECDH(CURVE);
  if (opts.serverPrivate) ecdh.setPrivateKey(Buffer.from(opts.serverPrivate));
  else ecdh.generateKeys();
  const asPublicRaw = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublicRaw);

  /* Kalitni chiqarish — RFC 8291 §3.4.
     Tartib muhim: avval BRAUZERNING kaliti, keyin bizniki. */
  const prkKey = hkdfExtract(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'), uaPublicRaw, asPublicRaw,
  ]);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);

  const salt = opts.salt ? Buffer.from(opts.salt) : crypto.randomBytes(16);
  const prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

  /* Oxirgi (va yagona) yozuv 0x02 bilan tugaydi — RFC 8188. */
  const plain = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

  /* Sarlavha: salt(16) | yozuv hajmi(4) | kalit uzunligi(1) | kalit(65) */
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublicRaw.length, 20);

  return Buffer.concat([header, asPublicRaw, body]);
};

/**
 * Shifrni ochadi. SERVERDA KERAK EMAS — buni brauzer qiladi.
 * Shu yerda turgani sinov uchun: yozilgan shifr haqiqatan
 * ochilishini tekshirmasdan "ishlayapti" deb bo'lmaydi.
 */
export const decryptPayload = (body, { uaPrivate, uaPublic, auth }) => {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  const idLen = buf.readUInt8(20);
  const asPublicRaw = buf.subarray(21, 21 + idLen);
  const cipherText = buf.subarray(21 + idLen);

  const ecdh = crypto.createECDH(CURVE);
  ecdh.setPrivateKey(Buffer.from(uaPrivate));
  const sharedSecret = ecdh.computeSecret(asPublicRaw);

  const prkKey = hkdfExtract(Buffer.from(auth), sharedSecret);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'), Buffer.from(uaPublic), asPublicRaw,
  ]);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);
  const prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

  const tag = cipherText.subarray(cipherText.length - 16);
  const data = cipherText.subarray(0, cipherText.length - 16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  /* Oxiridagi to'ldiruvchi baytni olib tashlaymiz. */
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end -= 1;
  if (end > 0 && (plain[end - 1] === 2 || plain[end - 1] === 1)) end -= 1;
  return plain.subarray(0, end).toString('utf8');
};

/**
 * VAPID imzosi — RFC 8292.
 * Push xizmatiga "bu xabar YO'LDA serveridan" deyish uchun.
 */
export const vapidHeader = (endpoint, { publicKey, privateKey, subject }) => {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject || 'mailto:admin@yolda.uz',
  }));
  const signed = `${header}.${body}`;

  const pubRaw = publicFromPrivate(unb64u(privateKey));
  const key = privateKeyFromRaw(unb64u(privateKey), pubRaw);
  /* ES256 imzosi xom r||s (64 bayt) bo'lishi kerak. Node odatda
     DER qaytaradi — JWT uni qabul qilmaydi. */
  const sig = crypto.sign('sha256', Buffer.from(signed, 'utf8'), {
    key, dsaEncoding: 'ieee-p1363',
  });

  return `vapid t=${signed}.${b64u(sig)}, k=${publicKey}`;
};

export const vapidConfigured = () =>
  Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

/**
 * Bitta obunaga xabar yuboradi.
 *
 * HECH QACHON XATO TASHLAMAYDI — bildirishnoma asosiy amalni
 * buzmasligi kerak (lib/notify.js dagi qoida bilan bir xil).
 *
 * Qaytaradi: { ok, status, gone }. `gone` — obuna endi
 * yaroqsiz (brauzer o'chirilgan, ruxsat olib tashlangan);
 * chaqiruvchi uni ro'yxatdan o'chirib tashlashi kerak.
 */
export const sendPush = async (subscription, payload, opts = {}) => {
  if (!vapidConfigured()) return { ok: false, status: 0, gone: false };
  const sub = subscription || {};
  if (!sub.endpoint || !sub.p256dh || !sub.auth) {
    return { ok: false, status: 0, gone: true };
  }

  let body;
  let auth;
  try {
    body = encryptPayload(JSON.stringify(payload), sub, opts);
    auth = vapidHeader(sub.endpoint, {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT,
    });
  } catch (err) {
    /* Obunaning o'zi buzuq — qayta urinishdan foyda yo'q. */
    console.error('[push] shifrlanmadi:', err.message);
    return { ok: false, status: 0, gone: true };
  }

  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(opts.ttl || DEFAULT_TTL),
        Urgency: opts.urgency || 'normal',
      },
      body,
    });
    /* 404/410 — obuna yo'q. 403 — kalit mos emas (odatda VAPID
       kaliti almashtirilgan): ikkalasida ham yozuvni saqlashning
       ma'nosi yo'q. */
    const gone = res.status === 404 || res.status === 410 || res.status === 403;
    if (!res.ok && !gone) console.error('[push] yuborilmadi, status', res.status);
    return { ok: res.ok, status: res.status, gone };
  } catch (err) {
    console.error('[push] ulanmadi:', err.message);
    return { ok: false, status: 0, gone: false };
  }
};

/* ============================================================
   OBUNALARNI SAQLASH
   ------------------------------------------------------------
   Bir odamda bir nechta qurilma bo'lishi mumkin — telefon,
   kompyuter, planshet. Shuning uchun ro'yxat.

   Kalit `endpoint` ning o'zi emas, uning qisqartmasi: endpoint
   juda uzun bo'lishi mumkin va u obunaning MANZILI, ya'ni uni
   kalit nomida ochiq saqlashning hojati yo'q.
   ============================================================ */
export const MAX_DEVICES = 8;
export const pushKey = (identity) => `push:${identity}`;

/** Obunaning qisqa belgisi — bir xil qurilma ikki marta yozilmasin. */
export const deviceId = (endpoint) =>
  crypto.createHash('sha256').update(String(endpoint)).digest('base64url').slice(0, 22);

export const readSubscriptions = async (kvGet, identity) => {
  if (!identity) return [];
  try {
    const raw = await kvGet(pushKey(identity));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

export const writeSubscriptions = async (kvSet, kvDel, identity, list) => {
  if (!list.length) return kvDel(pushKey(identity));
  return kvSet(pushKey(identity), JSON.stringify(list.slice(-MAX_DEVICES)));
};
