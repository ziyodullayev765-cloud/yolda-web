/**
 * /api/pay — to'lov tizimlarining so'rovlari.
 *
 *   POST /api/pay?provider=payme   — Payme Merchant API (JSON-RPC)
 *   POST /api/pay?provider=click&action=prepare|complete — Click Shop API
 *
 * ============================================================
 * BU YERGA FAQAT TO'LOV TIZIMI MUROJAAT QILADI
 * ------------------------------------------------------------
 * Odam emas, brauzer emas — Payme yoki Click serveri. Shuning
 * uchun bu yerda ilovaning odatiy kirish tekshiruvi yo'q;
 * uning o'rniga har bir so'rovning O'ZI tekshiriladi:
 *
 *   Payme — `Authorization: Basic Paycom:<kalit>` sarlavhasi;
 *   Click — har bir so'rovdagi MD5 imzo.
 *
 * Kalitlar faqat server muhitida:
 *   PAYME_MERCHANT_ID, PAYME_KEY
 *   CLICK_SERVICE_ID, CLICK_MERCHANT_ID, CLICK_SECRET_KEY
 *
 * Kalit qo'yilmagan bo'lsa, o'sha tizim UMUMAN javob bermaydi —
 * "sozlanmagan" deb rad etiladi. Yarim ishlaydigan to'lov eng
 * yomon holat: odam pul to'laydi-yu, mahsulot olmaydi.
 *
 * ============================================================
 * SUMMA SERVERDA TEKSHIRILADI
 * ------------------------------------------------------------
 * To'lov tizimi aytgan summa hisobdagi summa bilan AYNAN mos
 * tushishi kerak. Mos kelmasa — rad etiladi. Aks holda odam
 * ming so'm to'lab, bir yillik premium olib ketardi.
 * ============================================================
 */
import crypto from 'node:crypto';
import { kvGet, kvSet, kvIncr, kvExpire } from '../lib/kv.js';
import {
  readInvoice, markHold, markPaid, markCancelled, saveInvoice,
  somToTiyin, INVOICE_TTL_MS,
} from '../lib/payments.js';

/* ============================================================
   Payme
   ============================================================ */

/** Payme xato kodlari — hujjatdagi raqamlar. */
const PAYME_ERR = {
  AUTH: -32504,
  METHOD: -32601,
  REQUEST: -32600,
  AMOUNT: -31001,
  ACCOUNT: -31050,          // hisob topilmadi
  TXN_NOT_FOUND: -31003,
  CANT_PERFORM: -31008,
  CANT_CANCEL: -31007,
};

const paymeError = (res, id, code, message) =>
  res.status(200).json({
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message: { uz: message, ru: message, en: message },
    },
  });

const paymeOk = (res, id, result) =>
  res.status(200).json({ jsonrpc: '2.0', id: id ?? null, result });

/** `Authorization: Basic base64("Paycom:<kalit>")`. */
const paymeAuthed = (req) => {
  const key = process.env.PAYME_KEY || '';
  if (!key) return false;
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const expected = `Paycom:${key}`;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(decoded, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

/* Payme holatlari: 1 — band qilindi, 2 — to'landi,
   -1 — band qilingandan keyin bekor, -2 — to'langandan keyin. */
const paymeState = (invoice) => {
  if (invoice.state === 'PAID') return 2;
  if (invoice.state === 'HOLD') return 1;
  if (invoice.state === 'CANCELLED') return invoice.paidAt ? -2 : -1;
  return 0;
};

/** Hisobni `account` dan topadi. Payme uni biz aytgan nom bilan yuboradi. */
const invoiceFromAccount = async (params) => {
  const account = (params && params.account) || {};
  const id = String(account.invoice || account.order_id || account.id || '').trim();
  if (!id) return null;
  return readInvoice(id);
};

const handlePayme = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const { id, method, params } = body;

  if (!paymeAuthed(req)) return paymeError(res, id, PAYME_ERR.AUTH, 'Ruxsat yo‘q');
  if (!method) return paymeError(res, id, PAYME_ERR.REQUEST, 'Metod ko‘rsatilmagan');

  /* ---- Hisob bormi va summa to'g'rimi ---- */
  if (method === 'CheckPerformTransaction') {
    const invoice = await invoiceFromAccount(params);
    if (!invoice) return paymeError(res, id, PAYME_ERR.ACCOUNT, 'Hisob topilmadi');
    if (invoice.state === 'PAID') {
      return paymeError(res, id, PAYME_ERR.CANT_PERFORM, 'Bu hisob allaqachon to‘langan');
    }
    if (Number(params.amount) !== somToTiyin(invoice.amount)) {
      return paymeError(res, id, PAYME_ERR.AMOUNT, 'Summa mos emas');
    }
    return paymeOk(res, id, { allow: true });
  }

  /* ---- Pulni band qilish ---- */
  if (method === 'CreateTransaction') {
    const invoice = await invoiceFromAccount(params);
    if (!invoice) return paymeError(res, id, PAYME_ERR.ACCOUNT, 'Hisob topilmadi');
    if (Number(params.amount) !== somToTiyin(invoice.amount)) {
      return paymeError(res, id, PAYME_ERR.AMOUNT, 'Summa mos emas');
    }

    /* O'sha tranzaksiya qayta kelsa — o'sha javob qaytadi. */
    if (invoice.providerTxn && invoice.providerTxn !== String(params.id)) {
      return paymeError(res, id, PAYME_ERR.CANT_PERFORM, 'Bu hisob band');
    }
    if (invoice.state === 'CANCELLED') {
      return paymeError(res, id, PAYME_ERR.CANT_PERFORM, 'Hisob bekor qilingan');
    }
    /* Juda eski hisobga to'lov qabul qilinmaydi. */
    if (Date.now() - Number(invoice.createdAt) > INVOICE_TTL_MS && invoice.state === 'NEW') {
      return paymeError(res, id, PAYME_ERR.CANT_PERFORM, 'Hisob muddati o‘tgan');
    }

    await markHold(invoice, { provider: 'payme', providerTxn: String(params.id) });
    /* Keyingi metodlar hisobni TRANZAKSIYA raqami bilan
       so'raydi, shuning uchun teskari yozuv shu yerda
       qo'yiladi — boshqa joyda qo'yib bo'lmaydi, raqam
       birinchi marta aynan shu metodda keladi. */
    await kvSet(`paymeTxn:${params.id}`, invoice.id).catch(() => {});
    await kvExpire(`paymeTxn:${params.id}`, 90 * 24 * 60 * 60).catch(() => {});
    return paymeOk(res, id, {
      create_time: invoice.holdAt,
      transaction: invoice.id,
      state: paymeState(invoice),
    });
  }

  /* ---- To'lovni yakunlash ---- */
  if (method === 'PerformTransaction') {
    const invoice = await findByTxn(String(params.id));
    if (!invoice) return paymeError(res, id, PAYME_ERR.TXN_NOT_FOUND, 'Tranzaksiya topilmadi');
    if (invoice.state === 'CANCELLED') {
      return paymeError(res, id, PAYME_ERR.CANT_PERFORM, 'Bekor qilingan');
    }
    await markPaid(invoice);
    return paymeOk(res, id, {
      transaction: invoice.id,
      perform_time: invoice.paidAt,
      state: paymeState(invoice),
    });
  }

  /* ---- Bekor qilish ---- */
  if (method === 'CancelTransaction') {
    const invoice = await findByTxn(String(params.id));
    if (!invoice) return paymeError(res, id, PAYME_ERR.TXN_NOT_FOUND, 'Tranzaksiya topilmadi');
    await markCancelled(invoice, params.reason);
    return paymeOk(res, id, {
      transaction: invoice.id,
      cancel_time: invoice.cancelledAt,
      state: paymeState(invoice),
    });
  }

  /* ---- Holatni so'rash ---- */
  if (method === 'CheckTransaction') {
    const invoice = await findByTxn(String(params.id));
    if (!invoice) return paymeError(res, id, PAYME_ERR.TXN_NOT_FOUND, 'Tranzaksiya topilmadi');
    return paymeOk(res, id, {
      create_time: invoice.holdAt || 0,
      perform_time: invoice.paidAt || 0,
      cancel_time: invoice.cancelledAt || 0,
      transaction: invoice.id,
      state: paymeState(invoice),
      reason: invoice.cancelReason || null,
    });
  }

  return paymeError(res, id, PAYME_ERR.METHOD, 'Bunday metod yo‘q');
};

/**
 * Tranzaksiya raqamidan hisobni topadi.
 *
 * Payme `CreateTransaction` dan keyingi hamma metodda faqat
 * O'Z raqamini yuboradi — bizning hisob raqamimizni emas.
 * Shuning uchun teskari yozuv kerak; u `CreateTransaction` da,
 * ya'ni raqam birinchi marta kelgan joyda qo'yiladi.
 */
const findByTxn = async (txn) => {
  const direct = await kvGet(`paymeTxn:${txn}`);
  if (direct) return readInvoice(direct);
  return null;
};

/* ============================================================
   Click
   ============================================================ */

const clickMd5 = (parts) => crypto.createHash('md5').update(parts.join('')).digest('hex');

const clickReply = (res, body) => res.status(200).json(body);

const handleClick = async (req, res) => {
  const secret = process.env.CLICK_SECRET_KEY || '';
  const serviceId = process.env.CLICK_SERVICE_ID || '';
  if (!secret || !serviceId) {
    return clickReply(res, { error: -9, error_note: 'Sozlanmagan' });
  }

  const b = typeof req.body === 'string'
    ? Object.fromEntries(new URLSearchParams(req.body))
    : (req.body ?? {});

  const action = String(b.action ?? req.query.action ?? '');
  const isPrepare = action === '0' || action === 'prepare';
  const isComplete = action === '1' || action === 'complete';
  if (!isPrepare && !isComplete) {
    return clickReply(res, { error: -3, error_note: 'Noto‘g‘ri amal' });
  }

  /* Imzo — har bir so'rovda. Click hujjatidagi tartib qat'iy. */
  const signParts = isPrepare
    ? [b.click_trans_id, b.service_id, secret, b.merchant_trans_id, b.amount, b.action, b.sign_time]
    : [b.click_trans_id, b.service_id, secret, b.merchant_trans_id, b.merchant_prepare_id,
      b.amount, b.action, b.sign_time];
  const expected = clickMd5(signParts.map((x) => String(x ?? '')));
  const given = String(b.sign_string || '').toLowerCase();
  if (expected.length !== given.length
      || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) {
    return clickReply(res, { error: -1, error_note: 'Imzo mos emas' });
  }
  if (String(b.service_id) !== String(serviceId)) {
    return clickReply(res, { error: -1, error_note: 'Xizmat mos emas' });
  }

  const invoice = await readInvoice(String(b.merchant_trans_id || ''));
  if (!invoice) return clickReply(res, { error: -5, error_note: 'Hisob topilmadi' });

  /* Click summani SO'MDA, kasr bilan yuboradi. */
  if (Math.round(Number(b.amount)) !== Number(invoice.amount)) {
    return clickReply(res, { error: -2, error_note: 'Summa mos emas' });
  }

  const base = {
    click_trans_id: b.click_trans_id,
    merchant_trans_id: invoice.id,
  };

  if (isPrepare) {
    if (invoice.state === 'PAID') return clickReply(res, { ...base, error: -4, error_note: 'Allaqachon to‘langan' });
    if (invoice.state === 'CANCELLED') return clickReply(res, { ...base, error: -9, error_note: 'Bekor qilingan' });
    await markHold(invoice, { provider: 'click', providerTxn: String(b.click_trans_id) });
    return clickReply(res, { ...base, merchant_prepare_id: invoice.id, error: 0, error_note: 'Success' });
  }

  /* ---- complete ---- */
  if (Number(b.error) < 0) {
    await markCancelled(invoice, Number(b.error));
    return clickReply(res, { ...base, error: -9, error_note: 'To‘lov bekor qilindi' });
  }
  if (invoice.state === 'CANCELLED') {
    return clickReply(res, { ...base, error: -9, error_note: 'Bekor qilingan' });
  }
  await markPaid(invoice);
  return clickReply(res, { ...base, merchant_confirm_id: invoice.id, error: 0, error_note: 'Success' });
};

/* ============================================================ */

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const provider = String(req.query.provider || '');

  /* Bu manzil ochiq turadi, shuning uchun murojaatlar soni
     cheklanadi: kalitni taxmin qilishga urinishni sekinlashtiradi. */
  const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0];
  const guard = `payHit:${ip}`;
  const hits = Number(await kvIncr(guard).catch(() => 0)) || 0;
  if (hits === 1) await kvExpire(guard, 60).catch(() => {});
  if (hits > 120) return res.status(429).json({ error: 'Too many requests' });

  if (provider === 'payme') return handlePayme(req, res);
  if (provider === 'click') return handleClick(req, res);
  return res.status(400).json({ error: 'Noto‘g‘ri provider' });
}
