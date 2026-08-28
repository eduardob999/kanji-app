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
 *   - **Text too faint to read**: contrast under WCAG AA, which is the one
 *     thing here that cannot be spotted by looking at a screenshot, because
 *     the eye adapts and a designer who chose the colour already knows what it
 *     says.
 *   - **Console errors**, because a screen that logs on every render is usually
 *     also doing something expensive on every render.
 *   - **Reachability with the keyboard open** — see `openKeyboard` below, which
 *     is a stated simulation rather than a real IME.
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
  'today', 'summary', 'sync', 'random', 'random-silent', 'reading', 'writing', 'fill', 'audio',
  'browse', 'progress', 'scheduler', 'input', 'account', 'about', 'signin',
  'handwriting', 'choice',
  /*
   * The same screens on a brand-new account.
   *
   * Every bar at zero, no streak, nothing due, a calibration curve with nothing
   * to plot. They have their own copy and their own layouts, and the fixtures
   * that made the lived-in versions checkable made these unrenderable — so they
   * went from being the only thing ever looked at to never being looked at.
   */
  'today-empty', 'progress-empty', 'scheduler-empty', 'browse-empty',
];

/**
 * States a screen can be in that only appear after you interact with it.
 *
 * A screen that is fine on load can still be broken once answered — the verdict
 * adds a banner, a reveal table and two more buttons to a card that was already
 * full, and nothing about loading the page shows that. Each entry drives the
 * page into the state and then the same checks run against it.
 *
 * A state may supply `before` to set something up *prior* to navigation, which
 * is the only way to reach a failure that happens during load; `reach` to drive
 * the page after it; and `check` for whatever that particular state exists to
 * prove.
 */

/**
 * The decks do not arrive.
 *
 * Every quiz screen has an error branch and none of them had ever run. A
 * failure here is not exotic — it is a first launch on a flaky connection
 * before anything is cached — and the failure mode that matters is a screen
 * that stays blank or sits for ever on "Working out what is due…", which is
 * indistinguishable from the app being broken.
 */
const deadDecks = {
  name: 'no-decks',
  /*
   * The point of this state is that requests fail, so the browser complaining
   * that requests failed is the setup rather than a finding — and so is the
   * app's own diagnostic, which is deliberate and is where the exception's
   * real text is supposed to end up.
   */
  ignoreConsole: /Failed to load resource|^\[decks\]/,
  async before(page) {
    await page.route('**/decks/**', (route) => route.abort('failed'));
  },
  async check(page) {
    const found = await page.evaluate(() => {
      const notice = document.querySelector('.notice--error, [role="alert"]');
      const text = (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
      return {
        hasNotice: Boolean(notice),
        // Anything still claiming to be working is a screen that will claim it
        // for ever: the load already failed.
        stillLoading: /Working out what is due|Getting ready/.test(text),
        // A dead end is only half a failure handled. There has to be a way to
        // try again without knowing to reload the page.
        hasWayOut: Boolean(
          [...document.querySelectorAll('button')].find((b) => /try again/i.test(b.textContent ?? '')),
        ),
        // The browser's own wording, handed to a learner. It says nothing about
        // whose fault it is, whether anything is lost, or what to press.
        rawException: /Failed to fetch|NetworkError|TypeError|undefined is not/.test(text),
        text: text.slice(0, 80),
      };
    });

    const issues = [];
    if (found.stillLoading) issues.push(`still says it is loading after the decks failed`);
    if (!found.hasNotice) issues.push(`no error is shown when the decks fail: "${found.text}"`);
    if (found.rawException) issues.push(`a raw exception message is on screen: "${found.text}"`);
    if (found.hasNotice && !found.hasWayOut) issues.push(`the error has no "try again"`);
    return issues;
  },
};
/**
 * The keyboard, simulated — and it is worth being precise about how.
 *
 * A headless browser cannot raise a soft keyboard, and there is no API to make
 * it pretend. What *can* be reproduced exactly is the thing the CSS reacts to:
 * `--keyboard-inset` and `data-keyboard`, which `src/viewport.ts` publishes
 * from `window.visualViewport`. Setting them by hand tests every rule that
 * depends on them, at the cost of not testing the measurement itself.
 *
 * So this catches a regression in the layout and cannot catch a regression in
 * the measurement. The second one needs a phone.
 *
 * 45% of the viewport is a middling Android keyboard; iOS is a little less.
 */
const KEYBOARD_FRACTION = 0.45;

const openKeyboard = {
  name: 'keyboard',
  async reach(page, viewport) {
    const inset = Math.round(viewport.height * KEYBOARD_FRACTION);
    await page.focus('.textinput--answer');
    await page.evaluate((px) => {
      document.documentElement.style.setProperty('--keyboard-inset', `${px}px`);
      document.documentElement.dataset.keyboard = 'open';
    }, inset);
  },
  async check(page, viewport) {
    const line = viewport.height - Math.round(viewport.height * KEYBOARD_FRACTION);
    return page.evaluate((keyboardTop) => {
      const found = [];
      const dock = document.querySelector('.quiz__dock');
      if (!dock) return ['no .quiz__dock to keep above the keyboard'];

      const box = dock.getBoundingClientRect();
      if (box.bottom > keyboardTop + 1) {
        found.push(`the dock sits ${Math.round(box.bottom - keyboardTop)}px into the keyboard`);
      }
      if (box.top < 0) {
        found.push('the dock is cut off at the top of the viewport');
      }

      // The dock is only useful if every part of it is: the field being typed
      // into, the primary action, and the way out of a question you cannot
      // answer. Checking the container alone would pass a dock whose last row
      // had wrapped below the fold.
      for (const [what, selector] of [
        ['the answer field', '.textinput--answer, .choices, .handwriting'],
        ['the primary button', '.button--primary'],
        ['"I don\u2019t know"', '.quiz__afterthoughts .button'],
      ]) {
        const el = dock.querySelector(selector);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.bottom > keyboardTop + 1) {
          found.push(`${what} is ${Math.round(rect.bottom - keyboardTop)}px into the keyboard`);
        }
      }

      const tabbar = document.querySelector('.tabbar');
      if (tabbar && getComputedStyle(tabbar).display !== 'none') {
        found.push('the tab bar is still taking space with the keyboard open');
      }

      return found;
    }, line);
  },
};

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
    {
      /*
       * All the way through a miss: answer wrongly, then write the answer out
       * before Next is offered.
       *
       * The answer is read off the verdict line rather than known in advance,
       * which is the only way a harness with no deck data can do this — and it
       * doubles as a check that what the verdict shows is genuinely what the
       * correction accepts. If those two ever disagree, this state cannot be
       * reached and the audit says so.
       */
      name: 'corrected',
      async reach(page) {
        await page.fill('.textinput--answer', 'まちがい');
        await page.click('.button--primary');
        await page.waitForSelector('.quiz__copyprompt', { timeout: 5_000 });

        const answer = (await page.textContent('.verdict'))?.trim() ?? '';
        if (!answer) throw new Error('the verdict did not name the answer');

        await page.fill('.textinput--answer', answer);
        await page.click('.button--primary');
        await page.waitForSelector('.quiz__dock .button--primary:not([disabled])', {
          timeout: 5_000,
        });

        const label = (await page.textContent('.quiz__dock .button--primary'))?.trim();
        if (label !== 'Next') throw new Error(`copying the answer left the dock on "${label}"`);
      },
    },
    openKeyboard,
    deadDecks,
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
    openKeyboard,
  ],
  today: [
    deadDecks,
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
  const occluded = [];
  const faintText = [];

  /*
   * WCAG relative luminance and contrast ratio.
   *
   * Approximate in one way worth naming: the background is the first ancestor
   * with a non-transparent colour, so an element sitting on a gradient or an
   * image is measured against whatever is behind that. Every such case in this
   * app is a solid card, and the alternative — sampling rendered pixels — would
   * make the check slow and flaky for the sake of cases that do not arise.
   */
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  const parse = (colour) => {
    const parts = colour.match(/[\d.]+/g);
    if (!parts || parts.length < 3) return null;
    const alpha = parts.length > 3 ? Number(parts[3]) : 1;
    return { r: +parts[0], g: +parts[1], b: +parts[2], a: alpha };
  };

  const luminance = ({ r, g, b }) =>
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

  const over = (front, back) => ({
    r: front.r * front.a + back.r * (1 - front.a),
    g: front.g * front.a + back.g * (1 - front.a),
    b: front.b * front.a + back.b * (1 - front.a),
    a: 1,
  });

  const backgroundFor = (el) => {
    let node = el;
    while (node) {
      const style = getComputedStyle(node);
      const colour = parse(style.backgroundColor);
      if (colour && colour.a > 0.95) return colour;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  const contrast = (a, b) => {
    const [light, dark] = luminance(a) > luminance(b) ? [a, b] : [b, a];
    return (luminance(light) + 0.05) / (luminance(dark) + 0.05);
  };

  /*
   * The tab bar is `position: fixed`, so it covers whatever shares its band of
   * the viewport. For content in normal flow that is fine — you scroll, and it
   * comes out from under. For anything *pinned* it is permanent: the element
   * has nowhere to scroll to.
   *
   * This is how the quiz's dock shipped underneath the tab bar while every
   * other rule here passed it. Overflow, tap size and contrast were all
   * correct; the button was simply not visible.
   */
  const bar = document.querySelector('.tabbar');
  const barBox = bar && getComputedStyle(bar).display !== 'none'
    ? bar.getBoundingClientRect()
    : null;

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

    if (barBox && !bar.contains(el)) {
      const pinned = getComputedStyle(el).position;
      if (
        (pinned === 'sticky' || pinned === 'fixed') &&
        box.bottom > barBox.top + 1 &&
        box.top < barBox.bottom
      ) {
        occluded.push({ el: describe(el), by: Math.round(box.bottom - barBox.top) });
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
      const style = getComputedStyle(el);
      const size = parseFloat(style.fontSize);
      if (size < minFont) {
        smallText.push({ el: describe(el), size: Math.round(size * 10) / 10 });
      }

      // Disabled controls are exempt: being hard to read is how a disabled
      // control says it is disabled, and WCAG exempts them for that reason.
      const disabled = el.closest('[disabled], :disabled') !== null;

      const foreground = parse(style.color);
      if (foreground && !disabled) {
        const background = backgroundFor(el);
        const ratio = contrast(over(foreground, background), background);

        // WCAG's "large text" is 18.66px bold or 24px, and gets a lower bar.
        const weight = Number.parseInt(style.fontWeight, 10) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const floor = large ? 3 : 4.5;

        if (ratio < floor) {
          faintText.push({
            el: describe(el),
            ratio: Math.round(ratio * 100) / 100,
            needs: floor,
            size: Math.round(size * 10) / 10,
          });
        }
      }
    }
  }

  return {
    viewport,
    scrollWidth: doc.scrollWidth,
    overflowing: overflowing.slice(0, 8),
    occluded: occluded.slice(0, 4),
    smallTaps: smallTaps.slice(0, 8),
    smallText: smallText.slice(0, 6),
    faintText: faintText.slice(0, 6),
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
    if (state?.before) await state.before(page);
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

    if (state?.reach) {
      try {
        await state.reach(page, viewport);
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
    if (result.occluded.length) {
      issues.push(`pinned under the tab bar: ` +
        result.occluded.map((o) => `${o.el} by ${o.by}px`).join(', '));
    }
    if (result.smallTaps.length) {
      issues.push(`${result.smallTaps.length} small tap target(s): ` +
        result.smallTaps.map((t) => `${t.el} ${t.w}x${t.h}`).join(', '));
    }
    if (result.smallText.length) {
      issues.push(`tiny text: ` + result.smallText.map((t) => `${t.el} ${t.size}px`).join(', '));
    }
    if (result.faintText.length) {
      issues.push(`under WCAG AA: ` +
        result.faintText.map((t) => `${t.el} ${t.ratio}:1 needs ${t.needs}`).join(', '));
    }
    const unexpected = state?.ignoreConsole
      ? errors.filter((text) => !state.ignoreConsole.test(text))
      : errors;
    if (unexpected.length) issues.push(`console: ${unexpected[0]}`);

    // Whatever this particular state is here to prove.
    if (state?.check) {
      issues.push(...(await state.check(page, viewport)));
    }

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
