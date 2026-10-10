/**
 * Xodimlar ro'yxati.
 *
 *     node test/staff.test.mjs      (yoki npm test)
 *
 * NIMANI HIMOYA QILADI. Panelga kirish parol bilan, ya'ni "bu
 * odam administrator" degan ma'lumot hech qayerda saqlanmasdi.
 * Shu daftar uni saqlaydi va ilovadagi profilda yorliq chiqaradi.
 *
 * Bu yerdagi eng muhim tasdiqlar ikkita va ikkalasi ham xavfsizlik
 * haqida:
 *
 *   1. Daftarni FAQAT super admin o'zgartira oladi. Agar oddiy
 *      admin ham o'zgartira olsa, u o'zini yoki boshqani
 *      "Administrator" qilib qo'yib, odamlar oldida vakolat
 *      ko'rsatib olardi.
 *   2. Daftarga yozilgani panelga kirish huquqi BERMAYDI. Kirish
 *      hamon faqat parol bilan tekshiriladi. Bu tasdiq yo'q
 *      bo'lsa, kelajakda kimdir "xodim bo'lsa kiritamiz" deb
 *      qo'shib qo'yishi mumkin — va daftar bir zumda kirish
 *      kalitiga aylanib qolardi.
 */
process.env.ADMIN_PASSWORD = 'super-parol-test';
process.env.ADMIN_PASSWORD_ADMIN = 'admin-parol-test';
process.env.ADMIN_PASSWORD_ACCOUNTANT = 'hisobchi-parol-test';

import { join } from 'node:path';
import { db, repo, loadApi, loadLib, makeRes, runner } from './harness.mjs';

const t = runner();
const { flow, check } = t;

const adminData = await loadApi('api/admin-data.js', 'staff_admin_data');
const adminLogin = await loadApi('api/admin-login.js', 'staff_admin_login');
const profileApi = await loadApi('api/profile.js', 'staff_profile');
const staffLib = await loadLib('staff.js');
const { makeSessionToken, isAdminAuthed, roleCan } = await import(join(repo, 'lib/adminAuth.js'));

const cookieFor = (role) => `admin_session=${makeSessionToken(role, Date.now() + 60_000)}`;

const call = async (handler, method, query, body, role) => {
  const res = makeRes();
  await handler({
    method,
    query: query || {},
    body: body || {},
    headers: role ? { cookie: cookieFor(role) } : {},
  }, res);
  return res;
};

/** Ro'yxatga qo'shish mumkin bo'lishi uchun odamning profili bo'lishi kerak. */
const seedUser = (identity, username) => {
  db.strings.set(`profile:${identity}`, JSON.stringify({
    username, displayName: 'Aziz Karimov', role: 'OWNER', joinedAt: Date.now(),
  }));
  db.strings.set(`username:${username}`, identity);
};

const reset = () => { db.strings.clear(); db.sets.clear(); db.lists.clear(); };

/* ---------------------------------------------------------- */
flow('Super admin xodim qo\'shadi');
{
  reset();
  seedUser('aziz@example.com', 'aziz');

  const res = await call(adminData, 'POST', { action: 'save-staff' },
    { identity: 'aziz@example.com', role: 'ADMIN', title: 'Operatsiya' }, 'SUPER_ADMIN');

  check('qo\'shildi', res.statusCode === 200, res.payload);
  check('ro\'yxatda bitta xodim', (res.payload.staff || []).length === 1);
  check('roli saqlandi', res.payload.staff[0].role === 'ADMIN');
  check('lavozimi saqlandi', res.payload.staff[0].title === 'Operatsiya');
  check('rol bo\'yicha sanoq', res.payload.counts.ADMIN === 1 && res.payload.counts.MODERATOR === 0);
}

flow('Rol o\'zgartirilsa yozuv ikkilanmaydi');
{
  reset();
  seedUser('aziz@example.com', 'aziz');
  await call(adminData, 'POST', { action: 'save-staff' },
    { identity: 'aziz@example.com', role: 'ADMIN' }, 'SUPER_ADMIN');
  const first = await staffLib.staffRecord('aziz@example.com');

  const res = await call(adminData, 'POST', { action: 'save-staff' },
    { identity: 'aziz@example.com', role: 'MODERATOR' }, 'SUPER_ADMIN');

  check('hamon bitta yozuv', res.payload.staff.length === 1);
  check('yangi rol', res.payload.staff[0].role === 'MODERATOR');
  check('qo\'shilgan vaqti o\'zgarmadi', res.payload.staff[0].addedAt === first.addedAt);
}

flow('Faqat super admin o\'zgartiradi');
{
  reset();
  seedUser('aziz@example.com', 'aziz');

  for (const role of ['ADMIN', 'MODERATOR', 'ACCOUNTANT']) {
    const res = await call(adminData, 'POST', { action: 'save-staff' },
      { identity: 'aziz@example.com', role: 'ADMIN' }, role);
    check(role + ' qo\'sha olmaydi (403)', res.statusCode === 403, res.statusCode);

    const del = await call(adminData, 'POST', { action: 'delete-staff' },
      { identity: 'aziz@example.com' }, role);
    check(role + ' o\'chira olmaydi (403)', del.statusCode === 403, del.statusCode);

    const list = await call(adminData, 'GET', { resource: 'staff' }, null, role);
    check(role + ' ro\'yxatni ko\'rmaydi (403)', list.statusCode === 403, list.statusCode);
  }

  const anon = await call(adminData, 'POST', { action: 'save-staff' },
    { identity: 'aziz@example.com', role: 'ADMIN' }, null);
  check('kirmagan odam qo\'sha olmaydi (401)', anon.statusCode === 401, anon.statusCode);

  check('daftar bo\'sh qoldi', (await staffLib.listStaff()).length === 0);
}

flow('Noto\'g\'ri ma\'lumot o\'tmaydi');
{
  reset();
  seedUser('aziz@example.com', 'aziz');

  const noUser = await call(adminData, 'POST', { action: 'save-staff' },
    { identity: 'yoq@example.com', role: 'ADMIN' }, 'SUPER_ADMIN');
  check('mavjud bo\'lmagan hisob rad etiladi', noUser.statusCode === 404, noUser.statusCode);

  const badRole = await call(adminData, 'POST', { action: 'save-staff' },
    { identity: 'aziz@example.com', role: 'OWNER' }, 'SUPER_ADMIN');
  check('o\'ylab topilgan rol rad etiladi', badRole.statusCode === 400, badRole.statusCode);

  const noId = await call(adminData, 'POST', { action: 'save-staff' },
    { role: 'ADMIN' }, 'SUPER_ADMIN');
  check('shaxssiz so\'rov rad etiladi', noId.statusCode === 400, noId.statusCode);

  check('hech narsa yozilmadi', (await staffLib.listStaff()).length === 0);
}

flow('O\'chirish');
{
  reset();
  seedUser('aziz@example.com', 'aziz');
  await call(adminData, 'POST', { action: 'save-staff' },
    { identity: 'aziz@example.com', role: 'ADMIN' }, 'SUPER_ADMIN');

  const res = await call(adminData, 'POST', { action: 'delete-staff' },
    { identity: 'aziz@example.com' }, 'SUPER_ADMIN');
  check('o\'chirildi', res.statusCode === 200 && res.payload.staff.length === 0);
  check('roli ham yo\'qoldi', (await staffLib.staffRole('aziz@example.com')) === null);
  check('to\'plamdan ham chiqdi', (await staffLib.listStaff()).length === 0);
}

flow('Profilda yorliq ko\'rinadi');
{
  reset();
  seedUser('aziz@example.com', 'aziz');
  seedUser('bek@example.com', 'bek');
  await call(adminData, 'POST', { action: 'save-staff' },
    { identity: 'aziz@example.com', role: 'ADMIN' }, 'SUPER_ADMIN');

  const mine = await call(profileApi, 'GET', { action: 'public', username: 'aziz' });
  check('ochiq profil qaytdi', mine.statusCode === 200, mine.payload);
  check('xodim roli bor', mine.payload.profile.staffRole === 'ADMIN');
  check('odam o\'qiydigan nom', mine.payload.profile.staffRoleLabel === 'Administrator');

  const other = await call(profileApi, 'GET', { action: 'public', username: 'bek' });
  check('xodim bo\'lmaganda yorliq bo\'sh', other.payload.profile.staffRole === '');
  check('nomi ham bo\'sh', other.payload.profile.staffRoleLabel === '');
}

flow('Yorliqni odam o\'ziga yozib qo\'ya olmaydi');
{
  reset();
  seedUser('aziz@example.com', 'aziz');
  /* Profil yozuviga qo'lda `staffRole` qo'shib ko'ramiz: ochiq
     profil faqat daftardan o'qishi kerak, profil maydonidan emas. */
  const raw = JSON.parse(db.strings.get('profile:aziz@example.com'));
  raw.staffRole = 'SUPER_ADMIN';
  raw.staffRoleLabel = 'Super administrator';
  db.strings.set('profile:aziz@example.com', JSON.stringify(raw));

  const res = await call(profileApi, 'GET', { action: 'public', username: 'aziz' });
  check('profilga yozilgan rol e\'tiborsiz qoladi', res.payload.profile.staffRole === '');
  check('nomi ham chiqmaydi', res.payload.profile.staffRoleLabel === '');
}

flow('Daftar kirish huquqi emas');
{
  reset();
  seedUser('aziz@example.com', 'aziz');
  await call(adminData, 'POST', { action: 'save-staff' },
    { identity: 'aziz@example.com', role: 'SUPER_ADMIN' }, 'SUPER_ADMIN');

  /* Eng muhim tasdiq. Daftarda SUPER_ADMIN deb yozilgan odam
     uchun ham imzosiz so'rov hamon 401 bo'lishi kerak. */
  const res = await call(adminData, 'GET', { resource: 'users' }, null, null);
  check('xodim bo\'lish o\'zi kirish bermaydi', res.statusCode === 401, res.statusCode);
  check('imzosiz cookie ham ishlamaydi',
    isAdminAuthed({ headers: { cookie: 'admin_session=' + (Date.now() + 60000) + '.SUPER_ADMIN.xxx' } }) === null);
}

flow('Hisobchi roli');
{
  reset();
  const res = makeRes();
  await adminLogin({ method: 'POST', query: {}, body: { password: 'hisobchi-parol-test' }, headers: {} }, res);
  check('hisobchi paroli bilan kiriladi', res.statusCode === 200 && res.payload.role === 'ACCOUNTANT', res.payload);

  check('hisobchi buyurtmalarni ko\'radi', roleCan('ACCOUNTANT', 'orders:read'));
  check('hisobchi hisobotlarni ko\'radi', roleCan('ACCOUNTANT', 'analytics:read'));
  check('hisobchi to\'lovlarni ko\'radi', roleCan('ACCOUNTANT', 'payments:read'));
  check('hisobchi e\'lon tasdiqlamaydi', !roleCan('ACCOUNTANT', 'trucks:write'));
  check('hisobchi profilni o\'zgartirmaydi', !roleCan('ACCOUNTANT', 'users:write'));
  check('hisobchi xodim qo\'shmaydi', !roleCan('ACCOUNTANT', 'staff:write'));
  check('admin ham xodim qo\'shmaydi', !roleCan('ADMIN', 'staff:write'));
  check('super admin qo\'shadi', roleCan('SUPER_ADMIN', 'staff:write'));
}

flow('Chegara');
{
  reset();
  for (let i = 0; i < staffLib.MAX_STAFF; i++) {
    seedUser(`u${i}@example.com`, `u${i}`);
    const r = await staffLib.saveStaff(`u${i}@example.com`, { role: 'MODERATOR' });
    if (!r.ok) { check('chegaragacha hammasi yozildi', false, r.error); break; }
  }
  check('chegaraga to\'ldi', (await staffLib.listStaff()).length === staffLib.MAX_STAFF);

  seedUser('oshiq@example.com', 'oshiq');
  const over = await staffLib.saveStaff('oshiq@example.com', { role: 'MODERATOR' });
  check('chegaradan keyin qo\'shilmaydi', over.ok === false, over);

  /* Chegara to'lgan bo'lsa ham MAVJUD xodimning rolini
     o'zgartirish ishlashi kerak — aks holda ro'yxat qotib
     qolardi. */
  const edit = await staffLib.saveStaff('u0@example.com', { role: 'ADMIN' });
  check('mavjud xodim hamon tahrirlanadi', edit.ok === true, edit);
}

t.done();
