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
 *   - **Reachability with the keyboard open**, in both of the ways a browser
 *     can react to one. See `keyboardResizesContent` and
 *     `keyboardResizesVisual` below: stated simulations rather than a real IME,
 *     but the app's own measurement runs against them.
 *
 * Screenshots go to `.ui/` for looking at; the report goes to stdout for
 * deciding what to fix.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
  /*
   * The smallest phone anyone is still using, and the one this file had never
   * looked at. 320x640 is a Galaxy A-series in display-zoom, an iPhone SE 1st
   * generation, and the width every "even the smallest phones" claim has to
   * survive. It finds what 360 does not.
   */
  { name: 'phone-320-dark', width: 320, height: 640, scheme: 'dark' },
  /*
   * The same phones with the system font turned up.
   *
   * Android's display settings and iOS's Dynamic Type both scale text, and a
   * learner who has turned it up is exactly the learner squinting at kanji.
   * Every size in this app is in `rem`, so the multiplier lands on all of them
   * at once: at 1.3 a card tuned to the pixel has a third more text in the same
   * box. This file passed at 1.0 for its whole life and reported nothing while
   * the owner said small screens were still troublesome, which is the shape of
   * a harness measuring a condition nobody is in.
   *
   * 1.15 and 1.3 are the second and third steps of Android's slider — the ones
   * people actually pick — rather than the extreme, which no layout survives
   * and which would say nothing about this one.
   */
  { name: 'phone-320-text130-dark', width: 320, height: 640, scheme: 'dark', scale: 1.3 },
  { name: 'phone-390-text115-light', width: 390, height: 844, scheme: 'light', scale: 1.15 },
  { name: 'phone-360-light', width: 360, height: 780, scheme: 'light' },
  { name: 'phone-390-dark', width: 390, height: 844, scheme: 'dark' },
  /* The owner's own phone, and the width every report so far has come from. */
  { name: 'phone-412-light', width: 412, height: 915, scheme: 'light' },
  { name: 'tablet-768-dark', width: 768, height: 1024, scheme: 'dark' },
  { name: 'desktop-1280-light', width: 1280, height: 900, scheme: 'light' },
];

const SCREENS = [
  'practice', 'summary', 'sync', 'practice-silent', 'reading', 'writing', 'fill', 'audio',
  'browse', 'progress', 'scheduler', 'input', 'sound', 'account', 'about', 'signin',
  'handwriting', 'choice',
  /*
   * The same screens on a brand-new account.
   *
   * Every bar at zero, no streak, nothing due, a calibration curve with nothing
   * to plot. They have their own copy and their own layouts, and the fixtures
   * that made the lived-in versions checkable made these unrenderable — so they
   * went from being the only thing ever looked at to never being looked at.
   */
  'practice-empty', 'progress-empty', 'scheduler-empty', 'browse-empty',
  'reading-empty', 'fill-empty', 'audio-empty', 'account-empty',
  /*
   * And the practice screen with the queue cleared.
   *
   * Nothing due, nothing left to introduce, so the whole round is the practice
   * the merge added. It is the only state in which a question carries the
   * "extra practice" mark, and before the merge it was the state the app had no
   * answer to at all.
   */
  'practice-ahead',
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
 * The keyboard, simulated. There are two of them, because there are two things
 * a browser can do about one, and only one of them used to be checked here.
 *
 * A headless browser cannot raise a soft keyboard. What it can do is reproduce
 * what the browser does to the page afterwards, and that is not one behaviour:
 *
 *   resizes-content  The layout viewport itself shrinks. This is what
 *                    `interactive-widget=resizes-content` in the viewport meta
 *                    asks for and what Chrome on Android does, so it is the
 *                    case the owner's phone is actually in. Reproduced by
 *                    shrinking the page's viewport, which is what the browser
 *                    itself does.
 *   resizes-visual   Only the visual viewport shrinks; `window.innerHeight`
 *                    does not move. This is iOS, and anything ignoring the
 *                    meta. Reproduced by patching `visualViewport.height`
 *                    before the page loads and firing its resize event.
 *
 * Both run the app's own measurement in `src/viewport.ts` rather than handing
 * it the answer. The previous version set `--keyboard-inset` and
 * `data-keyboard` by hand, which checked every CSS rule and left the code that
 * decides whether those rules apply at all unchecked. That is the gap the bug
 * came through: on Chrome for Android the measurement correctly saw no
 * visual-viewport shrink, never set `data-keyboard`, and the tab bar stayed up
 * over a 464px window with the dock riding over the question. This file passed
 * the whole time.
 *
 * 55% of the viewport, which is a tall Android keyboard — Gboard with its
 * suggestion strip on a short screen — rather than a middling one. This was
 * 45%, and 45% is the comfortable case: it passed while the owner, whose
 * keyboard is taller than that, was scrolling to reach the field he was being
 * asked to type into. The harness should sit at the hard end of what people
 * actually have, not the middle.
 */
const KEYBOARD_FRACTION = 0.55;

/**
 * Everything that has to hold with a keyboard up, whichever kind it is.
 *
 * The fold is worked out inside the page rather than passed in, because the two
 * simulations put the same number in different places: one shortens the window,
 * the other shortens only the visual viewport inside it.
 */
async function keyboardChecks(page, { mustFit = true } = {}) {
  return page.evaluate((fits) => {
    const found = [];
    const vv = window.visualViewport;
    const fold = vv
      ? Math.min(window.innerHeight, Math.round(vv.offsetTop + vv.height))
      : window.innerHeight;

    // The measurement itself. Everything below is downstream of it, so a
    // failure here would otherwise be reported four times over.
    if (document.documentElement.dataset.keyboard !== 'open') {
      found.push('the keyboard is up and nothing noticed: data-keyboard is not set');
    }

    const dock = document.querySelector('.quiz__dock');
    if (!dock) return found.concat('no .quiz__dock to keep above the keyboard');

    const box = dock.getBoundingClientRect();
    if (fits && box.bottom > fold + 1) {
      found.push(`the dock sits ${Math.round(box.bottom - fold)}px into the keyboard`);
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
      // Beside the primary in the asking state, under it in the verdict ones.
      ['"I don’t know"', '.quiz__afterthoughts .button, .quiz__actions .button--ghost'],
    ]) {
      const el = dock.querySelector(selector);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (fits && rect.bottom > fold + 1) {
        found.push(`${what} is ${Math.round(rect.bottom - fold)}px into the keyboard`);
      }
    }

    const tabbar = document.querySelector('.tabbar');
    if (tabbar && getComputedStyle(tabbar).display !== 'none') {
      found.push('the tab bar is still taking space with the keyboard open');
    }

    /*
     * The question, still readable.
     *
     * The dock is sticky, so when the card does not fit it pins itself to the
     * bottom of the window while its place in the flow is below the fold, and
     * the distance between the two gets painted over whatever is above it.
     * What is above it is the word being asked about. Every other rule in this
     * file passed while half a kanji sat behind the answer field.
     */
    for (const [what, selector] of [
      ['the prompt', '.quiz__prompt'],
      ['the reveal', '.quiz__reveal'],
    ]) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height > 0 && box.top < rect.bottom - 1 && box.bottom > rect.top + 1) {
        found.push(`the dock covers ${Math.round(rect.bottom - box.top)}px of ${what}`);
      }
      if (fits && rect.bottom > fold + 1) {
        found.push(`${what} runs ${Math.round(rect.bottom - fold)}px into the keyboard`);
      }
      // Shrunk past its contents is fine. Shrunk past them with no way to
      // scroll to the rest is the same thing as hidden.
      const cut = el.scrollHeight - el.clientHeight;
      const scrollable = /auto|scroll/.test(getComputedStyle(el).overflowY);
      if (cut > 1 && !scrollable) {
        found.push(`${cut}px of ${what} is cut off with no way to scroll to it`);
      }
    }

    return found;
  }, mustFit);
}

/** The owner's phone: Chrome for Android, where the layout viewport shrinks. */
const keyboardResizesContent = {
  name: 'keyboard',
  async reach(page, viewport) {
    await page.focus('.textinput--answer');
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height - Math.round(viewport.height * KEYBOARD_FRACTION),
    });
    await page.waitForTimeout(300);
    // The browser keeps the focused field in view; so does this.
    await page.evaluate(() =>
      document.querySelector('.textinput--answer')?.scrollIntoView({ block: 'nearest' }),
    );
  },
  check: keyboardChecks,
};

/**
 * The keyboard, on the one screen in the app that cannot fit above it.
 *
 * After a miss the card carries a verdict, what you wrote, the whole reveal and
 * the tallest dock in the app, which is 597px of content at 390px wide. The
 * window with a keyboard up is 464px. Nothing shrinks that away, so this state
 * scrolls, and the only question worth asking of it is whether anything is
 * *hidden* rather than merely below the fold. `mustFit: false` drops the
 * above-the-fold rules and keeps the ones that matter: nothing painted over by
 * the dock, and nothing clipped out of a box with no way to scroll to it.
 */
const keyboardAfterMiss = {
  name: 'keyboard-after-miss',
  async reach(page, viewport) {
    await page.fill('.textinput--answer', 'まちがい');
    await page.click('.quiz__dock .button--primary');
    await page.waitForSelector('.quiz__copyprompt', { timeout: 5_000 });
    await keyboardResizesContent.reach(page, viewport);
  },
  check: (page) => keyboardChecks(page, { mustFit: false }),
};

/** iOS, and anything ignoring the viewport meta: only the visual viewport moves. */
const keyboardResizesVisual = {
  name: 'keyboard-ios',
  async before(page) {
    await page.addInitScript((fraction) => {
      const vv = window.visualViewport;
      if (!vv) return;
      let open = false;
      Object.defineProperty(vv, 'height', {
        configurable: true,
        get: () =>
          open
            ? window.innerHeight - Math.round(window.innerHeight * fraction)
            : window.innerHeight,
      });
      window.__openKeyboard = () => {
        open = true;
        vv.dispatchEvent(new Event('resize'));
      };
    }, KEYBOARD_FRACTION);
  },
  async reach(page) {
    await page.focus('.textinput--answer');
    await page.evaluate(() => window.__openKeyboard?.());
    await page.waitForTimeout(300);
  },
  check: keyboardChecks,
};

/**
 * The longest question in the corpus, whatever it happens to be today.
 *
 * Read out of the built decks rather than written down here, so it keeps
 * pointing at the worst case after a deck rebuild instead of at whatever the
 * worst case was the day this was written. Today it is 代: eleven readings, 86
 * characters of them, and a 121-character meaning, against a median item's 8
 * and 28.
 *
 * Readings count double because they are set two thirds larger than the
 * meaning, so a character of them costs about twice the room.
 */
function longestKanjiPrompt() {
  const decks = resolve(ROOT, 'public/decks');
  let worst = null;

  for (const file of readdirSync(decks)) {
    if (!file.startsWith('kanji-')) continue;
    const deck = JSON.parse(readFileSync(resolve(decks, file), 'utf8'));
    for (const item of deck.items ?? []) {
      const readings = item.readings ?? [];
      const meaning = item.meaning ?? '';
      const size = readings.join('・').length * 2 + meaning.length;
      if (!worst || size > worst.size) worst = { size, kanji: item.kanji, readings, meaning };
    }
  }

  return worst;
}

/**
 * The tail of the corpus, above a keyboard.
 *
 * The fixture kanji is 山 — one reading, "mountain" — and every layout check in
 * this file passed against it while the meaning of a character with eleven
 * readings sat below the bottom of the prompt on a 360px phone. That is the
 * whole reason this state exists: a screen is only as good as its worst
 * content, and the worst content is exactly what a hand-written fixture never
 * has.
 *
 * The text is swapped into the DOM rather than reached by answering, since
 * there is no way to steer the planner to one item. The resize that follows is
 * what the app listens to, so the fit routine runs here as it would on a real
 * question.
 */
const keyboardLongestPrompt = {
  name: 'keyboard-longest',
  async reach(page, viewport) {
    const worst = longestKanjiPrompt();
    if (worst) {
      await page.evaluate(({ readings, meaning }) => {
        const prompt = document.querySelector('.quiz__prompt');
        if (!prompt) return;
        const readingsEl = prompt.querySelector('.quiz__readings');
        const gloss = prompt.querySelector('.quiz__gloss');
        if (readingsEl) readingsEl.textContent = readings.join('・');
        if (gloss) gloss.textContent = meaning;
      }, worst);
    }
    await keyboardResizesContent.reach(page, viewport);
  },
  async check(page) {
    const issues = await keyboardChecks(page);

    const hidden = await page.evaluate(() => {
      const prompt = document.querySelector('.quiz__prompt');
      if (!prompt) return 0;
      return Math.max(0, prompt.scrollHeight - prompt.clientHeight);
    });

    if (hidden > 0) {
      issues.push(
        `the longest question in the corpus is ${hidden}px taller than the room it has, ` +
          `so its meaning is off the bottom of the prompt`,
      );
    }

    return issues;
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
    keyboardResizesContent,
    keyboardResizesVisual,
    keyboardAfterMiss,
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
    keyboardResizesContent,
    keyboardResizesVisual,
    keyboardLongestPrompt,
  ],
  /*
   * The first answer anyone ever gives.
   *
   * A brand-new account takes a different path through `QuizFrame`: there is no
   * previous state to grade against, so the elapsed time is zero, the predicted
   * recall is one, and an undo has to *delete* the state rather than restore
   * one. Every user passes through this exactly once and it had never been run.
   */
  'reading-empty': [
    {
      name: 'first-answer',
      async reach(page) {
        await page.fill('.textinput--answer', 'まちがい');
        await page.click('.button--primary');
        await page.waitForSelector('.verdict', { timeout: 5_000 });

        const answer = (await page.textContent('.verdict'))?.trim() ?? '';
        if (!answer) throw new Error('the verdict did not name the answer');

        // Through the correction, which is where a first answer ends up.
        await page.fill('.textinput--answer', answer);
        await page.click('.button--primary');
        await page.waitForSelector('.quiz__dock .button--primary:not([disabled])', {
          timeout: 5_000,
        });
      },
      async check(page) {
        const found = await page.evaluate(() => {
          const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');
          const dock = document.querySelector('.quiz__dock');
          return {
            next: /Next/.test(dock?.textContent ?? ''),
            undo: /Undo/.test(dock?.textContent ?? ''),
            // A first answer has nothing to compare against, so the schedule
            // line must not claim it does.
            nonsense: /NaN|Infinity|undefined|Invalid Date/.test(text),
          };
        });

        const issues = [];
        if (!found.next) issues.push('a first answer does not lead anywhere');
        if (!found.undo) issues.push('a first answer cannot be undone');
        if (found.nonsense) issues.push('a first answer produced a number that is not one');
        return issues;
      },
    },
  ],

  /*
   * Pressing the cue buttons, which is the only way to find out that the audio
   * code runs at all in a browser: a headless one has no speakers, so what can
   * be checked is that asking for a sound throws nothing and leaves no console
   * error behind.
   */
  sound: [
    {
      name: 'played',
      async reach(page) {
        for (const label of ['Correct', 'Missed', 'Round done']) {
          await page.click(`button:has-text("${label}")`);
          await page.waitForTimeout(120);
        }
      },
    },
  ],

  practice: [
    deadDecks,
    {
      name: 'started',
      async reach(page) {
        await page.click('.button--block');
        await page.waitForSelector('.quiz', { timeout: 10_000 });
      },
    },
  ],
  /*
   * Starting a round that has no schedule left in it.
   *
   * The check is the point: with nothing due and nothing to introduce, the
   * screen has to ask a question anyway and has to say that is what it is
   * doing. A screen that says "nothing due" here is the bug the merge exists
   * to remove, and it would otherwise be invisible to an audit that only
   * measures boxes.
   */
  'practice-ahead': [
    {
      name: 'started',
      async reach(page) {
        await page.click('.button--block');
        await page.waitForSelector('.quiz', { timeout: 10_000 });
      },
      async check(page) {
        const found = await page.evaluate(() => {
          const header = document.querySelector('.card__header');
          return {
            marked: /extra practice/.test(header?.textContent ?? ''),
            asking: Boolean(document.querySelector('.quiz__prompt')),
          };
        });

        const issues = [];
        if (!found.asking) issues.push('the round stopped rather than falling through to practice');
        if (!found.marked) issues.push('a question past the schedule is not marked as practice');
        return issues;
      },
    },
  ],
};

/** Smallest comfortably hittable target. */
const MIN_TAP = 44;
const MIN_FONT = 12;

/**
 * Screens that have to fit the window with nothing below the fold.
 *
 * The ones where something is *done*: a question is asked and answered, a round
 * is started, a setting is chosen. Scrolling to reach the thing you came to
 * press is the failure this list exists to prevent, and on those screens it is
 * always avoidable — there is a fixed amount to show and it is small.
 *
 * Everything else is exempt, and the exemptions are the point of naming them
 * rather than leaving the rule vague:
 *
 *   browse      a list of 9,445 items. A list is scrolled; that is what it is.
 *   progress    a report: streak, eight level bars, the sticking points.
 *   scheduler   a report with a calibration curve and its explanation.
 *   account     settings, the sync badge, the licences.
 *   about       prose.
 *
 * Those five are read, not operated, and forcing them into a window would mean
 * hiding what someone came to read. What is *not* exempt on them is everything
 * else in this file: nothing may overflow sideways, be too small to hit, or sit
 * under the tab bar.
 */
const MUST_FIT = new Set([
  'practice',
  'practice-silent',
  'practice-empty',
  'practice-ahead',
  'summary',
  'reading',
  'writing',
  'fill',
  'audio',
  'reading-empty',
  'fill-empty',
  'audio-empty',
  'handwriting',
  'choice',
  'input',
  'signin',
  'sync',
]);

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

  /** Whether anything above this element scrolls horizontally by design. */
  const insideHorizontalScroller = (el) => {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
      node = node.parentElement;
    }
    return false;
  };

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
      /*
       * Inside something that scrolls sideways on purpose, being past the edge
       * is the design rather than the bug.
       *
       * The rule this check exists for is a *page* that slides under a thumb
       * because something on it is too wide — you cannot reach what is out
       * there, and the whole layout moves when you try. A row of level chips
       * with `overflow-x: auto` is the opposite: the overflow is contained, it
       * has a visible edge, and swiping it is the offered gesture.
       *
       * Ancestors are walked rather than checked one deep, since the scroller
       * is usually a grandparent of whatever is actually out of view.
       */
      if (!parentAlsoOut && !insideHorizontalScroller(el)) {
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

  /*
   * The primary action, and whether you can see it.
   *
   * "Does the card fit" stops being the right question when the text is scaled
   * up: the window did not grow. What does not stop being the right question is
   * whether the button the screen exists for is on screen before any scrolling,
   * and above the tab bar rather than behind it.
   */
  const primary = document.querySelector('.quiz__dock .button--primary, .card .button--primary');
  const primaryBox = primary?.getBoundingClientRect();
  const action =
    primary && primaryBox && primaryBox.height > 0
      ? {
          label: (primary.textContent ?? '').trim().slice(0, 20),
          bottom: Math.round(primaryBox.bottom),
          fold: Math.round(barBox ? barBox.top : window.innerHeight),
        }
      : null;

  return {
    viewport,
    scrollWidth: doc.scrollWidth,
    // What is below the fold, for the screens that may not have anything there.
    scrollHeight: doc.scrollHeight,
    window: window.innerHeight,
    action,
    overflowing: overflowing.slice(0, 8),
    occluded: occluded.slice(0, 4),
    smallTaps: smallTaps.slice(0, 8),
    smallText: smallText.slice(0, 6),
    faintText: faintText.slice(0, 6),
  };
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/*
 * Refuse to audit something that is not the app.
 *
 * Without a dev server on BASE, every screen loads the browser's connection
 * error page, every check then fails on ITS markup, and the run reports a large
 * number of confident, entirely fictional problems. That happened on
 * 2026-09-03: 152 of them, read as real for several minutes.
 *
 * The quieter version of the same trap is a STALE server, and this guard does
 * NOT catch it: on 2026-09-04 four instances from the previous day were still
 * answering 5173 to 5176, an audit fell back to 5173, and reported a confident
 * 0 problems for a build it had never seen.
 *
 * So use `npm run ui:fresh`, which starts a server on 5210 with --strictPort
 * and audits that. strictPort means it FAILS rather than sliding to the next
 * free port, which is the whole point: a port that is taken is an error, not
 * something to route around silently.
 *
 * The original wording of this comment follows, and it is still true. Ports 5173 to 5175
 * accumulate instances from earlier sessions, so a run started without UI_BASE
 * can silently audit a build from yesterday and pass.
 *
 * So: fail loudly here rather than produce fiction, and print what is serving.
 */
{
  let res;
  try {
    res = await fetch(BASE, { signal: AbortSignal.timeout(5000) });
  } catch (err) {
    console.error(
      `\nNothing is serving ${BASE}.\n\n` +
      `  npm run dev        then re-run npm run ui\n` +
      `  UI_BASE=http://localhost:5175 npm run ui   to point at another port\n\n` +
      `Refusing to run: with no server every screen loads an error page and this\n` +
      `script would report dozens of problems that are not in your code.\n`,
    );
    process.exit(1);
  }
  const html = await res.text();
  if (!res.ok || !html.includes('<div id="root"')) {
    console.error(
      `\n${BASE} answered ${res.status} but does not look like this app.\n` +
      `Something else is on that port. Point UI_BASE at the right one.\n`,
    );
    process.exit(1);
  }
  console.log(`Auditing ${BASE}`);
}

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

    /*
     * The system font size, applied before anything renders.
     *
     * Overriding `html { font-size }` scales every `rem` and looks convincing,
     * and it is the wrong mechanism: Android and iOS raise the *browser's
     * default* font size, which scales rem and also makes `em` media queries
     * respond — the mechanism a stylesheet is supposed to adapt through. This
     * is that same browser setting.
     */
    if (viewport.scale) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Page.enable');
      await cdp.send('Page.setFontSizes', {
        fontSizes: { standard: Math.round(16 * viewport.scale) },
      });
    }

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

    let idleFailed = false;
    try {
      await page.goto(`${BASE}/#/preview/${screen}`, { waitUntil: 'networkidle', timeout: 30_000 });
    } catch {
      // A screen that never goes idle used to be swallowed here, with a comment
      // saying it was worth knowing about. It was not reported, and that is the
      // hole this whole script fell through on 2026-09-04: when the deck fetch
      // failed, the page rendered empty, nothing overlapped anything, and the
      // run announced 0 problems for a screen with no content on it. Twice in
      // two days a confident pass meant "the page never loaded".
      idleFailed = true;
    }
    await page.waitForTimeout(700);

    /*
     * A screen with no content cannot have a layout problem, so measuring one
     * is worse than not running: it returns a pass. Refuse to grade a page that
     * did not render, and say which it was.
     */
    const rendered = await page
      .evaluate(() => {
        const root = document.querySelector('#root');
        if (!root) return { ok: false, why: 'no #root' };
        const text = (root.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text.length < 20) return { ok: false, why: `only ${text.length} chars of text` };
        return { ok: true, why: '' };
      })
      .catch((error) => ({ ok: false, why: `evaluate failed: ${String(error).slice(0, 60)}` }));

    if (!rendered.ok || idleFailed) {
      problems += 1;
      summary.push({
        screen: label,
        viewport: viewport.name,
        issues: [
          `did not render, so nothing was measured: ${rendered.why || 'never went idle'}`,
        ],
      });
      await page.close();
      continue;
    }

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
    /*
     * Below the fold, on a screen that is operated rather than read.
     *
     * Only in the resting state: the keyboard states have their own rules in
     * `keyboardChecks`, which know that a keyboard changes what "the fold"
     * means and that one state is allowed to scroll.
     *
     * And only at the default text size. With the system font turned up the
     * window has not grown while everything in it has, and the honest standard
     * changes with it: at 1.3 on a 320px phone the tab bar alone is 110px of
     * 640, and demanding that a whole card still fit would mean shrinking text
     * its owner deliberately enlarged. What must still hold is that the thing
     * you came to press is on screen without scrolling for it — which is
     * checked below, for every viewport, scaled or not.
     */
    if (MUST_FIT.has(screen) && !state?.name?.startsWith('keyboard') && !viewport.scale) {
      const below = result.scrollHeight - result.window;
      if (below > 1) issues.push(`${below}px below the fold on a screen that should fit`);
    }

    if (MUST_FIT.has(screen) && !state?.name?.startsWith('keyboard') && result.action) {
      const past = result.action.bottom - result.action.fold;
      if (past > 1) {
        issues.push(`"${result.action.label}" is ${past}px below the fold — the action itself`);
      }
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
