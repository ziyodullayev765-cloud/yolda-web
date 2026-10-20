/**
 * GET /api/config
 *
 * Exposes the few public settings the browser needs (like the Google
 * OAuth Client ID) without hardcoding them into the static index.html —
 * change them in Vercel's Environment Variables and they take effect on
 * the next request, no redeploy of the HTML required.
 *
 * telegramBotUsername is the bot's public @handle (not a secret — it's
 * visible to anyone who opens the bot in Telegram) used to build the
 * "Open in Telegram" deep link when the site is opened in a normal
 * browser. TELEGRAM_BOT_TOKEN itself is never exposed here or anywhere
 * else the browser can reach.
 *
 * The rest comes from the `admin_settings` blob the admin panel's
 * Sozlamalar screen writes (see api/admin-data.js). That's what makes
 * those settings real rather than decorative: changing the support phone
 * or flipping maintenance mode in /admin changes what this returns, and
 * index.html renders whatever it gets. Only the genuinely public fields
 * are forwarded — commissionPercent stays admin-side.
 */
import { kvGet, kvSmembers } from '../lib/kv.js';
import { publicShape as lifeShape, sortItems as sortLifeItems } from '../lib/life.js';
import { normalizeIcons } from '../lib/icons.js';
import { sameOriginIcon, R2_ICON_RE } from '../lib/iconProxy.js';

const FALLBACK = {
  platformName: "YO'LDA",
  supportPhone: '',
  supportTelegram: '',
  maintenanceMode: false,
  maintenanceMessage: '',
  welcomeImageUrl: '',
  mascotImageUrl: '',
};

/**
 * GET /api/config?resource=life
 *
 * YO'LDA LIFE bo'limining e'lon qilingan yozuvlari. Ochiq o'qish —
 * bu mazmun baribir hamma uchun. Alohida endpoint ochilmadi: Vercel
 * Hobby rejasida bitta deploy'da 12 ta funksiya bo'lishi mumkin va
 * 10 tasi allaqachon band, shuning uchun ochiq o'qishlar shu yerda
 * to'planadi.
 */
const getLife = async (res) => {
  let items = [];
  try {
    const ids = await kvSmembers('life_ids');
    items = (await Promise.all(ids.map(async (id) => {
      const raw = await kvGet(`life:${id}`);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }))).filter(Boolean).filter((it) => it.published);
  } catch {
    // Baza javob bermasa bo'lim bo'sh ko'rinadi — sahifa baribir ochiladi.
    items = [];
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  return res.status(200).json({ ok: true, life: sortLifeItems(items).map(lifeShape) });
};

/**
 * GET /icon/2026-10/<nom>.png  →  /api/config?iconPath=...
 *
 * NEGA. Ikonkalar fayl omborida (R2) turadi va ilova ochilganda
 * ularning har biri BOSHQA DOMENGA so'rov bo'lib ketadi: yangi
 * ulanish, yangi TLS, ombor cheklovi. Biri kelmasa — o'sha
 * ikonka umuman ko'rinmaydi (rasm niqob ichida; bo'sh niqob
 * shaklni qirqib tashlaydi).
 *
 * Endi ular saytning o'z manzilidan beriladi. Fayl o'sha
 * omborda qoladi, lekin uni brauzer emas, server olib keladi va
 * javob Vercel chekkasida (CDN) saqlanib qoladi — ya'ni ombor
 * bir marta bezovta qilinadi, qolgan hammaga chekkadan beriladi.
 *
 * XAVFSIZLIK. "Manzilni ayt — olib kelaman" degan endpoint SSRF
 * uchun ochiq eshik. Shuning uchun bu yerda manzil BERILMAYDI:
 * domen bizning sozlamamizdan (R2_PUBLIC_URL), yo'lning shakli
 * esa qat'iy tekshiriladi — `YYYY-MM/<32 belgi>.<png|jpg|webp>`.
 * Boshqa hech narsa o'tmaydi: na `..`, na boshqa domen, na
 * omborning boshqa papkasi.
 */
const ICON_MAX_BYTES = 2 * 1024 * 1024;

const getIconFile = async (req, res) => {
  const path = String(req.query.iconPath || '');
  if (!R2_ICON_RE.test(path)) return res.status(404).json({ error: 'Topilmadi' });

  const base = (process.env.R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (!base) return res.status(404).json({ error: 'Topilmadi' });

  try {
    const got = await fetch(`${base}/icon/${path}`, { redirect: 'error' });
    if (!got.ok) {
      /* Xato uzoq saqlanmasin: ombor bir lahzaga javob bermagan
         bo'lsa, yo'qlik bir yil yopishib qolmasligi kerak. */
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=10');
      return res.status(502).json({ error: 'Rasm olinmadi' });
    }
    const type = got.headers.get('content-type') || '';
    if (!/^image\/(png|jpeg|webp)$/.test(type)) {
      return res.status(502).json({ error: 'Rasm emas' });
    }
    const bytes = Buffer.from(await got.arrayBuffer());
    if (bytes.length > ICON_MAX_BYTES) return res.status(502).json({ error: 'Rasm juda katta' });

    /* Nomida tasodifiy belgilar bor — bitta manzil doim bitta
       rasm. Shuning uchun "abadiy" keshlanadi: yangi rasm yangi
       manzil bilan keladi. */
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    return res.status(200).send(bytes);
  } catch {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=10');
    return res.status(502).json({ error: 'Rasm olinmadi' });
  }
};

export default async function handler(req, res) {
  if (req.query.iconPath !== undefined) return getIconFile(req, res);
  if (String(req.query.resource || '') === 'life') return getLife(res);

  let settings = FALLBACK;
  try {
    const parsed = JSON.parse((await kvGet('admin_settings')) || '{}');
    if (parsed && typeof parsed === 'object') settings = { ...FALLBACK, ...parsed };
  } catch {
    // KV unreachable or the blob is corrupt — the site must still load and
    // sign people in, so fall back to "no overrides" rather than failing.
  }

  // Short cache: settings change rarely, but flipping maintenance mode
  // shouldn't take minutes to reach visitors.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
  // Admin paneldan almashtirilgan ikonkalar. Bo'sh bo'lsa ilova o'z
  // chizilgan ikonkalarini ishlatadi — bu jadval faqat ustiga yozadi.
  /* `icons` shakli o'zgarmaydi (`{id: havola}`): keshdan ochilgan
     eski sahifa ham aynan shuni kutadi. O'z rangida chiziladigan
     ikonkalar alohida ro'yxatda keladi — eski sahifa uni shunchaki
     e'tiborsiz qoldiradi. */
  let icons = {};
  let iconsPlain = [];
  try {
    const got = normalizeIcons(JSON.parse((await kvGet('icon_overrides')) || '{}'));
    /* Havolalar saytning o'z manziliga aylantiriladi — admin
       panel ularni ombor manzili bilan saqlaydi, ilova esa
       boshqa domenga bormasligi kerak. */
    icons = {};
    Object.keys(got.urls).forEach((id) => { icons[id] = sameOriginIcon(got.urls[id]); });
    iconsPlain = got.plain;
  } catch {
    icons = {};
    iconsPlain = [];
  }

  res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || '',
    /* Push bildirishnoma uchun OCHIQ kalit. U sir emas va sir
       bo'lishi ham mumkin emas: brauzer obunani aynan shu
       kalitga bog'laydi. Maxfiy juftligi (VAPID_PRIVATE_KEY)
       esa serverdan chiqmaydi. */
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    icons,
    iconsPlain,
    platformName: settings.platformName,
    /* Kirish ekranidagi rasm — admin paneldan almashtiriladi.
       Bo'sh bo'lsa ilovaning o'z chizmasi qoladi. */
    welcomeImageUrl: settings.welcomeImageUrl || '',
    /* Yordamchi rasmi — qo'yilmasa ilovaning o'z chizmasi. */
    mascotImageUrl: settings.mascotImageUrl || '',
    supportPhone: settings.supportPhone,
    supportTelegram: settings.supportTelegram,
    maintenanceMode: Boolean(settings.maintenanceMode),
    maintenanceMessage: settings.maintenanceMessage,
  });
}
