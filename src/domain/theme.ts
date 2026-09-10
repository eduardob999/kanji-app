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

/** The backgrounds the accent has to hold up against, from `styles.css`. */
const GROUND = {
  dark: { page: '#101a24', card: '#17242f' },
  light: { page: '#faf4ea', card: '#fffdf7' },
} as const;

export type Scheme = keyof typeof GROUND;

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
export function accentStylesheet(hue: number): string {
  const dark = accentTokens(hue, 'dark');
  const light = accentTokens(hue, 'light');

  const block = (tokens: AccentTokens) => `
    --accent: ${tokens.accent};
    --accent-soft: ${tokens.accentSoft};
    --accent-wash: ${tokens.accentWash};
    --on-accent: ${tokens.onAccent};`;

  return `:root {${block(dark)}\n}\n@media (prefers-color-scheme: light) {\n  :root {${block(light)}\n  }\n}`;
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

export function accentContrast(hue: number, scheme: Scheme): AccentContrast {
  const tokens = accentTokens(hue, scheme);
  const ground = GROUND[scheme];
  const accent: Rgb = fromHex(tokens.accent);
  const soft: Rgb = fromHex(tokens.accentSoft);

  return {
    onAccent: contrast(accent, fromHex(tokens.onAccent)),
    softOnPage: contrast(soft, fromHex(ground.page)),
    softOnCard: contrast(soft, fromHex(ground.card)),
    accentOnPage: contrast(accent, fromHex(ground.page)),
  };
}

export function isHue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 360;
}
