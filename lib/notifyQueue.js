/**
 * Kechiktirilgan bildirishnomalar — jadvalsiz (cron'siz).
 *
 * NEGA JADVAL YO'Q. Yangi yuk xabari premiumga darhol, qolganlarga
 * bir soatdan keyin boradi. Odatda bunday ish uchun jadval
 * (cron) ishlatiladi, lekin Vercel Hobby'da jadval kuniga bir
 * martagina ishga tushadi — soatlik aniqlik bermaydi. Ikkinchi
 * funksiya qo'shib bo'lmaydi ham: Hobby'da o'n ikkita funksiya
 * cheklovi bor va o'n bittasi band.
 *
 * SHUNING UCHUN navbat "yo'l-yo'lakay" bo'shatiladi: ilovaning
 * tez-tez chaqiriladigan endpointlari (yuklar ro'yxati, sozlamalar)
 * har safar navbatga bir ko'z tashlaydi va vaqti kelganini yuboradi.
 * Ya'ni xabar "bir soatdan keyin ilovaga kimdir murojaat qilganda"
 * ketadi. Amalda bu bir soat bilan bir necha daqiqa farq qiladi;
 * yuk bozorida bu farq sezilmaydi.
 *
 * ARZONLIGI. Navbat bo'sh bo'lganda bitta GET bilan tugaydi:
 * `notify_queue_next` da eng yaqin vaqt turadi, undan oldin
 * ro'yxatning o'ziga tegilmaydi.
 *
 * HECH QACHON XATO TASHLAMAYDI. Bu kod asosiy so'rovning ichida
 * ishlaydi: bildirishnoma yuborilmasligi foydalanuvchi uchun xato
 * emas, yuklar ro'yxati ochilmasligi esa xato.
 */
import { kvGet, kvSet, kvDel, kvPush, kvLrem, kvRange } from './kv.js';

export const QUEUE_KEY = 'notify_queue';
export const NEXT_KEY = 'notify_queue_next';

/** Bir ko'z tashlashda eng ko'pi shuncha ish qiladi. */
export const MAX_JOBS_PER_SWEEP = 2;

/**
 * Navbatga qo'yadi.
 * @param {object} job ichida nima borligi chaqiruvchiga bog'liq
 * @param {number} delayMs qancha vaqtdan keyin
 */
export const queueDelayed = async (job, delayMs) => {
  const dueAt = Date.now() + Math.max(0, delayMs || 0);
  const entry = JSON.stringify({ ...job, dueAt });
  if (!(await kvPush(QUEUE_KEY, entry))) return false;
  /* Eng yaqin vaqt belgisi faqat oldinga EMAS, orqaga suriladi:
     yangi ish avvalgisidan oldin bo'lsa, belgini yangilaymiz.
     Keyinroq bo'lsa — tegmaymiz, aks holda oldingi ish e'tibordan
     chetda qolardi. */
  const prev = Number(await kvGet(NEXT_KEY)) || 0;
  if (!prev || dueAt < prev) await kvSet(NEXT_KEY, String(dueAt));
  return true;
};

/**
 * Vaqti kelgan ishlarni bajaradi.
 *
 * @param {(job: object) => Promise<object|null|undefined>} run
 *   Ishni bajaradi. Ish tugamagan bo'lsa (masalan odamlar ko'p va
 *   bir so'rovda hammasiga yuborib bo'lmasa) — DAVOM ETTIRISH
 *   uchun yangi ishni qaytarsin; u navbatga darhol qaytib
 *   qo'yiladi va keyingi ko'z tashlashda davom etadi.
 * @returns {Promise<number>} bajarilgan ish soni
 */
export const drainDue = async (run) => {
  try {
    const now = Date.now();
    const next = Number(await kvGet(NEXT_KEY)) || 0;
    // Belgi yo'q — navbat bo'sh. Vaqti kelmagan — hali kutamiz.
    if (!next || now < next) return 0;

    const raw = await kvRange(QUEUE_KEY, 0, 49);
    if (!raw.length) {
      await kvDel(NEXT_KEY);
      return 0;
    }

    let did = 0;
    let earliestLeft = 0;

    for (const item of raw) {
      let job;
      try { job = JSON.parse(item); } catch { await kvLrem(QUEUE_KEY, item); continue; }

      if (!job || !job.dueAt || job.dueAt > now) {
        if (job && job.dueAt && (!earliestLeft || job.dueAt < earliestLeft)) earliestLeft = job.dueAt;
        continue;
      }
      if (did >= MAX_JOBS_PER_SWEEP) {
        if (!earliestLeft || job.dueAt < earliestLeft) earliestLeft = job.dueAt;
        continue;
      }

      /* Avval navbatdan olib tashlanadi, keyin bajariladi. Teskarisida
         bo'lsa, ikki so'rov bir vaqtda kelganda ikkalasi ham bitta
         ishni bajarardi. LREM atomik — faqat bittasi o'chiradi,
         lekin ikkinchisi ham `true` olishi mumkin, shuning uchun
         takroriy xabarning oldini olish ishning o'z ichida ham
         bor (`kvSaddNew`). */
      await kvLrem(QUEUE_KEY, item);
      did += 1;

      let follow = null;
      try { follow = await run(job); } catch (err) {
        console.error('notifyQueue job failed:', err.message);
      }
      if (follow) {
        const entry = JSON.stringify({ ...follow, dueAt: now });
        await kvPush(QUEUE_KEY, entry);
        earliestLeft = earliestLeft ? Math.min(earliestLeft, now) : now;
      }
    }

    if (earliestLeft) await kvSet(NEXT_KEY, String(earliestLeft));
    else await kvDel(NEXT_KEY);
    return did;
  } catch (err) {
    console.error('drainDue failed:', err.message);
    return 0;
  }
};
