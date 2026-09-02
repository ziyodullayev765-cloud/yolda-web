/**
 * POST /api/profile
 *
 * One endpoint doing double duty:
 *   - { googleIdToken | telegramInitData }                        → returns the caller's saved profile
 *   - { googleIdToken | telegramInitData, username/role/city/... } → updates whichever fields were sent
 *
 * Plus two actions for the Google<->Telegram account-linking flow
 * (requirement #6 — see lib/identity.js for why it's two steps):
 *   - ?action=link-telegram-start,  { googleIdToken }               → mint a 6-digit code
 *   - ?action=link-telegram-finish, { telegramInitData, code }      → redeem it, completing the link
 *
 * Plus the self-serve "get verified" request from the Profile page:
 *   - ?action=request-verification, { googleIdToken | telegramInitData } → flags the profile as pending review
 *
 * Auth accepts either credential — see lib/identity.js. A caller identified
 * only through Telegram (no linked Google account) is keyed by "tg:<id>"
 * instead of an email; every key below already treats that as an opaque
 * string, so nothing else in this file needs to change for that case.
 *
 * A username can belong to only one account at a time. Two keys in Redis
 * track that both ways:
 *   username:<lowercased>  -> owner's identity   (who currently holds it)
 *   profile:<identity>     -> JSON blob { username, displayName, role, city, bio, phone, avatarUrl, ... }
 */
import { resolveEmail, createTelegramLinkCode, redeemTelegramLinkCode } from '../lib/identity.js';
import { kvConfigured, kvGet, kvSet, kvDel, kvSadd, kvSrem, kvSismember, kvRange } from '../lib/kv.js';
import { MAX_SEARCHES, ANY_CITY, searchesKey, cityIndexKey } from '../lib/savedSearch.js';
import { NOTIFY_CATEGORIES, readNotifications, markNotificationsSeen } from '../lib/notify.js';
import { topTags, reviewsKey, REVIEW_LIMIT, CRITERIA_LABELS } from '../lib/reviews.js';
import {
  KINDS, REVIEWED_KINDS, MAX_DOC_CHARS, readVerifications, setVerification,
  publicVerifications, canSubmit, docKey,
} from '../lib/verification.js';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const ROLES = ['DRIVER', 'OWNER', 'BOTH'];
const CITIES = [
  'Toshkent', 'Samarqand', 'Buxoro', 'Andijon', 'Namangan', 'Nukus', 'Qarshi', 'Urganch',
  'Farg\'ona', 'Jizzax', 'Navoiy', 'Guliston', 'Termiz',
];
const VEHICLE_TYPES = ['ISUZU', 'GAZEL', 'FURGON', 'YARIM_TREYLER', 'SAMOSVAL', 'BOSHQA'];
// This app has no blob/file storage, so a picked avatar is just stored as a
// data: URL string inline in the profile JSON — the client (fileToAvatarDataUrl
// in index.html) already resizes it to a small square JPEG before sending it,
// this cap is just the server-side backstop against a client that skips that.
const AVATAR_DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/;
const MAX_AVATAR_BYTES = 400 * 1024;

/** profile:<email> used to just be the plain username string — read old and new shapes. */
const parseProfile = (raw) => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // fall through
  }
  return { username: raw };
};

/**
 * Bot shu foydalanuvchiga yoza oladimi? Sozlamalardagi bildirishnoma
 * kalitlari faqat shu rost bo'lganda ma'noga ega — aks holda ular
 * hech narsa qilmaydigan tugmalar bo'lib qolardi.
 *
 * Indeksni lib/identity.js yozadi (Telegram orqali har kirganda).
 */
const telegramReachable = async (identity) => {
  if (String(identity).startsWith('tg:')) return true;
  return Boolean(await kvGet(`tgChat:${identity}`));
};

/**
 * O'z profilini qaytarish. Tasdiqlar har doim to'liq uchtalik holda
 * beriladi — eski yozuvda `verifications` bo'lmasligi mumkin, va
 * sayt tomonida "yo'q bo'lsa nima qilamiz" degan tekshiruvlar
 * takrorlanmasligi kerak. Bu yerda kutilayotgan va rad etilgan
 * holatlar ham bor: bu odamning o'z profili, hammasini ko'radi.
 */
const withTelegramFlag = (profile, reachable) => ({
  ...profile,
  verifications: readVerifications(profile),
  telegramReachable: reachable,
});

const normalisePhone = (v) => {
  const d = String(v).replace(/\D/g, '');
  if (d.length === 9) return `+998${d}`;
  if (d.length === 12 && d.startsWith('998')) return `+${d}`;
  return '';
};

/** POST ?action=link-telegram-start — step 1, see the file header comment. */
const linkTelegramStart = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const result = await createTelegramLinkCode(body.googleIdToken);
  if (result.error) return res.status(400).json({ error: result.error });
  return res.status(200).json({ ok: true, code: result.code, expiresInSeconds: result.expiresInSeconds });
};

/** POST ?action=link-telegram-finish — step 2, see the file header comment. */
const linkTelegramFinish = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const result = await redeemTelegramLinkCode({ code: body.code, telegramInitData: body.telegramInitData });
  if (result.error) return res.status(400).json({ error: result.error });
  return res.status(200).json({ ok: true });
};

/**
 * POST ?action=request-verification — tasdiqlash so'rovi.
 *
 * Ilgari bitta tugma edi va u faqat profilga vaqt belgisini qo'yardi;
 * hujjatni admin Telegram orqali alohida so'rardi. Endi hujjat shu
 * yerdan yuboriladi va uch xil tasdiq bor (lib/verification.js).
 *
 * Telefon bu yerdan tasdiqlanmaydi: uni Telegram boti o'zi qiladi
 * (api/telegram.js), chunki raqamni Telegram'ning o'zi tasdiqlab
 * beradi. Bu yerda "SMS yubordik" deb yozib qo'yish yolg'on bo'lardi.
 *
 * `kind` yuborilmasa — eski mijoz, IDENTITY deb qabul qilinadi.
 */
const requestVerification = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = await resolveEmail({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData });
  if (!email) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const kind = KINDS.includes(body.kind) ? body.kind : 'IDENTITY';
  if (!REVIEWED_KINDS.includes(kind)) {
    return res.status(400).json({
      error: 'Telefon raqami Telegram boti orqali tasdiqlanadi',
      viaTelegram: true,
    });
  }

  const profileKey = `profile:${email}`;
  const existing = parseProfile(await kvGet(profileKey));
  const current = readVerifications(existing)[kind];

  const allowed = canSubmit(current);
  if (!allowed.ok) {
    // Kutilayotgan so'rov — xato emas, odam sahifani qayta ochgan.
    if (current.status === 'PENDING') {
      return res.status(200).json({ ok: true, profile: withTelegramFlag(existing, await telegramReachable(email)) });
    }
    return res.status(400).json({ error: allowed.error });
  }

  const doc = String(body.docDataUrl || '');
  if (!doc.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Hujjat rasmini biriktiring' });
  }
  if (doc.length > MAX_DOC_CHARS) {
    return res.status(413).json({ error: 'Rasm juda katta, kichikroq suratga oling' });
  }

  // Hujjat profil ichida emas, alohida kalitda turadi: profil har xil
  // joyda o'qiladi, hujjat esa faqat moderatorga kerak va qaror
  // chiqishi bilan o'chib ketadi.
  if (!(await kvSet(docKey(email, kind), doc))) {
    return res.status(502).json({ error: 'Yuborilmadi, qayta urinib ko‘ring' });
  }

  const next = setVerification({ ...existing }, kind, {
    status: 'PENDING', at: Date.now(), reviewedAt: 0, reason: '',
  });
  if (!(await kvSet(profileKey, JSON.stringify(next)))) {
    return res.status(502).json({ error: 'Yuborilmadi, qayta urinib ko‘ring' });
  }
  await kvSadd('profile_emails', email);
  await kvSadd('verify_queue', `${email}|${kind}`);
  return res.status(200).json({ ok: true, profile: withTelegramFlag(next, await telegramReachable(email)) });
};

const handleProfile = async (req, res) => {
  if (!kvConfigured) {
    return res.status(500).json({ error: 'Bazacha ulanmagan (KV_REST_API_URL/TOKEN yo‘q) — administratorga xabar bering' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = await resolveEmail({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData });
  if (!email) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const profileKey = `profile:${email}`;
  const existing = parseProfile(await kvGet(profileKey));

  const touchesAnyField = ['username', 'displayName', 'role', 'city', 'bio', 'phone', 'vehicleType', 'plateNumber', 'telegramUsername', 'avatarDataUrl', 'notify']
    .some((k) => body[k] !== undefined);
  if (!touchesAnyField) {
    return res.status(200).json({ ok: true, profile: withTelegramFlag(existing, await telegramReachable(email)) });
  }
  if (await kvSismember('banned', email.toLowerCase())) {
    return res.status(403).json({ error: 'Sizga xizmatdan foydalanish cheklangan' });
  }

  const next = { ...existing };
  // Set once, the first time this identity actually saves anything — real
  // "member since" data for the Mashinalar seller card, not a guess.
  if (!next.joinedAt) next.joinedAt = Date.now();

  if (body.username !== undefined && body.username !== null && body.username !== '') {
    const username = String(body.username).trim();
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({
        error: 'Username 3-20 belgidan, faqat lotin harflari, raqam va pastki chiziq (_) bo‘lishi kerak',
      });
    }
    const usernameKey = `username:${username.toLowerCase()}`;
    const owner = await kvGet(usernameKey);
    if (owner && owner !== email) {
      return res.status(409).json({ error: 'Bu username band, boshqasini tanlang' });
    }
    if (existing.username && existing.username.toLowerCase() !== username.toLowerCase()) {
      await kvDel(`username:${existing.username.toLowerCase()}`);
    }
    const claimed = await kvSet(usernameKey, email);
    if (!claimed) {
      return res.status(502).json({ error: 'Username saqlab bo‘lmadi, qayta urinib ko‘ring' });
    }
    next.username = username;
  }

  // An empty field means "the user didn't touch this one" — it must never
  // wipe a value that was saved earlier. Only a non-empty value updates it.
  // displayName overrides the name shown app-wide (profile header, chat, ...)
  // in place of whatever Google/Telegram reported — useful for a Telegram
  // account with no real name set, or anyone who'd rather show something else.
  if (body.displayName !== undefined && body.displayName !== null && body.displayName !== '') {
    next.displayName = String(body.displayName).trim().slice(0, 60);
  }

  if (body.role !== undefined && body.role !== null && body.role !== '') {
    const role = String(body.role);
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Noto‘g‘ri rol' });
    next.role = role;
  }

  if (body.city !== undefined && body.city !== null && body.city !== '') {
    const city = String(body.city);
    if (!CITIES.includes(city)) return res.status(400).json({ error: 'Noto‘g‘ri shahar' });
    next.city = city;
  }

  if (body.bio !== undefined && body.bio !== null && body.bio !== '') {
    next.bio = String(body.bio).trim().slice(0, 200);
  }

  if (body.phone !== undefined && body.phone !== null && body.phone !== '') {
    const phone = normalisePhone(body.phone);
    if (!phone) return res.status(400).json({ error: 'Telefon raqam noto‘g‘ri' });
    next.phone = phone;
  }

  // Driver-only fields — only meaningful once a role is DRIVER or BOTH, but
  // saved as sent so switching role back and forth doesn't lose them.
  if (body.vehicleType !== undefined && body.vehicleType !== null && body.vehicleType !== '') {
    const vehicleType = String(body.vehicleType);
    if (!VEHICLE_TYPES.includes(vehicleType)) return res.status(400).json({ error: 'Noto‘g‘ri mashina turi' });
    next.vehicleType = vehicleType;
  }

  if (body.plateNumber !== undefined && body.plateNumber !== null && body.plateNumber !== '') {
    next.plateNumber = String(body.plateNumber).trim().toUpperCase().slice(0, 12);
  }

  if (body.avatarDataUrl !== undefined && body.avatarDataUrl !== null && body.avatarDataUrl !== '') {
    const match = AVATAR_DATA_URL_RE.exec(String(body.avatarDataUrl));
    if (!match) return res.status(400).json({ error: 'Rasm formati noto‘g‘ri' });
    // Decoded byte length from the base64 payload, padding-adjusted — no
    // need to actually decode it just to size-check it.
    const b64 = match[2];
    const decodedBytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    if (decodedBytes > MAX_AVATAR_BYTES) {
      return res.status(400).json({ error: 'Rasm hajmi katta, boshqasini tanlang' });
    }
    next.avatarUrl = String(body.avatarDataUrl);
  }

  // Links this account to a Telegram @username so /api/telegram can show a
  // "✓ Tasdiqlangan" tag when this driver claims a load, and so a rating
  // left after delivery can be attributed back to this profile.
  if (body.telegramUsername !== undefined && body.telegramUsername !== null && body.telegramUsername !== '') {
    const tg = String(body.telegramUsername).trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-zA-Z0-9_]{5,32}$/.test(tg)) {
      return res.status(400).json({ error: 'Telegram username noto‘g‘ri (masalan: username)' });
    }
    next.telegramUsername = tg;
    await kvSet(`tgToEmail:${tg}`, email);
  }

  /**
   * Telegram bildirishnomalari sozlamasi (lib/notify.js o'qiydi).
   * Faqat ma'lum turkumlar, faqat boolean — mijoz yuborgan boshqa
   * narsa e'tiborga olinmaydi. Maydon yo'q bo'lsa — yoqilgan deb
   * hisoblanadi, shuning uchun faqat `false` saqlashning ma'nosi bor.
   */
  if (body.notify !== undefined && body.notify !== null && typeof body.notify === 'object') {
    const nextNotify = { ...(existing.notify || {}) };
    for (const key of NOTIFY_CATEGORIES) {
      if (body.notify[key] === undefined) continue;
      if (body.notify[key]) delete nextNotify[key];
      else nextNotify[key] = false;
    }
    if (Object.keys(nextNotify).length) next.notify = nextNotify;
    else delete next.notify;
  }

  const saved = await kvSet(profileKey, JSON.stringify(next));
  if (!saved) {
    return res.status(502).json({ error: 'Saqlab bo‘lmadi (bazachaga yozib bo‘lmadi), qayta urinib ko‘ring' });
  }
  // Registers this identity in the admin panel's user index. Safe to
  // repeat — SADD is a no-op if it's already a member.
  await kvSadd('profile_emails', email);
  return res.status(200).json({ ok: true, profile: withTelegramFlag(next, await telegramReachable(email)) });
};

/* ============================================================
   Saqlangan qidiruvlar
   ------------------------------------------------------------
   Haydovchi "Toshkent → Farg'ona yo'nalishida yuk chiqsa menga
   ayt" deb aytib qo'yadi. Yangi yuk joylanganda mos kelganlarga
   Telegram orqali xabar boradi (api/order.js dagi notifyMatches).

   Profil yozuvidan alohida kalitda saqlanadi: admin paneldagi
   foydalanuvchilar ro'yxati profil bilan birga bularni ham
   tortib yurmasin.

   `search_cities:<shahar>` — qaysi identity shu shahardan yuk
   kutayotgani indeksi. Yangi yuk kelganda hamma foydalanuvchini
   ko'rib chiqmaslik uchun kerak; "har qanday shahar" degan
   qidiruvlar ANY_CITY kalitida turadi.
   ============================================================ */
const readSearches = async (identity) => {
  try {
    const parsed = JSON.parse((await kvGet(searchesKey(identity))) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/** Faqat tanish maydonlar saqlanadi — mijoz yuborgan qolgani tashlanadi. */
const cleanSearch = (raw) => {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const search = {
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    fromCity: str(raw.fromCity, 40),
    toCity: str(raw.toCity, 40),
    cargoType: str(raw.cargoType, 30),
    truckType: str(raw.truckType, 30),
    minWeight: num(raw.minWeight),
    maxWeight: num(raw.maxWeight),
    createdAt: Date.now(),
  };
  if (search.minWeight && search.maxWeight && search.minWeight > search.maxWeight) {
    return { error: 'Og‘irlik oralig‘i noto‘g‘ri' };
  }
  return { search };
};

const getSearches = async (req, res, identity) =>
  res.status(200).json({ ok: true, searches: await readSearches(identity) });

const saveSearch = async (req, res, identity, body) => {
  const { search, error } = cleanSearch(body.search || {});
  if (error) return res.status(400).json({ error });

  const searches = await readSearches(identity);
  if (searches.length >= MAX_SEARCHES) {
    return res.status(409).json({ error: `Ko‘pi bilan ${MAX_SEARCHES} ta qidiruv saqlash mumkin` });
  }
  // Aynan shu qidiruv allaqachon bormi? Ikki xil nomdagi bir xil
  // qidiruv ikki marta xabar yuborardi.
  const sameAs = (a, b) => ['fromCity', 'toCity', 'cargoType', 'truckType', 'minWeight', 'maxWeight']
    .every((k) => (a[k] || null) === (b[k] || null));
  if (searches.some((s) => sameAs(s, search))) {
    return res.status(409).json({ error: 'Bunday qidiruv allaqachon saqlangan' });
  }

  searches.push(search);
  const saved = await kvSet(searchesKey(identity), JSON.stringify(searches));
  if (!saved) return res.status(502).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });
  await kvSadd(cityIndexKey(search.fromCity), identity);
  return res.status(200).json({ ok: true, searches });
};

const deleteSearch = async (req, res, identity, body) => {
  const id = String(body.id || '');
  const searches = await readSearches(identity);
  const removed = searches.find((s) => s.id === id);
  if (!removed) return res.status(404).json({ error: 'Qidiruv topilmadi' });

  const next = searches.filter((s) => s.id !== id);
  const saved = await kvSet(searchesKey(identity), JSON.stringify(next));
  if (!saved) return res.status(502).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });
  // Shu shahardan boshqa qidiruv qolmagan bo'lsa, indeksdan chiqamiz.
  if (!next.some((s) => (s.fromCity || ANY_CITY) === (removed.fromCity || ANY_CITY))) {
    await kvSrem(cityIndexKey(removed.fromCity), identity);
  }
  return res.status(200).json({ ok: true, searches: next });
};

/** POST ?action=notifications — ilova ichidagi bildirishnomalar. */
const handleNotifications = async (req, res, action) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const identity = await resolveEmail({
    googleIdToken: body.googleIdToken,
    telegramInitData: body.telegramInitData,
  });
  if (!identity) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  if (action === 'notifications-seen') {
    await markNotificationsSeen(identity);
    return res.status(200).json({ ok: true, unread: 0 });
  }
  const { items, unread } = await readNotifications(identity, kvRange);
  return res.status(200).json({ ok: true, notifications: items, unread });
};

const handleSearches = async (req, res, action) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const identity = await resolveEmail({
    googleIdToken: body.googleIdToken,
    telegramInitData: body.telegramInitData,
  });
  if (!identity) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  if (action === 'searches') return getSearches(req, res, identity);
  if (action === 'save-search') return saveSearch(req, res, identity, body);
  return deleteSearch(req, res, identity, body);
};

/* ============================================================
   Ommaviy profil
   ------------------------------------------------------------
   Taklif kelganda yuk beruvchi "bu kim?" deb so'raydi — shu savolga
   javob. Faqat ishonchga aloqador maydonlar chiqadi: telefon va
   email hech qachon. Ular aloqa boshlangandan keyin ochiladi.
   ============================================================ */
const publicProfileShape = (identity, profile) => ({
  username: profile.username || '',
  displayName: profile.displayName || profile.username || '',
  avatarDataUrl: profile.avatarDataUrl || '',
  verified: Boolean(profile.verified),
  // Uchta tasdiq alohida ko'rinadi: "tekshirilgan" degani nima ekani
  // endi aniq. Kutilayotgani va rad etilgani begonaga chiqmaydi.
  verifications: publicVerifications(profile),
  role: profile.role || '',
  city: profile.city || '',
  vehicleType: profile.vehicleType || '',
  bio: profile.bio || '',
  ratingCount: profile.ratingCount || 0,
  ratingSum: profile.ratingSum || 0,
  // Yuk beruvchi sifatidagi baho alohida turadi: yaxshi haydovchi
  // bo'lish bilan yukni to'g'ri ko'rsatib, vaqtida to'lash — bir
  // narsa emas, va ular bitta o'rtachaga qo'shilib ketmasligi kerak.
  ownerRatingCount: profile.ownerRatingCount || 0,
  ownerRatingSum: profile.ownerRatingSum || 0,
  // Eng ko'p takrorlangan maqtovlar. Bir marta aytilgani chiqmaydi —
  // bitta odamning bitta bosishi hali fazilat degani emas.
  topTags: topTags(profile.tags),
  // Faqat shu hisoblagich joriy qilingandan keyingi yetkazishlar.
  // Undan oldingilari sanalmaydi — noto'g'ri raqamdan ko'ra kamroq
  // raqam yaxshiroq.
  deliveredCount: profile.deliveredCount || 0,
  joinedAt: profile.joinedAt || null,
});

const getPublicProfile = async (req, res) => {
  const username = String(req.query.username || '').trim().toLowerCase();
  if (!username) return res.status(400).json({ error: 'Username kerak' });

  const identity = await kvGet(`username:${username}`);
  if (!identity) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  const profile = parseProfile(await kvGet(`profile:${identity}`));
  if (!profile || !profile.username) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

  // Oxirgi izohlar. Raqamlar ishonch bermaydi — odamning o'z so'zi
  // beradi. Kim yozgani ko'rsatilmaydi: baho buyurtma orqali
  // bog'langan, ya'ni ismni chiqarish ikkala tomonni ham ochib
  // qo'yardi.
  const reviews = (await kvRange(reviewsKey(identity), 0, REVIEW_LIMIT - 1))
    .map((s) => { try { return JSON.parse(s); } catch { return null; } })
    .filter(Boolean)
    .slice(0, 10)
    .map((r) => ({
      stars: r.stars,
      comment: r.comment || '',
      route: r.route || '',
      at: r.ratedAt || 0,
      tags: (r.tags || []).filter((t) => CRITERIA_LABELS[t]),
    }));

  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=120');
  return res.status(200).json({ ok: true, profile: publicProfileShape(identity, profile), reviews });
};

export default async function handler(req, res) {
  // Ommaviy profil — yagona GET yo'l; qolgani hamma vaqt POST.
  if (req.method === 'GET' && String(req.query.action || '') === 'public') {
    return getPublicProfile(req, res);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const action = String(req.query.action || '');
  if (action === 'searches' || action === 'save-search' || action === 'delete-search') {
    return handleSearches(req, res, action);
  }
  if (action === 'notifications' || action === 'notifications-seen') {
    return handleNotifications(req, res, action);
  }
  if (action === 'link-telegram-start') return linkTelegramStart(req, res);
  if (action === 'link-telegram-finish') return linkTelegramFinish(req, res);
  if (action === 'request-verification') return requestVerification(req, res);
  return handleProfile(req, res);
}
