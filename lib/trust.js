/**
 * ISHONCH DARAJASI.
 *
 * ============================================================
 * BU NIMA EMAS
 * ------------------------------------------------------------
 * Bu — "bu odam halol" degan kafolat EMAS va shunday deb
 * ko'rsatilmaydi ham. Hech qanday raqam odamning niyatini
 * bilmaydi. Yolg'on kafolat esa kafolatsizlikdan battar: odam
 * unga ishonib ehtiyotkorligini yo'qotadi.
 *
 * Bu — ODAM O'ZI TEKSHIRIB OLADIGAN NARSALARNING YIG'INDISI:
 * nimasi tasdiqlangan, nechta yuk yetkazgan, qanday baho olgan.
 * Shuning uchun daraja hech qachon YAKKA ko'rsatilmaydi — doim
 * uning TARKIBI bilan birga chiqadi. "72 ball" hech narsa
 * demaydi; "telefoni va pasporti tasdiqlangan, 14 ta yuk
 * yetkazgan, 9 ta bahodan 4,8" — buni odam o'zi o'qiydi va
 * o'zi qaror qiladi.
 *
 * ============================================================
 * RAQAMLAR QAYERDAN OLINADI
 * ------------------------------------------------------------
 * Hammasi profildagi HAQIQIY ma'lumotdan. Bu yerda hech narsa
 * o'ylab topilmaydi va hech qanday "namuna" qiymat yo'q:
 *
 *   tasdiqlar     — lib/verification.js, moderator ko'rgan
 *                   yoki Telegram tasdiqlagan;
 *   yetkazishlar  — profile.deliveredCount, buyurtma
 *                   DELIVERED bo'lganda oshadi;
 *   baholar       — profile.ratingCount/ratingSum (haydovchi
 *                   sifatida) va ownerRating* (yuk beruvchi
 *                   sifatida), api/profile.js va api/order.js
 *                   yozadi.
 *
 * Ma'lumot bo'lmasa, o'rniga hech narsa to'qilmaydi: o'sha band
 * shunchaki "hali yo'q" bo'lib turadi.
 *
 * ============================================================
 * NEGA SHIKOYATLAR HISOBGA OLINMAYDI
 * ------------------------------------------------------------
 * Shikoyat bor, lekin uning holatlari (NEW, INVESTIGATING,
 * CONTACTED, RESOLVED, BANNED) "shikoyat O'RINLI edimi" degan
 * savolga javob bermaydi: RESOLVED ham "tasdiqlandi", ham
 * "asossiz ekan" degani bo'lishi mumkin. Shuning uchun ularni
 * ballga aylantirish — mavjud bo'lmagan hukmni o'ylab topish
 * bo'lardi. Odamga esa shikoyat tushgani uchun ball tushirish
 * eng og'ir xato: shikoyatni istalgan kishi yoza oladi.
 *
 * Bitta istisno bor va u aniq: odam `banned` ro'yxatida bo'lsa,
 * bu admin chiqargan QAROR. Unda daraja umuman hisoblanmaydi.
 *
 * (Agar keyinroq shikoyatga "o'rinli / asossiz" degan aniq
 *  holat qo'shilsa, uni shu yerga qo'shish mumkin bo'ladi.)
 *
 * ============================================================
 * OG'IRLIKLAR
 * ------------------------------------------------------------
 * Jami 100. Taqsimot shunday tanlangan:
 *
 *   Shaxs hujjati        25 — eng og'iri. Buni moderator ko'rgan
 *                             va u odamni haqiqiy ism bilan
 *                             bog'laydi.
 *   Telefon              20 — Telegram raqamni o'zi tasdiqlaydi,
 *                             ya'ni soxtalashtirib bo'lmaydi.
 *   Yetkazilgan yuklar   20 — ish tarixi. 10 tadan keyin to'ladi:
 *                             100 ta yuk 10 tadan "o'n barobar
 *                             ishonchli" degani emas.
 *   Baho                 15 — faqat 3 tadan ortiq baho bo'lsa.
 *                             Bitta beshlik hech narsa demaydi.
 *   Guvohnoma            10
 *   Texnik pasport       10
 *
 * A'zolik muddati BALLGA KIRMAYDI: uzoq turish o'zi ishonch
 * bermaydi. Lekin u ko'rsatiladi — odam o'zi hisobga olsin.
 */

import { readVerifications } from './verification.js';

/** Darajalar — pastdan yuqoriga. */
export const LEVELS = ['BANNED', 'NEW', 'BASIC', 'TRUSTED', 'PROVEN'];

export const LEVEL_LABELS = {
  BANNED: 'Cheklangan',
  NEW: 'Yangi',
  BASIC: 'Boshlang‘ich',
  TRUSTED: 'Ishonchli',
  PROVEN: 'Tasdiqlangan',
};

/** Daraja nimani anglatishi — ekranda darajaning ostida turadi. */
export const LEVEL_NOTES = {
  BANNED: 'Bu hisobga xizmatdan foydalanish cheklangan.',
  NEW: 'Hali hech narsa tasdiqlanmagan. Ehtiyot bo‘ling.',
  BASIC: 'Ba’zi ma’lumotlari tasdiqlangan, ish tarixi hali kam.',
  TRUSTED: 'Ma’lumotlari tasdiqlangan va ish tarixi bor.',
  PROVEN: 'Hujjatlari tasdiqlangan, ish tarixi va baholari bor.',
};

/* Chegaralar. Ataylab baland: "Tasdiqlangan" degan so'z
   hujjatlarsiz va ish tarixisiz chiqmasligi kerak. */
const THRESHOLDS = [
  ['PROVEN', 70],
  ['TRUSTED', 45],
  ['BASIC', 20],
];

/** Baho uchun eng kam ovoz. Bittasi hali o'rtacha emas. */
export const MIN_RATINGS = 3;
/** Ball to'ladigan yetkazishlar soni. */
export const DELIVERY_FULL = 10;

const son = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Ikkala tomondagi baholarni birga oladi.
 *
 * Nega birga: odam bir yukda haydovchi, boshqasida yuk beruvchi
 * bo'lishi mumkin va ikkalasi ham uning qanday ish yuritishini
 * ko'rsatadi. Ekranda ular ALOHIDA ko'rinadi (publicProfileShape),
 * bu yerda esa faqat umumiy ball uchun qo'shiladi.
 */
const baho = (profile) => {
  const count = son(profile.ratingCount) + son(profile.ownerRatingCount);
  const sum = son(profile.ratingSum) + son(profile.ownerRatingSum);
  if (count < MIN_RATINGS || sum <= 0) return { count, avg: null };
  return { count, avg: Math.round((sum / count) * 10) / 10 };
};

/**
 * Ishonch darajasi va uning tarkibi.
 *
 * @param {object} profile  profile:<identity> yozuvi
 * @param {{banned?: boolean}} [holat]
 * @returns {{level, label, note, score, max, items: Array}}
 *   `items` — ekranda ko'rsatiladigan ro'yxat. Har biri:
 *   `{ key, label, done, points, max, detail }`. `detail` —
 *   odam o'qiydigan aniq fakt yoki bo'sh satr.
 */
export const trustOf = (profile, holat = {}) => {
  const p = profile && typeof profile === 'object' ? profile : {};

  /* Cheklangan hisob uchun daraja hisoblanmaydi: bu admin
     chiqargan qaror va u hamma narsadan ustun turadi. */
  if (holat.banned) {
    return {
      level: 'BANNED',
      label: LEVEL_LABELS.BANNED,
      note: LEVEL_NOTES.BANNED,
      score: 0,
      max: 100,
      items: [],
    };
  }

  const v = readVerifications(p);
  const ok = (kind) => v[kind].status === 'VERIFIED';

  const yetkazgan = Math.round(son(p.deliveredCount));
  const b = baho(p);

  const items = [
    {
      key: 'IDENTITY',
      label: 'Shaxs hujjati tasdiqlangan',
      done: ok('IDENTITY'),
      points: ok('IDENTITY') ? 25 : 0,
      max: 25,
      detail: ok('IDENTITY') ? 'Moderator hujjatni ko‘rgan' : '',
    },
    {
      key: 'PHONE',
      label: 'Telefon raqami tasdiqlangan',
      done: ok('PHONE'),
      points: ok('PHONE') ? 20 : 0,
      max: 20,
      detail: ok('PHONE') ? 'Telegram raqamni o‘zi tasdiqlagan' : '',
    },
    {
      key: 'DELIVERED',
      label: 'Yetkazilgan yuklar',
      done: yetkazgan > 0,
      /* `DELIVERY_FULL` tadan keyin to'ladi — izohdagi sababga
         qarang. `Math.min` aynan shuning uchun. */
      points: Math.round((Math.min(yetkazgan, DELIVERY_FULL) / DELIVERY_FULL) * 20),
      max: 20,
      detail: yetkazgan > 0 ? `${yetkazgan} ta` : 'Hali yo‘q',
    },
    {
      key: 'RATING',
      label: 'Baho',
      done: b.avg !== null,
      points: b.avg === null ? 0 : Math.round((b.avg / 5) * 15),
      max: 15,
      detail: b.avg !== null
        ? `${b.count} ta bahodan ${String(b.avg).replace('.', ',')}`
        /* Nechta baho borligi aytiladi — "hali yo'q" deb
           ko'rsatib, aslida ikkitasi borligini yashirish
           odamni chalg'itardi. */
        : (b.count > 0
          ? `${b.count} ta baho — o‘rtacha uchun hali kam`
          : 'Hali yo‘q'),
    },
    {
      key: 'LICENSE',
      label: 'Haydovchilik guvohnomasi',
      done: ok('LICENSE'),
      points: ok('LICENSE') ? 10 : 0,
      max: 10,
      detail: '',
    },
    {
      key: 'TRANSPORT',
      label: 'Texnik pasport',
      done: ok('TRANSPORT'),
      points: ok('TRANSPORT') ? 10 : 0,
      max: 10,
      detail: '',
    },
  ];

  const score = items.reduce((n, it) => n + it.points, 0);
  const max = items.reduce((n, it) => n + it.max, 0);

  let level = 'NEW';
  for (const [name, chegara] of THRESHOLDS) {
    if (score >= chegara) { level = name; break; }
  }

  return {
    level,
    label: LEVEL_LABELS[level],
    note: LEVEL_NOTES[level],
    score,
    max,
    items,
    /* A'zolik muddati — ballga kirmaydi, lekin ko'rsatiladi.
       Yo'q bo'lsa umuman chiqmaydi: "noma'lum" deb yozishdan
       ko'ra jim turgani yaxshi. */
    joinedAt: son(p.joinedAt) || null,
  };
};
