import { contrast, fromHex, oklch, toHex, type Rgb } from './colour';

/**
 * The accent, chosen by hue and nothing else.
 *
 * Four tokens carry the accent in this app — the colour itself, a softer
 * version for text, a wash for active states, and what is legible *on* it — and
 * they differ between the two themes, because the dark theme's accent is ink
 * diluted until it reads against an ink ground and the light theme's is ink at
 * full strength. Everything here is that arrangement with the hue pulled out as
 * a parameter.
 *
 * The lightness and chroma are the app's to choose and the learner's to leave
 * alone. That is the whole design: a hue slider cannot produce an unreadable
 * button, because the only thing it moves is the one dimension that does not
 * decide contrast.
 */

export const DEFAULT_HUE = 250;

/**
 * The ground's own hue when nobody has chosen one.
 *
 * This is the *dark* theme's, and the light theme's is 81 — the palette is two
 * hues by design, ink and washi, and reproducing the app as drawn means
 * honouring both. So the stored setting is absent until a learner picks
 * something, and each theme falls back to its own; a chosen hue applies to
 * both, because a learner who picks green means green.
 */
export const DEFAULT_GROUND_HUE = 249;

export type Scheme = 'dark' | 'light';

/**
 * The ground the app is painted on, as three steps and a hue.
 *
 * The page, the cards on it, and the insets inside those — measured from the
 * palette they replace, so the default hue reproduces the app as drawn: #101a24,
 * #17242f and #1e2f3d on dark; #faf4ea, #fffdf7 and #f0e7d7 on light.
 *
 * Only the hue moves. The lightness of each step is what decides whether text
 * on it can be read, and that stays the app's — the same bargain the accent
 * makes, for the same reason: there is no useful version of this feature where
 * a learner can choose an unreadable one.
 */
const GROUND_RECIPE = {
  dark: {
    hue: 249,
    page: [0.2132, 0.0247, 0],
    card: [0.2537, 0.0276, -4.3],
    inset: [0.2969, 0.0341, -4.9],
    /*
     * The quieter writing, which follows the ground rather than staying grey.
     *
     * A green ground with blue-grey secondary text reads as two palettes, and
     * this text is everywhere — labels, hints, the placeholder in the answer
     * field. Its *lightness* is the app's, chosen so that the worst hue still
     * clears AA on the deepest surface: measured over all 360, the floor is
     * 5.26 on dark and 4.62 on light, against the 4.5 body text needs.
     *
     * The light value is a hair darker than the palette it replaces (#5b6a78),
     * which measured 4.53 on its own inset — over the line, but with nothing to
     * spare for a hue that moved.
     */
    muted: [0.71, 0.022, -4],
  },
  light: {
    hue: 80.7,
    page: [0.9691, 0.0147, 0],
    card: [0.9939, 0.0082, 10.8],
    inset: [0.9307, 0.0234, 1.4],
    muted: [0.51, 0.028, 164],
  },
} as const;

/**
 * The writing, which does not follow the ground's hue.
 *
 * Warm cream on dark and near-black ink on light, both from the icon. Tinting
 * these with the ground would be more "designed" and would quietly undo the
 * thing that makes the palette recognisable — and since contrast is dominated
 * by lightness, tinting would buy nothing measurable either.
 */
const INK = {
  dark: { text: '#f3ece0' },
  light: { text: '#121f2e' },
} as const;

export interface GroundTokens {
  bg: string;
  bgElevated: string;
  bgInset: string;
  text: string;
  textMuted: string;
}

/**
 * The three ground steps for a hue, or for the app's own when none is chosen.
 *
 * The third number in each step is that step's hue *relative to the page* —
 * measured from the palette, where the card and inset drift a few degrees from
 * the page and the light theme's card drifts ten. Small enough to be invisible
 * as a colour and exactly what makes the default reproduce the app to the byte;
 * carried across a custom hue so a chosen green has the same internal
 * relationships the original had.
 */
export function groundTokens(hue: number | undefined, scheme: Scheme): GroundTokens {
  const recipe = GROUND_RECIPE[scheme];
  const base = isHue(hue) ? hue : recipe.hue;
  const step = ([lightness, chroma, drift]: readonly [number, number, number]) =>
    toHex(oklch(lightness, chroma, (base + drift + 360) % 360));

  return {
    bg: step(recipe.page),
    bgElevated: step(recipe.card),
    bgInset: step(recipe.inset),
    text: INK[scheme].text,
    textMuted: step(recipe.muted),
  };
}

export interface AccentTokens {
  accent: string;
  accentSoft: string;
  accentWash: string;
  onAccent: string;
}

/*
 * Measured from the palette these replace, so the default hue reproduces the
 * app as drawn: #7fa9d6 on dark is L 0.72 C 0.08, #1b3550 on light is L 0.33
 * C 0.06. The chroma is a little under what those have, because the most
 * saturated hues in sRGB run out of room before the least saturated do and a
 * hue slider may not have a dead zone.
 */
const RECIPE = {
  dark: { accent: [0.72, 0.09], soft: [0.83, 0.07], on: '#101a24' },
  light: { accent: [0.36, 0.08], soft: [0.47, 0.09], on: '#fffdf7' },
} as const;

export function accentTokens(hue: number, scheme: Scheme): AccentTokens {
  const recipe = RECIPE[scheme];
  const accent = oklch(recipe.accent[0], recipe.accent[1], hue);
  const soft = oklch(recipe.soft[0], recipe.soft[1], hue);

  return {
    accent: toHex(accent),
    accentSoft: toHex(soft),
    // The wash is the accent at low alpha over the page, and stays a colour
    // rather than a `color-mix` so that a test can read it.
    accentWash: `rgba(${accent.r}, ${accent.g}, ${accent.b}, ${scheme === 'dark' ? 0.16 : 0.1})`,
    onAccent: recipe.on,
  };
}

/**
 * The stylesheet that makes a hue the app's accent.
 *
 * Both themes at once, because which one is in use is the browser's business
 * and can change while the app is open — a phone that switches at sunset should
 * not need a reload to keep the colour someone chose.
 */
export function themeStylesheet(hue: number, groundHue: number | undefined): string {
  const block = (scheme: Scheme) => {
    const accent = accentTokens(hue, scheme);
    const ground = groundTokens(groundHue, scheme);
    return `
    --accent: ${accent.accent};
    --accent-soft: ${accent.accentSoft};
    --accent-wash: ${accent.accentWash};
    --on-accent: ${accent.onAccent};
    --bg: ${ground.bg};
    --bg-elevated: ${ground.bgElevated};
    --bg-inset: ${ground.bgInset};
    --text: ${ground.text};
    --text-muted: ${ground.textMuted};`;
  };

  return `:root {${block('dark')}\n}\n@media (prefers-color-scheme: light) {\n  :root {${block('light')}\n  }\n}`;
}

/** What a hue has to clear before it may be offered. */
export interface AccentContrast {
  /** Label on a primary button. */
  onAccent: number;
  /** Accent-coloured text on the page and on a card. */
  softOnPage: number;
  softOnCard: number;
  /** The accent as a large block — a filled button — against the page. */
  accentOnPage: number;
}

export function accentContrast(
  hue: number,
  scheme: Scheme,
  groundHue?: number,
): AccentContrast {
  const tokens = accentTokens(hue, scheme);
  const ground = groundTokens(groundHue, scheme);
  const accent: Rgb = fromHex(tokens.accent);
  const soft: Rgb = fromHex(tokens.accentSoft);

  return {
    onAccent: contrast(accent, fromHex(tokens.onAccent)),
    softOnPage: contrast(soft, fromHex(ground.bg)),
    softOnCard: contrast(soft, fromHex(ground.bgElevated)),
    accentOnPage: contrast(accent, fromHex(ground.bg)),
  };
}

export interface GroundContrast {
  /** Body text on the page and on a card. */
  textOnPage: number;
  textOnCard: number;
  /** The quieter text, which is the one that gets close. */
  mutedOnPage: number;
  mutedOnCard: number;
  /** And on the deepest surface, which holds the answer field. */
  mutedOnInset: number;
}

export function groundContrast(hue: number | undefined, scheme: Scheme): GroundContrast {
  const ground = groundTokens(hue, scheme);
  const text = fromHex(ground.text);
  const muted = fromHex(ground.textMuted);

  return {
    textOnPage: contrast(text, fromHex(ground.bg)),
    textOnCard: contrast(text, fromHex(ground.bgElevated)),
    mutedOnPage: contrast(muted, fromHex(ground.bg)),
    mutedOnCard: contrast(muted, fromHex(ground.bgElevated)),
    mutedOnInset: contrast(muted, fromHex(ground.bgInset)),
  };
}

export function isHue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 360;
}
