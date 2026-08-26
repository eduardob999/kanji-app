import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, intervalFor, retrievability, reviewSkill, type FsrsState } from './fsrs';
import {
  MIN_REVIEWS_TO_FIT,
  calibration,
  evaluate,
  fitWeights,
  type ReviewRecord,
} from './optimiser';

const DAY = 86_400_000;

/**
 * A synthetic learner whose memory really does decay at a known rate.
 *
 * The point of these tests is not that the optimiser finds one true answer —
 * it will not, and coordinate descent over a partly-identifiable model never
 * does. It is that the machinery around the search behaves: it declines when it
 * should, it does not adopt noise, and when a learner genuinely differs from
 * the population it moves in the right direction.
 *
 * `decayFactor` below scales how fast this person forgets relative to what the
 * default weights assume. Above 1 means they forget faster.
 */
function simulate(options: {
  items: number;
  reps: number;
  decayFactor: number;
  seed?: number;
}): ReviewRecord[] {
  const { items, reps, decayFactor } = options;
  let seed = options.seed ?? 1;
  // Deterministic LCG: a real PRNG would make failures unreproducible.
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return seed / 4_294_967_296;
  };

  const reviews: ReviewRecord[] = [];

  for (let item = 0; item < items; item += 1) {
    const itemId = `item-${item}`;
    let state: FsrsState | null = null;
    let at = Date.UTC(2026, 0, 1) + item * 60_000;
    let elapsedDays = 0;

    for (let rep = 0; rep < reps; rep += 1) {
      // What this learner's memory actually does, which is not what the
      // default weights believe.
      const trueRecall = state
        ? retrievability(elapsedDays * decayFactor, state.stability)
        : 1;
      const result = state && random() > trueRecall ? 'fail' : 'good';

      reviews.push({ itemId, at, result, elapsedDays });

      const update = reviewSkill({ state, result, elapsedDays }, new Date(at));
      state = update.state;
      elapsedDays = intervalFor(state.stability);
      at += elapsedDays * DAY;
    }
  }

  return reviews;
}

describe('evaluate', () => {
  it('scores a log and is deterministic', () => {
    const reviews = simulate({ items: 20, reps: 6, decayFactor: 1 });
    const grouped = [reviews];
    // Grouping by item is the optimiser's job; evaluate takes sequences, so
    // build one trivially here to check determinism only.
    expect(evaluate(grouped, DEFAULT_WEIGHTS)).toBe(evaluate(grouped, DEFAULT_WEIGHTS));
  });

  it('reports infinity when nothing can be scored', () => {
    // A single first rep per item: nothing to predict from.
    expect(evaluate([[{ itemId: 'a', at: 0, result: 'good', elapsedDays: 0 }]], DEFAULT_WEIGHTS)).toBe(
      Infinity,
    );
  });
});

describe('fitWeights', () => {
  it('declines on a short log rather than fitting noise', () => {
    const result = fitWeights(simulate({ items: 5, reps: 4, decayFactor: 1 }));

    expect(result.adopted).toBe(false);
    expect(result.weights).toBe(DEFAULT_WEIGHTS);
    expect(result.reason).toContain('needed before a fit');
  });

  it('leaves a population-average learner alone', () => {
    // Someone the published weights already describe well. Any "improvement"
    // here is noise, and the margin exists to refuse it.
    const reviews = simulate({ items: 300, reps: 8, decayFactor: 1, seed: 11 });
    expect(reviews.length).toBeGreaterThan(MIN_REVIEWS_TO_FIT);

    const result = fitWeights(reviews, DEFAULT_WEIGHTS, 3);

    expect(result.adopted).toBe(false);
    expect(result.weights).toBe(DEFAULT_WEIGHTS);
    // Close to the incumbent either way — that is what "already describes them
    // well" means.
    expect(Math.abs(result.baselineLoss - result.fittedLoss)).toBeLessThan(0.005);
  });

  it('adopts a better fit for a learner who forgets faster than the model expects', () => {
    const reviews = simulate({ items: 300, reps: 8, decayFactor: 3, seed: 11 });

    const result = fitWeights(reviews, DEFAULT_WEIGHTS, 3);

    expect(result.adopted).toBe(true);
    expect(result.weights).not.toBe(DEFAULT_WEIGHTS);
    expect(result.fittedLoss).toBeLessThan(result.baselineLoss);
    expect(result.reviewsUsed).toBe(reviews.length);
  });

  it('helps more the further the learner is from the population', () => {
    // A sanity check on direction: the worse the published weights fit, the
    // more there is for the search to win back.
    const gain = (decayFactor: number) => {
      const r = fitWeights(simulate({ items: 300, reps: 8, decayFactor, seed: 11 }), DEFAULT_WEIGHTS, 3);
      return r.baselineLoss - r.fittedLoss;
    };

    expect(gain(5)).toBeGreaterThan(gain(2));
    expect(gain(2)).toBeGreaterThan(gain(1));
  });

  it('scores a well-calibrated model at a believable loss', () => {
    // Guards the held-out replay itself. Splitting the log by *time* rather
    // than by item cut every sequence in half and made the model replay each
    // held-out item from no memory state — which scored 1.78 nats, far worse
    // than chance, for weights that were in fact correct.
    const result = fitWeights(simulate({ items: 300, reps: 8, decayFactor: 1, seed: 11 }), DEFAULT_WEIGHTS, 1);
    expect(result.baselineLoss).toBeLessThan(0.6);
  });

  it('never returns weights that scored worse than the incumbent', () => {
    // The whole guard: whatever the search found, what comes back is only ever
    // adopted on a held-out improvement.
    for (const decay of [1, 2, 4]) {
      const result = fitWeights(simulate({ items: 150, reps: 8, decayFactor: decay, seed: 3 }), DEFAULT_WEIGHTS, 2);
      if (result.adopted) {
        expect(result.baselineLoss - result.fittedLoss).toBeGreaterThanOrEqual(0);
      } else {
        expect(result.weights).toBe(DEFAULT_WEIGHTS);
      }
    }
  });

  it('keeps every fitted weight inside its bounds', () => {
    const result = fitWeights(simulate({ items: 300, reps: 8, decayFactor: 5, seed: 13 }), DEFAULT_WEIGHTS, 2);

    result.weights.forEach((weight, index) => {
      expect(Number.isFinite(weight)).toBe(true);
      const base = DEFAULT_WEIGHTS[index]!;
      // Either untouched, or within the multiplicative envelope the search is
      // allowed to explore. Initial-stability and difficulty terms have their
      // own absolute bounds, so only check finiteness and sign for those.
      if (index > 4) {
        expect(Math.abs(weight)).toBeLessThanOrEqual(Math.abs(base) * 2.5 + 1e-9);
      }
    });
  });

  it('is deterministic', () => {
    const reviews = simulate({ items: 120, reps: 8, decayFactor: 2, seed: 5 });
    const a = fitWeights(reviews, DEFAULT_WEIGHTS, 1);
    const b = fitWeights(reviews, DEFAULT_WEIGHTS, 1);
    expect(a.weights).toEqual(b.weights);
    expect(a.adopted).toBe(b.adopted);
  });
});

describe('calibration', () => {
  it('reports what actually happened against what was predicted', () => {
    const buckets = calibration(simulate({ items: 150, reps: 8, decayFactor: 1, seed: 2 }));

    expect(buckets.length).toBeGreaterThan(0);
    for (const bucket of buckets) {
      expect(bucket.count).toBeGreaterThan(0);
      expect(bucket.actual).toBeGreaterThanOrEqual(0);
      expect(bucket.actual).toBeLessThanOrEqual(1);
    }
  });

  it('shows a fast-forgetting learner doing worse than predicted', () => {
    // This is the signal the Progress screen exists to surface: the model says
    // 90%, reality says less, so the schedule is running late.
    const buckets = calibration(simulate({ items: 200, reps: 8, decayFactor: 4, seed: 4 }));
    const confident = buckets.filter((b) => b.band >= 0.8 && b.count >= 20);

    expect(confident.length).toBeGreaterThan(0);
    for (const bucket of confident) {
      expect(bucket.actual).toBeLessThan(bucket.predicted);
    }
  });

  it('drops empty bands rather than reporting zeroes', () => {
    const buckets = calibration(simulate({ items: 30, reps: 5, decayFactor: 1 }));
    expect(buckets.every((b) => b.count > 0)).toBe(true);
  });
});
