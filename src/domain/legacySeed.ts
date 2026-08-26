import { Timestamp } from 'firebase/firestore';
import { intervalFor } from './fsrs';
import { isLevel, levelRank, LEVELS, type Level } from './items';
import { bucketId, REVIEW_MODES, type ReviewMode } from './modes';
import type { ItemReviewState } from './review';

/**
 * Turning the CLI's correct-answer streaks into FSRS memory.
 *
 * `scripts/migrate-scores.mjs` has already thrown away everything that was
 * only a JLPT level restated; what arrives here is ~1,117 items that were
 * genuinely answered correctly one or two times in a row before a miss.
 *
 * That is thin evidence, and it is treated as thin evidence. A streak of one
 * says "known well enough to get right once", not "known" — so the seeded
 * stability is small, the schedule brings the item back within days, and the
 * first real review under FSRS immediately overwrites the guess with something
 * measured.
 *
 * Pure, with `now` passed in, like everything else in this directory.
 */

export interface LegacyEntry {
  /** Review mode. */
  m: ReviewMode;
  /** JLPT level. */
  l: string;
  /** Item id. */
  i: string;
  /** Correct answers above this item's level baseline. */
  k: number;
}

export interface LegacySeedFile {
  source: string;
  generatedAt: string;
  note: string;
  entries: LegacyEntry[];
}

/**
 * Days of stability implied by a streak.
 *
 * Two correct answers in the CLI is not two spaced reviews — its scheduler
 * asked whatever had the lowest score, which often meant the same day. So
 * these are deliberately short: a couple of days for one success, under a week
 * for two. The point is to start the item somewhere other than "never seen",
 * not to claim it is learnt.
 */
export function stabilityForStreak(streak: number): number {
  if (streak <= 0) return 0;
  if (streak === 1) return 2;
  if (streak === 2) return 4.5;
  // The CLI's data does not go above 2, but a hand-edited file could.
  return Math.min(14, 4.5 + (streak - 2) * 2);
}

/**
 * Difficulty implied by a JLPT level.
 *
 * FSRS difficulty runs 1 (trivial) to 10 (punishing). N5 material really is
 * easier than N1 material, and starting everything at the population mean
 * throws away the one thing the corpus does know about each item.
 */
export function difficultyForLevel(level: Level): number {
  const span = LEVELS.length - 1;
  return 4 + (levelRank(level) / span) * 3;
}

/**
 * How far out to schedule an item, spread across the intake window.
 *
 * Without the spread, importing 1,117 items would make every one of them due
 * at the same instant — a wall on day one that no session can clear, followed
 * by weeks of nothing. Hashing the id scatters them deterministically, so a
 * re-run of the import puts each item back where it was.
 */
export const INTAKE_DAYS = 14;

function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

export function seedStateFor(entry: LegacyEntry, now: Date): ItemReviewState | null {
  if (!isLevel(entry.l)) return null;
  if (!(REVIEW_MODES as readonly string[]).includes(entry.m)) return null;

  const stability = stabilityForStreak(entry.k);
  if (stability <= 0) return null;

  const difficulty = difficultyForLevel(entry.l);
  const interval = intervalFor(stability);

  // When it comes back: scattered across the intake window, and *not* clamped
  // to the interval. Clamping was the obvious thing and it was wrong — a streak
  // of one implies a two-day interval, so every one of the 1,117 items would
  // have landed inside 48 hours. That is the wall this spread exists to
  // prevent, rebuilt out of the thing meant to prevent it.
  const dueInDays = (hash(`${entry.m}:${entry.i}`) % (INTAKE_DAYS * 1000)) / 1000;

  // Dated one interval into the past, so the item reads as "reviewed then" and
  // is due about now — rather than as reviewed today, which would tell the
  // model a review happened that did not.
  //
  // That leaves the gap to `dueAt` wider than the interval, and deliberately:
  // the CLI recorded *that* an answer was right and never *when*, so by the
  // time the item comes round it is genuinely somewhat overdue and the model
  // should treat it that way.
  const lastReviewedAt = new Date(now.getTime() - interval * 86_400_000);

  return {
    itemId: entry.i,
    stability,
    difficulty: Math.round(difficulty * 100) / 100,
    intervalDays: Math.round(interval * 100) / 100,
    totalReps: entry.k,
    lapses: 0,
    lastResult: 'good',
    // Deliberately absent: predictedRecall. Nothing predicted these, and a
    // fabricated value would be fed straight into the calibration curve.
    dueAt: Timestamp.fromDate(new Date(now.getTime() + dueInDays * 86_400_000)),
    lastReviewedAt: Timestamp.fromDate(lastReviewedAt),
  };
}

/**
 * Groups a seed file into the buckets `seedReviewBuckets` writes.
 *
 * One document per review mode per level, which is the same layout the app
 * writes to normally — the import is not a special case in storage, only in
 * where its numbers came from.
 */
export function toBuckets(
  file: LegacySeedFile,
  now: Date,
): Map<string, Map<string, ItemReviewState>> {
  const buckets = new Map<string, Map<string, ItemReviewState>>();

  for (const entry of file.entries) {
    const state = seedStateFor(entry, now);
    if (!state || !isLevel(entry.l)) continue;

    const id = bucketId(entry.m, entry.l);
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = new Map();
      buckets.set(id, bucket);
    }
    bucket.set(entry.i, state);
  }

  return buckets;
}

export function countSeeds(buckets: Map<string, Map<string, ItemReviewState>>): number {
  let total = 0;
  for (const bucket of buckets.values()) total += bucket.size;
  return total;
}
