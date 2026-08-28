/**
 * How much of the window the on-screen keyboard is covering.
 *
 * The quiz's buttons — Check, Next, "I don't know" — are the two things pressed
 * on every question, and with an IME open on a phone they were below the fold.
 * Putting them where the thumb is means knowing where the keyboard starts, and
 * that is harder than it sounds: whether the *layout* viewport shrinks when the
 * keyboard opens is the browser's choice, not ours.
 *
 * Where it does shrink — which `interactive-widget=resizes-content` in the
 * viewport meta asks for, and Chromium honours — `100dvh`, `position: fixed`
 * and sticky all follow the keyboard for free, and this module measures zero
 * and changes nothing. Where it does not, `bottom: 0` stays pinned to the
 * full-height layout viewport, which is to say behind the keyboard, and this is
 * the only thing that reports the truth.
 *
 * Publishes two values on the root element:
 *
 *   --keyboard-inset   pixels of the window the keyboard is covering
 *   data-keyboard      "open", so the tab bar can get out of the way
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

export function watchKeyboardInset(): () => void {
  const viewport = window.visualViewport;
  const root = document.documentElement;

  // No visualViewport means an old browser, and an old browser is one that
  // resizes the layout viewport — so the CSS already works there.
  if (!viewport) return () => {};

  let frame = 0;

  const measure = () => {
    frame = 0;

    // offsetTop matters: iOS scrolls the visual viewport up to keep the focused
    // field visible, and the covered strip is what is left below it.
    const covered = window.innerHeight - (viewport.height + viewport.offsetTop);
    const inset = covered >= OPEN_FROM_PX ? Math.round(covered) : 0;

    root.style.setProperty('--keyboard-inset', `${inset}px`);
    if (inset > 0) root.dataset.keyboard = 'open';
    else delete root.dataset.keyboard;
  };

  // Both events fire in bursts as the keyboard animates in.
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(measure);
  };

  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  measure();

  return () => {
    if (frame) cancelAnimationFrame(frame);
    viewport.removeEventListener('resize', schedule);
    viewport.removeEventListener('scroll', schedule);
  };
}
