import { dayKey, shiftDays } from './days';
import type { Deck, Level, StudyItem } from './items';
import type { ReviewMode } from './modes';
import type { ItemReviewState } from './review';

/**
 * How much of the corpus is actually held, and how steadily it is being worked
 * at.
 *
 * The CLI printed completion bars per JLPT level on startup, from its score
 * column. That column was a count of correct answers, so the bars measured
 * attendance — how often you had answered — rather than knowledge. FSRS stores
 * something better: stability, the number of days until recall of an item is
 * expected to fall to 90%. A bar drawn from stability says how much you would
 * still know next month, which is the question the old bar looked like it was
 * answering.
 *
 * `Tools → Scheduler` covers whether the schedule is *aimed* correctly. This is
 * the other half: how far through the material you are.
 *
 * Pure, `now` passed in.
 */

/**
 * Bands, from the same thresholds `describeStability` uses for its wording.
 *
 * Four rather than five, because a stacked bar with five segments at phone
 * width is a row of slivers. "Known" absorbs everything from a month upward,
 * which is the point at which an item stops needing regular attention.
 */
export type Band = 'unseen' | 'learning' | 'familiar' | 'known';

export const BANDS: readonly Band[] = ['known', 'familiar', 'learning', 'unseen'];

/** Days of stability at which an item moves up a band. */
export const FAMILIAR_FROM = 7;
export const KNOWN_FROM = 30;

export function bandFor(state: ItemReviewState | null): Band {
  if (!state || state.stability === undefined) return 'unseen';
  if (state.stability >= KNOWN_FROM) return 'known';
  if (state.stability >= FAMILIAR_FROM) return 'familiar';
  return 'learning';
}

export function bandLabel(band: Band): string {
  switch (band) {
    case 'known':
      return 'Known';
    case 'familiar':
      return 'Familiar';
    case 'learning':
      return 'Learning';
    case 'unseen':
      return 'Not yet seen';
  }
}

export type BandCounts = Record<Band, number>;

export interface LevelProgress {
  level: Level;
  total: number;
  counts: BandCounts;
  /** Items due at or before `now`. */
  due: number;
  /**
   * How far through this level you are, 0–1.
   *
   * Familiar items count half. An item you will still know next week is
   * genuine progress and counting it as zero makes the bar sit still for weeks;
   * counting it the same as one you will know next year overstates it.
   */
  score: number;
}

function emptyCounts(): BandCounts {
  return { unseen: 0, learning: 0, familiar: 0, known: 0 };
}

export type StateLookup = (mode: ReviewMode, itemId: string) => ItemReviewState | null;

export function summariseLevel(
  deck: Deck<StudyItem>,
  mode: ReviewMode,
  lookup: StateLookup,
  now: Date,
): LevelProgress {
  const counts = emptyCounts();
  let due = 0;

  for (const item of deck.items) {
    const state = lookup(mode, item.id);
    counts[bandFor(state)] += 1;

    const dueAt = state?.dueAt?.toDate();
    if (state && (!dueAt || dueAt.getTime() <= now.getTime())) due += 1;
  }

  const total = deck.items.length;
  const score = total === 0 ? 0 : (counts.known + counts.familiar * 0.5) / total;

  return { level: deck.level, total, counts, due, score };
}

export interface CorpusProgress {
  levels: LevelProgress[];
  total: number;
  counts: BandCounts;
  due: number;
  score: number;
}

export function summarise(
  decks: readonly Deck<StudyItem>[],
  mode: ReviewMode,
  lookup: StateLookup,
  now: Date,
): CorpusProgress {
  const levels = decks.map((deck) => summariseLevel(deck, mode, lookup, now));

  const counts = emptyCounts();
  let total = 0;
  let due = 0;

  for (const level of levels) {
    total += level.total;
    due += level.due;
    for (const band of BANDS) counts[band] += level.counts[band];
  }

  return {
    levels,
    total,
    counts,
    due,
    score: total === 0 ? 0 : (counts.known + counts.familiar * 0.5) / total,
  };
}

/* --- Streaks -------------------------------------------------------------- */

export { dayKey };


export interface Streaks {
  /** Consecutive days up to today (or yesterday) with at least one review. */
  current: number;
  longest: number;
  /** Reviews answered today. */
  today: number;
  totalReviews: number;
  /** Days with at least one review, most recent first, for the activity strip. */
  activeDays: Set<string>;
}

/**
 * Streaks from the review log.
 *
 * A streak survives *today* being empty. Someone who studied for thirty days
 * and opens the app at nine in the morning has not broken anything, and telling
 * them their streak is zero until they answer something is both wrong and a
 * mean way to open a screen. It breaks when a whole day passes unanswered.
 */
export function streaksFrom(timestamps: readonly number[], now: Date): Streaks {
  const activeDays = new Set(timestamps.map((at) => dayKey(new Date(at))));
  const todayKey = dayKey(now);
  const today = timestamps.filter((at) => dayKey(new Date(at)) === todayKey).length;

  // Current: walk back from today, allowing today itself to be empty.
  let current = 0;
  let cursor = activeDays.has(todayKey) ? new Date(now) : shiftDays(now, -1);
  while (activeDays.has(dayKey(cursor))) {
    current += 1;
    cursor = shiftDays(cursor, -1);
  }

  // Longest: walk the sorted distinct days once.
  const sorted = [...activeDays].sort();
  let longest = 0;
  let run = 0;
  let previous: string | null = null;

  for (const day of sorted) {
    if (previous !== null && dayKey(shiftDays(new Date(`${previous}T12:00:00`), 1)) === day) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    previous = day;
  }

  return { current, longest, today, totalReviews: timestamps.length, activeDays };
}

/**
 * The last `weeks` weeks of activity, oldest first, as one entry per day.
 *
 * Used for the little contribution-graph strip. Returns the day key and whether
 * anything was answered, and nothing about how much: a day you did ten reviews
 * and a day you did two hundred are both days you turned up, and shading by
 * volume rewards binges over habit.
 */
export function activityStrip(
  streaks: Streaks,
  now: Date,
  weeks = 8,
): { day: string; active: boolean }[] {
  const days = weeks * 7;
  return Array.from({ length: days }, (_, i) => {
    const day = dayKey(shiftDays(now, -(days - 1 - i)));
    return { day, active: streaks.activeDays.has(day) };
  });
}
