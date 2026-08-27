/**
 * Types for `pipeline.js`, which is plain JavaScript so that the build script
 * and the app can share one copy of the numerical routines.
 */

/** A point, `[x, y]`. */
export type Point = [number, number];

/** One stroke: the points it was drawn through, in order. */
export type Stroke = Point[];

/** A drawn or reference character: its strokes, in the order they were made. */
export type Pattern = Stroke[];

/**
 * A reference character: `[character, strokeCount, features]`.
 *
 * `features` is the output of `extractFeatures(momentNormalize(raw), 20)`, not
 * the raw strokes — that is the space comparisons happen in.
 */
export type RefPattern = [string, number, Pattern];

/** Scales a pattern to fill a 256×256 box. */
export function normalizeLinear(pattern: Pattern): Pattern;

/**
 * Normalises for position, size and slant using image moments.
 *
 * The step that makes recognition insensitive to where on the canvas the
 * character was drawn and how big it is.
 */
export function momentNormalize(pattern: Pattern): Pattern;

/** Resamples each stroke to points roughly `interval` apart. */
export function extractFeatures(pattern: Pattern, interval: number): Pattern;

/**
 * Cheap first pass: everything with a plausible stroke count, scored roughly.
 * Returns `[index, distance]` pairs into `refPatterns`, nearest first.
 */
export function coarseClassification(
  input: Pattern,
  refPatterns: readonly RefPattern[],
): [number, number][];

/**
 * Expensive second pass over the coarse candidates. Returns up to ten
 * characters, best first.
 */
export function fineClassification(
  input: Pattern,
  candidates: readonly [number, number][],
  refPatterns: readonly RefPattern[],
): string[];

export function euclid(a: Point, b: Point): number;
