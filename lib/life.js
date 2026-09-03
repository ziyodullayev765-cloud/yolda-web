/**
 * YO'LDA LIFE mazmuni — audio, video va matnli yozuvlar.
 *
 * Media faylning o'zi bu yerda saqlanmaydi va saqlanmasligi kerak:
 * Vercel'ning oylik trafigi 100 GB, bitta 45 daqiqalik podkast esa
 * ~21 MB. Ya'ni bir necha ming tinglashdan keyin butun sayt o'chadi,
 * faqat bu bo'lim emas. Shuning uchun bazada faqat havola turadi:
 * video — YouTube'da, audio — Telegram kanalida yoki obyekt xotirasida
 * (masalan Cloudflare R2, uning chiqish trafigi bepul).
 *
 * Kalitlar: `life_ids` to'plami + har biri uchun `life:<id>` — mashina
 * e'lonlaridagi (`truck_ids` / `truck:<id>`) bilan bir xil tartib.
 */

export const KINDS = ['AUDIO', 'VIDEO', 'LINK'];

export const KIND_LABELS = {
  AUDIO: 'Audio / musiqa',
  VIDEO: 'Video',
  LINK: 'Havola',
};

/** Ilovadagi turkumlar qatori bilan bir xil. */
export const CATEGORIES = ['audio', 'news', 'community', 'stories'];

export const CATEGORY_LABELS = {
  audio: 'Audio',
  news: 'Yangiliklar',
  community: 'Hamjamiyat',
  stories: 'Stories',
};

export const LIMITS = {
  title: 120,
  description: 400,
  author: 80,
  url: 600,
  coverUrl: 600,
  durationMin: 600,
};

/**
 * YouTube havolasidan video identifikatorini ajratadi. Uchala ko'rinish
 * ham qo'llab-quvvatlanadi: to'liq havola, qisqa havola va Shorts.
 * Topilmasa null — chaqirgan joyda bu "havola noto'g'ri" degani.
 */
export const youtubeId = (url) => {
  const s = String(url || '').trim();
  if (!s) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const id = (v) => (/^[A-Za-z0-9_-]{11}$/.test(String(v || '')) ? String(v) : null);

  if (host === 'youtu.be') return id(u.pathname.slice(1).split('/')[0]);
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') return id(u.searchParams.get('v'));
    const m = u.pathname.match(/^\/(?:embed|shorts|v|live)\/([^/?#]+)/);
    if (m) return id(m[1]);
  }
  return null;
};

/** Faqat https qabul qilinadi — http havola ilovada aralash mazmun beradi. */
const httpsUrl = (v, max) => {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.length > max) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
};

const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/**
 * Admin yuborgan yozuvni tekshiradi va saqlanadigan shaklga keltiradi.
 * Xato bo'lsa {error} qaytaradi — chaqirgan joy uni foydalanuvchiga
 * ko'rsatadi, jim tuzatib qo'ymaydi.
 */
export const normalise = (input, existing) => {
  const body = input && typeof input === 'object' ? input : {};
  const prev = existing && typeof existing === 'object' ? existing : null;

  const kind = String(body.kind || (prev && prev.kind) || '').toUpperCase();
  if (!KINDS.includes(kind)) return { error: 'Tur noto‘g‘ri' };

  const category = String(body.category || (prev && prev.category) || '').toLowerCase();
  if (!CATEGORIES.includes(category)) return { error: 'Turkum noto‘g‘ri' };

  const title = clean(body.title !== undefined ? body.title : prev && prev.title, LIMITS.title);
  if (title.length < 2) return { error: 'Sarlavha juda qisqa' };

  const rawUrl = body.url !== undefined ? body.url : (prev && prev.url);
  const url = httpsUrl(rawUrl, LIMITS.url);
  if (url === null) return { error: 'Havola https bilan boshlanishi kerak' };
  if (!url) return { error: 'Havola kerak' };

  // Video uchun havola YouTube bo'lishi shart: boshqa xizmatni ilova
  // ichida chala olmaymiz, ya'ni saqlansa ham ochilmaydigan yozuv
  // bo'lib qolardi.
  let videoId = '';
  if (kind === 'VIDEO') {
    videoId = youtubeId(url) || '';
    if (!videoId) return { error: 'Video havolasi YouTube bo‘lishi kerak' };
  }

  const coverUrl = httpsUrl(body.coverUrl !== undefined ? body.coverUrl : (prev && prev.coverUrl), LIMITS.coverUrl);
  if (coverUrl === null) return { error: 'Muqova havolasi https bo‘lishi kerak' };

  const rawMin = body.durationMin !== undefined ? body.durationMin : (prev && prev.durationMin);
  const durationMin = rawMin === '' || rawMin == null ? 0 : Number(rawMin);
  if (!Number.isFinite(durationMin) || durationMin < 0 || durationMin > LIMITS.durationMin) {
    return { error: 'Davomiylik 0 dan 600 daqiqagacha bo‘lsin' };
  }

  const rawOrder = body.order !== undefined ? body.order : (prev && prev.order);
  const order = rawOrder === '' || rawOrder == null ? 0 : Number(rawOrder);
  if (!Number.isFinite(order) || order < -999 || order > 999) {
    return { error: 'Tartib -999 dan 999 gacha bo‘lsin' };
  }

  const bool = (v, fallback) => (v === undefined ? Boolean(fallback) : Boolean(v));
  const now = Date.now();

  return {
    item: {
      id: (prev && prev.id) || `lf_${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      kind,
      category,
      title,
      description: clean(body.description !== undefined ? body.description : prev && prev.description, LIMITS.description),
      author: clean(body.author !== undefined ? body.author : prev && prev.author, LIMITS.author),
      url,
      videoId,
      coverUrl,
      durationMin: Math.round(durationMin),
      order: Math.round(order),
      featured: bool(body.featured, prev && prev.featured),
      published: bool(body.published, prev ? prev.published : true),
      createdAt: (prev && prev.createdAt) || now,
      updatedAt: now,
    },
  };
};

/** Ilovaga chiqadigan shakl — ichki maydonlarsiz. */
export const publicShape = (item) => ({
  id: item.id,
  kind: item.kind,
  category: item.category,
  title: item.title,
  description: item.description || '',
  author: item.author || '',
  url: item.url,
  videoId: item.videoId || '',
  coverUrl: item.coverUrl || '',
  durationMin: item.durationMin || 0,
  featured: Boolean(item.featured),
  createdAt: item.createdAt || 0,
});

/**
 * Ko'rsatish tartibi: avval `order` (kattasi tepada), keyin yangisi.
 * Bir xil tartibdagilar orasida yangisi oldinda tursin.
 */
export const sortItems = (list) => list.slice().sort((a, b) => {
  const byOrder = (b.order || 0) - (a.order || 0);
  if (byOrder) return byOrder;
  return (b.createdAt || 0) - (a.createdAt || 0);
});
