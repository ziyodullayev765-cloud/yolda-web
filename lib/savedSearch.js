/**
 * Saqlangan qidiruvlar: kalitlar va moslik qoidasi.
 *
 * Ikki joyda kerak — api/profile.js ularni saqlaydi/o'chiradi,
 * api/order.js yangi yuk kelganda kimga xabar berishni shu yerdan
 * hisoblaydi. Qoida bitta joyda tursin: ikkita nusxa bir kun
 * ajralib ketadi va odam kutgan xabari kelmay qoladi.
 */

export const MAX_SEARCHES = 5;

export const searchesKey = (identity) => `searches:${identity}`;

/* SHAHAR INDEKSI OLIB TASHLANDI.
   Ilgari bu yerda `search_cities:<shahar>` degan teskari indeks
   bor edi: har bir saqlangan qidiruv uchun yoziladi, akkaunt
   o'chirilganda tozalanadi. Lekin u HECH QAYERDA O'QILMASDI —
   xabar oladiganlar `profile_emails` dan olinib, keyin
   `matchesSearch` bilan filtrlanardi.

   Nega u yordam ham bera olmasdi: qidiruvi YO'Q odam ham xabar
   oladi (u hamma yukni kutyapti), bunday odamlar esa indeksda
   turmaydi. Ya'ni indeks bilan ham to'liq ro'yxatni o'qish
   kerak bo'lardi — faqat ustiga yana bir o'qish qo'shilardi.

   Shuning uchun olib tashlandi: har bir saqlash va o'chirishda
   bitta ortiqcha yozuv kam bo'ldi. */

/**
 * Yuk shu qidiruvga mos keladimi?
 *
 * Bo'sh maydon — "farqi yo'q". api/order.js dagi listLoads filtri
 * bilan bir xil mantiq: odam ro'yxatda ko'radigan yuk bilan xabar
 * oladigan yuk bir xil bo'lishi kerak.
 */
export const matchesSearch = (order, search) => {
  if (!order || !search) return false;
  if (search.fromCity && order.fromCity !== search.fromCity) return false;
  if (search.toCity && order.toCity !== search.toCity) return false;
  if (search.cargoType && order.cargoType !== search.cargoType) return false;
  if (search.truckType && order.truckType !== search.truckType) return false;

  const weight = Number(order.weightKg);
  if (search.minWeight && !(weight >= search.minWeight)) return false;
  if (search.maxWeight && !(weight <= search.maxWeight)) return false;
  return true;
};

/** Qidiruvni odam o'qiydigan qatorga aylantiradi (chip yozuvi, xabar sarlavhasi). */
export const describeSearch = (search) => {
  const route = [search.fromCity || null, search.toCity || null].filter(Boolean).join(' → ');
  const parts = [route || 'Barcha yo‘nalishlar'];
  if (search.minWeight || search.maxWeight) {
    const from = search.minWeight ? `${search.minWeight}` : '0';
    const to = search.maxWeight ? `${search.maxWeight}` : '∞';
    parts.push(`${from}–${to} kg`);
  }
  return parts.join(' · ');
};
