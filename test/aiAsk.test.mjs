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

flow('Chegara tugaganda sababi aytiladi');
{
  seed();
  /* Google bepul hisobda kuniga cheklangan so'rov beradi. Chegara
     tugasa 429 qaytadi — bu NOSOZLIK EMAS, shuning uchun odamga
     "javob kelmadi" deyish noto'g'ri bo'lardi. */
  reply = { ok: false, status: 429, body: { error: { message: 'quota exceeded ' + KEY } } };
  const res = await ask({ googleIdToken: ME, text: 'Salom' });
  check('429 qaytdi', res.statusCode === 429, res.statusCode);
  check('sababi chegara ekani aytilgan', res.payload.quota === true, res.payload);
  check('matn tushunarli', String(res.payload.error).includes('chegara'), res.payload);
  check('KALIT KO\'RINMADI', noKey(res), res.payload);

  /* Ikkinchi model ham sinab ko'rilgan bo'lishi kerak. */
  check('ikkala model ham sinaldi', sent.length === 2, sent.map((x) => x.url));
  check('ikkinchisi boshqa model',
    sent[0].url !== sent[1].url && sent[1].url.includes('lite'), sent.map((x) => x.url));
}

flow('Birinchi model tugasa, ikkinchisi javob beradi');
{
  seed();
  let n = 0;
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (!href.includes(GOOGLE)) return saved(url, init);
    n += 1;
    sent.push({ url: href, headers: init.headers, body: JSON.parse(init.body) });
    if (n === 1) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Zaxira javob' }] } }] }) };
  };
  const res = await ask({ googleIdToken: ME, text: 'Salom' });
  globalThis.fetch = saved;
  check('200 qaytdi', res.statusCode === 200, res.statusCode);
  check('ZAXIRA MODEL JAVOB BERDI', res.payload.text === 'Zaxira javob', res.payload);
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

/* ============================================================
   Botning qo'llari
   ------------------------------------------------------------
   Eng muhimi: javobdagi raqam BAZADAN kelishi kerak. Model
   "yuk bor" deb o'ylab topsa, odam yo'lga chiqib, bo'sh
   qaytardi.
   ============================================================ */
flow('Yuk so\'ralsa — bazaga qaraydi');
{
  seed();
  db.strings.set('loads_cache', JSON.stringify({
    at: Date.now(),
    items: [
      { code: 'YOL-1', fromCity: 'Toshkent', toCity: 'Samarqand', weightKg: 1200,
        cargoType: 'Oziq-ovqat', amount: 1500000, pickupDate: '2026-10-15',
        owner: { name: 'Aziz', phone: '+998901112233' } },
      { code: 'YOL-2', fromCity: 'Buxoro', toCity: 'Navoiy', weightKg: 800,
        amount: 700000, owner: { name: 'Dilnoza', phone: '+998909998877' } },
    ],
  }));

  /* Model avval vositani so'raydi, keyin javob yozadi. */
  let step = 0;
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (!href.includes(GOOGLE)) return saved(url, init);
    sent.push({ url: href, headers: init.headers, body: JSON.parse(init.body) });
    step += 1;
    if (step === 1) {
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [
        { functionCall: { name: 'yuk_qidir', args: { fromCity: 'Toshkent' } } },
      ] } }] }) };
    }
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [
      { text: 'Toshkentdan bitta yuk bor: YOL-1, Samarqandga, 1200 kg.' },
    ] } }] }) };
  };

  const res = await ask({ googleIdToken: ME, text: 'Toshkentdan yuk bormi?' });
  globalThis.fetch = saved;

  check('javob keldi', res.statusCode === 200, res.payload);
  check('VOSITA ISHLATILDI', (res.payload.tools || []).includes('yuk_qidir'), res.payload);
  check('ikki marta so\'raldi', sent.length === 2, sent.length);
  check('vositalar modelga berilgan',
    Array.isArray(sent[0].body.tools) && sent[0].body.tools[0].functionDeclarations.length === 2,
    sent[0].body.tools);

  /* Vosita javobi modelga qanday ketganini tekshiramiz. */
  const back = sent[1].body.contents[sent[1].body.contents.length - 1];
  const payload = back.parts[0].functionResponse.response;
  check('natija modelga uzatildi', payload.ready === true, payload);
  check('faqat shu shahardan', payload.yuklar.length === 1
    && payload.yuklar[0].kod === 'YOL-1', payload.yuklar);

  /* ENG MUHIM: shaxsiy ma'lumot modelga BERILMAYDI. */
  const asJson = JSON.stringify(payload);
  check('ISM UZATILMADI', !asJson.includes('Aziz'), asJson);
  check('TELEFON UZATILMADI', !asJson.includes('998901112233'), asJson);
}

flow('Ro\'yxat tayyor bo\'lmasa — "yuk yo\'q" demaydi');
{
  seed();
  /* loads_cache umuman yo'q. */
  let step = 0;
  let toolResult = null;
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (!href.includes(GOOGLE)) return saved(url, init);
    const body = JSON.parse(init.body);
    step += 1;
    if (step === 1) {
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [
        { functionCall: { name: 'yuk_qidir', args: {} } },
      ] } }] }) };
    }
    const last = body.contents[body.contents.length - 1];
    toolResult = last.parts[0].functionResponse.response;
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [
      { text: 'Ro‘yxat hozir yangilanmoqda.' },
    ] } }] }) };
  };
  await ask({ googleIdToken: ME, text: 'Yuk bormi?' });
  globalThis.fetch = saved;

  check('tayyor emasligi aytildi', toolResult && toolResult.ready === false, toolResult);
  check('SABABI ANIQ YOZILGAN',
    toolResult && String(toolResult.note).includes('EMAS'), toolResult);
}

flow('Narx — faqat haqiqiy buyurtmalardan');
{
  seed();
  db.strings.set('price_stats', JSON.stringify({
    computedAt: Date.now(),
    routes: { 'Toshkent>Samarqand': { count: 12, p25: 90000, p50: 110000, p75: 130000 } },
  }));

  const run = async (args) => {
    let result = null;
    let step = 0;
    const saved = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const href = String(url);
      if (!href.includes(GOOGLE)) return saved(url, init);
      const body = JSON.parse(init.body);
      step += 1;
      if (step === 1) {
        return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [
          { functionCall: { name: 'narx_statistikasi', args } },
        ] } }] }) };
      }
      result = body.contents[body.contents.length - 1].parts[0].functionResponse.response;
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [
        { text: 'Javob' },
      ] } }] }) };
    };
    await ask({ googleIdToken: ME, text: 'Narx qancha?' });
    globalThis.fetch = saved;
    return result;
  };

  const ok = await run({ fromCity: 'Toshkent', toCity: 'Samarqand', weightKg: 2000 });
  check('ma\'lumot bor', ok && ok.enough === true, ok);
  check('nechta buyurtmadan ekani aytilgan', ok.buyurtmalarSoni === 12, ok);
  check('og\'irlikka moslandi', ok.shuYukUchunSom.orta === 220000, ok.shuYukUchunSom);

  const yoq = await run({ fromCity: 'Xiva', toCity: 'Nukus' });
  check('MA\'LUMOT YO\'Q — TAXMIN QILINMAYDI', yoq && yoq.enough === false, yoq);
  check('modelga "taxmin qilma" deyilgan',
    String(yoq.note).includes('Taxmin qilma'), yoq);
}

flow('Vosita xatosi javobni buzmaydi');
{
  seed();
  db.strings.set('loads_cache', 'buzilgan-matn');
  let step = 0;
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (!href.includes(GOOGLE)) return saved(url, init);
    step += 1;
    if (step === 1) {
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [
        { functionCall: { name: 'bunday_vosita_yoq', args: {} } },
      ] } }] }) };
    }
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [
      { text: 'Kechirasiz, hozir ma‘lumot yo‘q.' },
    ] } }] }) };
  };
  const res = await ask({ googleIdToken: ME, text: 'Yuk bormi?' });
  globalThis.fetch = saved;
  check('javob baribir qaytdi', res.statusCode === 200, res.payload);
  check('xato matni javobga chiqmadi', !String(res.payload.text).includes('error'), res.payload);
}

flow('Suhbatlar saqlanadi');
{
  seed();
  const get = async (action, query) => {
    const res = makeRes();
    await chat({ method: 'GET', query: { action, ...(query || {}) }, body: {}, headers: {} }, res);
    return res;
  };
  const save = async (body) => {
    const res = makeRes();
    await chat({ method: 'POST', query: { action: 'ai-save' }, body, headers: {} }, res);
    return res;
  };

  const r1 = await save({
    googleIdToken: ME, title: 'Masofa',
    items: [{ from: 'me', text: 'Necha km?', at: '09:10' }, { from: 'ai', text: '280 km', at: '09:10' }],
  });
  check('saqlandi', r1.statusCode === 200, r1.payload);
  const id = r1.payload.id;
  check('id berildi', typeof id === 'string' && id.length > 4, id);

  const list = await get('ai-list', { googleIdToken: ME });
  check('ro\'yxatda ko\'rindi', list.payload.threads.length === 1, list.payload);
  check('sarlavha joyida', list.payload.threads[0].title === 'Masofa', list.payload.threads[0]);
  check('ro\'yxatda butun matn yo\'q', !('items' in list.payload.threads[0]), list.payload.threads[0]);

  const one = await get('ai-thread', { googleIdToken: ME, id });
  check('to\'liq suhbat o\'qildi', one.payload.thread.items.length === 2, one.payload);

  /* ENG MUHIM: begona odam id ni bilsa ham ocholmaydi. */
  const begona = await get('ai-thread', { googleIdToken: 'begona@example.com', id });
  check('BEGONA SUHBATNI OCHOLMADI', begona.statusCode === 404, begona.statusCode);
  const begonaDel = makeRes();
  await chat({ method: 'POST', query: { action: 'ai-del' }, body: { googleIdToken: 'begona@example.com', id }, headers: {} }, begonaDel);
  check('BEGONA O\'CHIRA OLMADI', begonaDel.statusCode === 404, begonaDel.statusCode);
  check('suhbat joyida', (await get('ai-thread', { googleIdToken: ME, id })).statusCode === 200);

  const anon = await get('ai-list', {});
  check('kirmagan odam ro\'yxatni ko\'rmaydi', anon.statusCode === 401, anon.statusCode);

  /* Yangilanish yangi yozuv yaratmaydi. */
  const r2 = await save({
    googleIdToken: ME, id, title: 'Masofa',
    items: [{ from: 'me', text: 'Necha km?', at: '09:10' }, { from: 'ai', text: '280 km', at: '09:10' },
            { from: 'me', text: 'Yana?', at: '09:11' }],
  });
  check('o\'sha id qaytdi', r2.payload.id === id, r2.payload);
  check('ro\'yxat o\'smadi', (await get('ai-list', { googleIdToken: ME })).payload.threads.length === 1);
  check('yangi xabar qo\'shildi',
    (await get('ai-thread', { googleIdToken: ME, id })).payload.thread.items.length === 3);

  /* Begonaning id si bilan yozib bo'lmaydi — yangisi ochiladi. */
  const chet = await save({ googleIdToken: 'boshqa@example.com', id, title: 'Urinish',
    items: [{ from: 'me', text: 'salom', at: '09:12' }] });
  check('begona id bosib ketilmadi', chet.payload.id !== id, chet.payload);
  check('asl suhbat tegilmadi',
    (await get('ai-thread', { googleIdToken: ME, id })).payload.thread.title === 'Masofa');

  /* O'chirish. */
  const del = makeRes();
  await chat({ method: 'POST', query: { action: 'ai-del' }, body: { googleIdToken: ME, id }, headers: {} }, del);
  check('o\'chirildi', del.statusCode === 200, del.payload);
  check('ro\'yxatdan ketdi', (await get('ai-list', { googleIdToken: ME })).payload.threads.length === 0);
  check('o\'qib ham bo\'lmaydi', (await get('ai-thread', { googleIdToken: ME, id })).statusCode === 404);

  const bosh = await save({ googleIdToken: ME, title: 'x', items: [] });
  check('bo\'sh suhbat saqlanmadi', bosh.statusCode === 400, bosh.statusCode);
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
