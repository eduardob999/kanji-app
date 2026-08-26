import { describe, expect, it } from 'vitest';
import { MAX_INTERVAL_DAYS, adaptWeights, retrievability } from './fsrs';
import { describeInterval, scheduleNext } from './scheduler';

/**
 * `fsrs.ts` and `scheduler.ts` arrived from GHAPP already working. These tests
 * are not a re-derivation of FSRS — they pin the properties this app depends
 * on, and in particular the interval cap, which is the one number that was
 * deliberately changed on the way across.
 */

const NOW = new Date('2026-08-26T09:00:00Z');
const DAY = 86_400_000;

describe('scheduleNext', () => {
  it('schedules a first rep from the grade alone', () => {
    const easy = scheduleNext({}, 'easy', NOW);
    const good = scheduleNext({}, 'good', NOW);
    const hard = scheduleNext({}, 'hard', NOW);

    expect(easy.intervalDays).toBeGreaterThan(good.intervalDays);
    expect(good.intervalDays).toBeGreaterThan(hard.intervalDays);
    expect(easy.reps).toBe(1);
  });

  it('brings a failure back within the day, not in three days', () => {
    const update = scheduleNext({ stability: 20, difficulty: 5, reps: 6 }, 'fail', NOW);

    expect(update.intervalDays).toBeLessThan(1);
    expect(update.lapses).toBe(1);
  });

  it('never makes a failed item more stable than it was', () => {
    const before = 30;
    const update = scheduleNext({ stability: before, difficulty: 5, reps: 6 }, 'fail', NOW);

    expect(update.stability).toBeLessThanOrEqual(before);
  });

  it('grows the interval across a run of successes', () => {
    // Answered each time on the day it came due, which is the case the model
    // is built for. Reviewing with zero elapsed time correctly teaches it
    // nothing, so the review has to happen *at* dueAt, not at the last one.
    let state = { stability: 1, difficulty: 5, reps: 1, lapses: 0, intervalDays: 1 };
    let previous = 0;
    let lastAt = NOW;
    let at = new Date(NOW.getTime() + DAY);

    for (let rep = 0; rep < 6; rep += 1) {
      const update = scheduleNext({ ...state, lastPracticedAt: lastAt }, 'good', at);
      expect(update.intervalDays).toBeGreaterThan(previous);
      previous = update.intervalDays;
      lastAt = at;
      at = update.dueAt;
      state = {
        stability: update.stability,
        difficulty: update.difficulty,
        reps: update.reps,
        lapses: update.lapses,
        intervalDays: update.intervalDays,
      };
    }
  });

  it('lets a well-known item go most of a year', () => {
    // The cap GHAPP set at 90 days. A kanji answered correctly at widening
    // intervals for two years really is yours, and dragging it back quarterly
    // spends the session budget on material that is not at risk.
    const update = scheduleNext({ stability: 5_000, difficulty: 1, reps: 40 }, 'easy', NOW);

    expect(update.intervalDays).toBe(MAX_INTERVAL_DAYS);
    expect(MAX_INTERVAL_DAYS).toBe(365);
  });

  it('does not let a second grade in one sitting inflate the interval', () => {
    const lastPracticedAt = new Date(NOW.getTime() - 5 * 60_000);
    const update = scheduleNext(
      { stability: 10, difficulty: 5, reps: 4, intervalDays: 12, lastPracticedAt },
      'easy',
      NOW,
    );

    expect(update.intervalDays).toBeLessThanOrEqual(12);
  });

  it('still lets a second grade in one sitting shrink the interval', () => {
    const lastPracticedAt = new Date(NOW.getTime() - 5 * 60_000);
    const update = scheduleNext(
      { stability: 10, difficulty: 5, reps: 4, intervalDays: 12, lastPracticedAt },
      'fail',
      NOW,
    );

    expect(update.intervalDays).toBeLessThan(1);
  });

  it('is deterministic', () => {
    const input = { stability: 4, difficulty: 6, reps: 3, lapses: 1 } as const;
    expect(scheduleNext(input, 'good', NOW)).toEqual(scheduleNext(input, 'good', NOW));
  });
});

describe('retrievability', () => {
  it('is certain the instant after a review and decays from there', () => {
    expect(retrievability(0, 10)).toBe(1);
    expect(retrievability(10, 10)).toBeLessThan(1);
    expect(retrievability(100, 10)).toBeLessThan(retrievability(10, 10));
  });

  it('decays more slowly the more stable the memory', () => {
    expect(retrievability(10, 30)).toBeGreaterThan(retrievability(10, 3));
  });
});

describe('adaptWeights', () => {
  it('leaves the weights alone until there is evidence worth acting on', () => {
    const thin = Array.from({ length: 5 }, () => ({ predicted: 0.9, recalled: false }));
    expect(adaptWeights(thin)).toEqual(adaptWeights([]));
  });

  it('shortens the schedule when the model is over-confident', () => {
    // Predicting 90% recall and getting 40% means the intervals are too long.
    const outcomes = Array.from({ length: 40 }, (_, i) => ({
      predicted: 0.9,
      recalled: i % 10 < 4,
    }));

    const adapted = adaptWeights(outcomes);
    const base = adaptWeights([]);

    expect(adapted[8]).toBeLessThan(base[8]!);
  });

  it('lengthens the schedule when the model is under-confident', () => {
    const outcomes = Array.from({ length: 40 }, () => ({ predicted: 0.5, recalled: true }));

    expect(adaptWeights(outcomes)[8]).toBeGreaterThan(adaptWeights([])[8]!);
  });

  it('leaves a well-aimed schedule alone', () => {
    const outcomes = Array.from({ length: 40 }, (_, i) => ({
      predicted: 0.9,
      recalled: i % 10 !== 0,
    }));

    expect(adaptWeights(outcomes)).toEqual(adaptWeights([]));
  });
});

describe('describeInterval', () => {
  it('reads naturally on both sides of a day', () => {
    expect(describeInterval(0.1)).toContain('hour');
    expect(describeInterval(1)).toBe('about a day');
    expect(describeInterval(30)).toBe('about 30 days');
  });
});
