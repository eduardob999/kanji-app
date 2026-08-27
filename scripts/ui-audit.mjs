/**
 * Renders every screen at phone, tablet and desktop widths and reports what is
 * broken.
 *
 * Run with `npm run ui` while `npm run dev` is up. Drives the preview route in
 * `src/preview/`, which exists because the app is behind a Google sign-in and a
 * headless browser otherwise sees the splash screen and nothing else.
 *
 * It checks the things that are tedious and error-prone to eyeball:
 *
 *   - **Horizontal overflow.** The complaint that started this: content wider
 *     than the viewport, which on a phone means a page that slides sideways and
 *     buttons you cannot reach.
 *   - **Tap targets.** Anything interactive under 44 px in either direction,
 *     which is the smallest reliably hittable size with a thumb.
 *   - **Text too small to read**, under 12 px.
 *   - **Console errors**, because a screen that logs on every render is usually
 *     also doing something expensive on every render.
 *
 * Screenshots go to `.ui/` for looking at; the report goes to stdout for
 * deciding what to fix.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, '.ui');
const BASE = process.env.UI_BASE ?? 'http://localhost:5173';

/** Playwright's own cached build; nothing extra to download. */
const EXECUTABLE = resolve(
  homedir(),
  '.cache/ms-playwright/chromium-1148/chrome-linux/chrome',
);

/**
 * The viewports that matter, and the theme each is checked in.
 *
 * 360 is the narrowest Android still in wide use and the one that finds
 * everything; 390 is a current iPhone; 768 and 1280 confirm nothing collapses
 * the other way.
 *
 * The theme is part of the viewport rather than a second dimension, because
 * doubling every run to check a palette that shares all its layout would be
 * slow for nothing. What it must not do is leave a combination unlooked-at: the
 * phone widths were dark-only for a while, so no phone-sized light screenshot
 * existed at all. 360 now covers light and 390 dark.
 */
const VIEWPORTS = [
  { name: 'phone-360-light', width: 360, height: 780, scheme: 'light' },
  { name: 'phone-390-dark', width: 390, height: 844, scheme: 'dark' },
  { name: 'tablet-768-dark', width: 768, height: 1024, scheme: 'dark' },
  { name: 'desktop-1280-light', width: 1280, height: 900, scheme: 'light' },
];

const SCREENS = [
  'today', 'random', 'reading', 'writing', 'fill', 'audio',
  'browse', 'progress', 'scheduler', 'input', 'account', 'about', 'signin',
  'handwriting', 'choice',
];

/**
 * States a screen can be in that only appear after you interact with it.
 *
 * A screen that is fine on load can still be broken once answered — the verdict
 * adds a banner, a reveal table and two more buttons to a card that was already
 * full, and nothing about loading the page shows that. Each entry drives the
 * page into the state and then the same checks run against it.
 */
const STATES = {
  reading: [
    {
      name: 'verdict',
      async reach(page) {
        await page.fill('.textinput--answer', 'まちがい');
        await page.click('.button--block');
        await page.waitForSelector('.verdict', { timeout: 5_000 });
      },
    },
  ],
  writing: [
    {
      name: 'verdict',
      async reach(page) {
        await page.fill('.textinput--answer', 'x');
        await page.click('.button--block');
        await page.waitForSelector('.verdict', { timeout: 5_000 });
      },
    },
  ],
  today: [
    {
      name: 'started',
      async reach(page) {
        await page.click('.button--block');
        await page.waitForSelector('.quiz', { timeout: 10_000 });
      },
    },
  ],
};

/** Smallest comfortably hittable target. */
const MIN_TAP = 44;
const MIN_FONT = 12;

/** Runs inside the page: everything that needs layout to have happened. */
function inspect(minTap, minFont) {
  const doc = document.documentElement;
  const viewport = doc.clientWidth;

  const overflowing = [];
  const smallTaps = [];
  const smallText = [];

  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
  };

  for (const el of document.querySelectorAll('*')) {
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;

    // Only report the element that actually sticks out, not every ancestor.
    if (box.right > viewport + 1 || box.left < -1) {
      const parent = el.parentElement?.getBoundingClientRect();
      const parentAlsoOut = parent && (parent.right > viewport + 1 || parent.left < -1);
      if (!parentAlsoOut) {
        overflowing.push({
          el: describe(el),
          left: Math.round(box.left),
          right: Math.round(box.right),
          width: Math.round(box.width),
        });
      }
    }

    const interactive = el.matches('button, a[href], input, select, textarea, [role="button"]');

    // WCAG 2.5.8 exempts a target "in a sentence or block of text", and it is
    // right to: growing an inline link to 44px either breaks the line box or
    // pushes the sentence around it apart. A link whose parent holds text of
    // its own is such a link. Everything else has no excuse.
    const inlineInProse =
      el.tagName === 'A' &&
      [...(el.parentElement?.childNodes ?? [])].some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
      );

    if (interactive && !inlineInProse && (box.height < minTap || box.width < minTap)) {
      smallTaps.push({
        el: describe(el),
        w: Math.round(box.width),
        h: Math.round(box.height),
        text: (el.textContent ?? '').trim().slice(0, 24),
      });
    }

    const hasOwnText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
    );
    if (hasOwnText) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < minFont) {
        smallText.push({ el: describe(el), size: Math.round(size * 10) / 10 });
      }
    }
  }

  return {
    viewport,
    scrollWidth: doc.scrollWidth,
    overflowing: overflowing.slice(0, 8),
    smallTaps: smallTaps.slice(0, 8),
    smallText: smallText.slice(0, 6),
  };
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--no-sandbox', '--disable-gpu'],
});

let problems = 0;
const summary = [];

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    colorScheme: viewport.scheme,
  });

  // Each screen on load, plus any interactive state it can be driven into.
  const runs = SCREENS.flatMap((screen) => [
    { screen, state: null },
    ...(STATES[screen] ?? []).map((state) => ({ screen, state })),
  ]);

  for (const { screen, state } of runs) {
    const label = state ? `${screen}:${state.name}` : screen;
    const page = await context.newPage();
    const errors = [];
    /**
     * Firestore is deliberately unconfigured in the preview harness, so its
     * complaints are a fact about the harness rather than about the screen.
     * Everything else is reported.
     */
    const environmental = (text) => text.includes('@firebase') || text.includes('Firestore');

    page.on('console', (m) => {
      const text = m.text().slice(0, 120);
      if (m.type() === 'error' && !environmental(text)) errors.push(text);
    });
    page.on('pageerror', (e) => {
      const text = String(e).slice(0, 120);
      if (!environmental(text)) errors.push(text);
    });

    try {
      await page.goto(`${BASE}/#/preview/${screen}`, { waitUntil: 'networkidle', timeout: 30_000 });
    } catch {
      // A screen that never goes idle is worth knowing about but not fatal.
    }
    await page.waitForTimeout(700);

    if (state) {
      try {
        await state.reach(page);
        await page.waitForTimeout(400);
      } catch (error) {
        // Reaching the state is itself a result: a verdict that cannot be
        // reached is worth reporting, not swallowing.
        problems += 1;
        summary.push({
          screen: label,
          viewport: viewport.name,
          issues: [`could not reach state: ${String(error).split('\n')[0].slice(0, 100)}`],
        });
        await page.close();
        continue;
      }
    }

    const result = await page.evaluate(
      ([tap, font]) => inspectImpl(tap, font),
      [MIN_TAP, MIN_FONT],
    ).catch(async () => {
      // The helper is injected per page rather than bundled.
      await page.addScriptTag({ content: `window.inspectImpl = ${inspect.toString()}` });
      return page.evaluate(([tap, font]) => window.inspectImpl(tap, font), [MIN_TAP, MIN_FONT]);
    });

    await page.screenshot({ path: resolve(OUT, `${label}-${viewport.name}.png`), fullPage: true });

    const issues = [];
    if (result.scrollWidth > result.viewport + 1) {
      issues.push(`overflows by ${result.scrollWidth - result.viewport}px`);
    }
    if (result.overflowing.length) {
      issues.push(`${result.overflowing.length} element(s) past the edge: ` +
        result.overflowing.map((o) => `${o.el}(${o.left}..${o.right})`).join(', '));
    }
    if (result.smallTaps.length) {
      issues.push(`${result.smallTaps.length} small tap target(s): ` +
        result.smallTaps.map((t) => `${t.el} ${t.w}x${t.h}`).join(', '));
    }
    if (result.smallText.length) {
      issues.push(`tiny text: ` + result.smallText.map((t) => `${t.el} ${t.size}px`).join(', '));
    }
    if (errors.length) issues.push(`console: ${errors[0]}`);

    if (issues.length) {
      problems += 1;
      summary.push({ screen: label, viewport: viewport.name, issues });
    }

    await page.close();
  }

  await context.close();
}

await browser.close();

if (summary.length === 0) {
  console.log('No layout problems found.');
} else {
  let current = '';
  for (const row of summary) {
    if (row.viewport !== current) {
      current = row.viewport;
      console.log(`\n=== ${current} ===`);
    }
    console.log(`  ${row.screen}`);
    for (const issue of row.issues) console.log(`      ${issue}`);
  }
}

console.log(`\n${problems} screen/viewport combinations with problems.`);
console.log(`Screenshots in ${OUT}`);
