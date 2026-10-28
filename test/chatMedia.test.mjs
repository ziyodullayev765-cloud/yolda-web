/**
 * Yozishmaga biriktirilgan fayl: ovoz, rasm va hujjat.
 *
 *     node test/chatMedia.test.mjs      (yoki npm test)
 *
 * Hech qanday so'rov tashqariga chiqmaydi: global.fetch yozib
 * olinadi, ya'ni R2'ga nima yuborilgani ko'rinib turadi.
 *
 * TEKSHIRILADIGAN QOIDALAR:
 *   1. Ruxsat etilgan turlar ro'yxati qisqa — rasm, PDF, ovoz.
 *      Bajariladigan fayl yoki boshqa tur RAD ETILADI.
 *   2. Hajm chegarasi serverda ham bor (mijozdagi cheklov yagona
 *      to'siq emas).
 *   3. Ovozli xabarda matn bo'lmasligi mumkin.
 *   4. Davomiylikni mijoz aytadi — unga ishonilmaydi, cheklanadi.
 *   5. Saqlash sozlanmagan bo'lsa, "yuborildi" deb ko'rsatilmaydi.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
process.env.R2_ACCOUNT_ID = 'acc123';
process.env.R2_ACCESS_KEY_ID = 'AKIAEXAMPLE';
process.env.R2_SECRET_ACCESS_KEY = 'secretExampleKey';
process.env.R2_BUCKET = 'yolda';
process.env.R2_PUBLIC_URL = 'https://pub-test.r2.dev';

import { db, loadApi, makeRes, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

/* --- tashqariga chiqadigan so'rovlar shu yerda qoladi --- */
const putlar = [];
const haqiqiyFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('r2.cloudflarestorage.com')) {
    const h = (init && init.headers) || {};
    const turi = h['content-type'] || h['Content-Type'] || '';
    putlar.push({ url: u, method: init.method, type: turi,
      size: init.body ? init.body.length : 0 });
    return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  }
  /* Qolgani — harness'ning o'z fetch'i: Google tokenini u
     tekshiradi, Telegram xabarlarini u yozib oladi. */
  return haqiqiyFetch(url, init);
};

const ME = 'me@example.com';
const A = 'a@example.com';

const seed = () => {
  db.strings.clear(); db.sets.clear(); db.lists.clear();
  putlar.length = 0;
  [[ME, 'men'], [A, 'ali']].forEach(([id, u]) => {
    db.strings.set(`profile:${id}`, JSON.stringify({ username: u, displayName: u }));
    db.strings.set(`username:${u}`, id);
  });
};

/* Spam qo'riqchisi modul xotirasida — har yuborish uchun yangi nusxa. */
let nusxa = 0;
const send = async (body) => {
  const api = await loadApi('api/chat.js', 'chatmedia_send' + (nusxa += 1));
  const res = makeRes();
  await api({ method: 'POST', query: { action: 'send' }, body, headers: {} }, res);
  return res;
};

const okIsh = await loadApi('api/chat.js', 'chatmedia_read');
const get = async (action, query) => {
  const res = makeRes();
  await okIsh({ method: 'GET', query: { action, ...(query || {}) }, body: {}, headers: {} }, res);
  return res;
};
const thread = async (who, withEmail) =>
  (await get('thread', { googleIdToken: who, withEmail })).payload.messages;

/** Berilgan hajmdagi soxta fayl. */
const dataUrl = (type, bytes) =>
  `data:${type};base64,${Buffer.alloc(bytes, 7).toString('base64')}`;

/* ---------------------------------------------------------- */
flow('Ovozli xabar');
{
  seed();
  const res = await send({ googleIdToken: ME, toUsername: 'ali', text: '',
    media: { dataUrl: dataUrl('audio/webm', 3000), duration: 7, name: '' } });
  check('matnsiz ham yuborildi', res.statusCode === 200, res.payload);
  check('R2ga bitta fayl yozildi', putlar.length === 1, putlar);
  check('turi o\'zgartirilmadi', putlar[0] && putlar[0].type === 'audio/webm', putlar[0]);
  check('kengaytmasi .webm', /\.webm$/.test(putlar[0] ? putlar[0].url : ''), putlar[0] && putlar[0].url);
  check('kalit taxmin qilinmaydi', /\/chat\/\d{4}-\d{2}\/[0-9a-f]{32}\./.test(putlar[0] ? putlar[0].url : ''), putlar[0] && putlar[0].url);

  const list = await thread(A, ME);
  const m = list[list.length - 1];
  check('xabarda fayl bor', m.media && m.media.kind === 'voice', m.media);
  check('havola berildi', /^https:\/\/pub-test\.r2\.dev\//.test(m.media.url), m.media.url);
  check('hajmi yozilgan', m.media.size === 3000, m.media.size);
  check('davomiyligi yozilgan', m.media.duration === 7, m.media.duration);
}

flow('Davomiylikka ishonilmaydi');
{
  seed();
  await send({ googleIdToken: ME, toUsername: 'ali', text: '',
    media: { dataUrl: dataUrl('audio/webm', 100), duration: 999999 } });
  let m = (await thread(A, ME)).pop();
  check('haddan ortig\'i qirqiladi', m.media.duration === 600, m.media.duration);

  seed();
  await send({ googleIdToken: ME, toUsername: 'ali', text: '',
    media: { dataUrl: dataUrl('audio/webm', 100), duration: -5 } });
  m = (await thread(A, ME)).pop();
  check('manfiy son qabul qilinmaydi', m.media.duration === null, m.media.duration);
}

flow('Rasm va hujjat');
{
  seed();
  const rasm = await send({ googleIdToken: ME, toUsername: 'ali', text: 'Mana',
    media: { dataUrl: dataUrl('image/jpeg', 500), name: 'yuk.jpg' } });
  check('rasm yuborildi', rasm.statusCode === 200, rasm.payload);
  let m = (await thread(A, ME)).pop();
  check('rasm deb belgilandi', m.media.kind === 'image', m.media);
  check('izoh ham saqlandi', m.text === 'Mana', m.text);

  seed();
  await send({ googleIdToken: ME, toUsername: 'ali', text: '',
    media: { dataUrl: dataUrl('application/pdf', 900), name: 'yuk-xati.pdf' } });
  m = (await thread(A, ME)).pop();
  check('hujjat deb belgilandi', m.media.kind === 'file', m.media);
  check('nomi saqlandi', m.media.name === 'yuk-xati.pdf', m.media.name);
}

flow('RAD ETILADIGAN fayllar');
{
  seed();
  const exe = await send({ googleIdToken: ME, toUsername: 'ali', text: '',
    media: { dataUrl: dataUrl('application/x-msdownload', 100), name: 'virus.exe' } });
  check('bajariladigan fayl o\'tmadi', exe.statusCode === 400, exe.payload);
  check('R2ga HECH NARSA yozilmadi', putlar.length === 0, putlar);

  const svg = await send({ googleIdToken: ME, toUsername: 'ali', text: '',
    media: { dataUrl: dataUrl('image/svg+xml', 100), name: 'x.svg' } });
  check('SVG ham o\'tmadi', svg.statusCode === 400, svg.payload);

  const katta = await send({ googleIdToken: ME, toUsername: 'ali', text: '',
    media: { dataUrl: dataUrl('image/jpeg', 3 * 1024 * 1024) } });
  check('katta fayl o\'tmadi', katta.statusCode === 400, katta.payload);
  check('sababi aytildi', /hajmi/i.test(katta.payload.error || ''), katta.payload);
  check('baribir hech narsa yozilmadi', putlar.length === 0, putlar);

  const bosh = await send({ googleIdToken: ME, toUsername: 'ali', text: '' });
  check('matnsiz va faylsiz xabar o\'tmadi', bosh.statusCode === 400, bosh.payload);
}

flow('Ro\'yxatda matnsiz xabar');
{
  seed();
  db.sets.set(`inbox:${A}`, new Set([ME]));
  await send({ googleIdToken: ME, toUsername: 'ali', text: '',
    media: { dataUrl: dataUrl('audio/webm', 100), duration: 3 } });
  const list = (await get('inbox', { googleIdToken: A })).payload.conversations;
  const row = list.find((c) => c.email === ME);
  check('ovozli xabar deb ko\'rsatiladi', /Ovozli xabar/.test(row ? row.lastText : ''), row);
}

flow('O\'chirilganda fayl ham ketadi');
{
  seed();
  const res = await send({ googleIdToken: ME, toUsername: 'ali', text: '',
    media: { dataUrl: dataUrl('image/png', 400), name: 'x.png' } });
  const id = res.payload.id;
  putlar.length = 0;

  const api = await loadApi('api/chat.js', 'chatmedia_del');
  const del = makeRes();
  await api({ method: 'POST', query: { action: 'delete' },
    body: { googleIdToken: ME, ids: [id], forMe: false }, headers: {} }, del);
  check('xabar o\'chdi', del.statusCode === 200, del.payload);
  check('R2dan ham O\'CHIRILDI',
    putlar.length === 1 && putlar[0].method === 'DELETE', putlar);

  const m = (await thread(A, ME)).find((x) => x.id === id);
  check('xabarda fayl qolmadi', m && m.media === null, m);
}

flow('Saqlash sozlanmagan bo\'lsa — ochiq aytiladi');
{
  seed();
  /* lib/storage.js sozlamani YUKLANGANDA o'qiydi, shuning uchun
     bu holatni shu jarayonda yasab bo'lmaydi: alohida jarayon
     ochiladi va u yerda R2 umuman sozlanmagan bo'ladi. */
  const { execFileSync } = await import('node:child_process');
  const kod = `
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
    const { db, loadApi, makeRes } = await import('./test/harness.mjs');
    db.strings.set('profile:${ME}', JSON.stringify({ username: 'men' }));
    db.strings.set('profile:${A}', JSON.stringify({ username: 'ali' }));
    db.strings.set('username:ali', '${A}');
    const api = await loadApi('api/chat.js', 'nostore');
    const res = makeRes();
    await api({ method: 'POST', query: { action: 'send' }, headers: {}, body: {
      googleIdToken: '${ME}', toUsername: 'ali', text: '',
      media: { dataUrl: 'data:audio/webm;base64,AAAA', duration: 2 },
    } }, res);
    // Spam qo'riqchisi modul xotirasida — ikkinchi nusxa olinadi.
    const api2 = await loadApi('api/chat.js', 'nostore2');
    const matn = makeRes();
    await api2({ method: 'POST', query: { action: 'send' }, headers: {}, body: {
      googleIdToken: '${ME}', toUsername: 'ali', text: 'Salom',
    } }, matn);
    console.log(JSON.stringify({ fayl: res.statusCode, xato: res.payload && res.payload.error,
      matn: matn.statusCode }));
  `;
  const muhit = { ...process.env };
  ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL']
    .forEach((k) => { delete muhit[k]; });
  const chiqdi = execFileSync(process.execPath, ['--input-type=module', '-e', kod],
    { env: muhit, encoding: 'utf8' }).trim().split('\n').pop();
  const natija = JSON.parse(chiqdi);
  check('SOXTA "yuborildi" YO\'Q', natija.fayl === 503, natija);
  check('sabab aytildi', /ishlamayapti/i.test(natija.xato || ''), natija);
  // Matnli xabar esa baribir ketaveradi.
  check('oddiy xabar ishlayveradi', natija.matn === 200, natija);
}

globalThis.fetch = haqiqiyFetch;
t.done();
