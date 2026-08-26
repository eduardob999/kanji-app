/**
 * Registers the app-shell service worker.
 *
 * Production only, on purpose: a worker that caches assets fights the dev
 * server's hot reload and hands you yesterday's bundle while you are editing.
 */
/** Called when a new version is installed and waiting for permission to take over. */
export type UpdateListener = (apply: () => void) => void;

let notifyUpdate: UpdateListener | null = null;
let pendingWorker: ServiceWorker | null = null;

/**
 * Registers interest in updates.
 *
 * If one is already waiting when the listener arrives — which happens whenever
 * the update installs before React has mounted — it fires immediately rather
 * than being missed.
 */
export function onServiceWorkerUpdate(listener: UpdateListener): () => void {
  notifyUpdate = listener;
  if (pendingWorker) listener(applyUpdate);
  return () => {
    notifyUpdate = null;
  };
}

/** Tells the waiting worker to take over. The reload follows from it. */
function applyUpdate(): void {
  pendingWorker?.postMessage({ type: 'SKIP_WAITING' });
}

function announce(worker: ServiceWorker | null): void {
  if (!worker) return;
  pendingWorker = worker;
  notifyUpdate?.(applyUpdate);
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;

  if (!('serviceWorker' in navigator)) {
    console.info('[pwa] This browser has no service worker support; offline shell disabled.');
    return;
  }

  window.addEventListener('load', () => {
    // BASE_URL is Vite's build-time base ('./' by default), which resolves to
    // the right sub-path on GitHub Pages without hardcoding the repo name.
    const workerUrl = new URL('service-worker.js', new URL(import.meta.env.BASE_URL, location.href));

    navigator.serviceWorker
      .register(workerUrl, { updateViaCache: 'none' })
      .then((registration) => {
        console.info('[pwa] Service worker registered for', registration.scope);

        // Already waiting: the update installed on a previous visit, or before
        // this listener existed.
        if (registration.waiting && navigator.serviceWorker.controller) {
          announce(registration.waiting);
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener('statechange', () => {
            // `installed` with a controller present means an *update* rather
            // than a first install: the old version is still running the page.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              announce(installing);
            }
          });
        });
      })
      .catch((error: unknown) => {
        console.error('[pwa] Service worker registration failed.', error);
      });
  });

  // Reload only when a worker *replaces* another one — that is the case where
  // the running JS no longer matches the assets being served. On a first visit
  // the worker claims an uncontrolled page, which is also a controllerchange
  // but has nothing to reconcile: reloading there is a free page flash on
  // someone's very first launch.
  // Tracked across changes rather than sampled once at startup: on a first
  // visit there is no controller *yet*, so a flag captured here would suppress
  // every later swap as well — including the one the user just asked for.
  let controller = navigator.serviceWorker.controller;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const replaced = controller !== null;
    controller = navigator.serviceWorker.controller;

    // No previous controller means this is the first claim, which has nothing
    // to reconcile — reloading there is a free page flash on a first launch.
    if (reloading || !replaced) return;
    reloading = true;
    location.reload();
  });
}
