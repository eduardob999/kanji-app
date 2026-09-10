import { useEffect } from 'react';
import { DEFAULT_HUE, isHue, themeStylesheet } from '../domain/theme';

/**
 * Paints the app in the learner's chosen colours.
 *
 * A `<style>` element rather than inline custom properties on `:root`, and the
 * reason is the light theme. The tokens differ between schemes, which scheme is
 * in use is the browser's business, and it can change while the app is open —
 * a phone that switches at sunset should not need a reload to keep the colour
 * someone picked. Inline properties cannot carry a media query; a stylesheet
 * can, so both themes are written at once and the browser picks.
 *
 * One element, reused: rewriting `textContent` restyles the app in a frame and
 * leaves no pile of stale rules behind a slider being dragged.
 */
const ELEMENT_ID = 'kanjiba-theme';

/**
 * Applies a hue immediately, outside React's render cycle.
 *
 * The pickers call this on the way to writing the profile, because the write is
 * deliberately not awaited: Firestore updates the local cache first and the
 * profile subscription follows, which is fast but is not *now*, and a colour
 * picker that answers a frame late feels broken in a way a saved setting never
 * makes up for. The subscription then arrives at the same value and this runs
 * again to no effect.
 */
export function applyTheme(hue: number | undefined, groundHue?: number | undefined): void {
  const accent = isHue(hue) ? hue : DEFAULT_HUE;
  /*
   * Left undefined when nobody has chosen one, rather than defaulted here.
   *
   * The app's own ground is two hues — ink at 249 on dark, washi at 81 on light
   * — so a single default substituted at this level would paint the light theme
   * cool blue and quietly lose the paper it was drawn on. `groundTokens` knows
   * both; this only has to not get in the way.
   */
  const ground = isHue(groundHue) ? groundHue : undefined;

  let element = document.getElementById(ELEMENT_ID) as HTMLStyleElement | null;
  if (!element) {
    element = document.createElement('style');
    element.id = ELEMENT_ID;
    document.head.append(element);
  }

  element.textContent = themeStylesheet(accent, ground);
}

/** The stored choices, applied and kept in step with the profile. */
export function useTheme(hue: number | undefined, groundHue: number | undefined): void {
  useEffect(() => {
    applyTheme(hue, groundHue);
  }, [groundHue, hue]);
}
