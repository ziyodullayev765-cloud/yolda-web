/**
 * POST /api/support
 *
 * Receives a message from the "Muammo bormi? Yozing" form on the Aloqa tab
 * and logs it for the admin panel. No Google sign-in required here on
 * purpose — someone stuck (e.g. can't sign in at all) still needs a way to
 * reach us.
 */
import { kvPush, kvLtrim, kvIncr, kvExpire } from '../lib/kv.js';

/**
 * Crude in-memory throttle. Serverless instances are ephemeral, so this only
 * blunts a burst from one warm instance.
 */
const recent = new Map();
const isThrottled = (key) => {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > 60_000) recent.delete(k);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
};

/* ============================================================
   NEGA BU YERDA IKKI XIL CHEGARA BOR
   ------------------------------------------------------------
   Bu endpoint ataylab ochiq: kira olmagan odam ham yoza olishi
   kerak. Lekin ochiq degani cheksiz degani emas.

   Yuqoridagi `isThrottled` har bir lambda NUSXASIDA alohida
   ishlaydi va `x-forwarded-for` ga tayanadi — uni so'rovda
   yozib yuborish mumkin. Ya'ni u faqat tezlik to'sig'i.

   Shuning uchun pastda yana ikkita, chetlab o'tilmaydigan
   chegara bor:

     - RO'YXAT UZUNLIGI. Har yozuvdan keyin ro'yxat qirqiladi.
       Aks holda u cheksiz o'sardi — Upstash bepul tarifida esa
       256 MB joy bor, ya'ni bir odam bazani to'ldirib, ilovani
       butunlay to'xtatib qo'yishi mumkin edi.

     - SOATLIK SON. Hisoblagich bazada, demak hamma nusxa uchun
       bitta. Soatiga shuncha xabardan ko'pi qabul qilinmaydi.
       Bu "admin panelni to'ldirib tashlash" ni to'xtatadi.

   Chegaraga yetilsa odamga rostini aytamiz — xabar YUBORILMADI.
   "Yuborildi" deb ko'rsatib, sukutda tashlab yuborish eng yomoni
   bo'lardi: muammosi bor odam javob kutib o'tiradi.
   ============================================================ */
const MAX_STORED = 500;
const MAX_PER_HOUR = 60;
const COUNTER_KEY = () => `supportRate:${Math.floor(Date.now() / 3_600_000)}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});

  const name = String(body.name || '').trim().slice(0, 80);
  const contact = String(body.contact || '').trim().slice(0, 80);
  const message = String(body.message || '').trim().slice(0, 500);

  if (!message) return res.status(400).json({ error: 'Xabar matnini yozing' });

  const ip = req.headers['x-forwarded-for'] || 'unknown';
  if (isThrottled(ip)) {
    return res.status(429).json({ error: 'Biroz kuting va qayta urinib ko‘ring' });
  }

  /* Soatlik chegara — bazadagi hisoblagich bo'yicha, ya'ni hamma
     lambda nusxasi uchun bitta. Birinchi oshirishda kalitga ikki
     soatlik muddat qo'yiladi: o'zi tozalanadi. */
  const counterKey = COUNTER_KEY();
  const hits = Number(await kvIncr(counterKey).catch(() => 0)) || 0;
  if (hits === 1) await kvExpire(counterKey, 2 * 60 * 60).catch(() => {});
  if (hits > MAX_PER_HOUR) {
    return res.status(429).json({ error: 'Hozir juda ko‘p murojaat keldi. Birozdan keyin urinib ko‘ring' });
  }

  const ok = await kvPush('support_messages', JSON.stringify({ name, contact, message, createdAt: Date.now() }));
  if (!ok) return res.status(500).json({ error: 'Yuborilmadi, birozdan keyin urinib ko‘ring' });
  /* Eng yangisi boshida (`LPUSH`), shuning uchun boshidan
     `MAX_STORED` ta qoldiriladi — eskilari tushib ketadi. */
  await kvLtrim('support_messages', 0, MAX_STORED - 1).catch(() => {});

  return res.status(200).json({ ok: true });
}
