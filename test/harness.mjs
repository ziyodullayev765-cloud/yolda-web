/**
 * Oqim testlari uchun umumiy tayyorgarlik.
 *
 * Qolgan to'plamlar bitta modulni alohida sinaydi. Oqim testlari
 * esa odamning yo'lini boshidan oxirigacha kuzatadi: kirish →
 * yuk joylash → taklif → qabul → bosqichlar → baho. Buning uchun
 * bir nechta endpoint BITTA bazani bo'lishishi kerak, aks holda
 * birida yozilgan narsa ikkinchisida ko'rinmaydi.
 *
 * Shuning uchun bu yerda:
 *
 *   - lib/kv.js xotiradagi nusxaga almashtiriladi va u YAGONA
 *     bo'ladi: hamma modul ayni o'sha faylni import qiladi, ya'ni
 *     Node uni bir marta yuklaydi va baza umumiy bo'ladi;
 *   - lib/identity.js HAQIQIYsi ishlatiladi — ya'ni telefon orqali
 *     olingan token haqiqatan tekshiriladi, soxta emas;
 *   - global.fetch tashqariga chiqmaydi: Telegram'ga ketgan har
 *     bir xabar yozib olinadi, Google'ning tokeninfo so'rovi esa
 *     o'rnida javob beriladi (token matni = pochta manzili).
 *
 * Ya'ni testdan birorta ham tarmoq so'rovi chiqmaydi, lekin kodning
 * o'zi to'liq, hech narsa chetlab o'tilmay ishlaydi.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
export const repo = join(here, '..');

const work = mkdtempSync(join(tmpdir(), 'yolda-flows-'));

/* ============================================================
   Xotiradagi baza
   ============================================================ */
export const db = {
  strings: new Map(),
  sets: new Map(),
  lists: new Map(),
  /** Hamma narsani tozalaydi — oqimlar orasida toza boshlash uchun. */
  reset() { this.strings.clear(); this.sets.clear(); this.lists.clear(); },
  /** Kalitni o'qish — tasdiqlar uchun. */
  json(key) {
    const raw = this.strings.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  },
  /** Berilgan boshlanishga mos kalitlar. */
  keysLike(prefix) {
    return [...this.strings.keys()].filter((k) => k.startsWith(prefix));
  },
};
globalThis.__db = db;

writeFileSync(join(work, 'kvmock.mjs'), `
const db = globalThis.__db;
export const kvConfigured = true;
export const kvGet = async (k) => (db.strings.has(k) ? db.strings.get(k) : null);
export const kvSet = async (k, v) => { db.strings.set(k, String(v)); return true; };
export const kvDel = async (k) => { db.strings.delete(k); return true; };
export const kvIncr = async (k) => {
  const n = Number(db.strings.get(k) || 0) + 1;
  db.strings.set(k, String(n));
  return n;
};
export const kvSadd = async (k, m) => {
  if (!db.sets.has(k)) db.sets.set(k, new Set());
  db.sets.get(k).add(String(m));
  return true;
};
export const kvSrem = async (k, m) => { if (db.sets.has(k)) db.sets.get(k).delete(String(m)); return true; };
export const kvSmembers = async (k) => (db.sets.has(k) ? [...db.sets.get(k)] : []);
export const kvSismember = async (k, m) => db.sets.has(k) && db.sets.get(k).has(String(m));
export const kvPush = async (k, v) => {
  if (!db.lists.has(k)) db.lists.set(k, []);
  db.lists.get(k).unshift(String(v));
  return true;
};
export const kvLrem = async (k, v) => {
  if (db.lists.has(k)) db.lists.set(k, db.lists.get(k).filter((x) => x !== String(v)));
  return true;
};
export const kvRange = async (k, start = 0, end = -1) => {
  const list = db.lists.get(k) || [];
  return end === -1 ? list.slice(start) : list.slice(start, end + 1);
};
export const kvKeys = async (pattern) => {
  const prefix = String(pattern).replace(/\\*$/, '');
  return [...db.strings.keys()].filter((k) => k.startsWith(prefix));
};
export const kvDbSize = async () => db.strings.size;
export const kvUsedMemory = async () => 0;
export const kvMonthCommands = async () => 0;
export const usageKey = () => 'usage';
`);

const kvMock = JSON.stringify(join(work, 'kvmock.mjs'));

/* Umumiy nusxalar: bu modullar bir marta ko'chiriladi va hamma
   joyda AYNI o'sha fayl ishlatiladi, ya'ni holat bo'linmaydi. */
const shared = new Map();

const rewrite = (relPath, name) => {
  const src = readFileSync(join(repo, relPath), 'utf8')
    .replaceAll("'./kv.js'", kvMock)
    .replaceAll("'../lib/kv.js'", kvMock)
    /* Boshqa lib fayllari ham umumiy nusxadan olinadi: aks holda
       identity.js ning ikki xil nusxasi ikki xil bazaga qarardi. */
    .replace(/'\.\.\/lib\/([\w.]+\.js)'/g, (_, f) => JSON.stringify(libPath(f)))
    .replace(/'\.\/([\w.]+\.js)'/g, (_, f) => JSON.stringify(libPath(f)));
  const out = join(work, `${name}.mjs`);
  writeFileSync(out, src);
  return out;
};

function libPath(file) {
  if (shared.has(file)) return shared.get(file);
  const out = join(work, `lib_${file.replace(/\W/g, '_')}.mjs`);
  // Oldin joyini band qilamiz: ichma-ich import halqasi bo'lsa ham to'xtamasin.
  shared.set(file, out);
  const src = readFileSync(join(repo, 'lib', file), 'utf8')
    .replaceAll("'./kv.js'", kvMock)
    .replaceAll("'../lib/kv.js'", kvMock)
    .replace(/'\.\/([\w.]+\.js)'/g, (_, f) => JSON.stringify(libPath(f)));
  writeFileSync(out, src);
  return out;
}

/** `api/<name>.js` ni yuklaydi va uning handler'ini qaytaradi. */
export const loadApi = async (relPath, name) =>
  (await import(rewrite(relPath, name))).default;

/** `lib/<file>` ning testdagi nusxasini yuklaydi. */
export const loadLib = async (file) => import(libPath(file));

/* ============================================================
   Tashqariga chiqmaydigan fetch
   ============================================================ */
export const outgoing = [];

globalThis.fetch = async (url, init) => {
  const href = String(url);
  outgoing.push({ url: href, body: init && init.body ? safeJson(init.body) : null });

  /* Google tokenini tekshirish — haqiqiy yo'l bilan ketadi, faqat
     javobni biz beramiz. Testda "token" deb pochta manzilining
     o'zi yuboriladi. */
  if (href.includes('oauth2.googleapis.com/tokeninfo')) {
    const token = decodeURIComponent(href.split('id_token=')[1] || '');
    if (!token || !token.includes('@')) {
      return { ok: false, status: 400, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ email: token, email_verified: 'true' }),
    };
  }

  // Telegram: yuborilgan xabar `outgoing` ga yozildi, bas.
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
};

const safeJson = (body) => {
  try { return JSON.parse(body); } catch { return String(body); }
};

/** Telegram'ga ketgan xabarlar (matni bo'yicha qidirish uchun). */
export const telegramMessages = () => outgoing
  .filter((o) => o.url.includes('api.telegram.org') && o.url.endsWith('/sendMessage'))
  .map((o) => o.body);

export const clearOutgoing = () => { outgoing.length = 0; };

/* ============================================================
   Vercel javob obyektining eng kichik nusxasi
   ============================================================ */
export const makeRes = () => {
  const r = { statusCode: 0, payload: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.payload = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  r.end = () => r;
  return r;
};

/** POST so'rovi. */
export const post = async (handler, action, body) => {
  const res = makeRes();
  await handler({ method: 'POST', query: action ? { action } : {}, body, headers: {} }, res);
  return res;
};

/** GET so'rovi. */
export const get = async (handler, query) => {
  const res = makeRes();
  await handler({ method: 'GET', query, body: {}, headers: {} }, res);
  return res;
};

/* ============================================================
   Hisoblagich
   ============================================================ */
export const runner = () => {
  let pass = 0, fail = 0;
  const failures = [];
  return {
    flow(title) { console.log(`\n── ${title}`); },
    check(label, ok, detail) {
      if (ok) { pass++; console.log('  PASS ' + label); }
      else {
        fail++;
        failures.push(label);
        console.log('  FAIL ' + label + (detail === undefined ? '' : '  → ' + JSON.stringify(detail)));
      }
    },
    done(total) {
      console.log(`\n==== ${pass} passed, ${fail} failed ====`);
      if (total !== undefined) console.log(`     ${total} ta oqim tekshirildi`);
      process.exit(fail ? 1 : 0);
    },
  };
};
