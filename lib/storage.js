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

/* Qiymatlar `.trim()` bilan olinadi. Sababi amaliy: kalit sozlamaga
   nusxa-ko'chirma qilinganda oxiriga bo'shliq yoki qator ko'chirish
   belgisi qo'shilib qolishi juda tez-tez uchraydi. Ko'zga ko'rinmaydi,
   lekin imzo butunlay boshqacha chiqadi va R2 401 qaytaradi. */
const ACCOUNT_ID = (process.env.R2_ACCOUNT_ID || '').trim();
const ACCESS_KEY = (process.env.R2_ACCESS_KEY_ID || '').trim();
const SECRET_KEY = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const BUCKET = (process.env.R2_BUCKET || '').trim();
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');

const REGION = 'auto';
const SERVICE = 's3';

export const storageConfigured = () =>
  Boolean(ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && BUCKET && PUBLIC_URL);

/**
 * Qaysi sozlama yetishmayotganini aytadi — FAQAT NOMLARI.
 *
 * Qiymatlar hech qachon qaytarilmaydi: ular orasida maxfiy kalit bor.
 * Admin panelda "sozlanmagan" deb turgan paytda aynan nimasi
 * yetishmayotganini bilish uchun kerak, aks holda taxmin qilishga
 * to'g'ri keladi.
 */
export const storageMissing = () => {
  const missing = [];
  if (!ACCOUNT_ID) missing.push('R2_ACCOUNT_ID');
  if (!ACCESS_KEY) missing.push('R2_ACCESS_KEY_ID');
  if (!SECRET_KEY) missing.push('R2_SECRET_ACCESS_KEY');
  if (!BUCKET) missing.push('R2_BUCKET');
  if (!PUBLIC_URL) missing.push('R2_PUBLIC_URL');
  return missing;
};

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
/**
 * So'rovning savol qismi (`?a=1&b=2`) imzo uchun qat'iy
 * tartibda bo'lishi kerak: kalitlar alifbo bo'yicha, qiymatlar
 * esa kodlangan. Aks holda imzo mos kelmaydi.
 */
const canonicalQuery = (query) => {
  const q = query || {};
  return Object.keys(q)
    .filter((k) => q[k] !== undefined && q[k] !== null && q[k] !== '')
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(q[k]))}`)
    .join('&');
};

export const signRequest = ({ method, key, query, payload, contentType, now }) => {
  const stamp = (now || new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = stamp.slice(0, 8);
  const host = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
  /* Kalitsiz so'rov — bu bucket'ning O'ZIGA murojaat (ro'yxat
     olish). Unda yo'l oxiridagi chiziqcha qolmasligi kerak. */
  const uri = key ? `/${BUCKET}/${encodeKey(key)}` : `/${BUCKET}`;
  const qs = canonicalQuery(query);
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

  const canonicalRequest = [method, uri, qs, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256hex(canonicalRequest)].join('\n');

  let signingKey = hmac(`AWS4${SECRET_KEY}`, date);
  signingKey = hmac(signingKey, REGION);
  signingKey = hmac(signingKey, SERVICE);
  signingKey = hmac(signingKey, 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    url: `https://${host}${uri}${qs ? `?${qs}` : ''}`,
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
      const body = await res.text();
      console.error('R2 put failed:', res.status, body.slice(0, 300));
      /* R2 xato sababini XML ichida <Code> bo'lagida aytadi va aynan
         shu bo'lak hal qiluvchi:

           InvalidAccessKeyId    — Access Key ID noto'g'ri
           SignatureDoesNotMatch — Secret noto'g'ri
           NoSuchBucket          — bucket nomi noto'g'ri
           AccessDenied          — kalit to'g'ri, lekin ruxsati yo'q

         Faqat shu qisqa kod olinadi: javobning qolgan qismida
         kerakmas tafsilot bo'lishi mumkin. */
      const code = (/<Code>([^<]{1,60})<\/Code>/.exec(body) || [])[1] || '';
      return { error: `Faylni saqlab bo‘lmadi (R2: ${res.status}${code ? ' ' + code : ''})` };
    }
    return { ok: true, key, url: publicUrlFor(key) };
  } catch (err) {
    console.error('R2 put error:', err.message);
    // Tarmoq xatosi: manzil noto'g'ri bo'lsa ham shu yerga tushadi.
    return { error: `Faylni saqlab bo‘lmadi (ulanmadi: ${err.message})` };
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
/* ============================================================
   OMBORDA NIMA BOR
   ------------------------------------------------------------
   Admin panel "qancha joy band" degan savolga javob berishi
   kerak. Redis o'zining hajmini aytadi, R2 esa aytmaydi —
   uni sanab chiqish kerak.

   `ListObjectsV2` bir chaqiruvda 1000 tagacha fayl qaytaradi
   va davomi bo'lsa belgi (`continuation-token`) beradi. Bu
   yerda sahifalar soni CHEKLANGAN: admin sahifasi ochilganda
   o'n minglab faylni sanab o'tirish uzoq va qimmat. Chegaraga
   yetilsa, javobda `truncated: true` bo'ladi va panel "kamida
   shuncha" deb ko'rsatadi — to'liq sonni bilmasdan turib uni
   aniq qilib ko'rsatish yolg'on bo'lardi.

   Javob — XML. To'liq XML tahlilchisi kerak emas: bizga faqat
   `<Key>`, `<Size>` va `<NextContinuationToken>` kerak.
   ============================================================ */
const MAX_PAGES = 5;

const xmlAll = (xml, teg) => {
  const re = new RegExp(`<${teg}>([\\s\\S]*?)</${teg}>`, 'g');
  const out = [];
  let m = re.exec(xml);
  while (m) { out.push(m[1]); m = re.exec(xml); }
  return out;
};
const xmlOne = (xml, teg) => {
  const m = new RegExp(`<${teg}>([\\s\\S]*?)</${teg}>`).exec(xml);
  return m ? m[1] : '';
};

/**
 * Bucket'dagi fayllarni sanaydi.
 *
 * Hech qachon xato tashlamaydi: admin sahifasi ombor javob
 * bermagani uchun umuman ochilmay qolmasligi kerak.
 *
 * @returns {Promise<{ok:boolean, count:number, bytes:number,
 *   truncated:boolean, byPrefix:Object, error?:string}>}
 */
export const listObjects = async () => {
  if (!storageConfigured()) return { ok: false, count: 0, bytes: 0, truncated: false, byPrefix: {}, error: 'sozlanmagan' };

  let count = 0;
  let bytes = 0;
  const byPrefix = {};
  let token = '';
  let truncated = false;

  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const signed = signRequest({
        method: 'GET',
        key: '',
        query: { 'list-type': 2, 'max-keys': 1000, 'continuation-token': token },
        payload: '',
        contentType: 'application/octet-stream',
      });
      const res = await fetch(signed.url, { method: 'GET', headers: signed.headers });
      if (!res.ok) {
        return { ok: false, count, bytes, truncated, byPrefix, error: `R2 ${res.status}` };
      }
      const xml = await res.text();

      xmlAll(xml, 'Contents').forEach((item) => {
        const key = xmlOne(item, 'Key');
        const size = Number(xmlOne(item, 'Size')) || 0;
        count += 1;
        bytes += size;
        /* Birinchi bo'lak — papka nomi: avatar, chat, truck,
           icon. Shu bo'yicha guruhlanadi, ya'ni "nima joy
           egallayapti" degan savolga javob bo'ladi. */
        const papka = key.includes('/') ? key.slice(0, key.indexOf('/')) : 'boshqa';
        if (!byPrefix[papka]) byPrefix[papka] = { count: 0, bytes: 0 };
        byPrefix[papka].count += 1;
        byPrefix[papka].bytes += size;
      });

      const yana = xmlOne(xml, 'IsTruncated') === 'true';
      token = xmlOne(xml, 'NextContinuationToken');
      if (!yana || !token) return { ok: true, count, bytes, truncated: false, byPrefix };
      truncated = true;
    }
    /* Sahifalar chegarasiga yetildi — son to'liq emas. */
    return { ok: true, count, bytes, truncated: true, byPrefix };
  } catch (err) {
    return { ok: false, count, bytes, truncated, byPrefix, error: err.message };
  }
};

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

/* ============================================================
   Yozishmaga biriktiriladigan fayllar
   ------------------------------------------------------------
   Rasmdan boshqa narsa ham ketadi: ovozli xabar va hujjat.
   Lekin ISTALGAN tur emas — ro'yxat qisqa va ataylab shunday.
   Yuk tashishda kerak bo'ladigani: rasm, PDF (yuk xati, hisob)
   va ovoz. Bajariladigan fayllar bu ro'yxatga kirmaydi.
   ============================================================ */
export const CHAT_MEDIA_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  /* Ovoz: qaysi qurilma qaysi turni berishini oldindan bilib
     bo'lmaydi. Android odatda webm/opus, iPhone mp4, eski
     brauzerlar ogg yoki 3gp beradi. Hammasi — ovoz idishi. */
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/3gpp': '3gp',
};

/** Tur bo'yicha xabarning ko'rinishi: ovoz, rasm yoki hujjat. */
export const mediaKindFor = (type) => {
  if (String(type || '').startsWith('audio/')) return 'voice';
  if (String(type || '').startsWith('image/')) return 'image';
  return 'file';
};

/* Telefon ovoz yozganda tur yolg'iz kelmaydi:
   `data:audio/webm;codecs=opus;base64,...`. Qo'shimcha bo'lak
   har brauzerda boshqacha yoziladi — oraga bo'sh joy ham,
   qo'shtirnoq ham tushishi mumkin ("audio/ogg; codecs=opus").
   Shu sababli bu yerda naqsh emas, oddiy ajratish ishlatiladi:
   vergulgacha bo'lgan sarlavha bo'laklarga bo'linadi, turi —
   birinchi bo'lak. Qolgani e'tiborga olinmaydi, ya'ni u orqali
   ruxsat ro'yxatini chetlab o'tib bo'lmaydi. */
const BASE64_RE = /^[A-Za-z0-9+/\s]*={0,2}$/;

const parseDataUrl = (raw) => {
  const value = String(raw ?? '');
  if (!value.startsWith('data:')) return null;
  const vergul = value.indexOf(',');
  if (vergul < 0) return null;

  const bolaklar = value.slice(5, vergul).split(';').map((p) => p.trim());
  // Oxirgi bo'lak "base64" bo'lishi shart: boshqa kodlash qabul qilinmaydi.
  if (bolaklar[bolaklar.length - 1].toLowerCase() !== 'base64') return null;

  const type = (bolaklar[0] || '').toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type)) return null;

  const body = value.slice(vergul + 1);
  if (!body || !BASE64_RE.test(body)) return null;
  return { type, body };
};

/**
 * `data:` ko'rinishidagi faylni R2'ga ko'chiradi.
 *
 * uploadImage bilan bir xil ishlaydi, farqi — ruxsat etilgan
 * turlar ro'yxati tashqaridan beriladi va qaytgan javobda
 * faylning turi, hajmi va ko'rinishi ham bo'ladi.
 */
export const uploadMedia = async (value, prefix, maxBytes, types) => {
  if (!storageConfigured()) return null;

  const parsed = parseDataUrl(value);
  if (!parsed) return { error: 'Fayl formati noto‘g‘ri' };

  const { type } = parsed;
  const ruxsat = types || CHAT_MEDIA_TYPES;
  /* Turi aytiladi: aks holda qaysi qurilma nega ishlamayotganini
     aniqlash imkonsiz bo'lardi. Bunda maxfiy narsa yo'q. */
  if (!ruxsat[type]) return { error: `Bu turdagi fayl yuborilmaydi (${type})` };

  const bytes = Buffer.from(parsed.body, 'base64');
  if (!bytes.length) return { error: 'Fayl bo‘sh' };
  if (maxBytes && bytes.length > maxBytes) return { error: 'Fayl hajmi katta' };

  const key = `${prefix}/${new Date().toISOString().slice(0, 7)}/`
    + `${crypto.randomBytes(16).toString('hex')}.${ruxsat[type]}`;

  const result = await putObject(key, bytes, type);
  if (result.error) return { error: result.error };
  return { url: result.url, key, type, size: bytes.length, kind: mediaKindFor(type) };
};
