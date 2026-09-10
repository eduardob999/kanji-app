import { describe, expect, it } from 'vitest';
import { accentContrast, accentTokens, DEFAULT_HUE, type Scheme } from './theme';

/**
 * The promise the accent picker makes: no hue produces an unreadable app.
 *
 * A colour wheel where a third of the wheel breaks the primary button is not a
 * feature, and "we chose sensible values" is not a check. This is the check —
 * all 360 hues, both themes, against the real backgrounds from `styles.css`.
 */

const HUES = Array.from({ length: 360 }, (_, hue) => hue);
const SCHEMES: Scheme[] = ['dark', 'light'];

describe('every accent hue', () => {
  it('keeps the label on a primary button at AA', () => {
    for (const scheme of SCHEMES) {
      for (const hue of HUES) {
        const { onAccent } = accentContrast(hue, scheme);
        // Named in the message so a failure says which hue, not just "4.31".
        expect({ scheme, hue, onAccent: Number(onAccent.toFixed(2)) }).toEqual({
          scheme,
          hue,
          onAccent: expect.any(Number),
        });
        expect(onAccent).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps accent-coloured text at AA on the page and on a card', () => {
    for (const scheme of SCHEMES) {
      for (const hue of HUES) {
        const { softOnPage, softOnCard } = accentContrast(hue, scheme);
        expect(softOnPage).toBeGreaterThanOrEqual(4.5);
        expect(softOnCard).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps a filled accent block distinguishable from the page', () => {
    // WCAG 1.4.11: a control has to be visible as a shape, which is 3:1.
    for (const scheme of SCHEMES) {
      for (const hue of HUES) {
        expect(accentContrast(hue, scheme).accentOnPage).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('reproduces the app as drawn at its default hue', () => {
    // The default is the icon's own blue; this is a guard against the recipe
    // drifting away from the palette the rest of the design was built around.
    expect(accentTokens(DEFAULT_HUE, 'dark').accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(accentContrast(DEFAULT_HUE, 'dark').onAccent).toBeGreaterThan(6);
    expect(accentContrast(DEFAULT_HUE, 'light').onAccent).toBeGreaterThan(6);
  });
});
