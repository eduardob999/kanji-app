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
