/**
 * Takliflar (offers) — YO'LDA'ning bozor modeli.
 *
 * Ilgari yuk "birinchi bo'lib bosgan oladi" tamoyilida ishlardi:
 * Telegram guruhida «Men olaman» tugmasini kim tez bossa, yuk o'shaniki.
 * Bu tezlikni mukofotlaydi, mosligini emas — yuk beruvchi na narxni,
 * na haydovchini tanlay olardi.
 *
 * Endi haydovchi taklif yuboradi (narx + yetib borish vaqti), yuk
 * beruvchi kelgan takliflarni taqqoslab, o'zi tanlaydi.
 *
 * Holatlar:
 *   PENDING   — yuborilgan, javob kutilmoqda
 *   ACCEPTED  — yuk beruvchi qabul qildi (buyurtma DRIVER_FOUND bo'ladi)
 *   REJECTED  — rad etilgan, yoki boshqa taklif qabul qilinganda avtomatik
 *   WITHDRAWN — haydovchi o'zi qaytarib oldi
 *
 * Kalitlar:
 *   offer:<id>              — taklifning o'zi
 *   offers:<orderCode>      — buyurtmaga kelgan takliflar ro'yxati
 *   driver_offers:<identity>— haydovchi yuborgan takliflar ro'yxati
 */

export const OFFER_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'];

/** Taklif faqat hali hech kim olmagan yukka yuboriladi. */
export const OFFERABLE_ORDER_STATUSES = ['NEW'];

export const MAX_OFFER_NOTE = 300;
export const MAX_ETA = 60;
/** Bir yukka bitta haydovchidan bittadan ortiq kutilayotgan taklif bo'lmaydi. */
export const MAX_OFFERS_PER_ORDER = 50;

export const offerKey = (id) => `offer:${id}`;
export const orderOffersKey = (code) => `offers:${code}`;
export const driverOffersKey = (identity) => `driver_offers:${identity}`;

/**
 * Mijoz yuborgan taklifni tozalaydi va tekshiradi.
 * Narx majburiy: taklifning butun ma'nosi — kelishilgan raqam.
 */
export const validateOffer = ({ price, eta, note }) => {
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: 'Narxni kiriting' };
  }
  if (amount > 1_000_000_000) {
    return { error: 'Narx juda katta' };
  }
  return {
    value: {
      price: Math.round(amount),
      eta: String(eta ?? '').trim().slice(0, MAX_ETA),
      note: String(note ?? '').trim().slice(0, MAX_OFFER_NOTE),
    },
  };
};

/**
 * Haydovchiga ko'rinadigan shakl. Yuk beruvchining ismi/telefoni bu
 * yerda yo'q — u faqat taklif qabul qilingandan keyin ochiladi, xuddi
 * eski oqimdagi kabi.
 */
export const publicOfferShape = (offer) => ({
  id: offer.id,
  orderCode: offer.orderCode,
  price: offer.price,
  eta: offer.eta || '',
  note: offer.note || '',
  status: offer.status,
  createdAt: offer.createdAt,
  driverName: offer.driverName || '',
  driverUsername: offer.driverUsername || '',
  driverVerified: Boolean(offer.driverVerified),
  driverRatingCount: offer.driverRatingCount || 0,
  driverRatingSum: offer.driverRatingSum || 0,
  driverDeliveredCount: offer.driverDeliveredCount || 0,
  driverCity: offer.driverCity || '',
  driverVehicleType: offer.driverVehicleType || '',
});
