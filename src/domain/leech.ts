import type { ItemReviewState } from './review';

/**
 * The items that will not stick.
 *
 * Every spaced-repetition collection grows a tail of them: a handful of words
 * that have been failed a dozen times and come back tomorrow to be failed
 * again. Left alone they are corrosive in a way their number does not suggest —
 * they are always due, so they are always at the front of the queue, and a
 * session that is mostly things you have never managed to learn is the session
 * people stop turning up for.
 *
 * Two decisions are worth stating.
 *
 * **Not suspension.** The usual treatment is to bury the item until it is asked
 * for. That is right for a collection someone else built, where a leech is
 * often just a bad card. This corpus is the JLPT lists: 憂鬱 is on the exam
 * whether or not it sticks, and hiding it would be hiding the syllabus.
 * Rationing is the honest version — they still come round, three at a time,
 * instead of taking the whole sitting.
 *
 * **A share, not a count.** Anki's rule is eight lapses, full stop, which
 * quietly indicts every item you have known for years: something answered
 * eighty times and failed eight is not a problem, it is a normal memory. What
 * marks a real one is failing *often relative to how often it has come up*, so
 * both a floor on evidence and a share are required.
 *
 * Pure, and reads only what the scheduler already stores — no migration, and
 * every imported item is classified from the moment its first lapse lands.
 */

/** Lapses before an item can be called anything but firm. */
export const SHAKY_FROM = 3;

/** Lapses before it is the thing this module is named after. */
export const LEECH_FROM = 6;

/** And that many lapses have to be this share of the reps to count. */
export const LEECH_SHARE = 0.3;

export type Grip = 'firm' | 'shaky' | 'slipping';

export function gripOn(state: ItemReviewState | null | undefined): Grip {
  if (!state) return 'firm';

  const lapses = state.lapses ?? 0;
  if (lapses < SHAKY_FROM) return 'firm';

  // Reps cannot be fewer than lapses; if the count is missing or nonsense, the
  // lapses themselves are the only evidence there is.
  const reps = Math.max(state.totalReps ?? 0, lapses);
  const share = lapses / reps;
  if (share < LEECH_SHARE) return 'firm';

  return lapses >= LEECH_FROM ? 'slipping' : 'shaky';
}

export function isSlipping(state: ItemReviewState | null | undefined): boolean {
  return gripOn(state) === 'slipping';
}

/**
 * How badly, for ordering a list of them.
 *
 * Lapses times the share they represent: enough to put "failed nine times in
 * eleven" above "failed nine times in thirty" without either disappearing.
 */
export function slipScore(state: ItemReviewState | null | undefined): number {
  if (!state) return 0;

  const lapses = state.lapses ?? 0;
  const reps = Math.max(state.totalReps ?? 0, lapses, 1);
  return lapses * (lapses / reps);
}
