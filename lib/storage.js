/**
 * Fayl saqlash — Cloudflare R2.
 *
 * Nega kerak: rasm va hujjatlar shu paytgacha `data:image/...;base64,...`
 * matn ko'rinishida Redis'ga yozilardi. Bu uch tomondan yomon:
 *   - bitta mashina e'loni 1 MB gacha joy egallaydi va har safar
 *     to'liq o'qiladi, ya'ni ro'yxat sekinlashadi;
 *   - base64 asl fayldan ~33% kattaroq, ya'ni trafik ham ortiq;
 *   - brauzer bunday rasmni keshlay olmaydi — har ochilishda qaytadan
 *     keladi.
 * R2'da esa rasm bir marta yuklanadi, havolasi saqlanadi va brauzer
 * uni oddiy rasm kabi keshlaydi.
 *
 * Nega SDK yo'q: loyihada umuman npm bog'liqlik yo'q (lib/kv.js ham
 * shunday yozilgan). R2 — S3 bilan mos, ya'ni oddiy HTTP so'rov va
 * AWS SigV4 imzosi yetarli. Imzo node:crypto bilan hisoblanadi.
 *
 * Sozlash (Vercel → Settings → Environment Variables):
 *   R2_ACCOUNT_ID         Cloudflare hisobingiz id'si
 *   R2_ACCESS_KEY_ID      R2 → Manage API Tokens
 *   R2_SECRET_ACCESS_KEY  o'sha yerdan
 *   R2_BUCKET             bucket nomi, masalan `yolda`
 *   R2_PUBLIC_URL         bucket'ning ochiq manzili
 *                         (https://pub-xxxx.r2.dev yoki o'z domeningiz)
 *
 * Sozlanmagan bo'lsa hamma narsa avvalgidek ishlaydi: rasm yana
 * base64 bo'lib Redis'ga tushadi. Ya'ni yarim ishlaydigan, "tugma
 * bor-u, hech narsa qilmaydi" holat yo'q.
 */
import crypto from 'node:crypto';

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID || '';
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const BUCKET = process.env.R2_BUCKET || '';
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');

const REGION = 'auto';
const SERVICE = 's3';

export const storageConfigured = () =>
  Boolean(ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && BUCKET && PUBLIC_URL);

/** Qabul qilinadigan turlar va ularning kengaytmasi. */
export const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();
const sha256hex = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Kalitdagi har bo'lak alohida kodlanadi — "/" ajratuvchi bo'lib qoladi. */
const encodeKey = (key) =>
  String(key).split('/').map((part) => encodeURIComponent(part)).join('/');

/**
 * AWS Signature Version 4. R2 shu imzoni kutadi.
 * Alohida chiqarilgan, chunki testda mustaqil hisoblangan imzo bilan
 * taqqoslanadi — tartib yoki format adashsa darhol bilinadi.
 */
export const signRequest = ({ method, key, payload, contentType, now }) => {
  const stamp = (now || new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = stamp.slice(0, 8);
  const host = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const uri = `/${BUCKET}/${encodeKey(key)}`;
  const payloadHash = sha256hex(payload ?? '');

  const headers = {
    'content-type': contentType,
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': stamp,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [method, uri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256hex(canonicalRequest)].join('\n');

  let signingKey = hmac(`AWS4${SECRET_KEY}`, date);
  signingKey = hmac(signingKey, REGION);
  signingKey = hmac(signingKey, SERVICE);
  signingKey = hmac(signingKey, 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    url: `https://${host}${uri}`,
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, `
        + `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
};

/** Ochiq havola — brauzer shu manzildan rasmni oladi. */
export const publicUrlFor = (key) => `${PUBLIC_URL}/${encodeKey(key)}`;

/**
 * Faylni bucket'ga yozadi. Hech qachon xato tashlamaydi — chaqirgan
 * tomon `error` ni ko'rib o'zi qaror qiladi.
 */
export const putObject = async (key, bytes, contentType) => {
  if (!storageConfigured()) return { error: 'Fayl saqlash sozlanmagan' };
  try {
    const signed = signRequest({ method: 'PUT', key, payload: bytes, contentType });
    const res = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: bytes });
    if (!res.ok) {
      console.error('R2 put failed:', res.status, (await res.text()).slice(0, 200));
      return { error: 'Faylni saqlab bo‘lmadi' };
    }
    return { ok: true, key, url: publicUrlFor(key) };
  } catch (err) {
    console.error('R2 put error:', err.message);
    return { error: 'Faylni saqlab bo‘lmadi' };
  }
};

export const deleteObject = async (key) => {
  if (!storageConfigured() || !key) return false;
  try {
    const signed = signRequest({ method: 'DELETE', key, payload: '', contentType: 'application/octet-stream' });
    const res = await fetch(signed.url, { method: 'DELETE', headers: signed.headers });
    return res.ok || res.status === 404;
  } catch (err) {
    console.error('R2 delete error:', err.message);
    return false;
  }
};

/** Shu bucket'dagi faylning havolasimi — o'chirishdan oldin tekshiriladi. */
export const isOwnUrl = (url) => Boolean(PUBLIC_URL) && String(url || '').startsWith(`${PUBLIC_URL}/`);

/** Havoladan kalitni ajratadi (o'chirish uchun). */
export const keyFromUrl = (url) => {
  if (!isOwnUrl(url)) return null;
  const rest = String(url).slice(PUBLIC_URL.length + 1);
  try {
    return rest.split('/').map((part) => decodeURIComponent(part)).join('/');
  } catch {
    return null;
  }
};

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/;

/**
 * `data:` ko'rinishidagi rasmni R2'ga ko'chiradi.
 *
 * Qaytadi:
 *   null            — saqlash sozlanmagan; chaqirgan tomon eski
 *                     yo'l bilan (base64) davom etadi;
 *   {url}           — yuklandi;
 *   {error}         — yuklab bo'lmadi yoki rasm noto'g'ri.
 *
 * Havolaning o'zi berilsa (allaqachon yuklangan rasm) — o'zgarishsiz
 * qaytariladi, ikkinchi marta yuklanmaydi.
 */
export const uploadImage = async (value, prefix, maxBytes) => {
  if (!storageConfigured()) return null;

  const raw = String(value ?? '');
  if (/^https:\/\//.test(raw)) return { url: raw, unchanged: true };

  const match = DATA_URL_RE.exec(raw);
  if (!match) return { error: 'Rasm formati noto‘g‘ri' };

  const bytes = Buffer.from(match[2], 'base64');
  if (maxBytes && bytes.length > maxBytes) return { error: 'Rasm hajmi katta, boshqasini tanlang' };

  const ext = IMAGE_TYPES[match[1]] || 'bin';
  // Kalit taxmin qilib bo'lmaydigan bo'lsin: havolani bilgan odamgina
  // ochadi. Sana bo'lagi esa keyinchalik eskilarini topishni
  // osonlashtiradi.
  const key = `${prefix}/${new Date().toISOString().slice(0, 7)}/`
    + `${crypto.randomBytes(16).toString('hex')}.${ext}`;

  const result = await putObject(key, bytes, match[1]);
  if (result.error) return { error: result.error };
  return { url: result.url, key };
};
