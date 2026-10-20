/**
 * Ikonkalar keshi (sw.js).
 *
 *     node test/swIcons.test.mjs      (yoki npm test)
 *
 * MUAMMO. Egasi qo'ygan ikonkalar saytda emas, fayl omborida
 * turadi va ilova har ochilganda ellikka yaqin alohida so'rov
 * ketadi. Biri kelmasa — o'sha ikonka UMUMAN ko'rinmaydi: rasm
 * niqob ichida turadi, bo'sh niqob esa shaklni butunlay qirqib
 * tashlaydi.
 *
 * Shuning uchun ular bir marta olinib, keyin keshdan beriladi.
 * Shu yerda aynan shu tekshiriladi — fayl matnidan emas, xizmat
 * faylini ISHLATIB: so'rov ikkinchi marta tarmoqqa chiqmasligi
 * kerak.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import { repo, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

/* Ikonka endi saytning o'z manzilidan keladi; eski ombor
   manzili ham qoldirilgan, chunki keshdan ochilgan eski sahifa
   hali o'shani so'raydi. */
const ICON = 'https://yolda.uz/icon/2026-10/7a519091c419c3ec1d46ac4e9f9aff80.png';
const ESKI_ICON = 'https://pub-9727192a07cd47c1a25898c5abe5c4a9.r2.dev/icon/2026-10/7a519091c419c3ec1d46ac4e9f9aff80.png';

/** Xizmat faylini soxta brauzer ichida ishga tushiradi. */
const bootSw = () => {
  const listeners = {};
  const store = new Map();          // kesh: manzil -> javob
  const asked = [];                 // tarmoqqa ketgan so'rovlar

  const cache = {
    put: async (req, resp) => { store.set(String(req.url || req), resp); },
    add: async () => {},
    match: async (req) => store.get(String(req.url || req)),
  };
  const caches = {
    open: async () => cache,
    match: async (req) => store.get(String(req.url || req)),
    keys: async () => [],
    delete: async () => true,
  };

  let networkFails = false;
  const fetchStub = async (req) => {
    asked.push(String(req.url || req));
    if (networkFails) throw new Error('tarmoq yo‘q');
    // Boshqa domendagi rasm "opaque" bo'lib keladi: holati 0,
    // `ok` esa false. Aynan shu holat sinaladi.
    return { ok: false, status: 0, type: 'opaque', clone: () => ({ opaque: true }) };
  };

  const self = {
    location: { origin: 'https://yolda.uz' },
    addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    skipWaiting: () => {},
    clients: { claim: () => {}, matchAll: async () => [] },
    registration: { showNotification: () => {} },
  };

  const ctx = { self, caches, fetch: fetchStub, URL, console, Promise };
  ctx.self.caches = caches;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(repo, 'sw.js'), 'utf8'), ctx);

  /** Bitta so'rovni xizmat fayliga beradi va javobini kutadi. */
  const request = async (url, extra) => {
    let answered = null;
    const event = {
      request: Object.assign({ url, method: 'GET', mode: 'no-cors' }, extra || {}),
      respondWith: (p) => { answered = p; },
      waitUntil: () => {},
    };
    (listeners.fetch || []).forEach((fn) => fn(event));
    if (!answered) return { handled: false };
    return { handled: true, response: await answered };
  };

  return {
    request,
    asked,
    store,
    version: /CACHE_VERSION = '([^']+)'/.exec(readFileSync(join(repo, 'sw.js'), 'utf8'))[1],
    failNetwork: (on) => { networkFails = on; },
  };
};

/* ---------------------------------------------------------- */
flow('Ikonka bir marta olinadi');
{
  const sw = bootSw();
  const first = await sw.request(ICON);
  check('birinchi so\'rov xizmat fayli orqali o\'tdi', first.handled);
  check('tarmoqqa chiqildi', sw.asked.length === 1, sw.asked);
  check('keshga yozildi', sw.store.has(ICON), [...sw.store.keys()]);

  const second = await sw.request(ICON);
  check('ikkinchisi ham javob berdi', second.handled && Boolean(second.response));
  check('TARMOQQA QAYTA CHIQILMADI', sw.asked.length === 1, sw.asked);
}

flow('Tarmoq yo\'q bo\'lsa ham keshdagisi beriladi');
{
  const sw = bootSw();
  await sw.request(ICON);
  sw.failNetwork(true);
  const again = await sw.request(ICON);
  check('rasm baribir qaytdi', Boolean(again.response), again);
  check('tarmoq urinishi takrorlanmadi', sw.asked.length === 1, sw.asked);
}

flow('Birinchi marta kelmasa — keshga yolg\'on yozilmaydi');
{
  const sw = bootSw();
  sw.failNetwork(true);
  let failed = false;
  try { await sw.request(ICON); } catch { failed = true; }
  check('xato yashirilmadi', failed || !sw.store.has(ICON), [...sw.store.keys()]);
  check('bo\'sh javob keshda qolmadi', !sw.store.has(ICON), [...sw.store.keys()]);
}

flow('Eski ombor manzili ham keshlanadi');
{
  const sw = bootSw();
  await sw.request(ESKI_ICON);
  await sw.request(ESKI_ICON);
  check('eski sahifa ham bir marta so\'raydi', sw.asked.length === 1, sw.asked);
}

flow('Boshqa domenlarga tegilmaydi');
{
  const sw = bootSw();
  const google = await sw.request('https://accounts.google.com/gsi/client');
  check('Google o\'ziga qoldirildi', !google.handled);
  const tiles = await sw.request('https://tile.openstreetmap.org/1/2/3.png');
  check('xarita plitkasi ham', !tiles.handled);
  const api = await sw.request('https://yolda.uz/api/config');
  check('/api ham tegilmadi', !api.handled);
  check('hech biri tarmoqda sanalmadi', sw.asked.length === 0, sw.asked);
}

flow('Kesh raqami oshirilgan');
{
  const sw = bootSw();
  /* Ikonkalar keshi v4 da paydo bo'ldi: undan oldingi kesh ichida
     ular yo'q edi, ya'ni raqam oshmasa eski nusxa qolib, yangi
     qoida hech qachon ishlamay qolardi.

     Aniq raqam emas, ENG KAMI tekshiriladi — raqam keyin ham
     oshadi (masalan belgi almashganda) va bu test har safar
     bejiz yiqilmasligi kerak. */
  const m = /^yolda-v(\d+)$/.exec(sw.version);
  check('CACHE_VERSION shaklida', Boolean(m), sw.version);
  check('v4 dan past emas', m && Number(m[1]) >= 4, sw.version);
}

t.done();
