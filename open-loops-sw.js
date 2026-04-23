const CACHE = 'open-loops-v2-responsive';

const ASSETS = [
  './open-loops.html',
  './open-loops-config.js',
  './open-loops-manifest.json',
  './open-loops-icon-192.png',
  './open-loops-icon-512.png'
];

const EXTERNAL_HOSTS = [
  'supabase.co',
  'jsdelivr.net',
  'fonts.googleapis',
  'fonts.gstatic',
  'accounts.google'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  const url = event.request.url;
  if (EXTERNAL_HOSTS.some(host => url.includes(host))) {
    event.respondWith(fetch(event.request).catch(() => new Response('Offline', { status: 503 })));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      });
    }).catch(() => caches.match('./open-loops.html'))
  );
});
