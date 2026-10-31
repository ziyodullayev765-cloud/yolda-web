/**
 * Xodimlar ro'yxati — admin panelga kiradigan odamlar.
 *
 * NEGA KERAK. Daftar foydalanuvchi hisobini (identity) rol bilan
 * bog'laydi. Panelda "xodim qo'shish" shuni yozadi, ilovadagi
 * profil esa shuni o'qib "Administrator" yorlig'ini ko'rsatadi.
 *
 * ============================================================
 * DIQQAT — BU KIRISH HUQUQI. YORLIQ EMAS.
 * ------------------------------------------------------------
 * Bu faylning boshida ilgari teskarisi yozilgan edi: "daftarga
 * yozilgani hech kimga panelga kirish imkonini bermaydi". U gap
 * `api/admin-login.js` ning ikkinchi kirish yo'li qo'shilgunga
 * qadar to'g'ri edi va keyin yolg'onga aylandi — eng yomon
 * joyda: kodni o'qiydigan odam "bu shunchaki yorliq" deb o'ylab,
 * birovga to'liq ruxsat berib qo'yishi mumkin edi.
 *
 * HOZIRGI HOLAT: daftarga yozilgan odam ilovaga qanday kirgan
 * bo'lsa (Google, Telegram yoki telefon), shu ma'lumot bilan
 * admin panelga ham kiradi — PAROLSIZ, shu yerda yozilgan rol
 * bilan. Ya'ni "xodim qo'shish" = ruxsat berish.
 *
 * Teskarisi ham darhol ishlaydi: daftardan chiqarilgan odam shu
 * zahoti kira olmay qoladi, cookie muddati tugashini kutmaydi
 * (lib/adminAuth.js: `resolveAdmin` har so'rovda shu daftarni
 * qayta o'qiydi).
 *
 * Panelga PAROL bilan kirish ham qoldi va u daftarga bog'liq
 * emas: parol hech kimga tegishli bo'lmagani uchun uni
 * daftardan o'chirib bo'lmaydi — parolning o'zini almashtirish
 * kerak. Panelda bu ikki gap ham ochiq yozilgan
 * (admin.html, "Xodimlar" bo'limi).
 * ============================================================
 *
 * SAQLANISHI. Har bir xodim alohida kalitda turadi
 * (`staff:<identity>`), ro'yxat esa to'plamda (`staff_ids`).
 * Bitta katta JSON bo'lsa, ilovadagi profil o'qishi uchun ham
 * butun ro'yxatni tortish kerak bo'lardi — profil esa eng
 * ko'p o'qiladigan joy.
 */
import { kvGet, kvSet, kvDel, kvSadd, kvSrem, kvSmembers } from './kv.js';

/* Panel rollari bilan BIR XIL vocabulary: ikkita turli rol
   ro'yxati bo'lsa, ular albatta bir kuni bir-biridan uzilib
   ketadi. lib/adminAuth.js dagi ROLES bilan solishtiring. */
export const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'ACCOUNTANT'];

/** Odamlar ko'radigan nom — ilovada ham, panelda ham shu. */
export const STAFF_ROLE_LABELS = {
  SUPER_ADMIN: 'Super administrator',
  ADMIN: 'Administrator',
  MODERATOR: 'Operator',
  ACCOUNTANT: 'Hisobchi',
};

export const staffKey = (identity) => `staff:${identity}`;
export const STAFF_SET = 'staff_ids';

/** Nechta xodim bo'lishi mumkin. Tasodifiy o'sishdan saqlaydi. */
export const MAX_STAFF = 50;

const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/**
 * Bitta xodimning roli yoki null.
 *
 * Profil o'qish yo'lida chaqiriladi, shuning uchun hech qachon
 * xato tashlamaydi: daftar o'qilmagani profilni ko'rsatmaslikka
 * sabab bo'lmasligi kerak.
 */
export const staffRole = async (identity) => {
  if (!identity) return null;
  try {
    const raw = await kvGet(staffKey(identity));
    if (!raw) return null;
    const rec = JSON.parse(raw);
    return STAFF_ROLES.includes(rec.role) ? rec.role : null;
  } catch {
    return null;
  }
};

/** Xodim yozuvi to'liq ko'rinishda, yoki null. */
export const staffRecord = async (identity) => {
  if (!identity) return null;
  try {
    const raw = await kvGet(staffKey(identity));
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!STAFF_ROLES.includes(rec.role)) return null;
    return { ...rec, identity };
  } catch {
    return null;
  }
};

/** Barcha xodimlar, yangisi tepada. */
export const listStaff = async () => {
  let ids = [];
  try {
    ids = await kvSmembers(STAFF_SET);
  } catch {
    return [];
  }
  const rows = await Promise.all(ids.map((id) => staffRecord(id)));
  return rows
    .filter(Boolean)
    .sort((a, b) => Number(b.addedAt || 0) - Number(a.addedAt || 0));
};

/**
 * Xodim qo'shadi yoki rolini o'zgartiradi.
 *
 * @returns {{ok:true, staff:object}|{ok:false, error:string}}
 */
export const saveStaff = async (identity, { role, title, addedBy } = {}) => {
  const id = clean(identity, 200);
  if (!id) return { ok: false, error: 'Foydalanuvchi ko‘rsatilmagan' };
  if (!STAFF_ROLES.includes(role)) return { ok: false, error: 'Rol noto‘g‘ri' };

  const existing = await staffRecord(id);
  if (!existing) {
    const ids = await kvSmembers(STAFF_SET).catch(() => []);
    if (ids.length >= MAX_STAFF) {
      return { ok: false, error: `Xodimlar soni chegarasi (${MAX_STAFF}) to‘ldi` };
    }
  }

  const record = {
    identity: id,
    role,
    title: clean(title, 60),
    addedAt: Number(existing && existing.addedAt) || Date.now(),
    addedBy: clean((existing && existing.addedBy) || addedBy, 40),
    updatedAt: Date.now(),
  };

  await kvSet(staffKey(id), JSON.stringify(record));
  await kvSadd(STAFF_SET, id);
  return { ok: true, staff: record };
};

/** Xodimni ro'yxatdan chiqaradi. Paroli bo'lsa, u hamon ishlaydi. */
export const removeStaff = async (identity) => {
  const id = clean(identity, 200);
  if (!id) return false;
  await kvDel(staffKey(id));
  await kvSrem(STAFF_SET, id);
  return true;
};

/** Rol bo'yicha sanoq — panelda "Administrator · 1" uchun. */
export const countByRole = (rows) => {
  const out = {};
  STAFF_ROLES.forEach((r) => { out[r] = 0; });
  (rows || []).forEach((r) => {
    if (out[r.role] !== undefined) out[r.role] += 1;
  });
  return out;
};
