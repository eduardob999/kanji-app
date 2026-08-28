import { describe, expect, it } from 'vitest';
import {
  IGNORE_ABOVE_MS,
  MIN_SAMPLES,
  isAdapted,
  observeResponse,
  profileFor,
  type FluencyTable,
} from './fluency';
import { timingProfile } from './grading';

/** Folds a run of response times into a fresh table. */
function feed(times: number[], quiz = 'vocab-reading' as const, input = 'keyboard' as const) {
  return times.reduce<FluencyTable>(
    (table, ms) => observeResponse(table, quiz, input, ms),
    {},
  );
}

/** A spread of times around a centre, so the quantiles have something to find. */
function sample(centre: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => centre * (0.5 + ((i * 7) % 10) / 10));
}

describe('profileFor', () => {
  it('uses the static thresholds until there is evidence', () => {
    const table = feed(sample(3_000, MIN_SAMPLES - 1));
    expect(profileFor(table, 'vocab-reading', 'keyboard')).toEqual(
      timingProfile('vocab-reading', 'keyboard'),
    );
  });

  it('switches to the learner’s own once there is', () => {
    const table = feed(sample(3_000, MIN_SAMPLES + 5));
    expect(isAdapted(table, 'vocab-reading', 'keyboard')).toBe(true);
    expect(profileFor(table, 'vocab-reading', 'keyboard')).not.toEqual(
      timingProfile('vocab-reading', 'keyboard'),
    );
  });

  it('keeps buckets separate per input method', () => {
    let table = feed(sample(1_500, 40));
    table = sample(20_000, 40).reduce(
      (t, ms) => observeResponse(t, 'vocab-reading', 'handwriting', ms),
      table,
    );

    const typed = profileFor(table, 'vocab-reading', 'keyboard');
    const drawn = profileFor(table, 'vocab-reading', 'handwriting');

    expect(drawn.fastMs).toBeGreaterThan(typed.fastMs);
  });
});

describe('the quantile estimates', () => {
  it('come down for a consistently fast learner', () => {
    // Someone answering in 1.2s should not be told that 3s was "straight away".
    const table = feed(Array.from({ length: 120 }, () => 1_200));
    const profile = profileFor(table, 'vocab-reading', 'keyboard');
    const base = timingProfile('vocab-reading', 'keyboard');

    expect(profile.fastMs).toBeLessThan(base.fastMs);
    expect(profile.slowMs).toBeLessThan(base.slowMs);
  });

  it('go up for a consistently slow one', () => {
    const table = feed(Array.from({ length: 120 }, () => 25_000));
    const profile = profileFor(table, 'vocab-reading', 'keyboard');
    const base = timingProfile('vocab-reading', 'keyboard');

    expect(profile.fastMs).toBeGreaterThan(base.fastMs);
    expect(profile.slowMs).toBeGreaterThan(base.slowMs);
  });

  it('lands the slow threshold above the fast one, around the right place', () => {
    // Half the answers at 2s, half at 8s: the 30th percentile belongs near the
    // lower cluster and the 80th near the upper.
    const times = Array.from({ length: 300 }, (_, i) => (i % 2 === 0 ? 2_000 : 8_000));
    const profile = profileFor(feed(times), 'vocab-reading', 'keyboard');

    expect(profile.fastMs).toBeLessThan(profile.slowMs);
    expect(profile.fastMs).toBeLessThanOrEqual(4_000);
    expect(profile.slowMs).toBeGreaterThanOrEqual(6_000);
  });

  it('never lets the two cross', () => {
    // Pathological: every answer identical, which pushes both estimates to the
    // same value. Crossing would make every single answer grade `hard`.
    const profile = profileFor(feed(Array.from({ length: 200 }, () => 3_000)), 'vocab-reading', 'keyboard');
    expect(profile.slowMs).toBeGreaterThan(profile.fastMs);
  });

  it('keeps adapting after it has converged', () => {
    // The step size has a floor on purpose: people get faster over months and
    // change device, and an estimator that has stopped listening is describing
    // someone who no longer exists.
    const settled = feed(Array.from({ length: 200 }, () => 10_000));
    const before = profileFor(settled, 'vocab-reading', 'keyboard');

    const moved = Array.from({ length: 100 }, () => 2_000).reduce(
      (t, ms) => observeResponse(t, 'vocab-reading', 'keyboard', ms),
      settled,
    );

    expect(profileFor(moved, 'vocab-reading', 'keyboard').fastMs).toBeLessThan(before.fastMs);
  });
});

describe('outliers', () => {
  it('ignores an answer that was really a walk away from the phone', () => {
    const settled = feed(sample(3_000, 40));
    const after = observeResponse(settled, 'vocab-reading', 'keyboard', IGNORE_ABOVE_MS + 1);
    expect(after).toBe(settled);
  });

  it('clamps a merely very slow answer instead of learning its full weight', () => {
    const settled = feed(sample(3_000, 40));
    const once = observeResponse(settled, 'vocab-reading', 'keyboard', 59_000);
    const twice = observeResponse(settled, 'vocab-reading', 'keyboard', 600_000);

    // The second is discarded outright, the first is kept but bounded.
    expect(twice).toBe(settled);
    expect(once).not.toBe(settled);
  });

  it('ignores nonsense', () => {
    const settled = feed(sample(3_000, 40));
    expect(observeResponse(settled, 'vocab-reading', 'keyboard', Number.NaN)).toBe(settled);
    expect(observeResponse(settled, 'vocab-reading', 'keyboard', Infinity)).toBe(settled);
  });
});

describe('observeResponse', () => {
  it('does not mutate the table it is given', () => {
    const before = feed(sample(3_000, 20));
    const snapshot = JSON.stringify(before);
    observeResponse(before, 'vocab-reading', 'keyboard', 4_000);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('counts every observation it keeps', () => {
    const table = feed(sample(3_000, 25));
    expect(table['vocab-reading:keyboard']!.n).toBe(25);
  });
});

describe('what the estimator does over a long run', () => {
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  }

  /** Response times are log-normal; a symmetric distribution would flatter it. */
  function lognormal(random: () => number, medianMs: number, sigma: number): number {
    const z = Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
    return Math.exp(Math.log(medianMs) + sigma * z);
  }

  it('finds a learner much faster than the defaults assume', () => {
    // Someone answering in two seconds where the published profile expects
    // three and a half. Two hundred answers is roughly what it takes; see
    // `stepFor` for why that is a deliberate trade rather than a slow bug.
    const random = mulberry32(7);
    let table: FluencyTable = {};
    for (let i = 0; i < 600; i += 1) {
      table = observeResponse(table, 'vocab-reading', 'keyboard', lognormal(random, 2_000, 0.4));
    }

    const profile = profileFor(table, 'vocab-reading', 'keyboard');
    const fallback = timingProfile('vocab-reading', 'keyboard');

    expect(profile.fastMs).toBeLessThan(fallback.fastMs);
    expect(profile.slowMs).toBeLessThan(fallback.slowMs);
    // True quantiles for this distribution are about 1.6s and 2.8s.
    expect(profile.fastMs).toBeGreaterThan(1_000);
    expect(profile.fastMs).toBeLessThan(2_400);
    expect(profile.slowMs).toBeGreaterThan(2_000);
    expect(profile.slowMs).toBeLessThan(4_000);
  });

  it('never lets fast catch slow, however strange the answers are', () => {
    /*
     * The two estimates are tracked independently, so nothing structural stops
     * them crossing — and a profile where "fast" is slower than "slow" does not
     * fail, it silently grades everything as one thing.
     *
     * This is the worst input available: alternating instant answers, answers
     * at the edge of what is recorded at all, and a heavy-tailed middle.
     */
    let table: FluencyTable = {};
    const random = mulberry32(3);

    for (let i = 0; i < 3_000; i += 1) {
      const ms =
        i % 3 === 0 ? 200 : i % 3 === 1 ? 119_000 : lognormal(random, 5_000, 1.2);
      table = observeResponse(table, 'kanji-writing', 'handwriting', ms);

      const profile = profileFor(table, 'kanji-writing', 'handwriting');
      expect(profile.fastMs).toBeLessThan(profile.slowMs);
    }
  });
});
