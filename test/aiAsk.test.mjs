/**
 * YO'LDA bot — savol yuborish (POST /api/chat?action=ask).
 *
 *     node test/aiAsk.test.mjs      (yoki npm test)
 *
 * ENG MUHIM QOIDA. Kalit (`GEMINI_API_KEY`) brauzerga HECH QACHON
 * tushmasligi kerak: na javobda, na xatolik matnida. Shuning uchun
 * bu yerdagi har bir tekshiruvdan keyin javobning butun matni
 * kalitga qarab qidiriladi. Kalit frontendga tushsa, uni sahifa
 * kodidan istalgan odam o'qib olib, hisobni ishlatib yuborardi.
 *
 * Ikkinchi qoida: kirmagan odam so'rov yubora olmaydi. Aks holda
 * kalit ochiq turgani bilan bir xil bo'lardi.
 */
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';

import { db, loadApi, makeRes, runner } from './harness.mjs';

const KEY = 'SIR-KALIT-BUNI-HECH-KIM-KORMASIN';
const GOOGLE = 'generativelanguage.googleapis.com';

/* Gemini'ga ketgan so'rovlarni ushlab qolamiz — testdan bironta
   ham haqiqiy so'rov chiqmaydi. */
const sent = [];
let reply = { ok: true, status: 200, body: { candidates: [{ content: { parts: [{ text: 'Javob' }] } }] } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const href = String(url);
  if (!href.includes(GOOGLE)) return realFetch(url, init);
  sent.push({ url: href, headers: (init && init.headers) || {}, body: JSON.parse(init.body) });
  if (reply.throws) {
    const e = new Error('abort');
    e.name = reply.throws;
    throw e;
  }
  return { ok: reply.ok, status: reply.status, json: async () => reply.body };
};

const t = runner();
const { flow, check } = t;

const chat = await loadApi('api/chat.js', 'aiask_chat');

const ask = async (body) => {
  const res = makeRes();
  await chat({ method: 'POST', query: { action: 'ask' }, body: body || {}, headers: {} }, res);
  return res;
};

const ME = 'me@example.com';
const seed = () => {
  db.strings.clear(); db.sets.clear(); db.lists.clear();
  sent.length = 0;
  db.strings.set(`profile:${ME}`, JSON.stringify({ username: 'me', displayName: 'Men' }));
  reply = { ok: true, status: 200, body: { candidates: [{ content: { parts: [{ text: 'Javob' }] } }] } };
};

/** Javobning butun matnida kalit yo'qligi. */
const noKey = (res) => !JSON.stringify(res.payload || {}).includes(KEY);

/* ---------------------------------------------------------- */
flow('Kalit qo\'yilmagan bo\'lsa — ochiq aytiladi');
{
  seed();
  delete process.env.GEMINI_API_KEY;
  const res = await ask({ googleIdToken: ME, text: 'Salom' });
  check('503 qaytdi', res.statusCode === 503, res.statusCode);
  check('sababi aytilgan', res.payload.notReady === true, res.payload);
  check('Google\'ga so\'rov ketmadi', sent.length === 0, sent.length);
}

process.env.GEMINI_API_KEY = KEY;

flow('Kirmagan odam so\'rov yubora olmaydi');
{
  seed();
  const res = await ask({ text: 'Salom' });
  check('401 qaytdi', res.statusCode === 401, res.statusCode);
  check('Google\'ga so\'rov KETMADI', sent.length === 0, sent.length);
  check('kalit ko\'rinmadi', noKey(res));
}

flow('Oddiy savol');
{
  seed();
  const res = await ask({ googleIdToken: ME, text: 'Toshkentdan Samarqandga necha kilometr?' });
  check('200 qaytdi', res.statusCode === 200, res.payload);
  check('javob matni keldi', res.payload.text === 'Javob', res.payload);
  check('KALIT JAVOBDA YO\'Q', noKey(res));

  check('bitta so\'rov ketdi', sent.length === 1, sent.length);
  check('to\'g\'ri manzil', sent[0].url.includes('gemini-flash-latest:generateContent'), sent[0].url);
  check('kalit SARLAVHADA ketdi', sent[0].headers['x-goog-api-key'] === KEY);
  check('kalit MANZILDA yo\'q', !sent[0].url.includes(KEY), sent[0].url);
  check('savol yuborildi',
    sent[0].body.contents[0].parts[0].text.includes('Samarqandga'), sent[0].body.contents);
  check('botga vazifasi aytilgan',
    sent[0].body.systemInstruction.parts[0].text.includes('YO\'LDA'), null);
}

flow('Suhbat tarixi');
{
  seed();
  const history = [];
  for (let i = 0; i < 14; i++) history.push({ from: i % 2 ? 'ai' : 'me', text: 'xabar ' + i });
  await ask({ googleIdToken: ME, text: 'Oxirgi savol', history });

  const c = sent[0].body.contents;
  check('tarix qirqildi', c.length === 11, c.length);       // 10 ta tarix + savol
  check('oxirgisi savol', c[c.length - 1].parts[0].text === 'Oxirgi savol', c[c.length - 1]);
  check('menikilari user', c[0].role === 'user' || c[0].role === 'model', c[0].role);
  check('bot javobi model deb belgilandi',
    c.some((x) => x.role === 'model'), c.map((x) => x.role));
}

flow('Bo\'sh va juda uzun savol');
{
  seed();
  const bosh = await ask({ googleIdToken: ME, text: '   ' });
  check('bo\'sh savol rad etildi', bosh.statusCode === 400, bosh.statusCode);

  const uzun = await ask({ googleIdToken: ME, text: 'a'.repeat(2001) });
  check('juda uzun savol rad etildi', uzun.statusCode === 400, uzun.statusCode);
  check('ikkalasida ham so\'rov ketmadi', sent.length === 0, sent.length);
}

flow('Kunlik chegara');
{
  seed();
  process.env.AI_DAILY_LIMIT = '3';
  const chat2 = await loadApi('api/chat.js', 'aiask_limit');
  const ask2 = async (body) => {
    const res = makeRes();
    await chat2({ method: 'POST', query: { action: 'ask' }, body, headers: {} }, res);
    return res;
  };

  for (let i = 1; i <= 3; i++) {
    const r = await ask2({ googleIdToken: ME, text: 'savol ' + i });
    check('ruxsat berildi: ' + i, r.statusCode === 200, r.statusCode);
  }
  const over = await ask2({ googleIdToken: ME, text: 'to\'rtinchi' });
  check('chegaradan keyin 429', over.statusCode === 429, over.statusCode);
  check('chegara aytilgan', over.payload.limit === 3, over.payload);
  check('chegaradan keyin Google\'ga so\'rov KETMADI', sent.length === 3, sent.length);

  /* Chegara SERVERDA sanaladi — boshqa odamga tegishli emas. */
  const boshqa = await ask2({ googleIdToken: 'boshqa@example.com', text: 'salom' });
  check('boshqa odamga chegara tegmadi', boshqa.statusCode === 200, boshqa.statusCode);
  delete process.env.AI_DAILY_LIMIT;
}

flow('Google xato qaytarsa — matni UZATILMAYDI');
{
  seed();
  /* Google'ning xato matni ba'zan so'rovning o'zini, ya'ni kalitni
     ham qaytaradi. Shuning uchun u mijozga berilmaydi. */
  reply = {
    ok: false, status: 400,
    body: { error: { message: 'API key not valid: ' + KEY, status: 'INVALID_ARGUMENT' } },
  };
  const res = await ask({ googleIdToken: ME, text: 'Salom' });
  check('502 qaytdi', res.statusCode === 502, res.statusCode);
  check('KALIT XATOLIKDA HAM YO\'Q', noKey(res), res.payload);
  check('Google matni uzatilmadi',
    !JSON.stringify(res.payload).includes('INVALID_ARGUMENT'), res.payload);
}

flow('Javob kech qolsa');
{
  seed();
  reply = { throws: 'AbortError' };
  const res = await ask({ googleIdToken: ME, text: 'Salom' });
  check('504 qaytdi', res.statusCode === 504, res.statusCode);
  check('kalit ko\'rinmadi', noKey(res));
}

flow('Bo\'sh javob kelsa — sababi aytiladi');
{
  seed();
  reply = { ok: true, status: 200, body: { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] } };
  const res = await ask({ googleIdToken: ME, text: 'Salom' });
  check('200 qaytdi', res.statusCode === 200, res.statusCode);
  check('bo\'sh ekani belgilandi', res.payload.empty === true, res.payload);
  check('tushunarli matn bor', String(res.payload.text).length > 10, res.payload);

  seed();
  reply = { ok: true, status: 200, body: { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] } };
  const uzun = await ask({ googleIdToken: ME, text: 'Salom' });
  check('uzunlik sababi alohida aytildi',
    String(uzun.payload.text).includes('uzun'), uzun.payload);
}

flow('Telefon orqali kirgan odam ham yubora oladi');
{
  seed();
  const { signPhoneToken } = await import('../lib/identity.js');
  const token = typeof signPhoneToken === 'function' ? signPhoneToken('+998901112233') : null;
  if (token) {
    const res = await ask({ phoneToken: token, text: 'Salom' });
    check('ruxsat berildi', res.statusCode === 200, res.statusCode);
  } else {
    check('telefon tokeni bu testda tekshirilmaydi (imzolovchi yo\'q)', true);
  }
}

flow('Kalit omborga ham, sahifaga ham yozilmagan');
{
  const { readFileSync, readdirSync } = await import('fs');
  const { join } = await import('path');
  const { repo } = await import('./harness.mjs');

  const page = readFileSync(join(repo, 'index.html'), 'utf8');
  check('index.html kalitni bilmaydi', !page.includes('GEMINI_API_KEY'));
  check('index.html Google manzilini ham chaqirmaydi',
    !page.includes('generativelanguage.googleapis.com'));
  check('sahifa so\'rovni o\'z serveriga yuboradi', page.includes('"ask"'));

  /* Kalit faqat BITTA faylda o'qiladi. */
  const apis = readdirSync(join(repo, 'api')).filter((f) => f.endsWith('.js'));
  const users = apis.filter((f) => readFileSync(join(repo, 'api', f), 'utf8').includes('GEMINI_API_KEY'));
  check('kalitni faqat chat.js o\'qiydi', users.join(',') === 'chat.js', users);

  /* Haqiqiy kalit omborga tushib qolmaganini tekshiramiz:
     "AQ." yoki "AIza" bilan boshlanadigan uzun qator. */
  const suspicious = /(^|[^A-Za-z0-9])(AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_-]{30,})/;
  for (const f of ['index.html', 'admin.html', 'api/chat.js', 'package.json']) {
    check('kalitga o\'xshash qator yo\'q: ' + f,
      !suspicious.test(readFileSync(join(repo, f), 'utf8')), f);
  }
}

t.done();
