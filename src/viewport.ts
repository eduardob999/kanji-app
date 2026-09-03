/**
 * Whether the on-screen keyboard is up, and how much of the window it covers.
 *
 * The quiz's buttons — Check, Next, "I don't know" — are the two things pressed
 * on every question, and with an IME open on a phone they were below the fold.
 * Putting them where the thumb is means knowing where the keyboard starts, and
 * that is harder than it sounds: whether the *layout* viewport shrinks when the
 * keyboard opens is the browser's choice, not ours.
 *
 * Publishes two things on the root element, and they are deliberately not the
 * same fact:
 *
 *   data-keyboard      "open" whenever a keyboard is up, however the browser
 *                      reacted to it. Whatever must get out of the way while
 *                      someone is typing keys off this: the tab bar, and the
 *                      space reserved for it.
 *   --keyboard-inset   pixels of the *layout* viewport the keyboard covers.
 *                      Non-zero only when the layout viewport did not shrink by
 *                      itself. Anything positioned against the bottom of the
 *                      window keys off this.
 *
 * Two facts because there are two browser behaviours, and one number cannot
 * carry both:
 *
 *   resizes-content   The layout viewport itself shrinks, which is what
 *                     `interactive-widget=resizes-content` in the viewport meta
 *                     asks for and what Chrome on Android does. `100dvh`,
 *                     `position: fixed` and sticky all follow the keyboard for
 *                     free, so the inset must stay zero or every rule using it
 *                     subtracts the keyboard twice. The keyboard is still open,
 *                     though, and the tab bar is still 79px of a 464px window
 *                     that nobody can use while typing.
 *   resizes-visual    Only the visual viewport shrinks, which is iOS and
 *                     anything ignoring the meta. `bottom: 0` stays pinned to
 *                     the full-height layout viewport, which is to say behind
 *                     the keyboard, and the inset is the only thing that
 *                     reports the truth.
 *
 * Conflating them is the bug this file shipped with. `--keyboard-inset` was the
 * only output, so on Chrome for Android it measured zero, correctly, and
 * `data-keyboard` was therefore never set: the tab bar stayed up, its 72px of
 * reserved clearance stayed reserved, and the sticky dock was pushed up over
 * the very word the question was asking about. Rendered at 390x844 with a 380px
 * keyboard, the prompt was 113px tall with the dock covering 100px of it.
 *
 * ## How the second case is detected
 *
 * By the layout viewport getting shorter while something is being typed into.
 * `window.innerHeight` is compared against the tallest it has been while
 * nothing editable had focus, which is the window at rest.
 *
 * Focus is what makes this safe. A shrinking layout viewport on its own is
 * ambiguous: a collapsing URL bar does it too, and so does rotating the phone.
 * A shrink of more than `OPEN_FROM_PX` that arrives while a text field is
 * focused is a keyboard, and nothing else on a phone is.
 *
 * ## What is deliberately not used
 *
 * `navigator.virtualKeyboard`, the one API that reports the keyboard's geometry
 * exactly. It only reports anything once `overlaysContent = true`, which turns
 * off the browser's own resizing and hands the whole problem to our CSS. That
 * may well be the better end state, and it cannot be checked here: a headless
 * browser has no keyboard to raise, so `npm run ui` could not tell a working
 * implementation from a broken one. It is not going on his only phone untested.
 *
 * Not a hook. It is a fact about the document rather than about any component,
 * it must hold for the preview harness as much as for the app, and starting it
 * once from `main.tsx` is fewer moving parts than a provider nobody reads.
 */

/**
 * Below this, it is not a keyboard.
 *
 * A collapsing URL bar and Safari's rubber-band scroll both leave the visual
 * viewport a little shorter than the window, and treating either as a keyboard
 * would make the action bar hop around while someone scrolls a long sentence.
 * Every soft keyboard is far larger than this.
 */
const OPEN_FROM_PX = 120;

/**
 * Input types that raise no keyboard.
 *
 * A date or colour picker opens its own widget, and a checkbox opens nothing.
 * Treating either as text would hide the tab bar for a tap.
 */
const NO_KEYBOARD = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** Whether what has focus is something a soft keyboard would open for. */
function typingInto(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !NO_KEYBOARD.has(el.type);
  return el.isContentEditable;
}

export function watchKeyboardInset(): () => void {
  const viewport = window.visualViewport;
  const root = document.documentElement;

  /*
   * The window at rest, and the width it was measured at.
   *
   * Only ever raised, and only while nothing is being typed into, so a URL bar
   * that collapses as the keyboard arrives cannot quietly lower the baseline
   * and make the keyboard look smaller than it is. The width is kept beside it
   * because rotating the phone makes the old height meaningless rather than
   * merely stale.
   */
  let resting = window.innerHeight;
  let restingWidth = window.innerWidth;

  let frame = 0;

  const measure = () => {
    frame = 0;

    const typing = typingInto();

    if (window.innerWidth !== restingWidth) {
      restingWidth = window.innerWidth;
      resting = window.innerHeight;
    } else if (!typing) {
      resting = Math.max(resting, window.innerHeight);
    }

    /*
     * offsetTop matters: iOS scrolls the visual viewport up to keep the focused
     * field visible, and the covered strip is what is left below it.
     */
    const covered = viewport ? window.innerHeight - (viewport.height + viewport.offsetTop) : 0;
    const inset = covered >= OPEN_FROM_PX ? Math.round(covered) : 0;

    // The layout viewport itself gave way. Nothing to subtract, and every bit
    // as much a keyboard.
    const shrank = typing && resting - window.innerHeight >= OPEN_FROM_PX;

    root.style.setProperty('--keyboard-inset', `${inset}px`);
    if (inset > 0 || shrank) root.dataset.keyboard = 'open';
    else delete root.dataset.keyboard;
  };

  // The events fire in bursts as the keyboard animates in.
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(measure);
  };

  /*
   * `resize` on the window is what the resizes-content case actually fires;
   * visualViewport's own events cover the other one. Focus changes are listened
   * to as well because the two can arrive in either order, and a focus that
   * lands after the resize would otherwise leave the state a frame stale for
   * good.
   */
  window.addEventListener('resize', schedule);
  window.addEventListener('focusin', schedule);
  window.addEventListener('focusout', schedule);
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  measure();

  return () => {
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('focusin', schedule);
    window.removeEventListener('focusout', schedule);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
  };
}
