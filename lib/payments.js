/**
 * To'lovlar: hisob-faktura (invoys) va uning holati.
 *
 * ============================================================
 * NIMA SOTILADI
 * ------------------------------------------------------------
 * Hozircha bitta narsa — PREMIUM. Uning yagona imtiyozi vaqt:
 * yangi yuk chiqqanda xabar premiumga darhol boradi, qolganlarga
 * bir soatdan keyin (lib/premium.js). Mexanizm allaqachon bor va
 * ishlaydi; shu paytgacha uni faqat admin qo'lda berardi.
 *
 * Komissiya EMAS. Pul hozir tomonlar o'rtasida naqd o'tadi, ya'ni
 * ilova uni ushlab qololmaydi. "Komissiya oldik" deb ko'rsatish
 * uchun esa pul haqiqatan ilova orqali o'tishi kerak — bu boshqa,
 * kattaroq ish.
 *
 * ============================================================
 * NARXNI MEN BELGILAMAYMAN
 * ------------------------------------------------------------
 * Narx admin paneldagi sozlamadan olinadi. Kodda hech qanday
 * raqam yo'q: egasi belgilamagan bo'lsa, mahsulot umuman
 * sotuvga chiqmaydi. O'ylab topilgan narx — odamdan haqiqiy pul
 * so'rash degani.
 *
 * ============================================================
 * HOLATLAR
 * ------------------------------------------------------------
 *   NEW      — hisob ochildi, to'lov kutilmoqda
 *   HOLD     — to'lov tizimi pulni band qildi (Payme: state 1)
 *   PAID     — pul o'tdi, mahsulot berildi
 *   CANCELLED— bekor qilindi yoki qaytarildi
 *
 * Bir yo'nalishli: PAID bo'lgan hisob qaytadan PAID bo'lmaydi va
 * mahsulot ikki marta berilmaydi. Buni `markPaid` qo'riqlaydi.
 * ============================================================
 */
import { kvGet, kvSet, kvPush, kvRange, kvExpire, kvSaddNew } from './kv.js';
import { grantPremium, revokePremium, isPremium, premiumKey } from './premium.js';

export const INVOICE_STATES = ['NEW', 'HOLD', 'PAID', 'CANCELLED'];

export const invoiceKey = (id) => `invoice:${id}`;
export const INVOICE_LIST = 'invoice_ids';
/** Odamning o'z hisoblari — "to'ladimi?" degan savolga tez javob. */
export const userInvoicesKey = (identity) => `invoices:${identity}`;

/** Hisob shuncha vaqtdan keyin kutishni bas qiladi. */
export const INVOICE_TTL_MS = 24 * 60 * 60 * 1000;

/* To'lov tizimlari so'mni emas, TIYINNI biladi. Aralashtirib
   yuborish yuz barobar xato degani, shuning uchun o'tkazish
   faqat shu ikki funksiya orqali. */
export const somToTiyin = (som) => Math.round(Number(som) * 100);
export const tiyinToSom = (tiyin) => Math.round(Number(tiyin) / 100);

/**
 * Sotiladigan narsalar.
 *
 * `days` — premium shuncha kunga beriladi.
 * `priceField` — admin sozlamasidagi maydon nomi.
 */
export const PRODUCTS = {
  premium_1m: { days: 30, priceField: 'premiumPrice1m', label: 'Premium — 1 oy' },
  premium_3m: { days: 90, priceField: 'premiumPrice3m', label: 'Premium — 3 oy' },
  premium_12m: { days: 365, priceField: 'premiumPrice12m', label: 'Premium — 1 yil' },
};

/**
 * Mahsulotning hozirgi narxi (so'mda), yoki null.
 *
 * null — "sotuvda yo'q". Narx belgilanmagan mahsulotni sotib
 * bo'lmaydi va bu xato emas: egasi hali narx qo'ymagan.
 */
export const productPrice = (settings, product) => {
  const def = PRODUCTS[product];
  if (!def) return null;
  const raw = Number((settings || {})[def.priceField]);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw);
};

/** Sotuvga qo'yilgan mahsulotlar ro'yxati. */
export const sellableProducts = (settings) =>
  Object.keys(PRODUCTS)
    .map((key) => ({ key, label: PRODUCTS[key].label, days: PRODUCTS[key].days, price: productPrice(settings, key) }))
    .filter((p) => p.price !== null);

const newId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/**
 * Yangi hisob ochadi.
 *
 * Summa SERVERDA hisoblanadi. Mijozdan kelgan summa umuman
 * o'qilmaydi — aks holda odam o'ziga ming so'mlik premium yozib
 * olardi.
 */
export const createInvoice = async ({ identity, product, settings }) => {
  if (!identity) return { ok: false, error: 'Avval ilovaga kiring' };
  const def = PRODUCTS[product];
  if (!def) return { ok: false, error: 'Bunday mahsulot yo‘q' };

  const amount = productPrice(settings, product);
  if (amount === null) return { ok: false, error: 'Bu mahsulot hozir sotuvda yo‘q' };

  const invoice = {
    id: newId(),
    identity,
    product,
    days: def.days,
    amount,                      // so'mda
    state: 'NEW',
    createdAt: Date.now(),
    provider: '',
    providerTxn: '',
    paidAt: 0,
    cancelledAt: 0,
    cancelReason: 0,
  };
  if (!(await kvSet(invoiceKey(invoice.id), JSON.stringify(invoice)))) {
    return { ok: false, error: 'Saqlanmadi, qayta urinib ko‘ring' };
  }
  await kvPush(INVOICE_LIST, invoice.id).catch(() => {});
  await kvPush(userInvoicesKey(identity), invoice.id).catch(() => {});
  return { ok: true, invoice };
};

export const readInvoice = async (id) => {
  if (!id) return null;
  try {
    const raw = await kvGet(invoiceKey(String(id)));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const saveInvoice = async (invoice) =>
  kvSet(invoiceKey(invoice.id), JSON.stringify(invoice));

/**
 * To'lov tizimi pulni band qildi.
 * Takroriy chaqiruv holatni buzmaydi — tizimlar so'rovni
 * qaytarishi odatiy hol.
 */
export const markHold = async (invoice, { provider, providerTxn }) => {
  if (invoice.state === 'PAID' || invoice.state === 'CANCELLED') return invoice;
  invoice.state = 'HOLD';
  invoice.provider = provider || invoice.provider;
  invoice.providerTxn = providerTxn || invoice.providerTxn;
  invoice.holdAt = invoice.holdAt || Date.now();
  await saveInvoice(invoice);
  return invoice;
};

/**
 * Pul o'tdi — mahsulot beriladi.
 *
 * IKKI MARTA BERILMAYDI. To'lov tizimlari bitta so'rovni bir
 * necha marta yuborishi mumkin (tarmoq uzilsa, javob yetib
 * bormasa). Shuning uchun allaqachon PAID bo'lgan hisob
 * qaytadan ishlov ko'rmaydi.
 *
 * MUDDAT QO'SHILADI, ALMASHTIRILMAYDI. Premiumi bor odam yana
 * sotib olsa, yangi muddat eskisining USTIGA qo'shiladi —
 * aks holda u pul to'lab, qolgan kunlarini yo'qotardi.
 *
 * HOLATNI O'QIB-YOZISH YETARLI EMAS. Yuqoridagi `state === 'PAID'`
 * tekshiruvi ketma-ket kelgan so'rovlarni to'xtatadi, lekin AYNI
 * PAYTDA kelgan ikkitasini to'xtatmaydi: ikkalasi ham hali
 * `NEW` ni ko'radi va ikkalasi ham premium qo'shadi — odam bir
 * marta to'lab, ikki oylik muddat olardi.
 *
 * Shuning uchun navbat Redis'ning o'zida egallanadi: `SADD`
 * atomik, ya'ni bir vaqtda kelgan ikki so'rovdan faqat BITTASI
 * "yangi a'zo qo'shdim" degan javob oladi. Ikkinchisi shu zahoti
 * chiqib ketadi. Qulf ortga qaytarilmaydi: bu "to'landi" degan
 * bir martalik belgi, vaqtinchalik band qilish emas.
 */
export const PAID_LOCK = 'invoice_paid';

export const markPaid = async (invoice) => {
  if (invoice.state === 'PAID') return { invoice, granted: false };
  if (invoice.state === 'CANCELLED') return { invoice, granted: false };

  /* Navbatni egallash. Egallanmagan bo'lsa — boshqa so'rov
     allaqachon shu hisobni ishlayapti yoki ishlab bo'lgan. */
  if (!(await kvSaddNew(PAID_LOCK, invoice.id))) {
    const fresh = await readInvoice(invoice.id);
    return { invoice: fresh || invoice, granted: false };
  }

  const now = Date.now();
  let from = now;
  try {
    const current = Number(await kvGet(premiumKey(invoice.identity)));
    if (Number.isFinite(current) && current > now) from = current;
  } catch {
    /* o'qib bo'lmasa — hozirdan boshlaymiz */
  }
  const until = from + invoice.days * 24 * 60 * 60 * 1000;
  await grantPremium(invoice.identity, until);

  invoice.state = 'PAID';
  invoice.paidAt = now;
  invoice.premiumUntil = until;
  await saveInvoice(invoice);
  return { invoice, granted: true, until };
};

/**
 * Bekor qilindi yoki pul qaytarildi.
 *
 * PUL QAYTSA, MAHSULOT HAM QAYTADI. Ilgari bu yerda faqat holat
 * yozilardi: to'langandan keyin bekor qilingan hisobda (Payme
 * holati −2) odam pulni ham, premiumni ham olib qolardi.
 *
 * Qo'shilgan muddat AYIRILADI, premium butunlay o'chirilmaydi:
 * odamda boshqa, haqiqatan to'langan oylari ham bo'lishi mumkin —
 * bitta qaytarilgan to'lov ularni yeb ketmasligi kerak. Ayirilgandan
 * keyin muddat o'tib ketsa, premium olib tashlanadi.
 *
 * MUDDATSIZ premiumga (admin qo'lda bergan) tegilmaydi: u
 * to'lovdan kelmagan, ya'ni bu hisobga aloqasi yo'q.
 */
export const markCancelled = async (invoice, reason) => {
  const wasPaid = invoice.state === 'PAID';
  invoice.state = 'CANCELLED';
  invoice.cancelledAt = Date.now();
  invoice.cancelReason = Number(reason) || 0;
  await saveInvoice(invoice);

  if (wasPaid && invoice.identity && invoice.days) {
    try {
      const raw = await kvGet(premiumKey(invoice.identity));
      const until = Number(raw);
      /* `raw === '0'` — muddatsiz. Number('0') === 0, ya'ni
         quyidagi shart uni o'tkazmaydi; aynan shu kerak. */
      if (Number.isFinite(until) && until > 0) {
        const qaytgan = until - invoice.days * 24 * 60 * 60 * 1000;
        if (qaytgan > Date.now()) await grantPremium(invoice.identity, qaytgan);
        else await revokePremium(invoice.identity);
      }
    } catch {
      /* Bazaga yetib bo'lmasa, hisob baribir bekor qilingan deb
         yozildi. Premium keyin admin paneldan to'g'irlanadi —
         bu yerda xato tashlash to'lov tizimiga "qabul qilmadim"
         deb javob berardi va u so'rovni cheksiz qaytarardi. */
    }
  }

  return invoice;
};

/** Oxirgi hisoblar — admin paneli uchun. */
export const listInvoices = async (limit = 100) => {
  const ids = await kvRange(INVOICE_LIST, 0, limit - 1);
  const out = [];
  for (const id of ids) {
    const inv = await readInvoice(id);
    if (inv) out.push(inv);
  }
  return out;
};

export { isPremium };

/**
 * Qaysi to'lov tizimi ulangan.
 *
 * Kalit NOMLARI ham bitta joyda tursin: boshqa fayl "ulanganmi"
 * degan savol uchun maxfiy kalitga qo'l urmasligi kerak. Shunda
 * kalitning o'zi faqat ikki joyda uchraydi — shu yerda va uni
 * haqiqatan tekshiradigan api/pay.js da.
 */
export const paymeReady = () =>
  Boolean(process.env.PAYME_MERCHANT_ID && process.env.PAYME_KEY);
export const clickReady = () =>
  Boolean(process.env.CLICK_SERVICE_ID && process.env.CLICK_MERCHANT_ID);
export const activeProviders = () =>
  [paymeReady() ? 'payme' : null, clickReady() ? 'click' : null].filter(Boolean);

/* Bir odam bir vaqtda ko'p hisob ochib tashlamasin. */
export const payGuardKey = (identity) => `payGuard:${identity}`;
export const PAY_GUARD_S = 60;
export const PAY_GUARD_MAX = 10;
export { kvExpire };
