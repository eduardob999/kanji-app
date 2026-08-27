import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  coarseClassification,
  extractFeatures,
  fineClassification,
  momentNormalize,
  type Pattern,
  type RefPattern,
} from './pipeline';

/**
 * Guards the port in `pipeline.js`.
 *
 * The numerical functions were lifted from Kanji Canvas unchanged — verified
 * body-for-body against upstream — and the value of that is entirely in them
 * *staying* unchanged. These tests exist so that a well-meaning tidy-up of
 * 2019-vintage `var` loops fails loudly instead of quietly degrading
 * recognition in a way nobody notices until they are drawing kanji on a train.
 *
 * They run against the real pattern file the app ships, so they also check that
 * `scripts/build-strokes.mjs` produced something usable.
 */

function loadShipped(): RefPattern[] {
  const path = resolve(__dirname, '../../../public/strokes/kanji.json');
  return (JSON.parse(readFileSync(path, 'utf8')) as { patterns: RefPattern[] }).patterns;
}

/** Points along a straight line, as a slow pen would leave them. */
function line(from: [number, number], to: [number, number], steps = 12): [number, number][] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return [
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
    ] as [number, number];
  });
}

/** 一 — one horizontal stroke. */
const ICHI: Pattern = [line([40, 128], [216, 128])];

/** 十 — horizontal then vertical, the way it is written. */
const JUU: Pattern = [line([40, 120], [216, 120]), line([128, 30], [128, 226])];

/** 二 — two horizontals. */
const NI: Pattern = [line([50, 90], [206, 90]), line([40, 170], [216, 170])];

describe('momentNormalize', () => {
  it('brings a small drawing up to the reference scale', () => {
    // The step that makes recognition indifferent to where on the canvas you
    // drew and how big.
    const tiny: Pattern = [line([10, 10], [30, 10]), line([20, 5], [20, 25])];
    const normalized = momentNormalize(tiny);

    const xs = normalized.flat().map((p) => p[0]);
    expect(Math.max(...xs)).toBeGreaterThan(60);
  });

  it('keeps the stroke count', () => {
    expect(momentNormalize(JUU)).toHaveLength(2);
  });

  it('puts a centred and an offset drawing in about the same place', () => {
    const shifted: Pattern = JUU.map((stroke) => stroke.map(([x, y]) => [x + 40, y - 20] as [number, number]));

    const a = momentNormalize(JUU).flat();
    const b = momentNormalize(shifted).flat();

    const centre = (points: [number, number][]) =>
      points.reduce((sum, p) => sum + p[0], 0) / points.length;

    expect(Math.abs(centre(a) - centre(b))).toBeLessThan(12);
  });
});

describe('extractFeatures', () => {
  it('resamples a long stroke down to a handful of points', () => {
    const dense = extractFeatures(momentNormalize(ICHI), 20.0);
    expect(dense[0]!.length).toBeLessThan(ICHI[0]!.length);
    expect(dense[0]!.length).toBeGreaterThan(1);
  });

  it('always keeps at least the two endpoints of a stroke', () => {
    // A stroke shorter than one interval would otherwise collapse to a single
    // point and carry no direction at all.
    const dot: Pattern = [[[128, 128], [129, 128]]];
    expect(extractFeatures(momentNormalize(dot), 20.0)[0]!.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the stroke count', () => {
    expect(extractFeatures(momentNormalize(JUU), 20.0)).toHaveLength(2);
  });
});

describe('the shipped pattern file', () => {
  const patterns = loadShipped();

  it('covers the corpus', () => {
    expect(patterns.length).toBeGreaterThan(1_900);
  });

  it('holds integer coordinates', () => {
    // The rounding is what takes the data from 6.37 MB to 1.46 MB. A build that
    // stopped rounding would quadruple the download without anyone noticing.
    for (const [, , pattern] of patterns.slice(0, 50)) {
      for (const stroke of pattern) {
        for (const [x, y] of stroke) {
          expect(Number.isInteger(x)).toBe(true);
          expect(Number.isInteger(y)).toBe(true);
        }
      }
    }
  });

  it('records a stroke count matching the pattern', () => {
    for (const [character, strokes, pattern] of patterns.slice(0, 200)) {
      expect(typeof character).toBe('string');
      expect(pattern.length).toBe(strokes);
    }
  });
});

describe('recognition', () => {
  const patterns = loadShipped();

  function recognise(drawn: Pattern): string[] {
    const features = extractFeatures(momentNormalize(drawn), 20.0);
    return fineClassification(features, coarseClassification(features, patterns), patterns);
  }

  it('recognises a drawn 一', () => {
    expect(recognise(ICHI).slice(0, 3)).toContain('一');
  });

  it('recognises a drawn 十', () => {
    expect(recognise(JUU).slice(0, 5)).toContain('十');
  });

  it('recognises a drawn 二', () => {
    expect(recognise(NI).slice(0, 5)).toContain('二');
  });

  it('tells one from two horizontal strokes', () => {
    // The coarse pass filters on stroke count, so this is really a check that
    // the count reaches it intact.
    expect(recognise(ICHI)[0]).not.toBe('二');
  });

  it('returns candidates best-first and no more than ten', () => {
    const out = recognise(JUU);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(10);
  });

  it('is unbothered by where on the canvas the character was drawn', () => {
    const shifted: Pattern = JUU.map((stroke) =>
      stroke.map(([x, y]) => [x - 30, y + 25] as [number, number]),
    );
    expect(recognise(shifted).slice(0, 5)).toContain('十');
  });

  it('returns nothing rather than throwing on an empty drawing', () => {
    expect(() => recognise([])).not.toThrow();
  });
});
