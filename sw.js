// Minimal offline cache so the game is installable/playable offline.
const CACHE = 'blacksite-v1';
const ASSETS = [
  '.', 'index.html', 'manifest.json', 'icon.svg',
  'vendor/three.module.js',
  'src/main.js', 'src/world.js', 'src/player.js', 'src/enemies.js',
  'src/weapons.js', 'src/textures.js', 'src/audio.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
