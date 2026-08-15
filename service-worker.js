/* ═══════════════════════════════════════════════════════════════════
   AttendX — Service Worker
   -----------------------------------------------------------------
   Provides the offline/installable behaviour for the AttendX PWA.
   Bumping CACHE_NAME below invalidates every previously cached asset
   on the next visit (old caches are swept in 'activate') — bump it
   whenever a deployed asset changes, so users don't get stuck on a
   stale cached version. All application DATA (students, records,
   settings) lives in localStorage, not in this cache — this file only
   caches the static app "shell" (HTML/CSS/JS/icons) and third-party
   assets, so the app can still load its UI with no network at all.
═══════════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'attendx-pwa-v1.3.2';

// Static assets critical for offline load.
// These are precached immediately on install so the very first offline
// visit after installation still has a working shell.
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

/* INSTALL
   Runs once when the service worker file is first loaded/updated.
   skipWaiting() forces this new worker to activate immediately instead
   of waiting for all open tabs of the old version to close — trades a
   theoretical mid-session asset mismatch for users always getting the
   latest shell promptly after a deploy. */
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Force the waiting service worker to become the active one
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
});

/* ACTIVATE
   Runs after install, once the new worker has taken over. Deletes any
   cache whose name doesn't match the current CACHE_NAME (i.e. caches
   left over from a previous deployed version), then clients.claim()
   lets this worker start controlling already-open tabs immediately
   rather than only new navigations. */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName); // Clean up old caches
          }
        })
      );
    }).then(() => self.clients.claim()) // Take control of all open pages
  );
});

/* FETCH
   Three different caching strategies depending on what's being
   requested — this is the heart of the offline behaviour: */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Navigation requests (loading the HTML page itself):
  //    NETWORK-FIRST, falling back to cache.
  //    Ensures a user with connectivity always gets the freshest
  //    index.html (so app updates are picked up), while a user who
  //    opens the installed app with no signal still gets the last
  //    successfully loaded copy from cache instead of a browser error
  //    page.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }

  // 2. Known third-party CDN origins (Google Fonts, jsDelivr icon
  //    webfont): CACHE-FIRST, falling back to network.
  //    These assets are versioned/immutable in practice, so serving
  //    the cached copy instantly (no network round-trip) is both
  //    faster and safe; only fetched from network the first time.
  if (
    url.origin === 'https://fonts.googleapis.com' ||
    url.origin === 'https://fonts.gstatic.com' ||
    url.origin === 'https://cdn.jsdelivr.net'
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
    return;
  }

  // 3. Everything else (app JS/CSS/icons not explicitly precached,
  //    and — incidentally — any other same-origin/CORS request that
  //    reaches this worker): STALE-WHILE-REVALIDATE.
  //    Immediately return whatever is cached (instant response, works
  //    offline) while simultaneously re-fetching in the background to
  //    refresh the cache for next time. If nothing is cached yet and
  //    the device is offline, this silently fails rather than
  //    throwing — callers relying on this path should not assume a
  //    response is always returned when fully offline on first visit.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
          });
          return networkResponse;
        })
        .catch(() => {
          // If offline and not in cache, silently fail (offline fallback)
        });
      return cachedResponse || fetchPromise;
    })
  );
});
