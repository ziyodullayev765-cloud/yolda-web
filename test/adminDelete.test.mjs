/**
 * Admin paneldan o'chirish.
 *
 *     node test/adminDelete.test.mjs      (yoki npm test)
 *
 * O'CHIRISH — ENG XAVFLI AMAL. Qolgan hamma narsani ortga
 * qaytarish mumkin: noto'g'ri yozilgan nom tuzatiladi, noto'g'ri
 * qo'yilgan holat qaytariladi. O'chirilgan narsa esa yo'q.
 *
 * Shuning uchun bu yerda tekshiriladigan narsa "o'chdimi" emas,
 * balki NIMA O'CHMASLIGI kerakligi:
 *
 *   - tasdiqsiz hech narsa o'chmaydi;
 *   - butun ro'yxatni faqat super admin tozalay oladi;
 *   - ro'yxat o'zgargan bo'lsa, "o'chir" bosilgan yozuv emas,
 *     BOSHQA yozuv o'chib ketmasligi kerak;
 *   - yo'ldagi yuk va yo'lda yuki bor odam ataylab tasdiqlanmasa
 *     o'chmaydi;
 *   - hisob o'chganda buyurtmalar YO'QOLMAYDI, anonim bo'ladi —
 *     ular ikkinchi tomonga ham tegishli.
 */
process.env.ADMIN_PASSWORD = 'super-parol-test';
process.env.ADMIN_PASSWORD_ADMIN = 'admin-parol-test';
process.env.ADMIN_PASSWORD_MODERATOR = 'moder-parol-test';

import { join } from 'node:path';
import { db, repo, loadApi, makeRes, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const adminData = await loadApi('api/admin-data.js', 'del_admin_data');
const { makeSessionToken } = await import(join(repo, 'lib/adminAuth.js'));

const cookieFor = (role) => `admin_session=${makeSessionToken(role, Date.now() + 60_000)}`;
const call = async (method, query, body, role) => {
  const res = makeRes();
  await adminData({
    method, query: query || {}, body: body || {},
    headers: role ? { cookie: cookieFor(role) } : {},
  }, res);
  return res;
};

const OWNER = 'owner@example.com';

const seed = () => {
  db.strings.clear(); db.sets.clear(); db.lists.clear();

  // Murojaatlar — oddiy ro'yxat, id yo'q.
  db.lists.set('support_messages', [
    JSON.stringify({ name: 'Uchinchi', contact: 'c3', message: 'm3', createdAt: 3000 }),
    JSON.stringify({ name: 'Ikkinchi', contact: 'c2', message: 'm2', createdAt: 2000 }),
    JSON.stringify({ name: 'Birinchi', contact: 'c1', message: 'm1', createdAt: 1000 }),
  ]);

  // Shikoyatlar — id bilan.
  db.lists.set('report_ids', ['r1', 'r2']);
  db.strings.set('report:r1', JSON.stringify({ id: 'r1', reason: 'SPAM', status: 'NEW' }));
  db.strings.set('report:r2', JSON.stringify({ id: 'r2', reason: 'FRAUD', status: 'NEW' }));

  // Buyurtmalar.
  db.lists.set('order_codes', ['Y1', 'Y2']);
  db.strings.set('order:Y1', JSON.stringify({
    code: 'Y1', ownerIdentity: OWNER, status: 'NEW', createdAt: 1000,
    fromCity: 'Toshkent', toCity: 'Samarqand', name: 'A', phone: '+998901112233',
  }));
  db.strings.set('order:Y2', JSON.stringify({
    code: 'Y2', ownerIdentity: OWNER, status: 'ON_THE_WAY', createdAt: 2000,
    fromCity: 'Buxoro', toCity: 'Nukus', name: 'A', phone: '+998901112233',
    driver: { name: 'H', identity: 'driver@example.com' },
  }));

  db.strings.set(`profile:${OWNER}`, JSON.stringify({
    username: 'owner', displayName: 'Egasi', phone: '+998901112233',
  }));
  db.strings.set('username:owner', OWNER);
};

const msgs = () => (db.lists.get('support_messages') || []).map((s) => JSON.parse(s));

/* ---------------------------------------------------------- */
flow('Murojaat: to\'g\'ri yozuv o\'chadi');
{
  seed();
  const res = await call('POST', { action: 'delete-message' },
    { index: 1, createdAt: 2000 }, 'ADMIN');
  check('o\'chirildi', res.statusCode === 200, res.payload);
  const left = msgs();
  check('ikkitasi qoldi', left.length === 2, left.length);
  check('aynan o\'sha yozuv ketdi', !left.some((m) => m.createdAt === 2000), left);
  check('qolganlari joyida',
    left.map((m) => m.createdAt).join(',') === '3000,1000', left.map((m) => m.createdAt));
}

flow('Murojaat: ro\'yxat o\'zgargan bo\'lsa hech narsa o\'chmaydi');
{
  seed();
  /* Odam "o'chir" bosgunicha yangi murojaat kelgan — endi 1-o'rinda
     boshqa yozuv turibdi. Vaqt mos kelmaydi, demak to'xtaymiz. */
  const res = await call('POST', { action: 'delete-message' },
    { index: 1, createdAt: 9999 }, 'ADMIN');
  check('rad etildi', res.statusCode === 409, res.statusCode);
  check('hech narsa o\'chmadi', msgs().length === 3, msgs().length);
  check('xato tushunarli', /o‘zgargan|o'zgargan/.test(String(res.payload.error || '')), res.payload);

  const bad = await call('POST', { action: 'delete-message' },
    { index: 99, createdAt: 1000 }, 'ADMIN');
  check('yo\'q o\'rin — 404', bad.statusCode === 404, bad.statusCode);
  check('baribir hech narsa o\'chmadi', msgs().length === 3, msgs().length);
}

flow('Murojaat: kim o\'chira oladi');
{
  seed();
  const mod = await call('POST', { action: 'delete-message' }, { index: 0, createdAt: 3000 }, 'MODERATOR');
  check('moderator o\'chira olmaydi', mod.statusCode === 403, mod.statusCode);
  const anon = await call('POST', { action: 'delete-message' }, { index: 0, createdAt: 3000 }, null);
  check('kirmagan odam o\'chira olmaydi', anon.statusCode === 401, anon.statusCode);
  check('ro\'yxat tegilmadi', msgs().length === 3, msgs().length);
}

flow('Hamma murojaatlarni tozalash — faqat super admin');
{
  seed();
  const admin = await call('POST', { action: 'purge-messages' }, { confirm: true }, 'ADMIN');
  check('oddiy admin tozalay olmaydi', admin.statusCode === 403, admin.statusCode);
  check('ro\'yxat joyida', msgs().length === 3, msgs().length);

  const noConfirm = await call('POST', { action: 'purge-messages' }, {}, 'SUPER_ADMIN');
  check('tasdiqsiz tozalanmaydi', noConfirm.statusCode === 400, noConfirm.statusCode);
  check('ro\'yxat hamon joyida', msgs().length === 3, msgs().length);

  const ok = await call('POST', { action: 'purge-messages' }, { confirm: true }, 'SUPER_ADMIN');
  check('super admin tozaladi', ok.statusCode === 200, ok.payload);
  check('nechta o\'chgani aytildi', ok.payload.removed === 3, ok.payload);
  check('ro\'yxat bo\'shadi', msgs().length === 0, msgs().length);
}

flow('Shikoyat');
{
  seed();
  const res = await call('POST', { action: 'delete-report' }, { id: 'r1' }, 'MODERATOR');
  check('moderator o\'chira oladi (reports:write)', res.statusCode === 200, res.payload);
  check('yozuv ketdi', !db.strings.has('report:r1'));
  check('ro\'yxatdan ham ketdi', (db.lists.get('report_ids') || []).join(',') === 'r2',
    db.lists.get('report_ids'));

  const missing = await call('POST', { action: 'delete-report' }, { id: 'yoq' }, 'MODERATOR');
  check('yo\'q shikoyat — 404', missing.statusCode === 404, missing.statusCode);

  const purgeMod = await call('POST', { action: 'purge-reports' }, { confirm: true }, 'MODERATOR');
  check('moderator hammasini tozalay olmaydi', purgeMod.statusCode === 403, purgeMod.statusCode);

  const purge = await call('POST', { action: 'purge-reports' }, { confirm: true }, 'SUPER_ADMIN');
  check('super admin tozaladi', purge.statusCode === 200 && purge.payload.removed === 1, purge.payload);
  check('hech narsa qolmadi', !db.strings.has('report:r2') && !db.lists.has('report_ids'));
}

flow('Buyurtma: yo\'ldagi yuk ataylab tasdiqlanmasa o\'chmaydi');
{
  seed();
  const noConfirm = await call('POST', { action: 'delete-order' }, { code: 'Y1' }, 'SUPER_ADMIN');
  check('tasdiqsiz o\'chmaydi', noConfirm.statusCode === 400, noConfirm.statusCode);

  const admin = await call('POST', { action: 'delete-order' }, { code: 'Y1', confirm: true }, 'ADMIN');
  check('oddiy admin o\'chira olmaydi', admin.statusCode === 403, admin.statusCode);

  const ok = await call('POST', { action: 'delete-order' }, { code: 'Y1', confirm: true }, 'SUPER_ADMIN');
  check('bo\'sh yuk o\'chadi', ok.statusCode === 200, ok.payload);
  check('yozuvi ketdi', !db.strings.has('order:Y1'));
  check('kodi ro\'yxatdan ketdi', (db.lists.get('order_codes') || []).join(',') === 'Y2');

  const onWay = await call('POST', { action: 'delete-order' }, { code: 'Y2', confirm: true }, 'SUPER_ADMIN');
  check('yo\'ldagi yuk to\'xtatildi', onWay.statusCode === 409, onWay.statusCode);
  check('holati aytildi', onWay.payload.status === 'ON_THE_WAY', onWay.payload);
  check('yuk joyida', db.strings.has('order:Y2'));

  const forced = await call('POST', { action: 'delete-order' },
    { code: 'Y2', confirm: true, force: true }, 'SUPER_ADMIN');
  check('ataylab tasdiqlansa o\'chadi', forced.statusCode === 200, forced.payload);
  check('yozuvi ketdi', !db.strings.has('order:Y2'));
}

flow('Hisob: buyurtmalar YO\'QOLMAYDI, anonim bo\'ladi');
{
  seed();
  const noConfirm = await call('POST', { action: 'delete-user' }, { email: OWNER }, 'SUPER_ADMIN');
  check('tasdiqsiz o\'chmaydi', noConfirm.statusCode === 400, noConfirm.statusCode);

  const admin = await call('POST', { action: 'delete-user' }, { email: OWNER, confirm: true }, 'ADMIN');
  check('oddiy admin o\'chira olmaydi', admin.statusCode === 403, admin.statusCode);

  /* Y2 yo'lda — avval to'xtatiladi. */
  const blocked = await call('POST', { action: 'delete-user' }, { email: OWNER, confirm: true }, 'SUPER_ADMIN');
  check('yo\'ldagi yuki bor odam to\'xtatildi', blocked.statusCode === 409, blocked.statusCode);
  check('qaysi yuklar ekani aytildi',
    Array.isArray(blocked.payload.activeOrders) && blocked.payload.activeOrders.includes('Y2'),
    blocked.payload);
  check('profil joyida', db.strings.has(`profile:${OWNER}`));

  const ok = await call('POST', { action: 'delete-user' },
    { email: OWNER, confirm: true, force: true }, 'SUPER_ADMIN');
  check('ataylab tasdiqlansa o\'chadi', ok.statusCode === 200, ok.payload);

  /* ENG MUHIM TASDIQ: buyurtmalar o'chib ketmadi. */
  check('buyurtma yozuvlari saqlandi',
    db.strings.has('order:Y1') && db.strings.has('order:Y2'));
  const y1 = JSON.parse(db.strings.get('order:Y1'));
  check('buyurtma anonim bo\'ldi', y1.ownerIdentity !== OWNER || !y1.phone, y1);
  check('telefon ochiq qolmadi', !String(JSON.stringify(y1)).includes('998901112233'), y1);

  const missing = await call('POST', { action: 'delete-user' },
    { email: 'yoq@example.com', confirm: true }, 'SUPER_ADMIN');
  check('yo\'q hisob — 404', missing.statusCode === 404, missing.statusCode);
}

flow('Xodimlar ro\'yxatida qolib ketmaydi');
{
  seed();
  db.strings.set('staff:' + OWNER, JSON.stringify({ identity: OWNER, role: 'ADMIN', addedAt: 1 }));
  db.sets.set('staff_ids', new Set([OWNER]));

  await call('POST', { action: 'delete-user' },
    { email: OWNER, confirm: true, force: true }, 'SUPER_ADMIN');
  check('xodim yozuvi ham ketdi', !db.strings.has('staff:' + OWNER));
  check('to\'plamdan ham ketdi', !(db.sets.get('staff_ids') || new Set()).has(OWNER));
}

t.done();
