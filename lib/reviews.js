/**
 * Baholar: mezonlar va ikki tomonlama baholash.
 *
 * Ilgari baho bitta raqam edi — 1 dan 5 gacha yulduz. "4 yulduz"
 * degani nima ekanini keyingi odam bilmaydi: kech keldimi, yukni
 * shikastladimi, yoki shunchaki telefonini ko'tarmadimi? Endi har
 * baho bilan birga bir necha mezon belgilanadi, va profilda qaysi
 * maqtov necha marta takrorlangani ko'rinadi.
 *
 * Ikkinchisi — baho endi bir tomonlama emas. Ilgari faqat yuk
 * beruvchi haydovchini baholardi; haydovchi esa pul to'lamagan yoki
 * yukni noto'g'ri ko'rsatgan mijoz haqida hech nima ayta olmasdi.
 * Bozorda ikkala tomon ham tanlaydi, demak ikkalasi ham baholanadi.
 *
 * Kalitlar:
 *   order.rating       — yuk beruvchi haydovchiga qo'ygan baho
 *   order.ownerRating  — haydovchi yuk beruvchiga qo'ygan baho
 *   profile.ratingCount / ratingSum        — haydovchi sifatidagi baho
 *   profile.ownerRatingCount / ownerRatingSum — yuk beruvchi sifatidagi baho
 *   profile.tags       — { ONTIME: 12, CARE: 9, ... } takrorlanish soni
 */

/** Baho kimga: haydovchigami yoki yuk beruvchigami. */
export const SIDES = ['DRIVER', 'OWNER'];

/**
 * Mezonlar. Faqat ijobiy — "nimasi yaxshi edi" degan savolga javob.
 *
 * Salbiy teglar ataylab yo'q: ular bir bosishda odamning nomiga
 * yopishib qoladi va janjalga aylanadi. Norozilik uchun izoh
 * maydoni va shikoyat tugmasi bor, ular odam ko'rib chiqadi.
 */
export const CRITERIA = {
  DRIVER: ['ONTIME', 'CARE', 'COMMUNICATION', 'PRICE_KEPT'],
  OWNER: ['PAID_ONTIME', 'ACCURATE', 'COMMUNICATION', 'FAST_LOADING'],
};

export const CRITERIA_LABELS = {
  ONTIME: 'Vaqtida yetkazdi',
  CARE: 'Yukka ehtiyot bo‘ldi',
  COMMUNICATION: 'Aloqaga oson chiqdi',
  PRICE_KEPT: 'Narxni o‘zgartirmadi',
  PAID_ONTIME: 'To‘lovni vaqtida qildi',
  ACCURATE: 'Yukni to‘g‘ri ko‘rsatdi',
  FAST_LOADING: 'Yuklash tez bo‘ldi',
};

export const MAX_COMMENT = 300;

/** Bir profilda saqlanadigan oxirgi izohlar soni. */
export const REVIEW_LIMIT = 30;

export const reviewsKey = (identity) => `reviews:${identity}`;

/**
 * Kelgan bahoni tozalaydi. Noma'lum teg jimgina tashlab yuboriladi —
 * eski mijoz yangi teg nomini bilmasligi mumkin, lekin bu butun
 * bahoni yo'qotish uchun sabab emas.
 */
export const validateReview = ({ stars, comment, tags }, side) => {
  const n = Number(stars);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    return { error: 'Baho 1 dan 5 gacha bo‘lsin' };
  }
  const allowed = CRITERIA[side] || [];
  const clean = [...new Set(
    (Array.isArray(tags) ? tags : []).map((t) => String(t)).filter((t) => allowed.includes(t)),
  )];
  return {
    value: {
      stars: n,
      comment: String(comment ?? '').trim().slice(0, MAX_COMMENT),
      tags: clean,
      ratedAt: Date.now(),
    },
  };
};

/**
 * Bahoni profilga qo'shadi: o'rtacha uchun yig'indi, va har bir
 * mezonning takrorlanish soni. Profil ob'ekti joyida o'zgaradi.
 */
export const applyReview = (profile, review, side) => {
  const p = profile && typeof profile === 'object' ? profile : {};
  if (side === 'OWNER') {
    p.ownerRatingCount = (p.ownerRatingCount || 0) + 1;
    p.ownerRatingSum = (p.ownerRatingSum || 0) + review.stars;
  } else {
    p.ratingCount = (p.ratingCount || 0) + 1;
    p.ratingSum = (p.ratingSum || 0) + review.stars;
  }
  const tags = p.tags && typeof p.tags === 'object' ? p.tags : {};
  for (const tag of review.tags) tags[tag] = (tags[tag] || 0) + 1;
  p.tags = tags;
  return p;
};

/**
 * Profilda ko'rsatish uchun eng ko'p takrorlangan mezonlar,
 * kamida ikki marta aytilganlari. Bir kishining bir marta bosgan
 * tegi hali "shu odamning fazilati" degani emas.
 */
export const topTags = (tags, limit = 3, minCount = 2) =>
  Object.entries(tags || {})
    .filter(([tag, count]) => count >= minCount && CRITERIA_LABELS[tag])
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count, label: CRITERIA_LABELS[tag] }));
