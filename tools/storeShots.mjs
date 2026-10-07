/**
 * Play Market uchun ekran rasmlari.
 *
 *     node tools/storeShots.mjs
 *
 * Rasmlar ilovaning O'ZIDAN olinadi — chizilgan maket emas. Play
 * qoidasi ham shuni talab qiladi: ekran rasmi ilovada haqiqatan
 * ko'rinadigan narsani ko'rsatishi kerak.
 *
 * Ma'lumot soxta emas, namunaviy: haqiqiy bazadan olinsa, rasmda
 * begona odamlarning ismi va telefon raqami turardi. Shuning uchun
 * so'rovlar shu fayldagi namuna javoblar bilan almashtiriladi —
 * ekranning o'zi, chizig'i, rangi va joylashuvi esa haqiqiy.
 *
 * Play talabi: eng kamida 2 ta telefon rasmi, qisqa tomoni 320 px
 * dan kam emas, uzun tomoni 3840 px dan ko'p emas. 1080x1920
 * ikkalasiga ham kiradi va eng keng tarqalgan o'lcham.
 */
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(repoRoot, 'store', 'screenshots');
const BASE = process.env.SHOT_BASE || 'http://127.0.0.1:8942';

/* 1080x2340 — hozirgi telefonlarning eng keng tarqalgan nisbati
   (9:19.5). Play chegarasi ichida: qisqa tomoni 320 px dan katta,
   uzuni 3840 px dan kichik.

   360x780 CSS px uchligiga ko'paytirilgan: matn haqiqiy
   telefondagidek zichlikda chiqadi, cho'zilgan ko'rinmaydi.
   Past bo'yli oyna (masalan 640) olinsa, kartalarning yarmi
   kesilib qolardi. */
const VIEW = { width: 360, height: 780 };
const SCALE = 3;

const now = Date.now();
const hour = 3600000;

const CONFIG = {
  googleClientId: '', telegramBotUsername: 'yolda_bot',
  platformName: "YO'LDA", maintenanceMode: false, icons: {},
};

const LOADS = [
  { code: 'YL4821', fromCity: 'Toshkent', toCity: 'Samarqand', cargoType: 'FOOD',
    weightKg: 12000, amount: 2400000, distanceKm: 300, truckType: 'Fura',
    pickupDate: '2026-10-12', status: 'NEW', createdAt: now - hour },
  { code: 'YL4822', fromCity: 'Buxoro', toCity: 'Nukus', cargoType: 'CONSTRUCTION',
    weightKg: 20000, amount: 3100000, distanceKm: 550, truckType: 'Samosval',
    pickupDate: '2026-10-13', status: 'NEW', createdAt: now - 3 * hour },
  { code: 'YL4823', fromCity: 'Andijon', toCity: 'Toshkent', cargoType: 'GENERAL',
    weightKg: 8000, amount: 1850000, distanceKm: 320, truckType: 'Tent',
    pickupDate: '2026-10-12', status: 'NEW', createdAt: now - 5 * hour },
  { code: 'YL4824', fromCity: 'Qarshi', toCity: 'Termiz', cargoType: 'AGRICULTURE',
    weightKg: 15000, amount: 1200000, distanceKm: 280, truckType: 'Refrijerator',
    pickupDate: '2026-10-14', status: 'NEW', createdAt: now - 8 * hour },
  { code: 'YL4825', fromCity: 'Namangan', toCity: 'Buxoro', cargoType: 'FURNITURE',
    weightKg: 6000, amount: 2050000, distanceKm: 650, truckType: 'Fura',
    pickupDate: '2026-10-15', status: 'NEW', createdAt: now - 11 * hour },
];

const MY_LOAD = {
  code: 'YL4821', fromCity: 'Toshkent', toCity: 'Samarqand',
  fromAddress: 'Chilonzor 5-kvartal', toAddress: 'Registon ko‘chasi 3',
  fromPoint: null, toPoint: null,
  cargoType: 'FOOD', customCargoLabel: '',
  weightKg: 12000, volumeM3: 18, quantity: null, quantityUnit: '',
  truckType: 'Fura', pickupDate: '2026-10-12',
  distanceKm: 300, amount: 2400000, agreed: true, comment: '',
  status: 'LOADED', statusLabel: 'Yuklandi',
  nextStatus: 'ON_THE_WAY', nextLabel: "Yo'lga chiqdim",
  owner: { name: 'Alisher Qodirov', phone: '+998901234567', username: 'alisher', verified: true },
};

/* `price` — kartochka aynan shu nom bilan o'qiydi (truckCardHtml).
   Server ham narxni majburiy qiladi, ya'ni e'lon narxsiz bo'lmaydi. */
const TRUCKS = [
  { id: 't1', brand: 'MAN', model: 'TGX 18.440', year: 2019, price: 520000000,
    city: 'Toshkent', category: 'YUK', mileageKm: 480000, createdAt: now - hour, photos: [] },
  { id: 't2', brand: 'Isuzu', model: 'NQR 90', year: 2021, price: 355000000,
    city: 'Samarqand', category: 'FURGON', mileageKm: 120000, createdAt: now - 4 * hour, photos: [] },
  { id: 't3', brand: 'Shacman', model: 'X3000', year: 2020, price: 448000000,
    city: 'Buxoro', category: 'SAMOSVAL', mileageKm: 260000, createdAt: now - 9 * hour, photos: [] },
  { id: 't4', brand: 'Mercedes-Benz', model: 'Actros 1841', year: 2017, price: 486000000,
    city: 'Andijon', category: 'YUK', mileageKm: 610000, createdAt: now - 26 * hour, photos: [] },
];

const CONVERSATIONS = [
  { email: 'a@y.z', username: 'alisher', name: 'Alisher Qodirov', verified: true,
    lastText: 'Ertaga ertalab yuklaymiz, tayyormisiz?', lastAt: now - 12 * 60000, lastFromMe: false, unread: 2 },
  { email: 'b@y.z', username: 'dilshod', name: 'Dilshod Tursunov', verified: false,
    lastText: '2 400 000 ga roziман', lastAt: now - 2 * hour, lastFromMe: true, unread: 0 },
  { email: 'c@y.z', username: 'sardor', name: 'Sardor Yo‘ldoshev', verified: true,
    lastText: 'Yuk yetkazildi, rahmat!', lastAt: now - 26 * hour, lastFromMe: false, unread: 0 },
];

/** Har bir so'rovga namunaviy javob. Tarmoqqa hech narsa chiqmaydi. */
const route = async (page) => {
  await page.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== new URL(BASE).origin) return r.abort();
    return r.continue();
  });

  await page.route((u) => u.pathname.startsWith('/api/'), (r) => {
    const url = r.request().url();
    const json = (body) => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(body),
    });

    if (url.includes('/api/config')) return json(CONFIG);

    if (url.includes('/api/order')) {
      if (url.includes('action=my-load')) return json({ ok: true, load: MY_LOAD });
      if (url.includes('action=list')) {
        return json({ ok: true, loads: LOADS, counts: { total: LOADS.length } });
      }
      if (url.includes('action=stats')) {
        return json({ ok: true, openLoads: 128, drivers: 64, deliveredThisWeek: 41 });
      }
      return json({ ok: true, loads: [], counts: {} });
    }

    if (url.includes('/api/trucks')) {
      /* Saralanganlar alohida so'rov: ro'yxatni qaytarib yuborsak,
         hamma e'lon "saqlangan" bo'lib, yuraklar qizarib ketardi. */
      if (url.includes('action=favorites')) return json({ ok: true, trucks: [] });
      return json({ ok: true, trucks: TRUCKS, total: TRUCKS.length, counts: {} });
    }

    if (url.includes('/api/chat')) {
      if (url.includes('action=inbox')) return json({ conversations: CONVERSATIONS });
      return json({ users: [], conversations: [] });
    }

    if (url.includes('/api/profile')) {
      /* Reyting `ratingSum / ratingCount` dan hisoblanadi — server
         ikkalasini ham doim son qilib qaytaradi (api/profile.js).
         Shuning uchun bu yerda ham ikkalasi beriladi. */
      const profile = {
        username: 'bekzod', displayName: 'Bekzod Rahimov', role: 'DRIVER',
        city: 'Toshkent', phone: '+998901119988', vehicleType: 'Fura',
        verified: true, deliveredCount: 37,
        ratingCount: 31, ratingSum: 152,
        experienceYears: 7, bio: 'Toshkent — Samarqand yo‘nalishi bo‘yicha ishlayman.',
        createdAt: now - 400 * 24 * hour,
      };
      return json({ ok: true, profile, ...profile });
    }

    return json({ ok: true });
  });
};

const signedIn = async (page) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('yolda_auth', JSON.stringify({
        kind: 'phone',
        token: JSON.stringify({ token: 'T', profile: { name: 'Bekzod', phone: '+998901119988' } }),
        expiresAt: Date.now() + 86400000,
      }));
      // Ekran rasmida "ilovani o'rnating" taklifi turmasin.
      localStorage.setItem('yolda_install_dismissed', '1');
    } catch (e) {}
  });
};

/* Qaysi ekran olinadi. `tab` — bo'limning nomi, `after` esa
   rasm olishdan oldin bajariladigan qo'shimcha ish. */
const SHOTS = [
  { file: '1-home', tab: 'home' },
  { file: '2-loads', tab: 'loads' },
  { file: '3-myload', tab: 'myload' },
  { file: '4-trucks', tab: 'trucks' },
  { file: '5-chat', tab: 'chat' },
  { file: '6-profile', tab: 'profile' },
];

const run = async () => {
  mkdirSync(OUT, { recursive: true });
  /* Dasturiy GPU shart. Oddiy headless rejimda `backdrop-filter`
     UMUMAN chizilmaydi — CSS.supports "ha" deydi, ekranda esa hech
     narsa bo'lmaydi. Ya'ni pastki panelning shishasi rasmda
     ko'rinmay, ilova haqiqiy telefondagidan boshqacha chiqardi. */
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-gpu-rasterization'],
  });

  for (const theme of ['light']) {
    const ctx = await browser.newContext({
      viewport: VIEW,
      deviceScaleFactor: SCALE,
      locale: 'uz-UZ',
      colorScheme: theme,
      hasTouch: true,
      isMobile: true,
    });
    const page = await ctx.newPage();
    await signedIn(page);
    await route(page);

    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
    // Ochilish animatsiyasi 3.5 soniya — tugashini kutamiz.
    await page.waitForSelector('#splash', { state: 'detached', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(900);

    for (const shot of SHOTS) {
      await page.evaluate((tab) => {
        const b = document.createElement('button');
        b.setAttribute('data-tab-link', tab);
        document.body.appendChild(b); b.click(); b.remove();
      }, shot.tab);
      await page.waitForTimeout(1400);
      // Bildirishnoma qalqib chiqib rasmni buzmasin.
      await page.evaluate(() => {
        const h = document.getElementById('toastHost');
        if (h) h.innerHTML = '';
      });
      const file = join(OUT, `${shot.file}.png`);
      await page.screenshot({ path: file });
      console.log('olindi:', file);
    }

    await ctx.close();
  }

  await browser.close();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
