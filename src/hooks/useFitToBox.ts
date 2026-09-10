import { useLayoutEffect, type RefObject } from 'react';

/**
 * Shrinks a box's type until the box holds all of it.
 *
 * The kanji writing prompt is every reading a character has plus its meaning,
 * and both are long-tailed: the median item is 8 characters of readings and 28
 * of meaning, 代 is 86 and 121. Laid out at one size, the median leaves half the
 * card empty and the tail pushes the meaning out of sight — measured at 360px
 * with a 45% keyboard, eleven of the twelve worst items in the corpus had their
 * meaning below the bottom of the prompt, by up to 36px. Scrolling to read the
 * question you are being asked is not much of an answer when the thing you have
 * to scroll is four lines tall.
 *
 * So the question is fitted to the room instead. `--fit` is a multiplier the
 * prompt's type is defined in terms of; this searches for the largest value of
 * it that fits and stops there. A median item never leaves 1, because 1 already
 * fits.
 *
 * **It can only ever shrink**, and only where the box is genuinely constrained
 * — which on this screen means with the keyboard up, where the prompt is a flex
 * item with a definite height. With the keyboard down the prompt is sized by
 * its own contents, `scrollHeight` equals `clientHeight`, and this returns
 * without touching anything.
 *
 * Each step is one forced layout of a small subtree, seven of them, and only
 * when the question changes or the window does. That is cheaper than it sounds
 * and much cheaper than the alternative, which is measuring text by hand
 * against a font this app does not choose.
 */

/**
 * As small as this may make anything.
 *
 * A floor on the multiplier as well as on each individual size — the sizes it
 * scales carry their own `max()` so nothing drops below what `npm run ui`
 * accepts as readable. If the content still does not fit at the floor, it
 * scrolls, which is what it did before this existed.
 *
 * 0.45 rather than the 0.6 this started at, and the reason is a lesson about
 * the harness rather than about the layout: every measurement behind that 0.6
 * was taken in a container with no Japanese font, where kana rendered as tofu
 * boxes with the wrong metrics. With a real font installed the same questions
 * need more room, the multiplier hit its floor before the per-size floors did,
 * and the numbers this file was tuned against turned out to be about squares.
 *
 * The `max()` floors are the real limit — 12.5px, which is what "readable"
 * means here — and this now lets the search reach them.
 */
const FLOOR = 0.45;

/** Seven halvings land within a percent of the largest size that fits. */
const STEPS = 7;

export function useFitToBox(ref: RefObject<HTMLElement | null>, key: string): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      // Always from full size: the room may have grown since the last fit, and
      // a multiplier left over from a longer question would strand this one
      // small.
      el.style.setProperty('--fit', '1');
      if (el.scrollHeight <= el.clientHeight) return;

      let fits = FLOOR;
      let tooBig = 1;
      for (let step = 0; step < STEPS; step += 1) {
        const mid = (fits + tooBig) / 2;
        el.style.setProperty('--fit', mid.toFixed(3));
        if (el.scrollHeight <= el.clientHeight) fits = mid;
        else tooBig = mid;
      }
      el.style.setProperty('--fit', fits.toFixed(3));
    };

    /*
     * Never straight off the event that prompted it.
     *
     * A resize is not the moment the room changes size. `watchKeyboardInset`
     * measures in a frame of its own and only then sets `data-keyboard`, which
     * is what gives the prompt a definite height — so a fit run synchronously
     * on `resize` measures the box as it was a moment ago, finds it
     * unconstrained, and returns having done nothing. That is not a subtle
     * failure: it is the whole feature not running on the one transition it
     * exists for, and `npm run ui` caught it doing exactly that, 36px of
     * meaning off the bottom at 360px.
     */
    let scheduled = 0;
    const schedule = () => {
      if (scheduled) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        fit();
      });
    };

    schedule();

    /*
     * The box itself is what to watch.
     *
     * A keyboard opening, a phone rotating, the dock growing a line — they all
     * reach this the same way, by changing the height the prompt was given, and
     * the observer fires after the layout that did it rather than before. Our
     * own shrinking cannot feed back into it: while the box is constrained its
     * height comes from the flex layout, not from what is inside it.
     */
    const observer = new ResizeObserver(schedule);
    observer.observe(el);

    /*
     * And a resize, for the changes the observer cannot see: a window that gets
     * wider re-wraps the text inside a box whose height the flex layout has
     * already fixed, so the same room now holds a different number of lines.
     * Deferred through `schedule` like everything else, which is what makes
     * listening to this safe rather than early.
     */
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);

    // The Japanese font decides how tall the readings are, and it may not have
    // arrived when the first question does.
    void document.fonts?.ready.then(schedule).catch(() => {});

    return () => {
      if (scheduled) cancelAnimationFrame(scheduled);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      el.style.removeProperty('--fit');
    };
  }, [key, ref]);
}
