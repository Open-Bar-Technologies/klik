// Service worker : l'app fonctionne hors-ligne (salle de concert sans réseau).
// Le cache porte le numéro de version : changer VERSION modifie ce fichier, ce que tous les
// navigateurs détectent. La nouvelle app s'installe en arrière-plan, puis l'utilisateur
// l'active avec le bandeau « Mettre à jour ».
//
// SOURCE UNIQUE DE LA VERSION : à incrémenter à CHAQUE modification déployée.
const VERSION = '0.11.0';

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
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
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
