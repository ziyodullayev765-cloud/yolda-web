/**
 * /api/trucks — the "Mashinalar" vehicle marketplace: buy/sell listings for
 * any vehicle (cars, trucks, buses, vans, special equipment, motorcycles),
 * separate from the load marketplace (/api/order). One file, dispatched by
 * `?action=`, for the same Vercel Hobby 12-function-cap reason as
 * api/admin-data.js and api/chat.js:
 *
 *   GET  /api/trucks?action=list                                        → active listings (everyone)
 *   GET  /api/trucks?action=detail&id=...                                → one listing + bumps its view count
 *   GET  /api/trucks?action=mine&googleIdToken=...|&telegramInitData=... → the caller's own listings, any status
 *   GET  /api/trucks?action=favorites&googleIdToken=...|&telegramInitData=... → the caller's favorited listings
 *   POST /api/trucks?action=create        { googleIdToken|telegramInitData, ...fields, photos }
 *   POST /api/trucks?action=update        { googleIdToken|telegramInitData, id, ...fields }
 *   POST /api/trucks?action=delete        { googleIdToken|telegramInitData, id }
 *   POST /api/trucks?action=set-status    { googleIdToken|telegramInitData, id, status }   (ACTIVE|PAUSED|SOLD)
 *   POST /api/trucks?action=favorite      { googleIdToken|telegramInitData, id }
 *   POST /api/trucks?action=unfavorite    { googleIdToken|telegramInitData, id }
 *
 * `photos` is up to 5 data: URLs — this app has no blob/file storage (see
 * api/profile.js's avatar comment for the same constraint), so each photo
 * is just a small resized JPEG stored inline as a string, same trick as
 * the profile avatar. The client (fileToPhotoDataUrl in index.html)
 * already keeps these small; the size caps below are the server-side
 * backstop against a client that skips that.
 *
 * Storage: `truck:<id>` is the listing JSON; `truck_ids` is a *set* (not
 * a list) of every listing id ever created (active or not) — sets support
 * real removal (SREM) on delete, which a list built with LPUSH doesn't
 * without an LREM helper this app doesn't have. `truck_favs:<identity>` is
 * a set of favorited listing ids per identity — real server-side favorites,
 * not a per-device localStorage list (unlike the load marketplace's
 * favorites today).
 *
 * No admin verification/promotion workflow yet — `verified` and
 * `promoted` are stored as plain booleans (default false) so that piece
 * can slot in later (an admin flipping them) without a schema change; the
 * frontend simply never shows a badge while they're false, honestly.
 */
import { resolveEmail } from '../lib/identity.js';
import { kvGet, kvSet, kvDel, kvSadd, kvSrem, kvSmembers, kvSismember } from '../lib/kv.js';

const CATEGORIES = ['YENGIL', 'YUK', 'MIKROAVTOBUS', 'FURGON', 'AVTOBUS', 'MAXSUS', 'MOTOSIKL', 'BOSHQA'];
const BODY_TYPES = [
  'SEDAN', 'SUV', 'UNIVERSAL', 'HATCHBACK', 'FURA', 'BORT', 'FURGON_KUZOV', 'REF', 'MIKROAVTOBUS_KUZOV', 'MAXSUS_KUZOV',
];
const FUEL_TYPES = ['DIZEL', 'BENZIN', 'GAZ', 'GIBRID', 'ELEKTR'];
const TRANSMISSIONS = ['MEXANIKA', 'AVTOMAT', 'ROBOT', 'BOSHQA'];
const CONDITIONS = ['YANGI', 'ISHLATILGAN'];
const STEERING_SIDES = ['CHAP', 'ONG'];
const SELLER_TYPES = ['SHAXSIY', 'KOMPANIYA'];
const PRICE_TYPES = ['FIXED', 'NEGOTIABLE'];
const STATUSES = ['ACTIVE', 'PAUSED', 'SOLD'];
const CITIES = [
  'Toshkent', 'Samarqand', 'Buxoro', 'Andijon', 'Namangan', 'Nukus', 'Qarshi', 'Urganch',
  'Farg\'ona', 'Jizzax', 'Navoiy', 'Guliston', 'Termiz',
];

const MAX_LISTINGS_RETURNED = 400;
const CURRENT_YEAR = new Date().getFullYear();
const PHOTO_DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/;
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 250 * 1024;

/** Decoded byte length from a base64 string's own length — no need to decode just to size-check it. */
const decodedBase64Length = (b64) => Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

const generateId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const parseJson = (raw) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const normalisePhone = (v) => {
  const d = String(v).replace(/\D/g, '');
  if (d.length === 9) return `+998${d}`;
  if (d.length === 12 && d.startsWith('998')) return `+${d}`;
  return '';
};

/** Every listing this identity ever created — used by getMine and to check ownership fast. */
const loadAllTrucks = async () => {
  const ids = await kvSmembers('truck_ids');
  const trucks = await Promise.all(ids.map((id) => kvGet(`truck:${id}`)));
  return trucks.map(parseJson).filter(Boolean);
};

const publicShape = (t) => ({
  id: t.id,
  sellerIdentity: t.sellerIdentity,
  sellerName: t.sellerName,
  sellerUsername: t.sellerUsername || null,
  phone: t.phone,
  category: t.category,
  brand: t.brand,
  year: t.year,
  mileageKm: t.mileageKm,
  price: t.price,
  priceType: t.priceType,
  city: t.city,
  bodyType: t.bodyType || null,
  fuel: t.fuel || null,
  transmission: t.transmission || null,
  condition: t.condition || null,
  steering: t.steering || null,
  sellerType: t.sellerType || null,
  documentsReady: Boolean(t.documentsReady),
  credit: Boolean(t.credit),
  exchange: Boolean(t.exchange),
  capacityTon: t.capacityTon != null ? t.capacityTon : null,
  cabType: t.cabType || null,
  axles: t.axles != null ? t.axles : null,
  hasTrailer: Boolean(t.hasTrailer),
  refrigerated: Boolean(t.refrigerated),
  enginePowerHp: t.enginePowerHp != null ? t.enginePowerHp : null,
  engineVolumeL: t.engineVolumeL != null ? t.engineVolumeL : null,
  description: t.description,
  photos: t.photos || [],
  status: t.status || 'ACTIVE',
  verified: Boolean(t.verified),
  promoted: Boolean(t.promoted),
  viewCount: t.viewCount || 0,
  createdAt: t.createdAt,
});

const getList = async (res) => {
  const all = await loadAllTrucks();
  const trucks = all
    .filter((t) => (t.status || 'ACTIVE') === 'ACTIVE')
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, MAX_LISTINGS_RETURNED)
    .map(publicShape);
  return res.status(200).json({ trucks });
};

const getDetail = async (req, res) => {
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'E’lon topilmadi' });
  const raw = await kvGet(`truck:${id}`);
  const truck = parseJson(raw);
  if (!truck) return res.status(404).json({ error: 'E’lon topilmadi' });

  // Best-effort view counter — not critical if this write races/fails.
  truck.viewCount = (truck.viewCount || 0) + 1;
  kvSet(`truck:${id}`, JSON.stringify(truck)).catch(() => {});

  // Seller info for the detail page's seller card — looked up fresh here
  // (not snapshotted onto the listing at post time) so it's never stale:
  // an avatar/rating/verified change shows up on every existing listing
  // immediately. This is the only public exposure of another identity's
  // profile fields in the app, so only the safe-to-share subset is sent.
  const [profile, all] = await Promise.all([kvGet(`profile:${truck.sellerIdentity}`), loadAllTrucks()]);
  const sellerProfile = parseJson(profile) || {};
  const sellerListingCount = all.filter((t) => t.sellerIdentity === truck.sellerIdentity && (t.status || 'ACTIVE') === 'ACTIVE').length;

  return res.status(200).json({
    truck: {
      ...publicShape(truck),
      sellerAvatarUrl: sellerProfile.avatarUrl || null,
      sellerVerified: Boolean(sellerProfile.verified),
      sellerJoinedAt: sellerProfile.joinedAt || null,
      sellerRatingCount: sellerProfile.ratingCount || 0,
      sellerRatingSum: sellerProfile.ratingSum || 0,
      sellerListingCount,
    },
  });
};

const getMine = async (req, res) => {
  const email = await resolveEmail({ googleIdToken: req.query.googleIdToken, telegramInitData: req.query.telegramInitData });
  if (!email) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const all = await loadAllTrucks();
  const trucks = all
    .filter((t) => t.sellerIdentity === email)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map(publicShape);
  return res.status(200).json({ trucks });
};

const getFavorites = async (req, res) => {
  const email = await resolveEmail({ googleIdToken: req.query.googleIdToken, telegramInitData: req.query.telegramInitData });
  if (!email) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const ids = await kvSmembers(`truck_favs:${email}`);
  const trucks = (
    await Promise.all(ids.map((id) => kvGet(`truck:${id}`)))
  )
    .map(parseJson)
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map(publicShape);
  return res.status(200).json({ trucks });
};

/** Shared field validation/extraction for create and update. `next` is the object being built (either fresh or the existing record being patched). */
const applyFields = (body, next, { requireCore }) => {
  if (requireCore || body.category !== undefined) {
    const category = String(body.category || '');
    if (!CATEGORIES.includes(category)) return 'Turkumni tanlang';
    next.category = category;
  }

  if (requireCore || body.brand !== undefined) {
    const brand = String(body.brand || '').trim().slice(0, 80);
    if (!brand) return 'Marka va modelini kiriting';
    next.brand = brand;
  }

  if (requireCore || body.year !== undefined) {
    const year = Math.round(Number(body.year));
    if (!Number.isFinite(year) || year < 1970 || year > CURRENT_YEAR + 1) return 'Ishlab chiqarilgan yili noto‘g‘ri';
    next.year = year;
  }

  if (body.mileageKm !== undefined) {
    const mileageKm = body.mileageKm === null || body.mileageKm === '' ? null : Math.round(Number(body.mileageKm));
    if (mileageKm !== null && (!Number.isFinite(mileageKm) || mileageKm < 0 || mileageKm > 5_000_000)) return 'Probeg noto‘g‘ri';
    next.mileageKm = mileageKm;
  }

  if (requireCore || body.price !== undefined) {
    const price = Math.round(Number(body.price));
    if (!Number.isFinite(price) || price <= 0 || price > 100_000_000_000) return 'Narxni to‘g‘ri kiriting';
    next.price = price;
  }

  if (body.priceType !== undefined) {
    const priceType = String(body.priceType || 'FIXED');
    if (!PRICE_TYPES.includes(priceType)) return 'Narx turi noto‘g‘ri';
    next.priceType = priceType;
  } else if (requireCore) {
    next.priceType = 'FIXED';
  }

  if (requireCore || body.city !== undefined) {
    const city = String(body.city || '');
    if (!CITIES.includes(city)) return 'Shaharni tanlang';
    next.city = city;
  }

  if (requireCore || body.phone !== undefined) {
    const phone = normalisePhone(body.phone);
    if (!phone) return 'Telefon raqam noto‘g‘ri';
    next.phone = phone;
  }

  if (requireCore || body.sellerName !== undefined) {
    const sellerName = String(body.sellerName || '').trim().slice(0, 60);
    if (!sellerName) return 'Ismingizni kiriting';
    next.sellerName = sellerName;
  }

  if (body.description !== undefined) {
    next.description = String(body.description || '').trim().slice(0, 2000);
  }

  // Everything below is optional and only meaningful for some categories —
  // the frontend only shows the relevant subset, but nothing stops any of
  // them being sent for any category, so validate loosely and just store
  // whatever was actually sent.
  if (body.bodyType !== undefined) {
    const v = String(body.bodyType || '');
    if (v && !BODY_TYPES.includes(v)) return 'Kuzov turi noto‘g‘ri';
    next.bodyType = v || null;
  }
  if (body.fuel !== undefined) {
    const v = String(body.fuel || '');
    if (v && !FUEL_TYPES.includes(v)) return 'Yoqilg‘i turi noto‘g‘ri';
    next.fuel = v || null;
  }
  if (body.transmission !== undefined) {
    const v = String(body.transmission || '');
    if (v && !TRANSMISSIONS.includes(v)) return 'Transmissiya turi noto‘g‘ri';
    next.transmission = v || null;
  }
  if (body.condition !== undefined) {
    const v = String(body.condition || '');
    if (v && !CONDITIONS.includes(v)) return 'Holati noto‘g‘ri';
    next.condition = v || null;
  }
  if (body.steering !== undefined) {
    const v = String(body.steering || '');
    if (v && !STEERING_SIDES.includes(v)) return 'Rul tomoni noto‘g‘ri';
    next.steering = v || null;
  }
  if (body.sellerType !== undefined) {
    const v = String(body.sellerType || '');
    if (v && !SELLER_TYPES.includes(v)) return 'Sotuvchi turi noto‘g‘ri';
    next.sellerType = v || null;
  }
  if (body.documentsReady !== undefined) next.documentsReady = Boolean(body.documentsReady);
  if (body.credit !== undefined) next.credit = Boolean(body.credit);
  if (body.exchange !== undefined) next.exchange = Boolean(body.exchange);

  if (body.capacityTon !== undefined) {
    const v = body.capacityTon === null || body.capacityTon === '' ? null : Number(body.capacityTon);
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 200)) return 'Yuk ko‘tarish sig‘imi noto‘g‘ri';
    next.capacityTon = v;
  }
  if (body.cabType !== undefined) next.cabType = String(body.cabType || '').trim().slice(0, 40) || null;
  if (body.axles !== undefined) {
    const v = body.axles === null || body.axles === '' ? null : Math.round(Number(body.axles));
    if (v !== null && (!Number.isFinite(v) || v < 1 || v > 12)) return 'O‘qlar soni noto‘g‘ri';
    next.axles = v;
  }
  if (body.hasTrailer !== undefined) next.hasTrailer = Boolean(body.hasTrailer);
  if (body.refrigerated !== undefined) next.refrigerated = Boolean(body.refrigerated);
  if (body.enginePowerHp !== undefined) {
    const v = body.enginePowerHp === null || body.enginePowerHp === '' ? null : Math.round(Number(body.enginePowerHp));
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 5000)) return 'Ot kuchi noto‘g‘ri';
    next.enginePowerHp = v;
  }
  if (body.engineVolumeL !== undefined) {
    const v = body.engineVolumeL === null || body.engineVolumeL === '' ? null : Number(body.engineVolumeL);
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 30)) return 'Dvigatel hajmi noto‘g‘ri';
    next.engineVolumeL = v;
  }

  if (body.photos !== undefined) {
    const rawPhotos = Array.isArray(body.photos) ? body.photos : [];
    if (rawPhotos.length > MAX_PHOTOS) return `Ko‘pi bilan ${MAX_PHOTOS} ta rasm yuklash mumkin`;
    const photos = [];
    for (const raw of rawPhotos) {
      const match = PHOTO_DATA_URL_RE.exec(String(raw));
      if (!match) return 'Rasm formati noto‘g‘ri';
      if (decodedBase64Length(match[2]) > MAX_PHOTO_BYTES) return 'Rasm hajmi katta, boshqasini tanlang';
      photos.push(String(raw));
    }
    next.photos = photos;
  }

  return null;
};

const create = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = await resolveEmail({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData });
  if (!email) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });
  if (await kvSismember('banned', email.toLowerCase())) {
    return res.status(403).json({ error: 'Sizga xizmatdan foydalanish cheklangan' });
  }

  const truck = { id: generateId(), sellerIdentity: email, status: 'ACTIVE', verified: false, promoted: false, viewCount: 0, createdAt: Date.now() };
  const error = applyFields(body, truck, { requireCore: true });
  if (error) return res.status(400).json({ error });
  if (!truck.photos) truck.photos = [];

  // Snapshot the seller's username at post time so a "message the seller"
  // button can open a chat thread without an extra profile lookup — chat
  // is keyed by username, same as the rest of the app's chat search.
  const profile = parseJson(await kvGet(`profile:${email}`));
  truck.sellerUsername = (profile && profile.username) || null;

  const saved = await kvSet(`truck:${truck.id}`, JSON.stringify(truck));
  if (!saved) return res.status(502).json({ error: 'Saqlab bo‘lmadi, qayta urinib ko‘ring' });
  await kvSadd('truck_ids', truck.id);

  return res.status(200).json({ ok: true, truck: publicShape(truck) });
};

const update = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = await resolveEmail({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData });
  if (!email) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const id = String(body.id || '');
  if (!id) return res.status(400).json({ error: 'E’lon topilmadi' });
  const truck = parseJson(await kvGet(`truck:${id}`));
  if (!truck) return res.status(404).json({ error: 'E’lon topilmadi' });
  if (truck.sellerIdentity !== email) return res.status(403).json({ error: 'Bu amalga huquqingiz yo‘q' });

  const error = applyFields(body, truck, { requireCore: false });
  if (error) return res.status(400).json({ error });

  const saved = await kvSet(`truck:${id}`, JSON.stringify(truck));
  if (!saved) return res.status(502).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });
  return res.status(200).json({ ok: true, truck: publicShape(truck) });
};

const setStatus = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = await resolveEmail({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData });
  if (!email) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const id = String(body.id || '');
  const status = String(body.status || '');
  if (!id || !STATUSES.includes(status)) return res.status(400).json({ error: 'Noto‘g‘ri so‘rov' });

  const truck = parseJson(await kvGet(`truck:${id}`));
  if (!truck) return res.status(404).json({ error: 'E’lon topilmadi' });
  if (truck.sellerIdentity !== email) return res.status(403).json({ error: 'Bu amalga huquqingiz yo‘q' });

  truck.status = status;
  const saved = await kvSet(`truck:${id}`, JSON.stringify(truck));
  if (!saved) return res.status(502).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });
  return res.status(200).json({ ok: true, truck: publicShape(truck) });
};

const remove = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = await resolveEmail({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData });
  if (!email) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const id = String(body.id || '');
  if (!id) return res.status(400).json({ error: 'E’lon topilmadi' });

  const truck = parseJson(await kvGet(`truck:${id}`));
  if (!truck) return res.status(404).json({ error: 'E’lon topilmadi' });
  if (truck.sellerIdentity !== email) return res.status(403).json({ error: 'Bu amalga huquqingiz yo‘q' });

  await kvDel(`truck:${id}`);
  await kvSrem('truck_ids', id);
  return res.status(200).json({ ok: true });
};

const favorite = async (req, res, add) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = await resolveEmail({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData });
  if (!email) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const id = String(body.id || '');
  if (!id) return res.status(400).json({ error: 'E’lon topilmadi' });

  if (add) await kvSadd(`truck_favs:${email}`, id);
  else await kvSrem(`truck_favs:${email}`, id);
  return res.status(200).json({ ok: true });
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const action = String(req.query.action || '');
    if (action === 'list') return getList(res);
    if (action === 'detail') return getDetail(req, res);
    if (action === 'mine') return getMine(req, res);
    if (action === 'favorites') return getFavorites(req, res);
    return res.status(400).json({ error: 'Noto‘g‘ri action' });
  }
  if (req.method === 'POST') {
    const action = String(req.query.action || '');
    if (action === 'create') return create(req, res);
    if (action === 'update') return update(req, res);
    if (action === 'delete') return remove(req, res);
    if (action === 'set-status') return setStatus(req, res);
    if (action === 'favorite') return favorite(req, res, true);
    if (action === 'unfavorite') return favorite(req, res, false);
    return res.status(400).json({ error: 'Noto‘g‘ri action' });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
