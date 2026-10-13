/**
 * Buyurtma bosqichlari tarixi.
 *
 *     node test/timeline.test.mjs      (yoki npm test)
 *
 * ENG MUHIM QOIDA. Vaqt O'YLAB TOPILMAYDI. Har bir bosqich
 * aynan sodir bo'lgan payt yozib olinadi; yozilmagan narsa esa
 * yozilmagan bo'lib qoladi. Panel keyinchalik "qachon
 * yuklandi?" degan savolga shu yozuvdan javob beradi —
 * shikoyat kelganda aynan shu so'raladi.
 */
import { loadLib, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const { markStage, MAX_TIMELINE, STATUS_FLOW } = await loadLib('orderMessage.js');

/* ---------------------------------------------------------- */
flow('Bosqich yozib olinadi');
{
  const order = { status: 'NEW' };
  markStage(order, 'NEW', 'OWNER');
  check('ro\'yxat paydo bo\'ldi', Array.isArray(order.timeline) && order.timeline.length === 1,
    order.timeline);
  check('bosqich nomi saqlandi', order.timeline[0].s === 'NEW', order.timeline[0]);
  check('vaqti yozildi', Math.abs(order.timeline[0].at - Date.now()) < 2000, order.timeline[0]);
  check('kim qilgani yozildi', order.timeline[0].by === 'OWNER', order.timeline[0]);

  markStage(order, 'DRIVER_FOUND', 'OWNER');
  markStage(order, 'PICKING_UP', 'DRIVER');
  check('ketma-ketlik saqlandi',
    order.timeline.map((x) => x.s).join(',') === 'NEW,DRIVER_FOUND,PICKING_UP',
    order.timeline.map((x) => x.s));
}

flow('Bir xil bosqich ikki marta yozilmaydi');
{
  const order = {};
  markStage(order, 'LOADED', 'DRIVER');
  markStage(order, 'LOADED', 'DRIVER');
  check('takror yozilmadi', order.timeline.length === 1, order.timeline);

  /* Lekin orada boshqasi bo'lsa — yoziladi: haydovchi almashsa
     bosqichlar qaytadan boshlanadi. */
  markStage(order, 'NEW', 'OWNER');
  markStage(order, 'LOADED', 'DRIVER');
  check('qaytadan boshlangani yozildi', order.timeline.length === 3,
    order.timeline.map((x) => x.s));
}

flow('Ro\'yxat cheksiz o\'smaydi');
{
  const order = {};
  for (let i = 0; i < 100; i++) {
    markStage(order, STATUS_FLOW[i % STATUS_FLOW.length], 'DRIVER');
  }
  check('chegara ushlandi', order.timeline.length === MAX_TIMELINE, order.timeline.length);
  /* Eng yangilari qoladi — eskisi emas. */
  const last = order.timeline[order.timeline.length - 1];
  check('oxirgisi eng yangi', Math.abs(last.at - Date.now()) < 2000, last);
}

flow('Noto\'g\'ri chaqiruv hech narsani buzmaydi');
{
  check('buyurtma yo\'q bo\'lsa', markStage(null, 'NEW') === null);
  const order = { timeline: [{ s: 'NEW', at: 1, by: 'OWNER' }] };
  markStage(order, '', 'OWNER');
  check('bosqich bo\'sh bo\'lsa tegilmaydi', order.timeline.length === 1, order.timeline);
  const broken = { timeline: 'buzilgan' };
  markStage(broken, 'NEW', 'OWNER');
  check('buzilgan yozuv tiklanadi', Array.isArray(broken.timeline) && broken.timeline.length === 1,
    broken.timeline);
}

flow('Panel vaqtni O\'YLAB TOPMAYDI');
{
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const { repo } = await import('./harness.mjs');
  const panel = readFileSync(join(repo, 'admin.html'), 'utf8');

  check('kuzatuv chizig\'i qo\'shilgan', panel.includes('function orderTimeline('));
  check('yozilmagan vaqt ochiq aytiladi', panel.includes('Vaqti yozilmagan'));
  check('eski buyurtma haqida ogohlantiriladi',
    panel.includes('o\\\'ylab topilmadi'), null);
  /* Chiziq faqat haqiqiy ro'yxatdan yoki ma'lum uchta vaqtdan
     tuziladi — boshqa manba yo'q. */
  check('faqat yozib olingan manbalar', panel.includes('order.timeline')
    && panel.includes('order.deliveredAt') && panel.includes('driver.takenAt'));
}

t.done();
