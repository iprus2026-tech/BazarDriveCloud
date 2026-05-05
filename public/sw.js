const VERSION    = 'v3';
const CACHE_NAME = `bazardrive-${VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/cloud.css',
  './src/app.js',
  './src/router.js',
  './src/state.js',
  './src/util.js',
  './src/mock_api.js',
  './src/screens/welcome.js',
  './src/screens/feed.js',
  './src/screens/rules.js',
  './src/screens/profile.js',
  './src/screens/onboarding.js',
  './src/screens/composer.js',
  './icons/icon.svg',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/prototypes/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((res) => {
          if (!res || res.status !== 200 || res.type !== 'basic') return res;
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
