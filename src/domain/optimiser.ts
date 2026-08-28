import { DEFAULT_WEIGHTS, retrievability, reviewSkill, type FsrsState, type FsrsWeights } from './fsrs';
import type { PracticeResult } from './review';

/**
 * Fitting FSRS to one learner's actual history.
 *
 * `adaptWeights` in `fsrs.ts` moves a single parameter — the stability-growth
 * term — by comparing average predicted recall with average actual recall. That
 * was the right call for GHAPP, where seven minutes of guitar a day never
 * produces enough reviews to fit anything. It is leaving most of the
 * information on the floor here: a kanji learner racks up thousands of reviews
 * in months, and thousands of reviews is enough to fit the model properly.
 *
 * So this does the real thing. It replays the review log under candidate
 * weights, scores how well the predictions matched what actually happened, and
 * searches for weights that score better.
 *
 * ## Why it will not blow up in your face
 *
 * A badly fitted model is worse than the population average, and the ways to
 * fit one badly are well known. Three guards:
 *
 * - **Held-out items.** One item in five is kept out of the fit and used to
 *   score it. Weights that only look good on the data they were fitted to are
 *   rejected, which is the whole failure mode of fitting nineteen parameters to
 *   a few hundred reviews.
 *
 *   The split is by *item*, not by time, and that matters more than it looks.
 *   Splitting a flat log chronologically cuts every item's history in half, so
 *   the held-out half replays as though each item had never been seen — the
 *   model predicts from no memory state against a real month-long interval, and
 *   scores worse than chance no matter what the weights are. Under FSRS an item
 *   depends only on its own history, so whole items are the unit that can be
 *   held out without destroying what is being measured.
 * - **A margin.** The fit has to beat the current weights on that held-out tail
 *   by more than noise, or nothing changes.
 * - **Bounds.** Every parameter is clamped to a range around the published
 *   value. A search that wanders to a stability growth of 40 has found a quirk
 *   of one person's June, not a fact about their memory.
 *
 * ## Why coordinate descent
 *
 * FSRS's reference optimiser uses gradient descent through a differentiable
 * reimplementation of the model. Writing one here would mean maintaining the
 * memory model twice — once forward, once with derivatives — and they would
 * drift. Coordinate descent needs only the forward model that already exists
 * and is fast enough: a few hundred passes over ten thousand reviews is a
 * second or two, which is fine for something that runs occasionally rather than
 * per answer.
 *
 * Pure, and deliberately free of Firestore: `storage/reviewLog.ts` fetches the
 * history, this decides what it means.
 */

/** One review, as the optimiser needs it. */
export interface ReviewRecord {
  itemId: string;
  /** Epoch milliseconds. Used only to order the sequence. */
  at: number;
  result: PracticeResult;
  /** Days since this item's previous review. Zero for a first rep. */
  elapsedDays: number;
}

/**
 * How much history is needed before fitting is attempted at all.
 *
 * Below this the held-out tail is too small to tell a real improvement from
 * luck, and the answer is always "keep the published weights".
 */
export const MIN_REVIEWS_TO_FIT = 400;

/** One item in every `HOLD_OUT_EVERY` is kept out of the fit and scored on. */
export const HOLD_OUT_EVERY = 5;

/**
 * How much better the fit must be on held-out data to be adopted.
 *
 * In nats per review. Small, because log-loss differences are small, but not
 * zero — adopting a fit that is better by 0.0001 is adopting noise.
 */
export const MIN_IMPROVEMENT = 0.005;

/**
 * Per-parameter bounds, as multiples of the published value.
 *
 * Wide enough for a genuinely unusual learner, narrow enough that the search
 * cannot escape into a region where the model stops meaning anything.
 */
const BOUND_LOW = 0.4;
const BOUND_HIGH = 2.5;

/** Weights that are additive offsets rather than scales need absolute bounds. */
const ABSOLUTE_BOUNDS: Record<number, [number, number]> = {
  // Initial difficulty, on the 1-10 scale.
  4: [1, 10],
  // Initial-stability weights, in days; a floor below 0.05 makes intervals
  // meaningless and the model numerically unhappy.
  0: [0.05, 10],
  1: [0.05, 15],
  2: [0.1, 30],
  3: [0.1, 60],
};

function boundsFor(index: number, base: number): [number, number] {
  const absolute = ABSOLUTE_BOUNDS[index];
  if (absolute) return absolute;

  const low = base * BOUND_LOW;
  const high = base * BOUND_HIGH;
  return low <= high ? [low, high] : [high, low];
}

/**
 * FNV-1a. Any stable string hash would do; the requirement is only that the
 * same item lands on the same side of the split every run, so that two fits of
 * the same log can be compared.
 */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** Keeps log-loss finite when the model is very confident and very wrong. */
const EPSILON = 1e-6;

function logLoss(predicted: number, recalled: boolean): number {
  const p = Math.min(1 - EPSILON, Math.max(EPSILON, predicted));
  return recalled ? -Math.log(p) : -Math.log(1 - p);
}

/**
 * Groups a flat log into per-item sequences, each in chronological order.
 *
 * The model is per item: an item's stability depends on its own history and
 * nothing else, so replay has to follow each item's thread separately.
 */
function sequences(reviews: readonly ReviewRecord[]): ReviewRecord[][] {
  const byItem = new Map<string, ReviewRecord[]>();

  for (const review of reviews) {
    const existing = byItem.get(review.itemId);
    if (existing) existing.push(review);
    else byItem.set(review.itemId, [review]);
  }

  for (const sequence of byItem.values()) {
    sequence.sort((a, b) => a.at - b.at);
  }

  return [...byItem.values()];
}

/**
 * Mean log-loss of the model's predictions over a set of sequences.
 *
 * First reps are replayed but not scored: the model has no memory state to
 * predict from, so its "prediction" is a formality and including it would
 * reward whichever weights happen to make first reps common.
 */
export function evaluate(itemSequences: readonly ReviewRecord[][], weights: FsrsWeights): number {
  let total = 0;
  let scored = 0;
  // `now` never affects stability or the loss — only the returned due date,
  // which is discarded — so a fixed value keeps this deterministic.
  const now = new Date(0);

  for (const sequence of itemSequences) {
    let state: FsrsState | null = null;

    for (const review of sequence) {
      if (state) {
        total += logLoss(retrievability(review.elapsedDays, state.stability), review.result !== 'fail');
        scored += 1;
      }

      state = reviewSkill(
        { state, result: review.result, elapsedDays: review.elapsedDays },
        now,
        weights,
      ).state;
    }
  }

  return scored === 0 ? Infinity : total / scored;
}

export interface FitResult {
  weights: FsrsWeights;
  /** Whether the fit beat the incumbent on held-out data and was adopted. */
  adopted: boolean;
  /** Held-out loss of the weights that were in use before. */
  baselineLoss: number;
  /** Held-out loss of the fitted weights. */
  fittedLoss: number;
  reviewsUsed: number;
  reason: string;
}

/** The parameters worth searching, in descending order of how much they matter. */
const TUNABLE = [8, 9, 10, 11, 14, 5, 4, 15, 16, 0, 1, 2, 3, 13];

/**
 * Searches for weights that predict this learner better.
 *
 * One pass tries a handful of multiples of each parameter in turn, keeping any
 * that lowers training loss; later passes narrow the steps around whatever the
 * earlier ones found.
 */
function coordinateDescent(
  train: readonly ReviewRecord[][],
  start: FsrsWeights,
  passes: number,
): FsrsWeights {
  let best = [...start];
  let bestLoss = evaluate(train, best);

  for (let pass = 0; pass < passes; pass += 1) {
    // Coarse first, then fine. Multiplicative because the parameters span
    // several orders of magnitude.
    const spread = 0.4 / (pass + 1);
    const candidates = [1 - spread, 1 - spread / 2, 1 + spread / 2, 1 + spread];

    for (const index of TUNABLE) {
      const current = best[index];
      if (current === undefined) continue;

      const [low, high] = boundsFor(index, DEFAULT_WEIGHTS[index] ?? current);

      for (const multiple of candidates) {
        const trial = Math.min(high, Math.max(low, current * multiple));
        if (trial === current) continue;

        const attempt = [...best];
        attempt[index] = trial;

        const loss = evaluate(train, attempt);
        if (loss < bestLoss) {
          bestLoss = loss;
          best = attempt;
        }
      }
    }
  }

  return best;
}

/**
 * Fits weights to a review log, or explains why it declined to.
 *
 * `incumbent` is what is currently in use — the published defaults on a first
 * run, or the last accepted fit afterwards. A fit has to beat *that*, not the
 * defaults, so repeated runs cannot ratchet on noise.
 */
export function fitWeights(
  reviews: readonly ReviewRecord[],
  incumbent: FsrsWeights = DEFAULT_WEIGHTS,
  passes = 3,
): FitResult {
  const decline = (reason: string): FitResult => ({
    weights: incumbent,
    adopted: false,
    baselineLoss: Number.NaN,
    fittedLoss: Number.NaN,
    reviewsUsed: reviews.length,
    reason,
  });

  if (reviews.length < MIN_REVIEWS_TO_FIT) {
    return decline(
      `${reviews.length} reviews; ${MIN_REVIEWS_TO_FIT} needed before a fit can be told from luck`,
    );
  }

  // Split by item, keeping each history whole. Every fifth item, chosen by a
  // stable hash of its id rather than at random, so a re-run of the same log
  // splits the same way and two runs are comparable.
  const all = sequences(reviews);
  const train: ReviewRecord[][] = [];
  const held: ReviewRecord[][] = [];

  for (const sequence of all) {
    const id = sequence[0]?.itemId ?? '';
    (hash(id) % HOLD_OUT_EVERY === 0 ? held : train).push(sequence);
  }

  if (train.length === 0 || held.length === 0) {
    return decline('not enough distinct items to hold any out');
  }

  const baselineLoss = evaluate(held, incumbent);
  if (!Number.isFinite(baselineLoss)) {
    return decline('the held-out tail contains no scoreable reviews');
  }

  const fitted = coordinateDescent(train, incumbent, passes);
  const fittedLoss = evaluate(held, fitted);

  const improvement = baselineLoss - fittedLoss;
  const adopted = Number.isFinite(fittedLoss) && improvement >= MIN_IMPROVEMENT;

  return {
    weights: adopted ? fitted : incumbent,
    adopted,
    baselineLoss,
    fittedLoss,
    reviewsUsed: reviews.length,
    reason: adopted
      ? `held-out loss ${baselineLoss.toFixed(4)} to ${fittedLoss.toFixed(4)}`
      : `no improvement worth adopting (${improvement.toFixed(4)} nats, need ${MIN_IMPROVEMENT})`,
  };
}

/**
 * How well aimed the schedule currently is, for the Progress screen.
 *
 * Buckets reviews by what the model predicted and reports what actually
 * happened in each bucket. A well-calibrated model puts 90% of the reviews it
 * predicted at 90% into the "recalled" column; anything else is the schedule
 * being systematically early or late, and is worth being able to see.
 */
export interface CalibrationBucket {
  /** Lower edge of the predicted-recall band, e.g. 0.8 for 80-90%. */
  band: number;
  predicted: number;
  actual: number;
  count: number;
}

export function calibration(
  reviews: readonly ReviewRecord[],
  weights: FsrsWeights = DEFAULT_WEIGHTS,
  bands = 10,
): CalibrationBucket[] {
  const sums = Array.from({ length: bands }, () => ({ predicted: 0, actual: 0, count: 0 }));
  const now = new Date(0);

  for (const sequence of sequences(reviews)) {
    let state: FsrsState | null = null;

    for (const review of sequence) {
      if (state) {
        const predicted = retrievability(review.elapsedDays, state.stability);
        const index = Math.min(bands - 1, Math.max(0, Math.floor(predicted * bands)));
        const bucket = sums[index]!;
        bucket.predicted += predicted;
        bucket.actual += review.result !== 'fail' ? 1 : 0;
        bucket.count += 1;
      }

      state = reviewSkill(
        { state, result: review.result, elapsedDays: review.elapsedDays },
        now,
        weights,
      ).state;
    }
  }

  return sums
    .map((bucket, index) => ({
      band: index / bands,
      predicted: bucket.count > 0 ? bucket.predicted / bucket.count : 0,
      actual: bucket.count > 0 ? bucket.actual / bucket.count : 0,
      count: bucket.count,
    }))
    .filter((bucket) => bucket.count > 0);
}


/**
 * One number for the whole curve: how far actual recall sits from predicted.
 *
 * Negative means the model is over-confident — it expected to be remembered
 * more often than it was, which in schedule terms means asking too late.
 * Weighted by band population, so a band with ten reviews cannot outvote one
 * with two hundred.
 *
 * A table of six bands is evidence; this is the answer. A learner should not
 * have to do the weighted average in their head to find out whether their
 * schedule is aimed correctly.
 */
export function calibrationBias(buckets: readonly CalibrationBucket[]): number {
  const total = buckets.reduce((n, bucket) => n + bucket.count, 0);
  if (total === 0) return 0;

  return (
    buckets.reduce((sum, bucket) => sum + (bucket.actual - bucket.predicted) * bucket.count, 0) /
    total
  );
}
