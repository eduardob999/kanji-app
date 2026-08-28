/* eslint-env serviceworker */

/**
 * App-shell service worker for Kanjiba.
 *
 * Scope: the HTML, JS, CSS and icons that make the app boot offline. It does
 * not touch Firestore or Google traffic — Firestore keeps its own IndexedDB
 * cache and write queue, and caching auth responses would be actively harmful.
 *
 * The deck and sentence JSON in public/ *is* precached: it is fingerprint-free
 * static data that the quizzes cannot run without, and "works on the train" is
 * the whole point.
 *
 * The line below is rewritten during `npm run build` by the
 * `kanjiba:service-worker-manifest` plugin in vite.config.ts, which fills in the
 * fingerprinted bundle filenames and a version derived from them. The literal
 * here is only what the file looks like in the repo.
 */
const BUILD_MANIFEST = { version: 'dev', precache: [] }; // __BUILD_MANIFEST__

const CACHE_NAME = `kanjiba-shell-${BUILD_MANIFEST.version}`;
const SCOPE = self.registration.scope;

/** Resolve a manifest entry against the worker's scope, not the request page. */
function scoped(path) {
  return new URL(path, SCOPE).toString();
}

const INDEX_URL = scoped('index.html');

/**
 * A cached copy carrying only the headers that describe the content.
 *
 * Storing a response exactly as it arrived means storing the origin's transport
 * headers with it, and one legal combination of those makes the stored copy
 * unusable: a `Content-Encoding: gzip` alongside `Transfer-Encoding: chunked`
 * is replayed to the subresource loader, which tries to decode a body the
 * Response has already decoded, and the load fails with ERR_FAILED.
 *
 * It is not hypothetical. `vite preview` sends exactly that pair, and against
 * it the app did not boot offline at all — the shell was served from cache and
 * then its stylesheet and its bundle both failed, so nothing mounted. GitHub
 * Pages sends `Content-Length` instead and is unaffected, which is why this
 * survived to be found by a script rather than by someone on a train.
 *
 * The body is read out and stored as bytes, with `Content-Type` and nothing
 * else. Transport is the origin's business and has no place in a cache.
 */
async function forCache(response) {
  return new Response(await response.blob(), {
    status: 200,
    statusText: 'OK',
    headers: response.headers.get('Content-Type')
      ? { 'Content-Type': response.headers.get('Content-Type') }
      : {},
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Added one at a time rather than with addAll: a single missing file
      // would otherwise abort the whole install and leave the app with no
      // worker at all, which is worse than an incomplete cache.
      // `cache.add` would store the response as it arrived, headers and all;
      // see `forCache` for why that is not safe.
      const results = await Promise.allSettled(
        BUILD_MANIFEST.precache.map(async (path) => {
          const url = scoped(path);
          const response = await fetch(new Request(url, { cache: 'reload' }));
          if (!response.ok) throw new Error(`${response.status} for ${path}`);
          await cache.put(url, await forCache(response));
        }),
      );

      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length > 0) {
        console.warn(`[sw] ${failed.length} shell asset(s) failed to precache.`, failed);
      }

      // Deliberately *not* skipWaiting() here.
      //
      // Taking over immediately means a deploy can swap the assets under
      // someone mid-practice, and the page reloads to match — losing the run
      // they were part-way through. A new build now waits until the page asks,
      // which it does when the user presses "Update" (see the SKIP_WAITING
      // handler at the bottom of this file).
      //
      // On a *first* install there is no controller, so the worker activates
      // straight away regardless. This only defers updates.
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('kanjiba-shell-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );

      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Everything cross-origin — Firestore, Identity Toolkit, Google avatars —
  // goes straight to the network.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(handleAsset(request));
});

/**
 * Network-first for page loads, falling back to the cached shell.
 *
 * The SPA has a single HTML entry point, so any navigation that cannot reach
 * the network can still be answered with index.html and routed client-side.
 */
async function handleNavigation(request) {
  try {
    const response = await fetch(request);

    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      // Stored from a clone, so the response being returned keeps its own body.
      void forCache(response.clone()).then((copy) => cache.put(INDEX_URL, copy));
    }

    return response;
  } catch {
    const cached = (await caches.match(INDEX_URL)) ?? (await caches.match(request));

    if (cached) return cached;

    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
        '<body style="font-family:system-ui;padding:2rem">' +
        '<h1>Offline</h1><p>Open this app once while connected, then it will work without a connection.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

/**
 * Cache-first for static assets.
 *
 * Vite fingerprints the bundle filenames, so a cached asset URL can never be
 * stale — a new build produces new URLs, and the old cache is dropped whole on
 * activate.
 */
async function handleAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  // A miss falls through to the network, and a network failure propagates as it
  // normally would — the page decides how to degrade.
  const response = await fetch(request);

  // Only store real, complete, same-origin responses: opaque and partial
  // responses would poison the cache with bodies we cannot read back.
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE_NAME);
    void forCache(response.clone()).then((copy) => cache.put(request, copy));
  }

  return response;
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});
