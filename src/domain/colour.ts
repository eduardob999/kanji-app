/**
 * Just enough colour science to promise that a chosen accent is readable.
 *
 * The app's palette is four accent tokens per theme, and letting someone pick
 * any colour they like is how a study app ends up with a primary button nobody
 * can read the label on. A colour wheel is not a feature if half of it is
 * broken.
 *
 * So the choice offered is a *hue*, and everything else about the colour —
 * lightness, chroma, and what goes on top of it — is fixed by the app at values
 * chosen to clear WCAG AA. OKLCH is what makes that possible: unlike HSL, its
 * lightness is perceptual, so `oklch(0.72 0.1 H)` is about equally light for
 * every H, and equally light means equally readable against the same
 * background. "About" is not good enough on its own, which is why
 * `theme.test.ts` checks all 360 of them.
 *
 * No dependency: the conversion is thirty lines and a matrix, and it has to run
 * in a test in Node as well as in the browser.
 */

export interface Rgb {
  /** 0-255. */
  r: number;
  g: number;
  b: number;
}

/** OKLab to linear sRGB, then gamma, then bytes. Björn Ottosson's matrices. */
function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function gamma(channel: number): number {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function inGamut([r, g, b]: [number, number, number]): boolean {
  return [r, g, b].every((channel) => channel >= -0.0001 && channel <= 1.0001);
}

/**
 * An OKLCH colour as sRGB, brought into gamut by giving up chroma.
 *
 * Some hues at a given lightness are simply more saturated than sRGB can hold —
 * a vivid blue-green far more than a muted orange. Clamping the channels
 * instead would change the hue and the lightness, which is exactly what this
 * whole module exists to keep fixed, so what gives way is the saturation.
 */
export function oklch(lightness: number, chroma: number, hue: number): Rgb {
  const radians = (hue * Math.PI) / 180;

  let c = chroma;
  let linear = oklabToLinear(lightness, c * Math.cos(radians), c * Math.sin(radians));

  // 40 halvings would take chroma below a millionth; in practice this exits in
  // one or two.
  for (let attempt = 0; attempt < 40 && !inGamut(linear); attempt += 1) {
    c *= 0.94;
    linear = oklabToLinear(lightness, c * Math.cos(radians), c * Math.sin(radians));
  }

  const byte = (channel: number) => Math.round(Math.min(1, Math.max(0, gamma(channel))) * 255);
  return { r: byte(linear[0]), g: byte(linear[1]), b: byte(linear[2]) };
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function fromHex(hex: string): Rgb {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio, 1 to 21. */
export function contrast(one: Rgb, two: Rgb): number {
  const a = relativeLuminance(one);
  const b = relativeLuminance(two);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}
