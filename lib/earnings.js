/**
 * Haydovchining yetkazgan yuklari daftari.
 *
 * NEGA ALOHIDA DAFTAR. Yetkazilgan yuklarni sanash uchun
 * buyurtmalar ro'yxatini (`order_codes`) qaytadan ko'rib chiqsa
 * ham bo'lardi. Ikki sabab bilan bunday qilinmadi:
 *
 *   1. U ro'yxat oxirgi 300 ta buyurtma bilan cheklangan. Ya'ni
 *      ilovada ishlar ko'paygan sari eski tashuvlar undan tushib
 *      qolardi — hisobot esa jimgina kamayib borardi. Hisob-kitob
 *      uchun bu eng yomon xato: raqam noto'g'ri bo'lsa ham
 *      ishonchli ko'rinadi.
 *   2. Har bir ochilishda uch yuzta yozuvni o'qish kerak bo'lardi.
 *
 * Shuning uchun yuk YETKAZILGAN PAYTDA (ya'ni kamdan-kam) bitta
 * qisqa yozuv qo'shiladi, o'qish esa bitta so'rovga tushadi.
 *
 * ESKI TASHUVLAR. Bu daftar paydo bo'lishidan oldin yetkazilgan
 * yuklar unda yo'q. Shuning uchun birinchi ochilishda daftar bir
 * marta buyurtmalar ro'yxatidan to'ldiriladi va "to'ldirildi"
 * belgisi qo'yiladi — keyingi ochilishlarda qayta sanalmaydi.
 *
 * SUMMA — KELISHILGAN NARX. Ilovada to'lov tizimi yo'q va hech
 * qanday komissiya ushlanmaydi (admin paneldagi `commissionPercent`
 * hech qayerda qo'llanilmaydi). Shuning uchun bu yerdagi raqam
 * "sof daromad" emas, aynan kelishilgan summa — ilovada shunday
 * nomlanadi ham.
 */
import { kvGet, kvSet, kvPush, kvRange } from './kv.js';

export const earningsKey = (identity) => `earnings:${identity}`;
/** Eski tashuvlar bir marta ko'chirilganini bildiradi. */
export const seededKey = (identity) => `earnings_seeded:${identity}`;

/** O'qishda nechta yozuv olinadi. `order_codes` bilan bir xil oyna. */
export const MAX_ENTRIES = 300;

/** Daftarga yoziladigan qisqa yozuv. */
const entryOf = (order) => ({
  code: order.code,
  fromCity: order.fromCity || '',
  toCity: order.toCity || '',
  // Kelishilgan narx bor bo'lsa — aynan u; yo'q bo'lsa e'londagisi.
  amount: Number(order.agreedAmount || order.amount || 0),
  distanceKm: Number(order.distanceKm || 0),
  deliveredAt: Number(order.deliveredAt || order.updatedAt || Date.now()),
});

/**
 * Yetkazilgan yukni daftarga yozadi.
 *
 * Hech qachon xato tashlamaydi: daftar yozilmagani yukning
 * yetkazilganini bekor qilmaydi.
 */
export const recordDelivery = async (identity, order) => {
  if (!identity || !order || !order.code) return false;
  try {
    return await kvPush(earningsKey(identity), JSON.stringify(entryOf(order)));
  } catch {
    return false;
  }
};

/**
 * Daftarni o'qiydi; bo'sh bo'lsa bir marta eski buyurtmalardan
 * to'ldiradi.
 *
 * @param {string} identity
 * @param {() => Promise<object[]>} loadPastOrders
 *        Shu haydovchining yetkazilgan buyurtmalarini qaytaradi.
 *        Faqat BIR MARTA, daftar birinchi ochilganda chaqiriladi.
 */
export const readLedger = async (identity, loadPastOrders) => {
  if (!identity) return [];

  let raw = [];
  try {
    raw = await kvRange(earningsKey(identity), 0, MAX_ENTRIES - 1);
  } catch {
    raw = [];
  }

  if (!raw.length && typeof loadPastOrders === 'function') {
    let seeded = null;
    try {
      seeded = await kvGet(seededKey(identity));
    } catch {
      /* Belgi o'qilmasa ham to'ldirishga urinamiz — eng yomoni
         bir marta ortiqcha ish bo'ladi. */
    }
    if (!seeded) {
      try {
        const past = (await loadPastOrders()) || [];
        // Eng eskisidan boshlab yoziladi: ro'yxat yangisi tepada
        // bo'lishi uchun (kvPush boshiga qo'yadi).
        const sorted = past
          .map(entryOf)
          .sort((a, b) => a.deliveredAt - b.deliveredAt)
          .slice(-MAX_ENTRIES);
        for (const e of sorted) {
          await kvPush(earningsKey(identity), JSON.stringify(e));
        }
        await kvSet(seededKey(identity), '1');
        raw = sorted.map((e) => JSON.stringify(e)).reverse();
      } catch {
        raw = [];
      }
    }
  }

  return raw
    .map((str) => {
      try {
        return JSON.parse(str);
      } catch {
        return null;
      }
    })
    .filter((e) => e && e.code)
    .sort((a, b) => (b.deliveredAt || 0) - (a.deliveredAt || 0));
};

/** `2026-10` ko'rinishidagi oy kaliti — mahalliy emas, UTC. */
export const monthKey = (ms) => new Date(ms).toISOString().slice(0, 7);

/**
 * Daftardan hisobot yasaydi.
 *
 * Oylar ro'yxatida hozirgi oy DOIM bo'ladi, hatto bo'sh bo'lsa
 * ham: "bu oy nechta tashuv qildim" degan savolga bo'sh ro'yxat
 * emas, "0" javob berishi kerak.
 *
 * @param {object[]} entries
 * @param {number} [now]
 */
export const summarise = (entries, now = Date.now()) => {
  const list = Array.isArray(entries) ? entries : [];

  const months = new Map();
  const cities = new Map();
  let amount = 0;
  let distanceKm = 0;

  // Hozirgi oy har doim ro'yxatda turadi.
  months.set(monthKey(now), { key: monthKey(now), count: 0, amount: 0 });

  for (const e of list) {
    const key = monthKey(e.deliveredAt || now);
    const m = months.get(key) || { key, count: 0, amount: 0 };
    m.count += 1;
    m.amount += Number(e.amount || 0);
    months.set(key, m);

    amount += Number(e.amount || 0);
    distanceKm += Number(e.distanceKm || 0);

    if (e.toCity) {
      const c = cities.get(e.toCity) || { city: e.toCity, count: 0, amount: 0 };
      c.count += 1;
      c.amount += Number(e.amount || 0);
      cities.set(e.toCity, c);
    }
  }

  const sortedMonths = [...months.values()].sort((a, b) => (a.key < b.key ? 1 : -1)).slice(0, 12);

  return {
    thisMonth: months.get(monthKey(now)),
    months: sortedMonths,
    topCities: [...cities.values()]
      .sort((a, b) => b.count - a.count || b.amount - a.amount)
      .slice(0, 5),
    totals: { count: list.length, amount, distanceKm },
  };
};
