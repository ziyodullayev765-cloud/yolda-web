/**
 * /api/chat — search users by username, message them, and edit/delete/react
 * to individual messages.
 *
 * One function (not several) to stay well under Vercel Hobby's 12-function
 * cap — see api/admin-data.js for the same reasoning. Dispatch is by
 * `?action=`:
 *
 *   GET  /api/chat?action=search&q=<text>&googleIdToken=...|&telegramInitData=...
 *   GET  /api/chat?action=inbox&googleIdToken=...|&telegramInitData=...
 *   GET  /api/chat?action=thread&googleIdToken=...|&telegramInitData=...&withEmail=...   (or &withUsername=...)
 *   POST /api/chat?action=send    { googleIdToken|telegramInitData, toUsername, text, replyTo?, media? }
 *   POST /api/chat?action=edit    { googleIdToken|telegramInitData, id, text }
 *   POST /api/chat?action=delete  { googleIdToken|telegramInitData, ids[], forMe }
 *   POST /api/chat?action=react   { googleIdToken|telegramInitData, id, emoji }
 *   POST /api/chat?action=pin     { googleIdToken|telegramInitData, withEmail, on }
 *   POST /api/chat?action=hide    { googleIdToken|telegramInitData, withEmail }
 *   POST /api/chat?action=ask     { googleIdToken|telegramInitData, text, history }
 *   GET  /api/chat?action=ai-list&googleIdToken=...
 *   GET  /api/chat?action=ai-thread&id=...&googleIdToken=...
 *   POST /api/chat?action=ai-save   { googleIdToken|telegramInitData, id, title, items }
 *   POST /api/chat?action=ai-del    { googleIdToken|telegramInitData, id }
 *
 * Each message is its own key (`msg:<id>`), not just an entry appended to a
 * list — that's what makes editing/deleting/reacting to one specific
 * message possible later without having to rewrite the whole conversation.
 * `convo:<pairKey>` is only the ordering: a list of message ids, keyed by
 * the two participants' identities sorted alphabetically so both sides
 * read/write the same key. An identity is either a real email (Google) or
 * "tg:<id>" (Telegram-only) — see lib/identity.js.
 *
 * The credential rides in the query string for GETs, the same tradeoff
 * /api/order already makes for phone numbers — acceptable at this app's
 * scale, and verified server-side on every call regardless.
 *
 * ============================================================
 * SUHBATDOSH IDENTITY SI MIJOZGA BERILMAYDI
 * ------------------------------------------------------------
 * Ilgari yozishmalar ro'yxati va suhbatning o'zi suhbatdoshning
 * `identity` sini qaytarardi. Google bilan kirgan odam uchun u —
 * haqiqiy pochta manzili, ya'ni istalgan `@username` ga bitta
 * xabar yozib, uning Gmail manzilini o'qib olish mumkin edi.
 *
 * Endi o'rniga qaytarib ochib bo'lmaydigan belgi beriladi
 * (`lib/chatAlias.js`). Maydon nomlari o'zgarmadi (`email`,
 * `withEmail`), chunki mijoz ularni shunchaki kalit sifatida
 * ishlatadi va qaytarib yuboradi — keshdan ochilgan eski sahifa
 * ham ishlayveradi.
 * ============================================================
 */
import { kvGet, kvSet, kvDel, kvIncr, kvExpire, kvPush, kvLrem, kvRange, kvSadd, kvSrem, kvSmembers, kvKeys, kvSismember } from '../lib/kv.js';
import { notifyUser, esc } from '../lib/notify.js';
import { uploadMedia, deleteObject, keyFromUrl, storageConfigured } from '../lib/storage.js';
import { resolveEmail } from '../lib/identity.js';
import { ensureAlias, resolveChatTarget } from '../lib/chatAlias.js';

const MAX_TEXT = 1000;

/* Biriktirilgan fayl base64 ko'rinishida, xabarning o'zi bilan
   birga keladi. Vercel so'rov tanasini ~4,5 MB bilan cheklaydi,
   base64 esa hajmni uchdan bir baravar oshiradi — shuning uchun
   chegara 2 MB. Ovoz uchun bu taxminan ikki daqiqa. */
const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
const MAX_FILE_NAME = 80;
/* Ovozli xabar uzunligi (soniya) — faqat ko'rsatish uchun.
   Mijoz aytadi, shuning uchun ishonib bo'lmaydi: chegaralanadi. */
const MAX_VOICE_SECONDS = 600;
const MAX_SEARCH_RESULTS = 20;
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const pairKey = (a, b) => `convo:${[a, b].sort().join('|')}`;

/* Yozishmaning "versiyasi" — har bir o'zgarishda bittaga oshadi.
   Mijoz pollda o'zidagi versiyani yuboradi; mos kelsa, server
   xabarlarni umuman o'qimaydi va bo'sh javob qaytaradi.

   Sababi: poll har 1,5 soniyada ketadi, lekin xabar har safar
   o'zgarmaydi. Ilgari o'zgarmaganini bilish uchun ham butun yozishma
   (100 tagacha alohida GET) o'qilardi. Endi o'zgarmagan poll bitta
   buyruqqa tushadi. */
const verKey = (a, b) => `convoVer:${[a, b].sort().join('|')}`;

/** Yozishma o'zgardi — versiyani oshiramiz. Xatosi jim o'tadi:
    hisoblagich yo'qolsa, eng yomoni ortiqcha bir marta o'qiladi. */
const bumpVer = async (a, b) => { await kvIncr(verKey(a, b)).catch(() => {}); };

/**
 * O'qilmagan xabarlar hisoblagichi: `chatUnread:<kimga>:<kimdan>`.
 *
 * Har safar butun yozishmani sanab chiqish qimmat — shuning uchun
 * xabar yuborilganda bitta oshiriladi, suhbat ochilganda esa
 * nolga tushadi. Ya'ni ro'yxat uchun bitta o'qish yetarli.
 */
const unreadKey = (to, from) => `chatUnread:${to}:${from}`;
const generateId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** profile:<email> used to just be the plain username string — read old and new shapes. */
const parseProfile = (raw) => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // fall through
  }
  return { username: raw };
};

const parseMessage = (raw) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

/** Matnsiz xabar ro'yxatda va bildirishnomada shunday ko'rinadi. */
const mediaLabel = (media) => {
  if (!media) return '';
  if (media.kind === 'voice') return '🎤 Ovozli xabar';
  if (media.kind === 'image') return '🖼 Rasm';
  return '📎 Hujjat';
};

/** Crude in-memory throttle against message spam. */
const recent = new Map();
const isThrottled = (key) => {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > 3_000) recent.delete(k);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
};

const searchUsers = async (req, res) => {
  const email = await resolveEmail({ googleIdToken: req.query.googleIdToken, telegramInitData: req.query.telegramInitData, phoneToken: req.query.phoneToken });
  if (!email) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  /* Odamlar username'ni "@ali" ko'rinishida aytadi va aynan shunday
     qidiradi. Bazada esa u "@"siz saqlanadi — belgini olib
     tashlamasak, "@ali" hech kimga tushmasdi. */
  const q = String(req.query.q || '').trim().replace(/^@+/, '').toLowerCase();
  if (q.length < 2) return res.status(200).json({ users: [] });

  const keys = await kvKeys('username:*');
  /* Boshidan mos kelgani tepada tursin: "ali" deb qidirilganda
     avval @ali, keyin @xolali chiqadi. */
  const matches = keys
    .map((k) => k.slice('username:'.length))
    .filter((u) => u.includes(q) && u !== '')
    .sort((a, b) => {
      const byStart = (b.startsWith(q) ? 1 : 0) - (a.startsWith(q) ? 1 : 0);
      return byStart || a.length - b.length || (a < b ? -1 : 1);
    })
    .slice(0, MAX_SEARCH_RESULTS);

  const users = (
    await Promise.all(
      matches.map(async (uname) => {
        const ownerEmail = await kvGet(`username:${uname}`);
        if (!ownerEmail || ownerEmail === email) return null;
        const profile = parseProfile(await kvGet(`profile:${ownerEmail}`));
        return {
          username: profile.username || uname,
          /* Ro'yxatda ism ko'rinadi — xuddi yozishmalarda bo'lgani
             kabi. Bular suhbatdoshga allaqachon ko'rinadigan
             ma'lumot; telefon, pochta yoki boshqasi berilmaydi. */
          name: profile.displayName || profile.name || '',
          avatarUrl: profile.avatarUrl || '',
          role: profile.role || null,
          city: profile.city || null,
          verified: Boolean(profile.verified),
        };
      }),
    )
  ).filter(Boolean);

  return res.status(200).json({ users });
};

const getInbox = async (req, res) => {
  const myEmail = await resolveEmail({ googleIdToken: req.query.googleIdToken, telegramInitData: req.query.telegramInitData, phoneToken: req.query.phoneToken });
  if (!myEmail) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const others = await kvSmembers(`inbox:${myEmail}`);
  const pins = await readPins(myEmail);
  /* O'chirilgan xabar ro'yxatda ham ko'rinmasligi kerak — na
     o'zi, na "o'chirildi" degan izi. Shuning uchun oxirgi
     bitta emas, bir nechta xabar o'qiladi va ulardan birinchi
     SOG' xabar olinadi. */
  const yashirin = new Set(await kvSmembers(hiddenKey(myEmail)));
  const conversations = (
    await Promise.all(
      others.map(async (otherEmail) => {
        const profile = parseProfile(await kvGet(`profile:${otherEmail}`));
        const lastIds = await kvRange(pairKey(myEmail, otherEmail), 0, 9);
        const unread = Number(await kvGet(unreadKey(myEmail, otherEmail))) || 0;
        const sogIds = lastIds.filter((id) => !yashirin.has(id));
        const oxirgilar = (await Promise.all(sogIds.map((id) => kvGet(`msg:${id}`))))
          .map(parseMessage)
          .filter((m) => m && !m.deleted);
        const lastMsg = oxirgilar[0] || null;
        // Profil yo'q = odam akkauntini o'chirgan. Zaxira sifatida
        // identity ko'rsatib bo'lmaydi: Google bilan kirganlarda u —
        // haqiqiy pochta manzili, ya'ni ro'yxatda begona odamning
        // manzili chiqib qolardi. Yozishma qoladi, nom esa umumiy.
        const gone = !profile.username && !profile.displayName && !profile.name;
        /* Mijozga identity BERILMAYDI — Google bilan kirganlarda u
           haqiqiy pochta manzili bo'ladi. Uning o'rniga qaytarib
           ochib bo'lmaydigan belgi (lib/chatAlias.js). Maydon nomi
           `email` bo'lib qoladi: keshdan ochilgan eski sahifa
           aynan shu nomni kutadi va qiymatni shunchaki qaytarib
           yuboradi, ya'ni u uchun hech narsa o'zgarmaydi. */
        const alias = (await ensureAlias(otherEmail)) || otherEmail;
        return {
          email: alias,
          username: profile.username || (gone ? 'deleted' : alias),
          deleted: gone,
          // Ro'yxatda username emas, odamning ismi ko'rinadi —
          // "@dilshod_driver" dan ko'ra "Dilshod Tursunov" tushunarli.
          // Ism yo'q bo'lsa username zaxira bo'lib qoladi.
          name: profile.displayName || profile.name || (gone ? 'O‘chirilgan foydalanuvchi' : ''),
          avatarUrl: profile.avatarUrl || '',
          verified: Boolean(profile.verified),
          lastText: lastMsg ? (lastMsg.text || mediaLabel(lastMsg.media)) : '',
          lastAt: lastMsg ? lastMsg.at : 0,
          lastFromMe: lastMsg ? lastMsg.from === myEmail : false,
          unread,
          pinned: pins.includes(otherEmail),
        };
      }),
    )
  ).sort((a, b) => {
    // Qadalganlari doim yuqorida; ichida esa oxirgi xabar bo'yicha.
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.lastAt - a.lastAt;
  });

  /* Qadalganlar ro'yxati ham belgi bilan: bu yerda ham identity
     chiqib ketmasligi kerak. */
  const pinnedAliases = (await Promise.all(pins.map(async (id) => (await ensureAlias(id)) || id)));
  return res.status(200).json({ conversations, pinned: pinnedAliases, maxPins: MAX_PINS });
};

/* ----------------------------------------------------------
   Qadab qo'yilgan yozishmalar
   ----------------------------------------------------------
   Har bir odamning o'z ro'yxati: `chatPins:<identity>`. Suhbat
   ikki tomonli, qadash esa bir tomonli — men kimnidir yuqoriga
   qadaganim unga ko'rinmasligi kerak.

   To'rttadan ko'p emas: beshinchisi qadalsa, ro'yxatning ma'nosi
   yo'qoladi — "eng muhimlari" degani "hammasi" bo'lib qoladi.
---------------------------------------------------------- */
const MAX_PINS = 4;
const pinsKey = (identity) => `chatPins:${identity}`;

const readPins = async (identity) => {
  try {
    const raw = await kvGet(pinsKey(identity));
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, MAX_PINS) : [];
  } catch {
    return [];
  }
};

const setPin = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const myEmail = await resolveEmail({
    googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData, phoneToken: body.phoneToken,
  });
  if (!myEmail) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  /* Mijoz belgi yuboradi (lib/chatAlias.js), eski sahifa esa
     identity yuborishi mumkin — ikkalasi ham qabul qilinadi. */
  const other = await resolveChatTarget(body.withEmail);
  if (!other || other === myEmail) return res.status(400).json({ error: 'Suhbat ko‘rsatilmagan' });

  /* Faqat o'z ro'yxatimdagi suhbatni qadash mumkin: aks holda
     begona odamni ro'yxatga yozib qo'yib bo'lardi. */
  if (!(await kvSismember(`inbox:${myEmail}`, other))) {
    return res.status(404).json({ error: 'Suhbat topilmadi' });
  }

  const pins = await readPins(myEmail);
  const on = body.on !== false;
  let next;
  if (on) {
    if (pins.includes(other)) next = pins;
    else if (pins.length >= MAX_PINS) {
      return res.status(409).json({ error: `Ko‘pi bilan ${MAX_PINS} ta suhbat qadaladi`, max: MAX_PINS });
    } else next = pins.concat([other]);
  } else {
    next = pins.filter((x) => x !== other);
  }

  await kvSet(pinsKey(myEmail), JSON.stringify(next));
  /* Bazada identity, javobda belgi — ro'yxatdagi bilan bir xil. */
  const nextAliases = await Promise.all(next.map(async (id) => (await ensureAlias(id)) || id));
  return res.status(200).json({ ok: true, pinned: nextAliases, max: MAX_PINS });
};

/* ============================================================
   POST ?action=ask — YO'LDA bot (Gemini)
   ------------------------------------------------------------
   KALIT FAQAT SHU YERDA. `GEMINI_API_KEY` — server muhitining
   o'zgaruvchisi. U brauzerga HECH QACHON yuborilmaydi: javobda
   ham, xatolikda ham ko'rinmaydi. So'rovni server yuboradi,
   mijoz faqat matnni oladi. Kalitni frontendga qo'yish — uni
   ochiq e'lon qilish bilan barobar: sahifa kodini istalgan odam
   o'qiy oladi.

   KIRGAN ODAMGAGINA. Kirmagan odam so'rov yubora olmaydi, aks
   holda kalit ochiq turgani bilan bir xil bo'lardi.

   CHEGARA BOR. Har bir odamga kunlik chegara — hisob bo'shab
   qolmasligi uchun. Chegara SERVERDA sanaladi: mijozga ishonib
   bo'lmaydi.
   ============================================================ */
/* Modellar — tartib bo'yicha. Birinchisi yaxshiroq javob
   beradi, lekin bepul hisobda KUNIGA 20 ta so'rovga ruxsat.
   U tugagach, ikkinchisiga o'tiladi: u soddaroq, ammo kunlik
   chegarasi ancha katta.

   "Javob kelmadi" degan xatoning sababi aynan shu edi: Google
   429 (chegara tugadi) qaytarardi, biz esa uni oddiy nosozlik
   deb ko'rsatardik. Endi sabab aniq aytiladi. */
const AI_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
/* Chegaraga urilgan model shuncha vaqt chetlab o'tiladi —
   har bir xabarda bekorga so'rov ketmasin. */
const AI_COOLDOWN_S = 2 * 60 * 60;
const aiCoolKey = (model) => `aiCool:${model}`;
const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 40);
const AI_MAX_QUESTION = 2000;
const AI_MAX_HISTORY = 10;
const AI_TIMEOUT_MS = 20000;

/* ============================================================
   BOTNING QO'LLARI
   ------------------------------------------------------------
   Bot raqam O'YLAB TOPMAYDI. "Toshkentdan Samarqandga yuk
   bormi?" degan savolga javob berish uchun unga bazaga
   qarash kerak — shuning uchun ikkita vosita berilgan.
   Vositani MODEL emas, SERVER bajaradi va javobga faqat
   natija qo'shiladi.

   MA'LUMOT QAYERDAN. Ikkala vosita ham ilovaning O'ZI
   ishlatadigan tayyor ro'yxatlardan o'qiydi (`loads_cache`,
   `price_stats`). Ya'ni bot ko'rgan narsa odam ekranda
   ko'rgan narsa bilan bir xil.

   RO'YXATNI QAYTA QURMAYDI. Ro'yxatni noldan qurish uch
   yuzdan ortiq buyruq talab qiladi; buni har bir savolda
   qilish — bazani savol bilan ko'mish. Tayyor ro'yxat
   bo'lmasa, bot "hozir ro'yxat tayyor emas" deydi va YUK
   YO'Q DEMAYDI: bu ikki boshqa narsa.

   SHAXSIY MA'LUMOT UZATILMAYDI. Yuk egasining ismi ham,
   telefoni ham vositaning javobiga kirmaydi — bot faqat
   yo'nalish, og'irlik, narx va kodni ko'radi. Telefon
   kerak bo'lsa, odam yukni ilovada ochadi.
   ============================================================ */
const AI_TOOLS = [{
  functionDeclarations: [
    {
      name: 'yuk_qidir',
      description: 'YO\'LDA dagi ochiq (hali haydovchi olmagan) yuklarni qidiradi. '
        + 'Yo\'nalish, yuk turi yoki og\'irlik bo\'yicha. Barcha maydonlar ixtiyoriy.',
      parameters: {
        type: 'OBJECT',
        properties: {
          fromCity: { type: 'STRING', description: 'Yuklash shahri, masalan "Toshkent"' },
          toCity: { type: 'STRING', description: 'Yetkazish shahri' },
          maxWeightKg: { type: 'NUMBER', description: 'Eng ko\'pi shuncha kg' },
          minWeightKg: { type: 'NUMBER', description: 'Eng kami shuncha kg' },
        },
      },
    },
    {
      name: 'narx_statistikasi',
      description: 'Shu yo\'nalishda avvalgi HAQIQIY buyurtmalar bo\'yicha tonna-narx '
        + 'taqsimoti. Ma\'lumot yetarli bo\'lmasa, shuni aytadi.',
      parameters: {
        type: 'OBJECT',
        properties: {
          fromCity: { type: 'STRING' },
          toCity: { type: 'STRING' },
          weightKg: { type: 'NUMBER', description: 'Berilsa, shu og\'irlikka moslab hisoblaydi' },
        },
        required: ['fromCity', 'toCity'],
      },
    },
  ],
}];

const AI_TOOL_ROUNDS = 3;

/** Ochiq yuklar — faqat TAYYOR ro'yxatdan. */
const toolFindLoads = async (args = {}) => {
  let cached = null;
  try { cached = JSON.parse((await kvGet('loads_cache')) || 'null'); } catch { cached = null; }
  if (!cached || !Array.isArray(cached.items)) {
    return { ready: false, note: 'Ro‘yxat hozir tayyor emas. Bu "yuk yo‘q" degani EMAS.' };
  }

  const eq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const list = cached.items
    .filter((o) => !args.fromCity || eq(o.fromCity, args.fromCity))
    .filter((o) => !args.toCity || eq(o.toCity, args.toCity))
    .filter((o) => !(args.minWeightKg > 0) || Number(o.weightKg) >= args.minWeightKg)
    .filter((o) => !(args.maxWeightKg > 0) || Number(o.weightKg) <= args.maxWeightKg)
    .slice(0, 8)
    /* Faqat ochiq ma'lumot. Ism va telefon ATAYLAB yo'q. */
    .map((o) => ({
      kod: o.code,
      yonalish: `${o.fromCity} → ${o.toCity}`,
      ogirlikKg: o.weightKg,
      yukTuri: o.cargoType || '',
      narxSom: o.amount || null,
      sana: o.pickupDate || '',
    }));

  return { ready: true, topildi: list.length, jami: cached.items.length, yuklar: list };
};

/** Narx — faqat haqiqiy buyurtmalardan hisoblangan statistika. */
const toolPriceStats = async (args = {}) => {
  let stats = null;
  try { stats = JSON.parse((await kvGet('price_stats')) || 'null'); } catch { stats = null; }
  if (!stats || !stats.routes) {
    return { ready: false, note: 'Statistika hozir tayyor emas.' };
  }
  const key = `${String(args.fromCity || '').trim()}>${String(args.toCity || '').trim()}`;
  const route = stats.routes[key];
  if (!route) {
    return {
      ready: true, enough: false,
      note: 'Bu yo‘nalishda yetarli buyurtma yo‘q — narx aytib bo‘lmaydi. Taxmin qilma.',
    };
  }
  const out = {
    ready: true, enough: true, buyurtmalarSoni: route.count,
    tonnaNarxiSom: { past: route.p25, orta: route.p50, yuqori: route.p75 },
  };
  const w = Number(args.weightKg);
  if (Number.isFinite(w) && w > 0) {
    const tons = w / 1000;
    out.shuYukUchunSom = {
      past: Math.round(route.p25 * tons),
      orta: Math.round(route.p50 * tons),
      yuqori: Math.round(route.p75 * tons),
    };
  }
  return out;
};

const AI_TOOL_IMPL = { yuk_qidir: toolFindLoads, narx_statistikasi: toolPriceStats };

const AI_SYSTEM = [
  'Sen "YO\'LDA bot" — YO\'LDA ilovasining yordamchisisan.',
  'YO\'LDA — O\'zbekistondagi yuk tashish bozori: yuk egalari yuk joylaydi,',
  'haydovchilar esa o\'z yo\'nalishiga mos yukni oladi.',
  'Foydalanuvchi qaysi tilda yozgan bo\'lsa, javobni o\'sha tilda ber;',
  'til aniq bo\'lmasa — o\'zbek tilida (lotin yozuvida).',
  'Qisqa va aniq yoz, ortiqcha muqaddima qilma.',
  'Bilmagan narsangni bilmayman deb ayt. Narx, masofa yoki qonunni',
  'o\'ylab topma; taxmin bo\'lsa, taxmin ekanini ayt.',
  'YUK VA NARX HAQIDA SO\'RALSA — VOSITALARDAN FOYDALAN.',
  'Yuk bormi degan savolga xotirangdan javob berma: yuk_qidir ni chaqir.',
  'Narx so\'ralsa narx_statistikasi ni chaqir; u "yetarli ma\'lumot yo\'q"',
  'desa, shuni ayt va o\'zingdan raqam aytma.',
  'Vosita "tayyor emas" desa, buni "yuk yo\'q" deb tarjima qilma —',
  'ro\'yxat hozir yangilanayotganini ayt.',
  'Yuk egasining ismi va telefoni senga berilmaydi; ular kerak bo\'lsa',
  'odam yukni ilovada kod bo\'yicha ochishi kerak.',
  'Ilovaning ichidagi ma\'lumotlarga (buyurtmalar, foydalanuvchilar,',
  'to\'lovlar) sening ruxsating yo\'q — ularni so\'rashsa, ilovaning',
  'tegishli bo\'limiga yo\'naltir.',
].join(' ');

const aiUsageKey = (email) => `aiUsed:${email}:${new Date().toISOString().slice(0, 10)}`;

const askAi = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const myEmail = await resolveEmail({
    googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData, phoneToken: body.phoneToken,
  });
  if (!myEmail) return res.status(401).json({ error: 'Avval ilovaga kiring' });

  const text = String(body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Savol bo‘sh' });
  if (text.length > AI_MAX_QUESTION) {
    return res.status(400).json({ error: `Savol ${AI_MAX_QUESTION} belgidan oshmasin` });
  }

  const key = process.env.GEMINI_API_KEY;
  /* Kalit qo'yilmagan bo'lsa — shuni ochiq aytamiz. O'ylab
     topilgan javob qaytarish odamni aldash bo'lardi. */
  if (!key) return res.status(503).json({ error: 'AI hali ulanmagan', notReady: true });

  const used = Number(await kvIncr(aiUsageKey(myEmail)).catch(() => 0)) || 0;
  if (used === 1) await kvExpire(aiUsageKey(myEmail), 60 * 60 * 36).catch(() => {});
  if (used > AI_DAILY_LIMIT) {
    return res.status(429).json({
      error: `Bugunga chegara tugadi (${AI_DAILY_LIMIT} ta savol). Ertaga yana urinib ko‘ring.`,
      limit: AI_DAILY_LIMIT,
    });
  }

  /* Suhbat tarixi mijozdan keladi — u odamning O'Z yozganlari.
     Shunga qaramay soni ham, uzunligi ham serverda qirqiladi. */
  const history = Array.isArray(body.history) ? body.history.slice(-AI_MAX_HISTORY) : [];
  const contents = [];
  for (const item of history) {
    const t = String((item && item.text) || '').trim().slice(0, AI_MAX_QUESTION);
    if (!t) continue;
    contents.push({ role: item.from === 'ai' ? 'model' : 'user', parts: [{ text: t }] });
  }
  contents.push({ role: 'user', parts: [{ text }] });

  /* ============================================================
     Modelga murojaat — vositalar bilan
     ------------------------------------------------------------
     Model javob o'rniga "shu vositani chaqir" deyishi mumkin.
     Unda server vositani bajaradi, natijani suhbatga qo'shadi
     va yana so'raydi. Shu aylanish chegaralangan: model
     o'zini-o'zi cheksiz chaqirtira olmasligi kerak.
     ============================================================ */
  const callModel = async (body) => {
    let out = null;
    let quota = false;
    let stat = 0;
    for (const model of AI_MODELS) {
      if (await kvGet(aiCoolKey(model)).catch(() => null)) { quota = true; continue; }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
      let r;
      try {
        r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          },
        );
      } catch (err) {
        console.error('[ai]', model, err && err.name === 'AbortError' ? 'vaqt tugadi' : 'ulanmadi');
        clearTimeout(timer);
        return { timeout: true };
      }
      clearTimeout(timer);

      if (r.ok) { out = await r.json().catch(() => null); break; }

      stat = r.status;
      /* Google'ning xato MATNI mijozga uzatilmaydi — u so'rovning
         o'zini, ya'ni kalitni ham qaytarishi mumkin. Faqat holat
         kodi ishlatiladi. */
      console.error('[ai]', model, 'status', r.status);
      if (r.status === 429 || r.status === 503) {
        quota = true;
        await kvSet(aiCoolKey(model), '1').catch(() => {});
        await kvExpire(aiCoolKey(model), AI_COOLDOWN_S).catch(() => {});
        continue;   // keyingi modelni sinab ko'ramiz
      }
      return { failed: true };
    }
    return { data: out, quota, stat };
  };

  const turns = contents.slice();
  let data = null;
  let quotaHit = false;
  let lastStatus = 0;
  const usedTools = [];

  for (let round = 0; round < AI_TOOL_ROUNDS; round += 1) {
    const got = await callModel({
      contents: turns,
      systemInstruction: { parts: [{ text: AI_SYSTEM }] },
      tools: AI_TOOLS,
      generationConfig: { maxOutputTokens: 1024, temperature: 0.6 },
    });
    if (got.timeout) return res.status(504).json({ error: 'Javob kech qoldi, qayta urinib ko‘ring' });
    if (got.failed) return res.status(502).json({ error: 'Javob kelmadi, qayta urinib ko‘ring' });
    quotaHit = quotaHit || got.quota;
    lastStatus = got.stat || lastStatus;
    data = got.data;
    if (!data) break;

    const c = data.candidates && data.candidates[0];
    const parts = (c && c.content && c.content.parts) || [];
    const calls = parts.filter((x) => x && x.functionCall);
    if (!calls.length) break;          // model javobini yozdi

    /* Modelning so'rovi ham suhbatga qo'shiladi — aks holda u
       nima so'raganini unutadi. */
    turns.push({ role: 'model', parts });

    const answers = [];
    for (const part of calls) {
      const name = part.functionCall.name;
      const impl = AI_TOOL_IMPL[name];
      let result;
      if (!impl) {
        result = { error: 'Bunday vosita yo‘q' };
      } else {
        try {
          result = await impl(part.functionCall.args || {});
        } catch (err) {
          console.error('[ai] vosita xatosi', name, err.message);
          result = { error: 'Ma‘lumotni olib bo‘lmadi' };
        }
      }
      usedTools.push(name);
      answers.push({ functionResponse: { name, response: result } });
    }
    turns.push({ role: 'user', parts: answers });
  }

  if (!data) {
    if (quotaHit) {
      /* Sababi ochiq aytiladi: bu nosozlik emas, chegara. */
      return res.status(429).json({
        error: 'Bugungi bepul chegara tugadi. Ertaga yana ishlaydi.',
        quota: true,
      });
    }
    return res.status(502).json({ error: 'Javob kelmadi, qayta urinib ko‘ring', status: lastStatus ? 1 : 0 });
  }

  const cand = data && data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const answer = parts.map((p) => String(p.text || '')).join('').trim();
  if (!answer) {
    /* Javob bo'sh ham bo'lishi mumkin: xavfsizlik filtri
       to'xtatgan yoki uzunlik chegarasiga urilgan. Bo'sh
       pufakcha ko'rsatgandan ko'ra sababini aytgan yaxshi. */
    const why = (cand && cand.finishReason) || 'NO_TEXT';
    return res.status(200).json({
      text: why === 'MAX_TOKENS'
        ? 'Javob juda uzun bo‘lib ketdi. Savolni qismlarga bo‘lib bering.'
        : 'Bu savolga javob bera olmadim. Boshqacha so‘rab ko‘ring.',
      empty: true, used, limit: AI_DAILY_LIMIT,
    });
  }

  /* Qaysi vosita ishlatilgani mijozga ham aytiladi: javob
     bazadan olinganini odam bilib tursin. */
  return res.status(200).json({
    text: answer, used, limit: AI_DAILY_LIMIT,
    tools: usedTools.length ? [...new Set(usedTools)] : undefined,
  });
};


/* ============================================================
   YO'LDA bot — suhbatlar saqlanishi
   ------------------------------------------------------------
   Suhbat SERVERDA saqlanadi, brauzerda emas: telefon
   almashtirilsa ham, ilova o'chirilib qayta o'rnatilsa ham
   yozishganlar joyida qoladi.

   KALIT EGASI BILAN BIRGA. Har bir suhbatning kaliti ichida
   egasining o'zi bor (`aiThread:<kim>:<id>`), shuning uchun
   boshqa odamning suhbatini id ni bilgan bilan ham ochib
   bo'lmaydi — kalit boshqa chiqadi.
   ============================================================ */
const AI_LIST_KEY = (email) => `aiThreads:${email}`;
const AI_THREAD_KEY = (email, id) => `aiThread:${email}:${id}`;
const MAX_AI_THREADS = 40;
const MAX_AI_ITEMS = 80;
const MAX_AI_ITEM_TEXT = 4000;

/* Id ni SERVER beradi. Mijoz bergan id bilan boshqa birovning
   yozuvini bosib ketib bo'lmasligi uchun — garchi kalit allaqachon
   egasiga bog'langan bo'lsa ham, ikki qavat qulf ortiqcha emas. */
const newAiId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const aiListThreads = async (req, res) => {
  const email = await resolveEmail({
    googleIdToken: req.query.googleIdToken, telegramInitData: req.query.telegramInitData,
    phoneToken: req.query.phoneToken,
  });
  if (!email) return res.status(401).json({ error: 'Avval ilovaga kiring' });

  const ids = await kvRange(AI_LIST_KEY(email), 0, MAX_AI_THREADS - 1);
  const threads = [];
  for (const id of ids) {
    const raw = await kvGet(AI_THREAD_KEY(email, id));
    if (!raw) continue;
    try {
      const t = JSON.parse(raw);
      threads.push({ id: t.id, title: t.title, at: t.at });
    } catch { /* buzilgan yozuv ro'yxatni to'xtatmasin */ }
  }
  return res.status(200).json({ threads });
};

const aiGetThread = async (req, res) => {
  const email = await resolveEmail({
    googleIdToken: req.query.googleIdToken, telegramInitData: req.query.telegramInitData,
    phoneToken: req.query.phoneToken,
  });
  if (!email) return res.status(401).json({ error: 'Avval ilovaga kiring' });

  const id = String(req.query.id || '');
  const raw = id && await kvGet(AI_THREAD_KEY(email, id));
  if (!raw) return res.status(404).json({ error: 'Suhbat topilmadi' });
  return res.status(200).json({ thread: JSON.parse(raw) });
};

const aiSaveThread = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = await resolveEmail({
    googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData, phoneToken: body.phoneToken,
  });
  if (!email) return res.status(401).json({ error: 'Avval ilovaga kiring' });

  const items = (Array.isArray(body.items) ? body.items : [])
    .slice(-MAX_AI_ITEMS)
    .map((m) => ({
      from: m && m.from === 'ai' ? 'ai' : 'me',
      text: String((m && m.text) || '').slice(0, MAX_AI_ITEM_TEXT),
      at: String((m && m.at) || '').slice(0, 5),
    }))
    .filter((m) => m.text);
  if (!items.length) return res.status(400).json({ error: 'Suhbat bo‘sh' });

  /* Mavjud suhbatni yangilash — faqat O'ZINIKINI: kalit egasiga
     bog'langani uchun begonaniki umuman topilmaydi. */
  let id = String(body.id || '');
  let fresh = false;
  if (id) {
    if (!(await kvGet(AI_THREAD_KEY(email, id)))) { id = ''; }
  }
  if (!id) { id = newAiId(); fresh = true; }

  const thread = {
    id,
    title: String(body.title || items[0].text).slice(0, 80),
    at: Date.now(),
    items,
  };
  const saved = await kvSet(AI_THREAD_KEY(email, id), JSON.stringify(thread));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });

  if (fresh) {
    await kvPush(AI_LIST_KEY(email), id);
    /* Ro'yxat cheksiz o'smasin: eng eskisi o'chiriladi. */
    const ids = await kvRange(AI_LIST_KEY(email), 0, -1);
    for (const old of ids.slice(MAX_AI_THREADS)) {
      await kvLrem(AI_LIST_KEY(email), old);
      await kvDel(AI_THREAD_KEY(email, old));
    }
  }
  return res.status(200).json({ ok: true, id, at: thread.at, title: thread.title });
};

const aiDeleteThread = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = await resolveEmail({
    googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData, phoneToken: body.phoneToken,
  });
  if (!email) return res.status(401).json({ error: 'Avval ilovaga kiring' });

  const id = String(body.id || '');
  if (!id || !(await kvGet(AI_THREAD_KEY(email, id)))) {
    return res.status(404).json({ error: 'Suhbat topilmadi' });
  }
  await kvDel(AI_THREAD_KEY(email, id));
  await kvLrem(AI_LIST_KEY(email), id);
  return res.status(200).json({ ok: true });
};

/**
 * POST ?action=hide — yozishmani O'Z ro'yxatimdan olib tashlash.
 *
 * Xabarlarning o'zi o'chmaydi va suhbatdoshning ro'yxatidan ham
 * yo'qolmaydi: yozishma ikki kishiniki, bir tomon ikkinchisining
 * yozishmasini o'chira olmasligi kerak. U yana yozsa, suhbat
 * ro'yxatga qaytadi — ilovada shu ochiq aytiladi.
 */
const hideConversation = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const myEmail = await resolveEmail({
    googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData, phoneToken: body.phoneToken,
  });
  if (!myEmail) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const other = await resolveChatTarget(body.withEmail);
  if (!other) return res.status(400).json({ error: 'Suhbat ko‘rsatilmagan' });
  if (!(await kvSismember(`inbox:${myEmail}`, other))) {
    return res.status(404).json({ error: 'Suhbat topilmadi' });
  }

  await kvSrem(`inbox:${myEmail}`, other);
  await kvDel(unreadKey(myEmail, other)).catch(() => {});

  // Qadalgan bo'lsa, ro'yxatdan ham chiqadi.
  const pins = await readPins(myEmail);
  if (pins.includes(other)) {
    await kvSet(pinsKey(myEmail), JSON.stringify(pins.filter((x) => x !== other)));
  }

  return res.status(200).json({ ok: true });
};

const getThread = async (req, res) => {
  const myEmail = await resolveEmail({ googleIdToken: req.query.googleIdToken, telegramInitData: req.query.telegramInitData, phoneToken: req.query.phoneToken });
  if (!myEmail) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  /* Suhbatdosh belgi bilan ataladi (lib/chatAlias.js). Eski
     sahifa identity yuborishi mumkin — u ham qabul qilinadi. */
  let withEmail = (await resolveChatTarget(req.query.withEmail)) || '';
  const withUsername = String(req.query.withUsername || '').trim().toLowerCase();
  if (!withEmail && withUsername) {
    withEmail = (await kvGet(`username:${withUsername}`)) || '';
  }
  if (!withEmail) return res.status(400).json({ error: 'Bunday foydalanuvchi topilmadi' });
  /* Javobda identity emas, belgi qaytadi — mijoz keyingi
     so'rovda aynan shuni yuboradi. */
  const withAlias = (await ensureAlias(withEmail)) || withEmail;

  /* Hech narsa o'zgarmaganmi? Mijoz o'zidagi versiyani yuboradi.
     Mos kelsa — xabarlarni umuman o'qimaymiz. Poll har 1,5 soniyada
     ketadi, lekin xabar har safar o'zgarmaydi, shuning uchun
     pollarning aksariyati shu yerda tugaydi: 100 dan ortiq buyruq
     o'rniga bittasi. */
  const ver = String((await kvGet(verKey(myEmail, withEmail))) || '0');
  const clientVer = String(req.query.ver || '');
  if (clientVer && clientVer === ver) {
    return res.status(200).json({ unchanged: true, ver, withEmail: withAlias });
  }

  // Suhbat ochildi yoki yangilik bor — bu yozishma o'qilgan hisoblanadi.
  await kvDel(unreadKey(myEmail, withEmail)).catch(() => {});

  const ids = await kvRange(pairKey(myEmail, withEmail), 0, 99);
  /* "Faqat o'zim uchun" yashirilganlar chetlab o'tiladi. Ular
     o'chirilmagan — suhbatdoshda joyida turibdi, shunchaki shu
     odamning ro'yxatida ko'rinmaydi. */
  const yashirin = new Set(await kvSmembers(hiddenKey(myEmail)));
  /* O'chirilgan xabar BUTUNLAY yo'qoladi: o'rnida "Xabar
     o'chirildi" degan iz ham qolmaydi. Yozuvning o'zi bazada
     o'chirilgan deb turadi — shunda eski id qayta tirilmaydi —
     lekin yozishmaga chiqmaydi. */
  const raw = (await Promise.all(ids.filter((id) => !yashirin.has(id)).map((id) => kvGet(`msg:${id}`))))
    .map(parseMessage).filter((m) => m && !m.deleted);

  const messages = raw
    .reverse() // ids stored newest-first (LPUSH); a chat reads oldest-first
    .map((m) => ({
      id: m.id,
      text: m.deleted ? '' : m.text,
      at: m.at,
      editedAt: m.editedAt || null,
      deleted: Boolean(m.deleted),
      fromMe: m.from === myEmail,
      replyTo: m.replyTo || null,
      media: m.deleted ? null : (m.media || null),
      reactions: REACTIONS
        .map((emoji) => ({ emoji, count: (m.reactions?.[emoji] || []).length, mine: (m.reactions?.[emoji] || []).includes(myEmail) }))
        .filter((r) => r.count > 0),
    }));

  const profile = parseProfile(await kvGet(`profile:${withEmail}`));
  return res.status(200).json({
    messages,
    ver,
    withEmail: withAlias,
    withUsername: profile.username || withUsername,
    withName: profile.displayName || profile.name || '',
    withAvatarUrl: profile.avatarUrl || '',
    withVerified: Boolean(profile.verified),
  });
};

/**
 * Qabul qiluvchiga Telegram orqali xabar bordi deb aytadi.
 *
 * Suhbat davomida har bir xabar uchun bildirishnoma yuborish — spam.
 * Shuning uchun bitta suhbatga NOTIFY_COOLDOWN_MS ichida faqat bitta
 * bildirishnoma ketadi: birinchisi darrov boradi, keyingilari odam
 * javob bermaguncha jim turadi.
 */
const NOTIFY_COOLDOWN_MS = 15 * 60 * 1000;
const NOTIFY_PREVIEW = 120;

const notifyNewMessage = async (fromIdentity, toIdentity, text) => {
  try {
    const key = `chatNotifiedAt:${toIdentity}:${fromIdentity}`;
    const last = Number(await kvGet(key)) || 0;
    if (Date.now() - last < NOTIFY_COOLDOWN_MS) return;

    // Yuboruvchi nomi: bor bo'lsa @username, bo'lmasa ko'rsatiladigan ism.
    let sender = '';
    try {
      const raw = await kvGet(`profile:${fromIdentity}`);
      const profile = raw ? JSON.parse(raw) : null;
      if (profile) sender = profile.username ? `@${profile.username}` : (profile.displayName || '');
    } catch {
      // ismsiz ham yuboraveramiz
    }

    const preview = text.length > NOTIFY_PREVIEW ? `${text.slice(0, NOTIFY_PREVIEW)}…` : text;
    const sent = await notifyUser(toIdentity, {
      category: 'chat',
      text: `<b>Yangi xabar</b>${sender ? ` — ${esc(sender)}` : ''}\n\n${esc(preview)}`,
    });
    // Vaqtni faqat haqiqatan yuborilganda belgilaymiz, aks holda
    // Telegram'i yo'q foydalanuvchi uchun ham "sovish" hisoblanardi.
    if (sent) await kvSet(key, String(Date.now()));
  } catch (err) {
    console.error('chat notify failed:', err.message);
  }
};

const sendMessage = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const myEmail = await resolveEmail({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData, phoneToken: body.phoneToken });
  if (!myEmail) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });
  if (await kvSismember('banned', myEmail.toLowerCase())) {
    return res.status(403).json({ error: 'Sizga xizmatdan foydalanish cheklangan' });
  }

  const toUsername = String(body.toUsername || '').trim().toLowerCase();
  const text = String(body.text || '').trim().slice(0, MAX_TEXT);
  const hasMedia = Boolean(body.media && body.media.dataUrl);
  if (!toUsername) return res.status(400).json({ error: 'Kimga yuborishni tanlang' });
  /* Fayl bo'lsa matn shart emas: ovozli xabarda matn umuman
     bo'lmaydi, rasmda esa izoh ixtiyoriy. */
  if (!text && !hasMedia) return res.status(400).json({ error: 'Xabar matnini yozing' });

  const toEmail = await kvGet(`username:${toUsername}`);
  if (!toEmail) return res.status(404).json({ error: 'Bunday foydalanuvchi topilmadi' });
  if (toEmail === myEmail) return res.status(400).json({ error: 'O‘zingizga yozib bo‘lmaydi' });

  if (isThrottled(myEmail)) return res.status(429).json({ error: 'Biroz kuting va qayta urinib ko‘ring' });

  /* Javob berilayotgan xabar. Faqat SHU ikki odamning yozishmasidagi
     xabarga javob bo'lishi mumkin: aks holda begona yozishmadagi
     xabarning id'sini yuborib, uning matnini ko'rish mumkin bo'lardi. */
  let replyTo = null;
  const replyId = String(body.replyTo || '').slice(0, 64);
  if (replyId) {
    const nishon = parseMessage(await kvGet(`msg:${replyId}`));
    const shuSuhbat = nishon
      && (nishon.from === myEmail || nishon.to === myEmail)
      && (nishon.from === toEmail || nishon.to === toEmail);
    if (shuSuhbat) replyTo = nishon.id;
  }

  /* Biriktirilgan fayl. Saqlash sozlanmagan bo'lsa — ochiq
     aytiladi. "Yuborildi" deb ko'rsatib, aslida hech qayerga
     yozmaslik eng yomon yo'l bo'lardi. */
  let media = null;
  if (hasMedia) {
    if (!storageConfigured()) {
      return res.status(503).json({ error: 'Fayl yuborish hozircha ishlamayapti' });
    }
    const uploaded = await uploadMedia(body.media.dataUrl, 'chat', MAX_MEDIA_BYTES);
    if (!uploaded || uploaded.error) {
      return res.status(400).json({ error: (uploaded && uploaded.error) || 'Fayl yuborilmadi' });
    }
    const nom = String(body.media.name || '').trim().slice(0, MAX_FILE_NAME).replace(/[\r\n\t]/g, ' ');
    const sek = Number(body.media.duration);
    media = {
      kind: uploaded.kind,
      url: uploaded.url,
      type: uploaded.type,
      size: uploaded.size,
      name: uploaded.kind === 'file' ? (nom || 'hujjat') : nom,
      duration: Number.isFinite(sek) && sek > 0 ? Math.min(Math.round(sek), MAX_VOICE_SECONDS) : null,
    };
  }

  const id = generateId();
  const message = { id, from: myEmail, to: toEmail, text, at: Date.now(), editedAt: null, deleted: false, reactions: {}, replyTo, media };

  const saved = await kvSet(`msg:${id}`, JSON.stringify(message));
  if (!saved) return res.status(500).json({ error: 'Yuborilmadi, qayta urinib ko‘ring' });
  await kvPush(pairKey(myEmail, toEmail), id);
  await bumpVer(myEmail, toEmail);
  await kvIncr(unreadKey(toEmail, myEmail)).catch(() => {});
  await kvSadd(`inbox:${myEmail}`, toEmail);
  await kvSadd(`inbox:${toEmail}`, myEmail);

  /* Bildirishnomada matn bo'lmasa, nima kelgani aytiladi —
     "bo'sh xabar" ko'rinmasin. */
  await notifyNewMessage(myEmail, toEmail, text || mediaLabel(media));

  return res.status(200).json({ ok: true, id });
};

/** Shared guard for edit/delete/react: loads the message and checks the caller is a participant. */
const loadOwnMessage = async (req, res, { requireSender } = {}) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const myEmail = await resolveEmail({ googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData, phoneToken: body.phoneToken });
  if (!myEmail) {
    res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });
    return null;
  }

  const id = String(body.id || '');
  if (!id) {
    res.status(400).json({ error: 'Xabar topilmadi' });
    return null;
  }
  const message = parseMessage(await kvGet(`msg:${id}`));
  if (!message) {
    res.status(404).json({ error: 'Xabar topilmadi' });
    return null;
  }
  const isParticipant = message.from === myEmail || message.to === myEmail;
  if (!isParticipant || (requireSender && message.from !== myEmail)) {
    res.status(403).json({ error: 'Bu amalga huquqingiz yo‘q' });
    return null;
  }

  return { myEmail, id, message, body };
};

const editMessage = async (req, res) => {
  const ctx = await loadOwnMessage(req, res, { requireSender: true });
  if (!ctx) return;
  const { id, message, body } = ctx;
  if (message.deleted) return res.status(400).json({ error: 'O‘chirilgan xabarni tahrirlab bo‘lmaydi' });

  const text = String(body.text || '').trim().slice(0, MAX_TEXT);
  if (!text) return res.status(400).json({ error: 'Xabar matnini yozing' });

  message.text = text;
  message.editedAt = Date.now();
  const saved = await kvSet(`msg:${id}`, JSON.stringify(message));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });

  await bumpVer(message.from, message.to);
  return res.status(200).json({ ok: true });
};

/**
 * O'chirish ikki xil bo'ladi.
 *
 * HAMMA UCHUN (`delete`) — xabarning o'zi o'chadi, ikkala
 * tomonda ham. Shuning uchun uni faqat YOZGAN odam qila oladi:
 * boshqaning gapini o'chirib tashlash huquqi hech kimda yo'q.
 *
 * FAQAT O'ZIM UCHUN (`hide`) — xabar joyida qoladi, shunchaki
 * shu odamning ro'yxatida ko'rinmaydi. Buni ikkala tomon ham
 * qila oladi va bir-biriga ta'sir qilmaydi: siz yashirsangiz,
 * suhbatdoshingiz baribir ko'rib turaveradi. Yashirilganlar
 * `hidden:<odam>` to'plamida saqlanadi va yozishma o'qilganda
 * chetlab o'tiladi.
 */
const hiddenKey = (identity) => `hidden:${identity}`;

/** So'rovdagi id lar ro'yxati. Bitta `id` ham qabul qilinadi. */
const idsFromBody = (body) => {
  const raw = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : []);
  return raw.map((x) => String(x || '')).filter(Boolean).slice(0, 50);
};

const deleteMessages = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const myEmail = await resolveEmail({
    googleIdToken: body.googleIdToken, telegramInitData: body.telegramInitData, phoneToken: body.phoneToken,
  });
  if (!myEmail) return res.status(401).json({ error: 'Avval Google yoki Telegram orqali kiring' });

  const ids = idsFromBody(body);
  if (!ids.length) return res.status(400).json({ error: 'Xabar topilmadi' });

  /* `forMe` — faqat o'zi uchun yashirish. Bo'lmasa, hamma uchun
     o'chirish: unda har bir xabar SHU ODAMNIKI bo'lishi shart. */
  const forMe = Boolean(body.forMe);
  let juftlik = null;
  let tegildi = 0;

  for (const id of ids) {
    const message = parseMessage(await kvGet(`msg:${id}`));
    if (!message) continue;
    const isParticipant = message.from === myEmail || message.to === myEmail;
    if (!isParticipant) continue;
    if (!forMe && message.from !== myEmail) continue;   // begonanikini o'chirib bo'lmaydi

    if (forMe) {
      await kvSadd(hiddenKey(myEmail), id);
    } else {
      const fayl = message.media;
      message.deleted = true;
      message.text = '';
      message.media = null;
      if (!(await kvSet(`msg:${id}`, JSON.stringify(message)))) continue;
      /* Xabar o'chdi — biriktirilgan fayl ham omborda qolmasin.
         Xatosi jim o'tadi: xabarning o'zi allaqachon o'chgan. */
      if (fayl && fayl.url) await deleteObject(keyFromUrl(fayl.url)).catch(() => {});
    }
    juftlik = [message.from, message.to];
    tegildi += 1;
  }

  if (!tegildi) return res.status(403).json({ error: 'Bu amalga huquqingiz yo‘q' });
  if (juftlik) await bumpVer(juftlik[0], juftlik[1]);
  return res.status(200).json({ ok: true, count: tegildi });
};

const reactToMessage = async (req, res) => {
  const ctx = await loadOwnMessage(req, res);
  if (!ctx) return;
  const { myEmail, id, message, body } = ctx;
  if (message.deleted) return res.status(400).json({ error: 'O‘chirilgan xabarga reaksiya qo‘yib bo‘lmaydi' });

  const emoji = String(body.emoji || '');
  if (!REACTIONS.includes(emoji)) return res.status(400).json({ error: 'Noto‘g‘ri reaksiya' });

  message.reactions = message.reactions || {};
  const holders = message.reactions[emoji] || [];
  const idx = holders.indexOf(myEmail);
  if (idx === -1) holders.push(myEmail);
  else holders.splice(idx, 1);
  message.reactions[emoji] = holders;

  const saved = await kvSet(`msg:${id}`, JSON.stringify(message));
  if (!saved) return res.status(500).json({ error: 'Saqlanmadi, qayta urinib ko‘ring' });

  await bumpVer(message.from, message.to);
  return res.status(200).json({ ok: true });
};

export default async function handler(req, res) {
  const action = String(req.query.action || '');

  if (req.method === 'GET') {
    if (action === 'search') return searchUsers(req, res);
    if (action === 'inbox') return getInbox(req, res);
    if (action === 'thread') return getThread(req, res);
    if (action === 'ai-list') return aiListThreads(req, res);
    if (action === 'ai-thread') return aiGetThread(req, res);
    return res.status(400).json({ error: 'Noto‘g‘ri action' });
  }
  if (req.method === 'POST') {
    if (action === 'send') return sendMessage(req, res);
    if (action === 'edit') return editMessage(req, res);
    if (action === 'delete') return deleteMessages(req, res);
    if (action === 'react') return reactToMessage(req, res);
    if (action === 'pin') return setPin(req, res);
    if (action === 'hide') return hideConversation(req, res);
    if (action === 'ask') return askAi(req, res);
    if (action === 'ai-save') return aiSaveThread(req, res);
    if (action === 'ai-del') return aiDeleteThread(req, res);
    return res.status(400).json({ error: 'Noto‘g‘ri action' });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
