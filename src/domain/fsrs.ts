import type { PracticeResult } from './review';

/**
 * FSRS — a memory model, rather than a rule of thumb.
 *
 * The previous scheduler multiplied an ease factor by an interval. That pushes
 * easy things apart and pulls failures forward, which is most of the value, but
 * it has no idea *why*: it cannot say how likely you are to still know a
 * character tomorrow, so it cannot aim for a particular chance of
 * remembering.
 *
 * FSRS models three things per skill:
 *
 * - **Stability** — how many days until recall probability decays to 90%.
 * - **Difficulty** — how much harder this item is than average, 1 to 10.
 * - **Retrievability** — the chance you would get it right *right now*, which
 *   falls as time passes since the last rep.
 *
 * A review updates stability and difficulty from how it went and how overdue it
 * was, and the next interval is chosen to land on a target retention. Reviewing
 * something you had nearly forgotten teaches the model more than reviewing
 * something fresh, and the maths says so rather than the author guessing.
 *
 * Everything here is pure, with `now` passed in — same rule as the rest of
 * `src/domain/`.
 *
 * Lifted from GHAPP, with one substantive change: the interval cap.
 *
 * GHAPP capped intervals at 90 days on the grounds that the forgetting curve is
 * fitted to recall of *facts* while a motor skill decays differently, and that
 * nobody practises a chord once a year. Neither caveat applies here. A kanji
 * reading is exactly the kind of item FSRS was fitted on — the published
 * weights come from millions of vocabulary reviews — so the model is being used
 * for its intended purpose, and a character you genuinely know can correctly go
 * a year without a review. The cap is raised accordingly; see
 * `MAX_INTERVAL_DAYS` below.
 *
 * The grade still arrives as one of four values, but `grading.ts` derives it
 * from a marked answer rather than asking the learner to rate themselves.
 */

export interface FsrsState {
  /** Days for retrievability to decay to `TARGET_RETENTION`. */
  stability: number;
  /** 1 (trivial) to 10 (punishing). */
  difficulty: number;
  /** Reps recorded, successes and lapses alike. */
  reps: number;
  /** How many times this has been failed after previously being known. */
  lapses: number;
}

export interface FsrsReview {
  state: FsrsState | null;
  result: PracticeResult;
  /** Days since the last review. Ignored for a first rep. */
  elapsedDays: number;
}

/**
 * The published FSRS-4 weights, as a starting point.
 *
 * These are a population average. `adaptWeights` moves them toward what this
 * player's own history says, which is the "adaptable" part — someone drilling N5
 * for the first time should not be scheduled on the same curve as a reader
 * halfway through N1.
 */
export const DEFAULT_WEIGHTS = [
  0.4, 0.6, 2.4, 5.8, // initial stability by grade: fail, hard, good, easy
  4.93, 0.94, 0.86, 0.01, // initial difficulty, and its drift
  1.49, 0.14, 0.94, // stability growth on success
  2.18, 0.05, 0.34, 1.26, // stability after a lapse
  0.29, 2.61, // easy bonus and hard penalty
] as const;

export type FsrsWeights = readonly number[];

/** The chance of recall we aim for when choosing the next interval. */
export const TARGET_RETENTION = 0.9;

/**
 * Nothing is scheduled further out than this.
 *
 * A year, which is where most spaced-repetition tools land and what the
 * published weights were fitted against. Unlike GHAPP's chord shapes, a kanji
 * you have answered correctly at widening intervals for two years really is
 * yours, and dragging it back every 90 days would spend the session budget on
 * material that is not at risk — at the cost of the material that is.
 */
export const MAX_INTERVAL_DAYS = 365;

/** Nothing comes back sooner than this, so a bad rep cannot spam the session. */
export const MIN_INTERVAL_DAYS = 0.25;

/** FSRS grades 1–4. Our four buttons map straight onto them. */
const GRADE: Record<PracticeResult, 1 | 2 | 3 | 4> = {
  fail: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** Recall probability after `elapsedDays` at a given stability. */
export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  // The FSRS forgetting curve: R = (1 + t / (9 S)) ^ -1.
  return 1 / (1 + elapsedDays / (9 * stability));
}

/** Days until retrievability falls to the target. */
export function intervalFor(stability: number, targetRetention = TARGET_RETENTION): number {
  const days = 9 * stability * (1 / targetRetention - 1);
  return clamp(days, MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS);
}

function initialState(result: PracticeResult, weights: FsrsWeights): FsrsState {
  const grade = GRADE[result];
  const stability = Math.max(0.1, weights[grade - 1] ?? 1);
  const difficulty = clamp((weights[4] ?? 5) - (weights[5] ?? 1) * (grade - 3), 1, 10);

  return {
    stability,
    difficulty,
    reps: 1,
    lapses: result === 'fail' ? 1 : 0,
  };
}

function nextDifficulty(current: number, grade: number, weights: FsrsWeights): number {
  const drifted = current - (weights[5] ?? 1) * (grade - 3);
  // Mean reversion toward the difficulty an "easy" first rep would imply, so a
  // run of good reps cannot ratchet an item to trivial for ever.
  const reverted = drifted + (weights[6] ?? 0.9) * ((weights[4] ?? 5) - drifted) * (weights[7] ?? 0.01);
  return clamp(reverted, 1, 10);
}

function stabilityAfterSuccess(
  state: FsrsState,
  grade: number,
  recall: number,
  weights: FsrsWeights,
): number {
  const easyBonus = grade === 4 ? 1 + (weights[15] ?? 0.3) : 1;
  const hardPenalty = grade === 2 ? 1 - (weights[16] ?? 0.3) / 10 : 1;

  // The three terms that make FSRS worth having: harder items gain less,
  // already-stable items gain proportionally less, and a review that was nearly
  // forgotten (low recall) gains far more than one that was still fresh.
  const growth =
    1 +
    Math.exp(weights[8] ?? 1.5) *
      (11 - state.difficulty) *
      state.stability ** -(weights[9] ?? 0.14) *
      (Math.exp((1 - recall) * (weights[10] ?? 0.94)) - 1) *
      easyBonus *
      hardPenalty;

  return Math.max(MIN_INTERVAL_DAYS, state.stability * growth);
}

function stabilityAfterLapse(state: FsrsState, recall: number, weights: FsrsWeights): number {
  const lapsed =
    (weights[11] ?? 2.2) *
    state.difficulty ** -(weights[12] ?? 0.05) *
    ((state.stability + 1) ** (weights[13] ?? 0.34) - 1) *
    Math.exp((1 - recall) * (weights[14] ?? 1.26));

  // Never *more* stable than before the failure.
  return clamp(lapsed, MIN_INTERVAL_DAYS, state.stability);
}

export interface FsrsUpdate {
  state: FsrsState;
  intervalDays: number;
  dueAt: Date;
  /** What the model thought your chances were, before this rep. Useful to log. */
  predictedRecall: number;
}

/**
 * Applies one review.
 *
 * A first rep starts from the grade alone; after that both the grade and how
 * overdue the rep was feed the update.
 */
export function reviewSkill(
  review: FsrsReview,
  now: Date,
  weights: FsrsWeights = DEFAULT_WEIGHTS,
  targetRetention = TARGET_RETENTION,
): FsrsUpdate {
  const grade = GRADE[review.result];

  if (!review.state) {
    const state = initialState(review.result, weights);
    const intervalDays = intervalFor(state.stability, targetRetention);
    return {
      state,
      intervalDays,
      dueAt: new Date(now.getTime() + intervalDays * 86_400_000),
      predictedRecall: 1,
    };
  }

  const elapsed = Math.max(0, review.elapsedDays);
  const recall = retrievability(elapsed, review.state.stability);
  const difficulty = nextDifficulty(review.state.difficulty, grade, weights);

  const stability =
    review.result === 'fail'
      ? stabilityAfterLapse(review.state, recall, weights)
      : stabilityAfterSuccess({ ...review.state, difficulty }, grade, recall, weights);

  const state: FsrsState = {
    stability,
    difficulty,
    reps: review.state.reps + 1,
    lapses: review.state.lapses + (review.result === 'fail' ? 1 : 0),
  };

  const intervalDays = intervalFor(stability, targetRetention);

  return {
    state,
    intervalDays,
    dueAt: new Date(now.getTime() + intervalDays * 86_400_000),
    predictedRecall: recall,
  };
}

/* ── Adapting to this player ───────────────────────────────────────────────── */

export interface ReviewOutcome {
  /** What the model predicted before the rep, 0–1. */
  predicted: number;
  /** Whether it actually went well. */
  recalled: boolean;
}

/**
 * Nudges the weights toward this learner's own history.
 *
 * Full FSRS optimisation fits nineteen parameters by gradient descent over
 * thousands of reviews. That is reachable here in a way it never was for
 * GHAPP — a kanji learner racks up reviews quickly — but it is not reachable in
 * *week one*, and a badly-fitted model is worse than the population average. So
 * this does the one adjustment a few dozen reviews can already support: compare
 * predicted recall with what actually happened, and scale the stability-growth
 * term so the schedule as a whole runs faster or slower. Fitting the full
 * parameter set once the review log is deep enough is left for later.
 *
 * Over-confident model (you forget more than it expects) → shorter intervals.
 * Under-confident → longer. Returns the weights unchanged until there is enough
 * evidence to be worth acting on.
 */
export const MIN_REVIEWS_TO_ADAPT = 20;

export function adaptWeights(
  outcomes: readonly ReviewOutcome[],
  weights: FsrsWeights = DEFAULT_WEIGHTS,
): FsrsWeights {
  if (outcomes.length < MIN_REVIEWS_TO_ADAPT) return weights;

  const predicted = outcomes.reduce((sum, o) => sum + o.predicted, 0) / outcomes.length;
  const actual = outcomes.filter((o) => o.recalled).length / outcomes.length;

  // A tenth of a point of error is noise at this sample size; beyond that,
  // move the growth term by at most 20% so one bad week cannot wreck the
  // schedule.
  const error = actual - predicted;
  if (Math.abs(error) < 0.05) return weights;

  const scale = clamp(1 + error * 2, 0.8, 1.2);
  const adapted = [...weights];
  adapted[8] = (weights[8] ?? 1.5) + Math.log(scale);

  return adapted;
}

/** Human-readable, for the card that says when something comes back. */
export function describeStability(stability: number): string {
  if (stability < 1) return 'shaky';
  if (stability < 4) return 'coming along';
  if (stability < 14) return 'solid';
  if (stability < 60) return 'known';
  return 'yours';
}
