import { describe, expect, it } from 'vitest';
import { contrast, fromHex } from './colour';
import {
  accentContrast,
  accentTokens,
  DEFAULT_HUE,
  groundContrast,
  groundTokens,
  type Scheme,
} from './theme';

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

describe('every background hue', () => {
  it('keeps body text at AA on the page and on a card', () => {
    for (const scheme of SCHEMES) {
      for (const hue of HUES) {
        const { textOnPage, textOnCard } = groundContrast(hue, scheme);
        expect(textOnPage).toBeGreaterThanOrEqual(4.5);
        expect(textOnCard).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the quiet text at AA, including on the deepest surface', () => {
    /*
     * The muted colour is the one that gets close: it is a step down from the
     * body text by design, and the inset — the answer field, the meters — is a
     * step up from the card. That pairing is where a ground would fail first,
     * so it is checked explicitly rather than being assumed to follow.
     */
    for (const scheme of SCHEMES) {
      for (const hue of HUES) {
        const { mutedOnPage, mutedOnCard, mutedOnInset } = groundContrast(hue, scheme);
        expect(mutedOnPage).toBeGreaterThanOrEqual(4.5);
        expect(mutedOnCard).toBeGreaterThanOrEqual(4.5);
        expect(mutedOnInset).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('reproduces the app as drawn at its default hue', () => {
    // The palette these replace, to the byte: a change to the recipe that moves
    // the app off its own icon should have to be deliberate.
    // Unset is the app's own palette, which is two hues: ink at 249 and washi
    // at 81. Reproducing it means each theme falling back to its own.
    expect(groundTokens(undefined, 'dark')).toMatchObject({
      bg: '#101a24',
      bgElevated: '#17242f',
      bgInset: '#1e2f3d',
      text: '#f3ece0',
    });
    expect(groundTokens(undefined, 'light')).toMatchObject({
      bg: '#faf4ea',
      bgElevated: '#fffdf7',
      bgInset: '#f0e7d7',
      text: '#121f2e',
    });
  });
});

describe('every accent against every background', () => {
  /*
   * 129,600 pairs per theme, and worth every one of them.
   *
   * The two pickers are independent — a learner can put a yellow accent on a
   * yellow ground — so checking each against the *default* of the other proves
   * nothing about the combination they will actually choose. Both token sets
   * are precomputed per hue so the inner loop is only arithmetic.
   */
  it('keeps accent text readable on whatever ground it lands on', () => {
    for (const scheme of SCHEMES) {
      const accents = HUES.map((hue) => fromHex(accentTokens(hue, scheme).accentSoft));
      const grounds = HUES.map((hue) => {
        const ground = groundTokens(hue, scheme);
        return { page: fromHex(ground.bg), card: fromHex(ground.bgElevated) };
      });

      let worst = { ratio: 21, accent: -1, ground: -1 };

      for (let accent = 0; accent < accents.length; accent += 1) {
        for (let ground = 0; ground < grounds.length; ground += 1) {
          const onPage = contrast(accents[accent]!, grounds[ground]!.page);
          const onCard = contrast(accents[accent]!, grounds[ground]!.card);
          const ratio = Math.min(onPage, onCard);
          if (ratio < worst.ratio) worst = { ratio, accent, ground };
        }
      }

      expect({ scheme, ...worst, ratio: Number(worst.ratio.toFixed(2)) }).toEqual({
        scheme,
        accent: worst.accent,
        ground: worst.ground,
        ratio: expect.any(Number),
      });
      expect(worst.ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps a filled accent block visible on whatever ground it lands on', () => {
    for (const scheme of SCHEMES) {
      const accents = HUES.map((hue) => fromHex(accentTokens(hue, scheme).accent));
      const grounds = HUES.map((hue) => fromHex(groundTokens(hue, scheme).bg));

      let worst = 21;
      for (const accent of accents) {
        for (const ground of grounds) worst = Math.min(worst, contrast(accent, ground));
      }

      expect(worst).toBeGreaterThanOrEqual(3);
    }
  });
});
