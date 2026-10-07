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
const CACHE_VERSION = 'yolda-v2';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // Bitta fayl yuklanmasa ham o'rnatish buzilmasin — qobiq keyingi
      // tashrifda to'ldiriladi.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Shu so'rovga umuman aralashmaymizmi? */
const isBypassed = (request, url) =>
  request.method !== 'GET' ||
  url.origin !== self.location.origin ||
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

// Sahifa "yangi versiyani hoziroq qo'y" deb aytsa.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
