/**
 * YO'LDA service worker.
 *
 * Maqsad — ilovani o'rnatiladigan (PWA) qilish va tarmoq uzilganda ham
 * ochilishini ta'minlash. Bu yerda hech qanday ma'lumot keshlanmaydi:
 *
 *   - /api/* umuman tegilmaydi. Buyurtmalar, profil, chat va e'lonlar
 *     doim jonli javob bo'lishi kerak; eski javobni ko'rsatish yolg'on
 *     ma'lumot bo'lardi.
 *   - Boshqa domenlar (Google OAuth, Telegram, xarita plitkalari)
 *     ham tegilmaydi — ular brauzerning o'ziga qoldiriladi.
 *   - /admin ham chetlab o'tiladi: u ichki vosita, offlayn ishlashi
 *     shart emas va eski nusxasi chalg'itishi mumkin.
 *
 * Keshlanadigan yagona narsa — ilova qobig'i (HTML va ikonkalar).
 *
 * CACHE_VERSION o'zgarganda eski kesh butunlay o'chiriladi. Sayt
 * yangilanganda shu raqamni oshirish kerak.
 */
// v2: "navigate" so'rovi endi har qanday sahifani qobiq deb
// saqlamaydi — eski keshda noto'g'ri qobiq qolgan bo'lishi mumkin.
// v4: egasi qo'ygan ikonkalar ham keshlanadi (pastga qarang).
// v5: ular endi saytning o'z manzilidan keladi — eski manzildagi
//     nusxalar keraksiz.
// v6: belgi almashdi. Fayllarning NOMIGA ham `-v2` qo'shildi, chunki
//     `/icons/` bir yilga keshlanadi: nomi o'zgarmasa, brauzer eskisini
//     ko'rsatib yuraverardi.
// v7: ilova endi yangilikni SHU FAYLDAN emas, serverdan so'raydi
//     (index.html, `watchBuild`). Raqam shuning uchun oshirildi:
//     telefonda turgan eski nusxa aynan shu fayl almashganda
//     boshqaruv almashganini ko'radi va bir marta qayta yuklanib
//     yangi yo'lga o'tadi. Undan keyin bu raqamga bog'liq
//     bo'lmaydi.
// v8: eski nusxa javob bermasa, u MAJBURAN qayta yuklanadi
//     (pastdagi `nudgeClients`).
const CACHE_VERSION = 'yolda-v8';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192-v2.png',
  '/icons/icon-512-v2.png',
  '/icons/apple-touch-icon-v2.png',
];

/* Bu O'RNATISH emas, YANGILANISH bo'ldimi.
   Birinchi marta kirgan odamning sahifasini qo'zg'atish mantiqsiz:
   unda allaqachon eng yangi kod turibdi (u hozirgina yuklandi).
   Eski kesh bor bo'lsa — demak bu yerda avvalgi nusxa bo'lgan. */
let yangilanish = false;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => { yangilanish = keys.length > 0; })
      .then(() => caches.open(CACHE_VERSION))
      // Bitta fayl yuklanmasa ham o'rnatish buzilmasin — qobiq keyingi
      // tashrifda to'ldiriladi.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

/* ============================================================
   ESKI NUSXANI QO'ZG'ATISH
   ------------------------------------------------------------
   MUAMMO. O'rnatilgan ilova kunlab ochiq turadi va sahifa
   qaytadan yuklanmaydi. Yangi sahifalar yangilikni o'zi
   sezadi (index.html, `watchBuild`), lekin TELEFONDA ALLAQACHON
   TURGAN eski nusxa buni bilmaydi — unda hali o'sha eski kod.

   Shuning uchun yangi xizmat fayli ishga tushganda hamma ochiq
   oynaga xabar yuboriladi. Yangi kod javob qaytaradi va o'zi
   qulay paytda yangilanadi (forma to'ldirilayotgan bo'lsa
   kutadi). Javob kelmasa — demak u yerda eski kod turibdi va
   boshqa yo'l yo'q: oyna majburan qayta yuklanadi.

   Bu faqat xizmat fayli ALMASHGANDA, ya'ni juda kamdan-kam
   bo'ladi. /admin esa tegilmaydi: u ichki vosita, u yerda ish
   ketayotgan bo'lishi mumkin.
   ============================================================ */
const ACK_WAIT = 5000;
const acked = new Set();

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'VERSION_ACK' && event.source) acked.add(event.source.id);
});

const nudgeClients = async () => {
  const windows = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const list = (await windows()).filter((c) => c.url.indexOf('/admin') === -1);
  if (!list.length) return;

  acked.clear();
  list.forEach((c) => c.postMessage({ type: 'NEW_VERSION' }));
  await new Promise((done) => setTimeout(done, ACK_WAIT));

  const qolgan = (await windows()).filter((c) => c.url.indexOf('/admin') === -1);
  for (const c of qolgan) {
    if (acked.has(c.id) || !('navigate' in c)) continue;
    try { await c.navigate(c.url); } catch (err) { /* oyna yopilgan bo'lishi mumkin */ }
  }
};

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => (yangilanish ? nudgeClients() : undefined)),
  );
});

/* ============================================================
   Egasi qo'ygan ikonkalar
   ------------------------------------------------------------
   Ular `/icon/...` manzilidan keladi — saytning o'zidan. Fayl
   omborda qoladi, lekin uni brauzer emas, server olib keladi.
   Ilova ochilganda baribir ellikka yaqin so'rov bo'ladi, ya'ni
   internet sust bo'lsa rasm kechikadi yoki umuman kelmaydi.

   KELMASA — IKONKA UMUMAN KO'RINMAYDI. Rasm niqob (`mask`) ichida
   turadi: niqob bo'sh bo'lsa, ustidagi shakl butunlay qirqib
   tashlanadi. "Buzuq rasm" belgisi ham chiqmaydi, shunchaki
   bo'shliq qoladi.

   Shuning uchun ular keshlanadi. Rasm nomida uning mazmuni xeshi
   bor — ya'ni manzil o'zgarmasa, rasm ham o'zgarmagan. Demak bir
   marta olingach, qayta so'rashning hojati yo'q: doim keshdan
   beriladi va ikkinchi tashrifdan boshlab tarmoqqa umuman
   bog'liq bo'lmaydi.
   ============================================================ */
/* Eski ombor manzili ham qoldirilgan: keshdan ochilgan eski
   sahifa hali o'shani so'raydi. */
const ICON_HOST = 'pub-9727192a07cd47c1a25898c5abe5c4a9.r2.dev';
const isIconImage = (url) =>
  (url.origin === self.location.origin && url.pathname.startsWith('/icon/'))
  || (url.hostname === ICON_HOST && url.pathname.startsWith('/icon/'));

/** Shu so'rovga umuman aralashmaymizmi? */
const isBypassed = (request, url) =>
  request.method !== 'GET' ||
  (url.origin !== self.location.origin && !isIconImage(url)) ||
  url.pathname.startsWith('/api/') ||
  url.pathname.startsWith('/admin');

/**
 * Shu manzil ilovaning o'zimi?
 *
 * Saytda ilovadan tashqari oddiy sahifalar ham bor (masalan
 * /maxfiylik — Play Market so'ragan ochiq hujjat). Ular ham
 * "navigate" so'rovi bilan ochiladi, lekin ilova qobig'i emas:
 * ularning javobini qobiq o'rniga keshga qo'yib yuborilsa,
 * internet uzilganda ilova o'rniga o'sha sahifa ochilardi.
 */
const isAppShell = (url) => url.pathname === '/' || url.pathname === '/index.html';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (isBypassed(event.request, url)) return;

  /* Ikonka: avval kesh, so'ng tarmoq. Boshqa fayllardan farqi —
     orqa fonda yangilanmaydi: manzili o'zgarmaguncha rasm ham
     o'zgarmaydi, ya'ni qayta so'rash bekorga tarmoq sarflash
     bo'lardi.

     Javob "opaque" bo'lishi mumkin (boshqa domen, `no-cors`):
     uning holati 0, `ok` esa false. Shunga qaramay u yaroqli
     rasm — shuning uchun alohida tekshiriladi. */
  if (isIconImage(url)) {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request).then((response) => {
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })),
    );
    return;
  }

  // Sahifa ochilishi: avval tarmoq (yangi versiya darrov ko'rinsin),
  // internet bo'lmasa — keshdagi qobiq.
  if (event.request.mode === 'navigate') {
    const shell = isAppShell(url);
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Faqat ilovaning o'zi qobiq sifatida saqlanadi. Boshqa
          // sahifalar o'z manzili bilan keshlanadi — tarmoqsiz ham
          // ochiladi, lekin ilovaning o'rnini egallamaydi.
          if (response && response.ok) {
            const copy = response.clone();
            const key = shell ? '/index.html' : event.request;
            caches.open(CACHE_VERSION).then((cache) => cache.put(key, copy));
          }
          return response;
        })
        .catch(() => (shell
          ? caches.match('/index.html').then((hit) => hit || caches.match('/'))
          : caches.match(event.request).then((hit) => hit || caches.match('/index.html')))),
    );
    return;
  }

  // Qolgan statik fayllar: keshdan darrov beramiz, orqa fonda yangilaymiz.
  event.respondWith(
    caches.match(event.request).then((hit) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});

/* ============================================================
   Push bildirishnoma
   ------------------------------------------------------------
   Server shifrlangan xabar yuboradi, brauzer uni ochib shu
   yerga beradi. Ichida uchta narsa bo'ladi: sarlavha, matn va
   bosilganda ochiladigan havola.

   XABAR BUZUQ BO'LSA HAM BILDIRISHNOMA CHIQADI. Brauzer
   "push" hodisasidan keyin hech narsa ko'rsatilmasa, ba'zi
   tizimlar o'zining "Yangi xabar" degan yozuvini chiqaradi —
   undan ko'ra o'zimizning umumiy yozuvimiz yaxshiroq.
   ============================================================ */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || "YO'LDA";
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192-v2.png',
    badge: '/icons/icon-192-v2.png',
    // Bir xil turkumdagi xabar eskisining ustiga tushadi —
    // ekranni bir xil bildirishnoma bilan to'ldirmaslik uchun.
    tag: data.tag || 'yolda',
    renotify: true,
    data: { link: data.link || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/* Bosilganda — ilova allaqachon ochiq bo'lsa o'sha oynani
   ko'taramiz, bo'lmasa yangisini ochamiz. Ikkinchi nusxa
   ochilishi odamni chalg'itadi. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
          if ('navigate' in client && link && link !== '/') {
            return client.navigate(link).then((c) => (c || client).focus());
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});

/* Obuna yangilanganda (brauzer kalitni almashtiradi) eski yozuv
   yaroqsiz bo'lib qoladi. Sahifa ochilganda u o'zi qayta obuna
   bo'ladi — shuning uchun bu yerda faqat belgilab qo'yamiz. */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      list.forEach((c) => c.postMessage({ type: 'PUSH_RESUBSCRIBE' }));
    }),
  );
});
