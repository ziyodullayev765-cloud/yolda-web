/**
 * Akkauntni o'chirish.
 *
 * Apple (5.1.1(v)) va Google Play ikkalasi ham talab qiladi: akkaunt
 * yaratish bor ekan, odam uni ilovaning ICHIDAN o'chira olishi kerak.
 * "Bizga yozing" yoki "saytga kiring" qabul qilinmaydi, "faolsizlantirish"
 * ham yetarli emas — ma'lumot haqiqatan o'chishi kerak.
 *
 * Qiyinligi shunda: ma'lumotning bir qismi YOLG'IZ foydalanuvchiniki
 * emas. Tugagan buyurtma — ikki odam o'rtasidagi kelishuv yozuvi;
 * yozishmaning ikki egasi bor; qo'yilgan baho esa boshqa odamning
 * reytingida turibdi. Ularni o'chirish ikkinchi tomonning tarixini
 * buzadi, uni haqsiz qoldiradi.
 *
 * Shuning uchun ikki xil muomala:
 *
 *   O'CHADI  — faqat o'ziga tegishli bo'lgani: profil, telefon va
 *              Telegram bog'lanishi, saqlangan qidiruvlar,
 *              bildirishnomalar, saralanganlar, tasdiqlash hujjatlari
 *              (pasport/guvohnoma rasmlari) va avatar fayli.
 *
 *   ANONIM   — ikkinchi tomoni bor yozuvlar: buyurtma va mashina
 *     BO'LADI  e'lonidan ism, telefon va username olib tashlanadi,
 *              yozuvning o'zi (yo'nalish, sana, holat) qoladi.
 *
 * Shu bilan do'konlar talabi ham bajariladi (shaxsiy ma'lumot
 * o'chdi), ikkinchi tomonning tarixi ham joyida qoladi.
 *
 * Username darhol bo'shaydi — boshqa odam uni ola oladi.
 */
import {
  kvGet, kvSet, kvDel, kvSmembers, kvSrem,
} from './kv.js';
import { KINDS, docKey } from './verification.js';
import { searchesKey, cityIndexKey, ANY_CITY } from './savedSearch.js';
import { keyFromUrl, deleteObject } from './storage.js';

/** O'chirilgan odam o'rniga ko'rinadigan nom. */
export const DELETED_NAME = 'O‘chirilgan foydalanuvchi';

/** Faol buyurtma — hali yakunlanmagan, ya'ni ikkinchi tomon kutmoqda. */
export const ACTIVE_ORDER_STATUSES = ['DRIVER_FOUND', 'PICKING_UP', 'LOADED', 'ON_THE_WAY'];

const parse = (raw) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * Yo'ldagi buyurtmalar. Akkauntni o'chirishdan oldin tekshiriladi:
 * haydovchi yo'lda ketayotganda yuk beruvchining raqami yo'qolsa,
 * u bog'lana olmay qoladi. Shuning uchun bunday holatda o'chirish
 * to'xtatiladi va sabab aytiladi — bu do'konlar ruxsat beradigan
 * istisno, chunki sabab tushuntiriladi va vaqtinchalik.
 */
export const activeOrdersFor = async (identity, codes) => {
  const active = [];
  for (const code of codes) {
    const order = parse(await kvGet(`order:${code}`));
    if (!order) continue;
    const mine = order.ownerIdentity === identity
      || (order.driver && order.driver.identity === identity);
    if (!mine) continue;
    if (ACTIVE_ORDER_STATUSES.includes(order.status || 'NEW')) active.push(code);
  }
  return active;
};

/** Buyurtmadan shaxsni olib tashlaydi, yozuvning o'zini qoldiradi. */
export const anonymiseOrder = (order, identity) => {
  const next = { ...order };
  let touched = false;

  if (next.ownerIdentity === identity) {
    next.ownerIdentity = null;
    next.ownerDeleted = true;
    next.googleEmail = null;
    next.name = DELETED_NAME;
    next.phone = '';
    next.telegramUsername = null;
    next.telegramId = null;
    // Hali hech kim olmagan yuk ochiq turmasin — egasi yo'q.
    if ((next.status || 'NEW') === 'NEW') next.status = 'CANCELLED';
    touched = true;
  }

  if (next.driver && next.driver.identity === identity) {
    next.driver = {
      ...next.driver,
      identity: null,
      deleted: true,
      name: DELETED_NAME,
      phone: '',
      telegramUsername: null,
      telegramId: null,
    };
    touched = true;
  }

  return touched ? next : null;
};

/** Mashina e'lonidan sotuvchini olib tashlaydi va ro'yxatdan yashiradi. */
export const anonymiseTruck = (truck, identity) => {
  if (!truck || truck.sellerIdentity !== identity) return null;
  return {
    ...truck,
    sellerIdentity: null,
    sellerDeleted: true,
    sellerName: DELETED_NAME,
    sellerUsername: null,
    phone: '',
    // Egasi yo'q e'lon sotuvda turmasligi kerak.
    status: 'REMOVED',
    removedAt: Date.now(),
  };
};

/**
 * Hamma ishni bajaradi. `deps` — tashqi bog'lanishlar (ro'yxat
 * kalitlari), testda ularni almashtirib qo'yish uchun ajratilgan.
 */
export const deleteAccount = async (identity, {
  orderCodes = [],
  truckIds = [],
} = {}) => {
  const profile = parse(await kvGet(`profile:${identity}`)) || {};
  const removed = [];
  const anonymised = { orders: 0, trucks: 0 };

  // ---- 1. Avatar fayli (R2) ----
  const avatarKey = keyFromUrl(profile.avatarUrl);
  if (avatarKey) await deleteObject(avatarKey).catch(() => {});

  // ---- 2. Tasdiqlash hujjatlari: pasport, guvohnoma rasmlari ----
  for (const kind of KINDS) {
    await kvDel(docKey(identity, kind));
    removed.push(docKey(identity, kind));
  }

  // ---- 3. Saqlangan qidiruvlar va ularning shahar indeksi ----
  const searches = parse(await kvGet(searchesKey(identity))) || [];
  const cities = new Set([ANY_CITY]);
  if (Array.isArray(searches)) {
    searches.forEach((s) => cities.add(s && s.fromCity ? s.fromCity : ANY_CITY));
  }
  for (const city of cities) await kvSrem(cityIndexKey(city), identity);
  await kvDel(searchesKey(identity));
  removed.push(searchesKey(identity));

  // ---- 4. Yozishmalar ro'yxati ----
  // Xabarlarning o'zi o'chmaydi: ularning ikkinchi egasi bor va
  // suhbatdoshning yozishmasi yo'qolib qolmasligi kerak. Faqat shu
  // odamning ro'yxati va o'qilmagan hisoblagichlari olib tashlanadi.
  const others = await kvSmembers(`inbox:${identity}`);
  for (const other of others) {
    await kvDel(`chatUnread:${identity}:${other}`);
    await kvDel(`chatUnread:${other}:${identity}`);
  }
  await kvDel(`inbox:${identity}`);
  removed.push(`inbox:${identity}`);

  // ---- 5. Buyurtmalar: anonim bo'ladi ----
  for (const code of orderCodes) {
    const order = parse(await kvGet(`order:${code}`));
    if (!order) continue;
    const next = anonymiseOrder(order, identity);
    if (next) {
      await kvSet(`order:${code}`, JSON.stringify(next));
      anonymised.orders += 1;
    }
  }

  // ---- 6. Mashina e'lonlari: anonim bo'ladi va yashiriladi ----
  for (const id of truckIds) {
    const truck = parse(await kvGet(`truck:${id}`));
    if (!truck) continue;
    const next = anonymiseTruck(truck, identity);
    if (next) {
      await kvSet(`truck:${id}`, JSON.stringify(next));
      anonymised.trucks += 1;
    }
  }

  // ---- 7. Telefon va Telegram bog'lanishlari ----
  if (profile.phone) {
    await kvDel(`phoneOwner:${profile.phone}`);
    await kvDel(`phoneChat:${profile.phone}`);
    await kvDel(`phoneUser:${profile.phone}`);
    removed.push(`phoneOwner:${profile.phone}`);
  }
  const tgId = await kvGet(`tgChat:${identity}`);
  if (tgId) {
    await kvDel(`tgIdToEmail:${tgId}`);
    await kvDel(`telegram:${tgId}`);
    removed.push(`tgIdToEmail:${tgId}`);
  }
  await kvDel(`tgChat:${identity}`);
  removed.push(`tgChat:${identity}`);

  /* ---- 8. Username band bo'lib qoladi (bo'shamaydi) ----
     Sababi: bu odam boshqalarga qo'ygan baholar ularning yozuvlarida
     `fromUsername` bilan turibdi. Username bo'shasa va uni boshqa
     odam olsa, eski baholar YANGI egasiga tegishli bo'lib ko'rinardi
     — ya'ni begona odamning gapi unga yozib qo'yilardi.

     Shuning uchun nom bo'shatilmaydi, o'rniga "egasi yo'q" belgisi
     qo'yiladi: band-bandligi tekshiruvi uni egallangan deb biladi,
     ommaviy profil qidiruvi esa profil yo'qligi uchun 404 qaytaradi. */
  if (profile.username) {
    const nameKey = `username:${String(profile.username).toLowerCase()}`;
    const owner = await kvGet(nameKey);
    // Faqat haqiqatan shu odamniki bo'lsa — begonasiga tegmaylik.
    if (owner === identity) {
      await kvSet(nameKey, `deleted:${Date.now()}`);
      removed.push(nameKey + ' (band qilib qoldirildi)');
    }
  }

  // ---- 9. Qolgan shaxsiy kalitlar ----
  for (const key of [
    `notifs:${identity}`,
    `notifs_seen:${identity}`,
    `truck_favs:${identity}`,
    `saved_loads:${identity}`,
    `saved_drivers:${identity}`,
    `reviews:${identity}`,
    `offers:${identity}`,
    `driver_offers:${identity}`,
  ]) {
    await kvDel(key);
    removed.push(key);
  }

  // ---- 10. Profilning o'zi ----
  await kvDel(`profile:${identity}`);
  removed.push(`profile:${identity}`);

  // Ban ro'yxatida qolsin: o'chirib qayta ro'yxatdan o'tish bilan
  // bloklashdan qutulib bo'lmasligi kerak.

  return { ok: true, removed, anonymised };
};
