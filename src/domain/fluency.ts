import { timingProfile, type TimingProfile } from './grading';
import type { InputMethod } from './inputMethod';
import type { QuizMode } from './modes';

/**
 * How fast *this* learner answers, learnt from how fast they have been.
 *
 * `grading.ts` decides whether a correct answer was `easy`, `good` or `hard`
 * from the clock, against thresholds I picked by guessing. Those guesses are
 * wrong for almost everyone: a fast typist on a laptop clears a reading in
 * under two seconds, someone drawing kanji on a phone on a bus does not, and
 * both get told what their memory is like by the same stopwatch.
 *
 * So the thresholds move. Each (question type, input method) pair tracks two
 * quantiles of that learner's own response times on correct answers — answer
 * faster than your 30th percentile and it was `easy`, slower than your 80th and
 * it was `hard`. What the grade means becomes "fast *for you*, at this, on this
 * device", which is the only version of the statement that carries information.
 *
 * ## How the quantiles are tracked
 *
 * By stochastic approximation, not by keeping the samples. Storing a window of
 * response times would mean a thousand numbers on the profile document and a
 * decision about how long a window; this keeps two numbers per bucket and
 * converges to the same place.
 *
 * The update is gradient descent on the pinball loss, whose minimum is the
 * quantile: an observation above the estimate nudges it up by `step * p`, one
 * below nudges it down by `step * (1 - p)`. For p = 0.8 that is a large push
 * down and a small push up, so the estimate settles where 80% of observations
 * fall below it.
 *
 * The step size has a floor rather than decaying to nothing, deliberately.
 * People get faster over months, and change device. An estimator that has
 * converged and stopped listening is describing a learner who no longer exists.
 *
 * Pure. The table goes in and a new table comes out.
 */

export interface FluencyBucket {
  /** Correct answers observed. */
  n: number;
  /** Estimated 30th percentile response time, ms. */
  fast: number;
  /** Estimated 80th percentile response time, ms. */
  slow: number;
}

/** Keyed by `${quiz}:${input}`. */
export type FluencyTable = Record<string, FluencyBucket>;

export const FAST_QUANTILE = 0.3;
export const SLOW_QUANTILE = 0.8;

/**
 * Below this, the learner's own thresholds are not yet worth trusting and the
 * static ones from `grading.ts` are used instead.
 *
 * Twelve is enough for the estimates to have moved somewhere sensible and few
 * enough to be reached in a single session.
 */
export const MIN_SAMPLES = 12;

/**
 * Answers slower than this are discarded rather than learnt from.
 *
 * Nobody spends two minutes recalling a reading; they put the phone down. Left
 * in, a handful of these drag the slow threshold up until nothing is ever
 * graded `hard` again.
 */
export const IGNORE_ABOVE_MS = 120_000;

/** And anything above this is clamped, for the same reason in miniature. */
const CLAMP_AT_MS = 60_000;

/** Nothing sensible is faster than this; below it, something autofilled. */
const FLOOR_MS = 250;

/** Keeps `fast` and `slow` from crossing, which would make every grade `hard`. */
const MIN_SEPARATION_MS = 600;

export function fluencyKey(quiz: QuizMode, input: InputMethod): string {
  return `${quiz}:${input}`;
}

/**
 * The step size, as a fraction of the current estimate.
 *
 * Relative rather than absolute because the buckets differ by an order of
 * magnitude — 3 s for a typed reading, 30 s for a drawn kanji — and one step
 * size in milliseconds cannot serve both.
 */
function stepFor(estimate: number): number {
  return Math.max(120, estimate * 0.05);
}

function updateQuantile(estimate: number, observation: number, p: number): number {
  const step = stepFor(estimate);
  return observation >= estimate ? estimate + step * p : estimate - step * (1 - p);
}

function seed(quiz: QuizMode, input: InputMethod): FluencyBucket {
  // Start from the static guesses, so behaviour before there is any evidence is
  // exactly what it was, and the estimates walk away from there.
  const base = timingProfile(quiz, input);
  return { n: 0, fast: base.fastMs, slow: base.slowMs };
}

/**
 * Folds one correct answer into the table.
 *
 * Only correct answers. A wrong answer's response time measures how long
 * someone was willing to stare at a word they did not know, which is a fact
 * about patience rather than fluency, and mixing it in inflates both thresholds.
 */
export function observeResponse(
  table: FluencyTable,
  quiz: QuizMode,
  input: InputMethod,
  responseMs: number,
): FluencyTable {
  if (!Number.isFinite(responseMs) || responseMs > IGNORE_ABOVE_MS) return table;

  const key = fluencyKey(quiz, input);
  const current = table[key] ?? seed(quiz, input);
  const observation = Math.min(CLAMP_AT_MS, Math.max(FLOOR_MS, responseMs));

  let fast = Math.max(FLOOR_MS, updateQuantile(current.fast, observation, FAST_QUANTILE));
  let slow = Math.max(FLOOR_MS, updateQuantile(current.slow, observation, SLOW_QUANTILE));

  // The two estimates are tracked independently and can cross on unusual data.
  if (slow - fast < MIN_SEPARATION_MS) {
    const midpoint = (fast + slow) / 2;
    fast = midpoint - MIN_SEPARATION_MS / 2;
    slow = midpoint + MIN_SEPARATION_MS / 2;
  }

  return {
    ...table,
    [key]: { n: current.n + 1, fast: Math.round(fast), slow: Math.round(slow) },
  };
}

/**
 * The thresholds to grade against right now.
 *
 * Falls back to the static profile until this learner has answered enough for
 * their own to mean anything.
 */
export function profileFor(
  table: FluencyTable,
  quiz: QuizMode,
  input: InputMethod,
): TimingProfile {
  const bucket = table[fluencyKey(quiz, input)];
  if (!bucket || bucket.n < MIN_SAMPLES) return timingProfile(quiz, input);

  return { fastMs: bucket.fast, slowMs: bucket.slow };
}

/** Whether the learner's own timings are in use yet, for the Progress screen. */
export function isAdapted(table: FluencyTable, quiz: QuizMode, input: InputMethod): boolean {
  return (table[fluencyKey(quiz, input)]?.n ?? 0) >= MIN_SAMPLES;
}
