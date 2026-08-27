import { Timestamp } from 'firebase/firestore';
import { intervalFor } from './fsrs';
import { isLevel, levelRank, LEVELS, type Level } from './items';
import { bucketId, REVIEW_MODES, type ReviewMode } from './modes';
import type { ItemReviewState } from './review';

/**
 * Turning the CLI's correct-answer streaks into FSRS memory.
 *
 * `scripts/migrate-scores.mjs` has already thrown away everything that was only
 * a JLPT level restated; what arrives here is ~6,300 items that were genuinely
 * answered correctly, between one and five times in a row, before any miss.
 *
 * That is still thin evidence and is treated as thin evidence. The CLI asked
 * whichever item had the lowest score, which often meant asking the same word
 * again minutes later — so a run of five correct answers is not five *spaced*
 * reviews, and the stability it implies is far short of what five real reps
 * would earn. The seeded numbers are deliberately small: the schedule brings
 * each item back within days, and the first real review overwrites the guess
 * with something measured.
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
 * Sub-linear and capped, because the streaks are worth less than their size
 * suggests: the CLI asked whichever item had the lowest score, so consecutive
 * correct answers were frequently minutes apart rather than days. Five in a row
 * earns under a fortnight here, where five properly spaced reps would earn
 * months.
 *
 * The point is to start an item somewhere other than "never seen", not to claim
 * it is learnt.
 */
export function stabilityForStreak(streak: number): number {
  if (streak <= 0) return 0;
  if (streak === 1) return 2;
  if (streak === 2) return 4.5;
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
 * How many imported items should come due on an average day.
 *
 * The intake window is derived from this and the size of the import, rather
 * than fixed. A fixed fortnight was right for the 1,117 items the first export
 * held and is nonsense for 6,328 — it would ask for 450 reviews a day, which no
 * one does, so the backlog would simply never clear and the app would show a
 * number that only went up.
 */
export const TARGET_PER_DAY = 50;

/** Floor and ceiling on the window, so neither a tiny nor a vast import is silly. */
export const MIN_INTAKE_DAYS = 14;
export const MAX_INTAKE_DAYS = 120;

export function intakeDaysFor(count: number): number {
  const needed = Math.ceil(count / TARGET_PER_DAY);
  return Math.min(MAX_INTAKE_DAYS, Math.max(MIN_INTAKE_DAYS, needed));
}

/**
 * One item's seeded state.
 *
 * `dueInDays` comes from the caller rather than from the entry, because where
 * an item sits in the queue is a property of the whole import — see
 * `toBuckets`, which orders by how weak the evidence is.
 */
export function seedStateFor(
  entry: LegacyEntry,
  now: Date,
  dueInDays: number,
): ItemReviewState | null {
  if (!isLevel(entry.l)) return null;
  if (!(REVIEW_MODES as readonly string[]).includes(entry.m)) return null;

  const stability = stabilityForStreak(entry.k);
  if (stability <= 0) return null;

  const difficulty = difficultyForLevel(entry.l);
  const interval = intervalFor(stability);

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

  // Weakest evidence first. A streak of one is a guess worth checking soon; a
  // streak of five can wait, and waiting is also what its larger stability
  // implies. Ties break on the item id so the whole layout is deterministic and
  // a re-import puts everything back where it was.
  const ordered = [...file.entries].sort(
    (a, b) => a.k - b.k || `${a.m}:${a.i}`.localeCompare(`${b.m}:${b.i}`),
  );
  const window = intakeDaysFor(ordered.length);

  for (const [index, entry] of ordered.entries()) {
    const dueInDays = ordered.length <= 1 ? 0 : (index / (ordered.length - 1)) * window;
    const state = seedStateFor(entry, now, dueInDays);
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
