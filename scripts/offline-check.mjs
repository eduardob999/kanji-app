/**
 * Does this actually work on a train?
 *
 * The whole design leans on it — decks and sentences are precached rather than
 * fetched, writes are deliberately not awaited because Firestore leaves them
 * pending offline, and the sync badge exists to say so. None of that had ever
 * been run with the network off.
 *
 * Run with `npm run offline` after `npm run build`. It starts its own server
 * and stops it, which is the whole trick.
 *
 * ## Why it stops the server rather than emulating offline
 *
 * The obvious way is Playwright's `context.setOffline(true)`, and it is wrong
 * here: **it does not apply to fetches the service worker makes.** Measured,
 * not assumed — with the context "offline", a request built to guarantee a
 * cache miss (`decks/index.json?bust=…`) still came back 200 from the real
 * server, and so did 1.5 MB of handwriting patterns that are deliberately not
 * precached. A check built on it would have passed while proving nothing about
 * the one path that matters.
 *
 * Stopping the server is unambiguous: there is nothing to fall back to, so
 * anything that answers came out of the cache.
 *
 * It cannot check the signed-in screens — the app is behind Google auth and the
 * preview harness is compiled out of a production build, which is the right
 * trade. What it does check is everything that has to survive the network going
 * away: the shell boots from cache, the decks and sentence packs are there, and
 * what is deliberately left out stays out.
 */
import { chromium } from 'playwright-core';
import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.OFFLINE_PORT ?? 4183);
const BASE = `http://localhost:${PORT}`;
const EXECUTABLE = resolve(homedir(), '.cache/ms-playwright/chromium-1148/chrome-linux/chrome');

/** Its own server, so it can be taken away again. */
async function serve() {
  // Its own process group, because `npx` forks vite and killing the wrapper
  // leaves the server running — which the first version of this did, and then
  // reported that the network could not be taken away.
  const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return child;
    } catch {
      // Not up yet.
    }
    await new Promise((wake) => setTimeout(wake, 250));
  }

  child.kill('SIGKILL');
  throw new Error(`vite preview did not come up on ${PORT}`);
}

function kill(child) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

async function stop(child) {
  kill(child);

  // Wait for the port to actually close, so "offline" is not a race.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`${BASE}/`);
    } catch {
      return;
    }
    await new Promise((wake) => setTimeout(wake, 100));
  }

  throw new Error('the preview server would not stop');
}

const failures = [];
const note = (ok, what, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(what);
};

const manifest = JSON.parse(
  readFileSync(resolve(ROOT, 'dist/service-worker.js'), 'utf8').match(
    /const BUILD_MANIFEST = (\{.*?\});/s,
  )[1],
);

const server = await serve();

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--no-sandbox', '--disable-gpu'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

console.log(`Precache manifest: ${manifest.precache.length} entries, version ${manifest.version}`);

// 1. First visit, online: the service worker installs and fills its cache.
await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 30_000 });

const activated = await page.evaluate(async () => {
  const registration = await navigator.serviceWorker.ready;
  return Boolean(registration.active);
});
note(activated, 'the service worker activates');

// Installation caches in the background; wait for the cache to hold the lot
// rather than guessing at a delay.
const cached = await page.evaluate(async (expected) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const names = await caches.keys();
    for (const name of names) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      if (keys.length >= expected) return keys.length;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const names = await caches.keys();
  let most = 0;
  for (const name of names) most = Math.max(most, (await (await caches.open(name)).keys()).length);
  return most;
}, manifest.precache.length);

note(
  cached >= manifest.precache.length,
  'everything in the precache list reaches the cache',
  `${cached}/${manifest.precache.length}`,
);

// 2. Take the network away for real.
await stop(server);

const reloadErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') reloadErrors.push(m.text().slice(0, 120));
});

// A fresh tab, because that is what reopening the installed app does — and
// because reloading the very tab whose server just vanished has its own
// half-torn-down connection state that is not what anyone experiences.
const offlinePage = await context.newPage();
offlinePage.on('console', (m) => {
  if (m.type() === 'error') reloadErrors.push(m.text().slice(0, 120));
});
await offlinePage.goto(`${BASE}/`, { waitUntil: 'load', timeout: 30_000 }).catch(() => {});
await offlinePage.waitForTimeout(1_500);

const shell = await offlinePage.evaluate(() => ({
  title: document.title,
  // The sign-in screen is what a signed-out visitor gets, online or off. What
  // matters is that it is *the app* rather than the browser's offline page.
  rendered: Boolean(document.querySelector('.screen, #root > *')),
  text: (document.body.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 90),
}));
note(shell.rendered, 'the app shell renders with the network off', shell.text);

/*
 * Snapshotted here, before the probes below.
 *
 * Those deliberately fetch things that are meant to fail offline — the
 * handwriting patterns most of all — and each failure logs a console error. An
 * assertion made after them would be measuring the test rather than the app.
 */
const bootErrors = [...reloadErrors];

// 3. The data the quizzes need, offline.
const data = await offlinePage.evaluate(async (paths) => {
  const out = [];
  for (const path of paths) {
    try {
      const response = await fetch(path, { cache: 'default' });
      out.push([path, response.ok, response.status]);
    } catch (error) {
      out.push([path, false, String(error).slice(0, 40)]);
    }
  }
  return out;
}, ['decks/index.json', 'decks/kanji-5.json', 'decks/vocab-5.json', 'sentences/vocab-5.json']);

for (const [path, ok, status] of data) {
  note(ok, `${path} is served from cache`, ok ? '' : `status ${status}`);
}

// 4. And the thing that is deliberately *not* precached, to prove the
//    distinction is real rather than accidental.
const strokes = await offlinePage.evaluate(async () => {
  try {
    const response = await fetch('strokes/kanji.json');
    return response.ok;
  } catch {
    return false;
  }
});
note(
  !strokes,
  'handwriting patterns are not precached',
  strokes ? 'they were served offline, so someone who never draws is paying 1.5 MB' : '',
);

note(bootErrors.length === 0, 'the app boots offline without console errors', bootErrors[0] ?? '');

await browser.close();

console.log(
  failures.length === 0
    ? '\nOffline: everything that has to work, works.'
    : `\n${failures.length} offline problem(s).`,
);
process.exit(failures.length === 0 ? 0 : 1);
