import { reviewSkill, type FsrsState, type FsrsWeights } from './fsrs';
import type { PracticeResult } from './review';

/**
 * Spaced-practice scheduling.
 *
 * **This is now a thin adapter over FSRS** (`src/domain/fsrs.ts`). It was
 * SM-2-in-spirit: an ease factor multiplying an interval, which pushes easy
 * material apart and pulls failures forward but has no model of forgetting
 * behind it — it cannot say how likely you are to still know a character
 * tomorrow, so it cannot aim at a retention target.
 *
 * The shape of this module is kept so every caller and every stored document
 * keeps working: `ease` is still written, derived from FSRS difficulty, and
 * still read by anything that displays it. New state lives alongside it.
 *
 * Every function here is pure. `now` is a parameter rather than a call to
 * `Date.now()` so the behaviour is reproducible and testable.
 */

export type { PracticeResult };

export interface SchedulerStateInput {
  ease?: number;
  intervalDays?: number;
  lastPracticedAt?: Date | null;
  /** FSRS memory state, absent on documents written before it existed. */
  stability?: number;
  difficulty?: number;
  reps?: number;
  lapses?: number;
}

export interface SchedulerUpdate {
  ease: number;
  intervalDays: number;
  dueAt: Date;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  /** What FSRS expected before this rep, 0–1. Logged so the model can be judged. */
  predictedRecall: number;
}

/**
 * Reads FSRS state off a stored document.
 *
 * Returns null when the item has never been reviewed *under FSRS* — including
 * documents written by the old scheduler, which are treated as a first rep
 * rather than converted. Ease and interval do not carry enough information to
 * reconstruct stability honestly, and a fabricated memory state would schedule
 * confidently on an invention.
 */
function toFsrsState(state: SchedulerStateInput): FsrsState | null {
  if (state.stability === undefined || state.difficulty === undefined) return null;

  return {
    stability: state.stability,
    difficulty: state.difficulty,
    reps: state.reps ?? 1,
    lapses: state.lapses ?? 0,
  };
}

/** FSRS difficulty (1 hard – 10 punishing) shown as the ease everything else reads. */
function easeFromDifficulty(difficulty: number): number {
  const eased = MAX_EASE - ((difficulty - 1) / 9) * (MAX_EASE - MIN_EASE);
  return round(clamp(eased, MIN_EASE, MAX_EASE));
}

export const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_EASE = 3.5;

/**
 * A failure comes back in about two and a half hours, i.e. later today.
 *
 * **This is applied, not merely clamped to.** GHAPP carried the same constant
 * and the same comment, but only used it as the lower bound of a clamp — and
 * FSRS's post-lapse stability for a well-known item is comfortably above it.
 * Missing a kanji you had known for a month scheduled it three and a half days
 * out, which is not what the comment says and not what a lapse needs.
 *
 * A lapse means the memory has to be rebuilt, and rebuilding starts with seeing
 * it again soon — the relearning step every spaced-repetition tool has. FSRS
 * supplies the *stability*, which is what the next successful review is
 * scheduled from; the step is what happens in between. The CLI did the same
 * thing more bluntly, by dropping the score to zero and putting the item
 * straight back into the lowest-score pool.
 */
export const FAIL_INTERVAL_DAYS = 0.1;

// Matches fsrs.ts. This clamp is the outer guard rail; fsrs.ts has already
// applied its own cap by the time a value reaches here.
const MAX_INTERVAL_DAYS = 365;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Grading the same item twice inside this window is treated as one sitting, so
 * a word that comes round again in the same session cannot inflate its interval
 * to weeks. Shrinking is still allowed — a fail should always pull it back in.
 */
const REPEAT_WINDOW_HOURS = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Two decimals is well below the resolution anyone perceives, and it keeps
 *  stored values and test expectations readable. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Computes the new scheduling state for one graded rep.
 *
 * Deterministic: the same state, result and `now` always produce the same
 * output.
 */
export function scheduleNext(
  state: SchedulerStateInput,
  result: PracticeResult,
  now: Date = new Date(),
  weights?: FsrsWeights,
): SchedulerUpdate {
  const previous = toFsrsState(state);
  const lastPracticedAt = state.lastPracticedAt ?? null;
  const elapsedDays = lastPracticedAt
    ? Math.max(0, (now.getTime() - lastPracticedAt.getTime()) / MILLISECONDS_PER_DAY)
    : 0;

  const update = reviewSkill(
    { state: previous, result, elapsedDays },
    now,
    ...(weights ? ([weights] as const) : ([] as const)),
  );

  // A lapse goes to the relearning step rather than to what FSRS makes of the
  // rebuilt stability. That stability is still stored, and still governs the
  // interval after the next *successful* answer.
  let intervalDays = result === 'fail' ? FAIL_INTERVAL_DAYS : update.intervalDays;

  // Same-sitting repeat: allow the interval to fall but not to climb. Answering
  // something twice in one sitting is massed practice, and FSRS — which assumes
  // reviews are spaced — would otherwise read the second rep as evidence of
  // durable memory rather than of short-term recall.
  const previousInterval = state.intervalDays;
  if (lastPracticedAt && previousInterval !== undefined) {
    const hoursSince = (now.getTime() - lastPracticedAt.getTime()) / (60 * 60 * 1000);
    if (hoursSince >= 0 && hoursSince < REPEAT_WINDOW_HOURS) {
      intervalDays = Math.min(intervalDays, previousInterval);
    }
  }

  intervalDays = round(clamp(intervalDays, FAIL_INTERVAL_DAYS, MAX_INTERVAL_DAYS));

  return {
    ease: easeFromDifficulty(update.state.difficulty),
    intervalDays,
    dueAt: new Date(now.getTime() + intervalDays * MILLISECONDS_PER_DAY),
    stability: round(update.state.stability),
    difficulty: round(update.state.difficulty),
    reps: update.state.reps,
    lapses: update.state.lapses,
    predictedRecall: Math.round(update.predictedRecall * 1000) / 1000,
  };
}

/** Rough, friendly rendering of an interval. Used for the "next due" hint. */
export function describeInterval(intervalDays: number): string {
  if (intervalDays < 1) {
    const hours = Math.max(1, Math.round(intervalDays * 24));
    return hours === 1 ? 'about an hour' : `about ${hours} hours`;
  }

  const days = Math.round(intervalDays);
  return days === 1 ? 'about a day' : `about ${days} days`;
}
