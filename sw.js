// Service worker : l'app fonctionne hors-ligne (salle de concert sans réseau).
// Le cache porte le numéro de version : changer VERSION modifie ce fichier, ce que tous les
// navigateurs détectent. La nouvelle app s'installe en arrière-plan, puis l'utilisateur
// l'active avec le bandeau « Mettre à jour ».
//
// SOURCE UNIQUE DE LA VERSION : à incrémenter à CHAQUE modification déployée.
const VERSION = '0.14.0';

const CACHE = 'klik-' + VERSION;
const FONT_CACHE = 'klik-fonts';
const ASSETS = [
  './',
  'index.html',
  'css/app.css',
  'js/i18n.js',
  'js/store.js',
  'js/engine.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  // Guide illustré (~0,5 Mo), disponible hors-ligne. La vidéo (video/) ne l'est pas : trop lourde.
  'guide.html',
  'guide/poster.webp',
  'guide/fr-01.webp',
  'guide/fr-02.webp',
  'guide/fr-03.webp',
  'guide/fr-04.webp',
  'guide/fr-05.webp',
  'guide/fr-06.webp',
  'guide/fr-07.webp',
  'guide/fr-08.webp',
  'guide/fr-09.webp',
  'guide/fr-10.webp',
  'guide/fr-11.webp',
  'guide/fr-12.webp',
  'guide/en-01.webp',
  'guide/en-02.webp',
  'guide/en-03.webp',
  'guide/en-04.webp',
  'guide/en-05.webp',
  'guide/en-06.webp',
  'guide/en-07.webp',
  'guide/en-08.webp',
  'guide/en-09.webp',
  'guide/en-10.webp',
  'guide/en-11.webp',
  'guide/en-12.webp',
];

// Chaque fichier est téléchargé avec ?v=VERSION : un cache intermédiaire (Cloudflare, proxy) qui
// garderait l'ancienne version ne peut pas la glisser dans la nouvelle. Il est rangé sous son
// adresse normale, que l'app demande.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => Promise.all(ASSETS.map(async url => {
      const res = await fetch(new Request(url + (url.includes('?') ? '&' : '?') + 'v=' + VERSION, { cache: 'reload' }));
      if (!res.ok) throw new Error(`${url} : ${res.status}`);
      await cache.put(url, res);
    })))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('klik-') && k !== CACHE && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data === 'version' && event.source) event.source.postMessage({ version: VERSION });
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Polices Google : mises en cache au premier chargement.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(cache => cache.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      })))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req, { ignoreSearch: true }).then(hit => {
        if (hit) return hit;
        if (req.mode === 'navigate') return cache.match('index.html').then(page => page || fetch(req));
        return fetch(req);
      })
    )
  );
});
