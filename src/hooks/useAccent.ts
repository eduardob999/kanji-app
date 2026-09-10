import { useEffect } from 'react';
import { accentStylesheet, DEFAULT_HUE, isHue } from '../domain/theme';

/**
 * Paints the app in the learner's chosen accent.
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
const ELEMENT_ID = 'kanjiba-accent';

/**
 * Applies a hue immediately, outside React's render cycle.
 *
 * The picker calls this on the way to writing the profile, because the write is
 * deliberately not awaited: Firestore updates the local cache first and the
 * profile subscription follows, which is fast but is not *now*, and a colour
 * picker that answers a frame late feels broken in a way a saved setting never
 * makes up for. The subscription then arrives at the same value and this runs
 * again to no effect.
 */
export function applyAccent(hue: number | undefined): void {
  const chosen = isHue(hue) ? hue : DEFAULT_HUE;

  let element = document.getElementById(ELEMENT_ID) as HTMLStyleElement | null;
  if (!element) {
    element = document.createElement('style');
    element.id = ELEMENT_ID;
    document.head.append(element);
  }

  element.textContent = accentStylesheet(chosen);
}

/** The stored choice, applied and kept in step with the profile. */
export function useAccent(hue: number | undefined): void {
  useEffect(() => {
    applyAccent(hue);
  }, [hue]);
}
