import type { Timestamp } from 'firebase/firestore';

/**
 * What a review *is*, independent of what is being reviewed.
 *
 * `src/domain/fsrs.ts` and `src/domain/scheduler.ts` are lifted from GHAPP,
 * where these types lived in a guitar micro-skill catalog. Here they stand on
 * their own: the memory model does not care whether the thing being recalled is
 * a chord shape or 憂鬱, only how the last rep went and how long ago it was.
 *
 * The item catalog lives in `items.ts` and never appears in the scheduler.
 */

/**
 * FSRS grades 1-4, named.
 *
 * GHAPP asks the player to pick one of these — whether a barre chord rang out
 * cleanly is a judgement call. Kanji answers are marked objectively, so
 * `grading.ts` derives the grade instead and these are an internal currency
 * rather than four buttons.
 */
export type PracticeResult = 'easy' | 'good' | 'hard' | 'fail';

/**
 * Per-item scheduling state, as the domain layer sees it.
 *
 * Stored in a rather different shape — see `src/storage/reviewState.ts`, which
 * packs many of these into one document per deck — but nothing outside that
 * module needs to know.
 */
export interface ItemReviewState {
  itemId: string;
  lastResult?: PracticeResult;
  lastReviewedAt?: Timestamp;
  /** Derived from FSRS difficulty. Kept because the UI displays it. */
  ease?: number;
  intervalDays?: number;
  dueAt?: Timestamp;
  totalReps?: number;
  stability?: number;
  difficulty?: number;
  lapses?: number;
  /** What the model expected before the last rep, 0-1. Judged in Progress. */
  predictedRecall?: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}
