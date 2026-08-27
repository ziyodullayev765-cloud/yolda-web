/**
 * /api/trucks — a simple classifieds board for buying/selling cargo
 * vehicles, separate from the load marketplace (/api/order). One file,
 * dispatched by `?action=`, for the same Vercel Hobby 12-function-cap
 * reason as api/admin-data.js and api/chat.js:
 *
 *   GET  /api/trucks?action=list                                     → every active listing
 *   GET  /api/trucks?action=mine&googleIdToken=...|&telegramInitData=... → the caller's own listings
 *   POST /api/trucks?action=create  { googleIdToken|telegramInitData, vehicleType, brand, year, mileageKm, price, city, phone, description }
 *   POST /api/trucks?action=delete  { googleIdToken|telegramInitData, id }
 *
 * No photos — this app has no file/blob storage (see api/profile.js's
 * avatar comment for the same constraint), so a listing is text-only,
 * same as how the load marketplace already works.
 *
 * Storage: `truck:<id>` is the listing JSON; `truck_ids` is a *set* (not
 * a list) of every active id — sets support real removal (SREM) when a
 * listing is deleted/sold, which a list built with LPUSH doesn't without
 * an LREM helper this app doesn't have. Order doesn't matter for a set,
 * so results are sorted by createdAt after fetching.
 */
import { resolveEmail } from '../lib/identity.js';
import { kvGet, kvSet, kvDel, kvSadd, kvSrem, kvSmembers, kvSismember } from '../lib/kv.js';

const VEHICLE_TYPES = ['ISUZU', 'GAZEL', 'FURGON', 'YARIM_TREYLER', 'SAMOSVAL', 'BOSHQA'];
const CITIES = [
  'Toshkent', 'Samarqand', 'Buxoro', 'Andijon', 'Namangan', 'Nukus', 'Qarshi', 'Urganch',
  'Farg\'ona', 'Jizzax', 'Navoiy', 'Guliston', 'Termiz',
];
const MAX_LISTINGS_RETURNED = 300;
const CURRENT_YEAR = new Date().getFullYear();

const generateId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const parseTruck = (raw) => {
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

const getList = async (res) => {
  const ids = await kvSmembers('truck_ids');
  const trucks = (
    await Promise.all(ids.slice(0, MAX_LISTINGS_RETURNED).map((id) => kvGet(`truck:${id}`)))
  )
    .map(parseTruck)
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return res.status(200).json({ trucks });
};

const getMine = async (req, res) => {
  const email = await resolveEmail({ googleIdToken: req.query.googleIdToken, telegramInitData: req.query.telegramInitData });
  if (!email) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const ids = await kvSmembers('truck_ids');
  const trucks = (
    await Promise.all(ids.map((id) => kvGet(`truck:${id}`)))
  )
    .map(parseTruck)
    .filter((t) => t && t.sellerIdentity === email)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return res.status(200).json({ trucks });
};

const create = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = await resolveEmail({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData });
  if (!email) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });
  if (await kvSismember('banned', email.toLowerCase())) {
    return res.status(403).json({ error: 'Sizga xizmatdan foydalanish cheklangan' });
  }

  const vehicleType = String(body.vehicleType || '');
  if (!VEHICLE_TYPES.includes(vehicleType)) return res.status(400).json({ error: 'Mashina turini tanlang' });

  const city = String(body.city || '');
  if (!CITIES.includes(city)) return res.status(400).json({ error: 'Shaharni tanlang' });

  const brand = String(body.brand || '').trim().slice(0, 60);
  if (!brand) return res.status(400).json({ error: 'Marka va modelini kiriting' });

  const year = Math.round(Number(body.year));
  if (!Number.isFinite(year) || year < 1970 || year > CURRENT_YEAR + 1) {
    return res.status(400).json({ error: 'Ishlab chiqarilgan yili noto‘g‘ri' });
  }

  const mileageKm = body.mileageKm === undefined || body.mileageKm === null || body.mileageKm === ''
    ? null
    : Math.round(Number(body.mileageKm));
  if (mileageKm !== null && (!Number.isFinite(mileageKm) || mileageKm < 0 || mileageKm > 5_000_000)) {
    return res.status(400).json({ error: 'Probeg noto‘g‘ri' });
  }

  const price = Math.round(Number(body.price));
  if (!Number.isFinite(price) || price <= 0 || price > 100_000_000_000) {
    return res.status(400).json({ error: 'Narxni to‘g‘ri kiriting' });
  }

  const phone = normalisePhone(body.phone);
  if (!phone) return res.status(400).json({ error: 'Telefon raqam noto‘g‘ri' });

  const sellerName = String(body.sellerName || '').trim().slice(0, 60);
  if (!sellerName) return res.status(400).json({ error: 'Ismingizni kiriting' });

  const description = String(body.description || '').trim().slice(0, 500);

  const id = generateId();
  const truck = {
    id,
    sellerIdentity: email,
    sellerName,
    phone,
    vehicleType,
    brand,
    year,
    mileageKm,
    price,
    city,
    description,
    createdAt: Date.now(),
  };

  const saved = await kvSet(`truck:${id}`, JSON.stringify(truck));
  if (!saved) return res.status(502).json({ error: 'Saqlab bo‘lmadi, qayta urinib ko‘ring' });
  await kvSadd('truck_ids', id);

  return res.status(200).json({ ok: true, truck });
};

const remove = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = await resolveEmail({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData });
  if (!email) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const id = String(body.id || '');
  if (!id) return res.status(400).json({ error: 'E’lon topilmadi' });

  const truck = parseTruck(await kvGet(`truck:${id}`));
  if (!truck) return res.status(404).json({ error: 'E’lon topilmadi' });
  if (truck.sellerIdentity !== email) return res.status(403).json({ error: 'Bu amalga huquqingiz yo‘q' });

  await kvDel(`truck:${id}`);
  await kvSrem('truck_ids', id);
  return res.status(200).json({ ok: true });
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const action = String(req.query.action || '');
    if (action === 'list') return getList(res);
    if (action === 'mine') return getMine(req, res);
    return res.status(400).json({ error: 'Noto‘g‘ri action' });
  }
  if (req.method === 'POST') {
    const action = String(req.query.action || '');
    if (action === 'create') return create(req, res);
    if (action === 'delete') return remove(req, res);
    return res.status(400).json({ error: 'Noto‘g‘ri action' });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
