// Morning Brief — Service Worker
// Cache version bumped on every release. External APIs are never cached.
const CACHE = 'morning-brief-v12';

const ASSETS = [
  './morning-brief.html',
  './privacy.html',
  './config.js',
  './discovery.js',
  './discovery-sources.json',
  './manifest.json'
];

// Hosts whose responses must always hit the network, never the cache.
const EXTERNAL_HOSTS = [
  'workers.dev',
  'supabase.co',
  'googleapis',
  'accounts.google',
  'fonts.googleapis',
  'fonts.gstatic',
  'amplitude.com'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
    // Intentionally NO skipWaiting — the page prompts the user first.
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page posts this message after the user confirms the update toast.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', e => {
  // Non-GET requests bypass cache entirely.
  if (e.request.method !== 'GET') {
    e.respondWith(fetch(e.request));
    return;
  }

  // Network-only for external APIs — never cache these.
  const url = e.request.url;
  if (EXTERNAL_HOSTS.some(h => url.includes(h))) {
    e.respondWith(
      fetch(e.request).catch(() => new Response('Offline', { status: 503 }))
    );
    return;
  }

  // Cache-first for app shell, with careful revalidation.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Only cache successful, basic responses. Never cache errors or opaque.
        if (res && res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE)
            .then(c => c.put(e.request, clone))
            .catch(err => console.warn('SW cache put failed:', err));
        }
        return res;
      });
    }).catch(() => caches.match('./morning-brief.html'))
  );
});
