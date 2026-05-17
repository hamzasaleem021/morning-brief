// Morning Brief — Service Worker
// Cache version bumped on every release. External APIs are never cached.
const CACHE = 'morning-brief-v15';

const ASSETS = [
  './morning-brief.html',
  './privacy.html',
  './config.js',
  './discovery.js',
  './discovery-sources.json',
  './clippings.js',
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
    // Use {cache: 'reload'} to make sure the install pulls fresh copies,
    // not whatever an older SW happened to leave in the HTTP cache.
    caches.open(CACHE).then(c =>
      Promise.all(ASSETS.map(a =>
        fetch(a, { cache: 'reload' })
          .then(r => r.ok ? c.put(a, r) : null)
          .catch(() => null)        // clippings.js may 404 on first install — tolerate
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          // Keep the current shell cache AND the clippings-inbox cache.
          .filter(k => k !== CACHE && k !== 'clippings-inbox')
          .map(k => caches.delete(k))
      ))
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
  const url = new URL(e.request.url);

  // ─────────────────────────────────────────────────────────────────────
  // Clippings: Web Share Target intake.
  // Android Chrome POSTs the share payload here; we stash it in a Cache
  // and redirect the page to morning-brief.html#clippings/share, where
  // clippings.js reads it back and opens the save sheet.
  // ─────────────────────────────────────────────────────────────────────
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const fd = await e.request.formData();
        const payload = {
          title: fd.get('title') || '',
          text:  fd.get('text')  || '',
          url:   fd.get('url')   || '',
          at:    Date.now()
        };
        const cache = await caches.open('clippings-inbox');
        await cache.put(
          '/clippings-pending',
          new Response(JSON.stringify(payload), {
            headers: { 'Content-Type': 'application/json' }
          })
        );
        const target = new URL('./morning-brief.html#clippings/share', self.registration.scope).href;
        return Response.redirect(target, 303);
      } catch (err) {
        // If anything blows up, fall back to opening the app normally —
        // worst case the user loses the selection, never gets a stuck state.
        const fallback = new URL('./morning-brief.html', self.registration.scope).href;
        return Response.redirect(fallback, 303);
      }
    })());
    return;
  }

  // Non-GET requests bypass cache entirely.
  if (e.request.method !== 'GET') {
    e.respondWith(fetch(e.request));
    return;
  }

  // Network-only for external APIs — never cache these.
  if (EXTERNAL_HOSTS.some(h => url.href.includes(h))) {
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
