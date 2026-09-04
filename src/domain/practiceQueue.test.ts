import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import type { Level, VocabItem } from './items';
import type { QuizMode, ReviewMode } from './modes';
import type { ItemReviewState } from './review';
import { buildPracticeQueue } from './practiceQueue';
import { ROUND_SIZE } from './randomPractice';
import type { Candidate } from './sessionPlanner';

/**
 * The merged screen, and mostly one question asked of it in several ways:
 * can a word he has never met reach him without the pacer deciding it should?
 */

const NOW = new Date('2026-08-26T09:00:00Z');
const DAY = 86_400_000;

function vocab(id: string): VocabItem {
  return { id, word: id, reading: 'よみ', meaning: 'meaning' };
}

function pool(size: number, quiz: QuizMode = 'vocab-reading', level: Level = '5'): Candidate[] {
  return Array.from({ length: size }, (_, i) => ({ quiz, item: vocab(`w${i}`), level }));
}

/** A state due `overdueDays` ago. Negative means it is not due yet. */
function state(id: string, overdueDays: number): ItemReviewState {
  return {
    itemId: id,
    stability: 3,
    difficulty: 5,
    intervalDays: 6,
    totalReps: 4,
    lapses: 0,
    dueAt: Timestamp.fromMillis(NOW.getTime() - overdueDays * DAY),
    lastReviewedAt: Timestamp.fromMillis(NOW.getTime() - (overdueDays + 6) * DAY),
  };
}

const NONE = () => null;

/** Every item in `ids` has been met; everything else is unseen. */
function met(ids: readonly string[], overdueDays = -30) {
  const known = new Set(ids);
  return (_mode: ReviewMode, itemId: string) =>
    known.has(itemId) ? state(itemId, overdueDays) : null;
}

describe('buildPracticeQueue', () => {
  it('gives the schedule the front of the round, most overdue first', () => {
    const candidates = pool(3);
    const lookup = (_mode: ReviewMode, itemId: string) =>
      itemId === 'w0' ? state('w0', 1) : itemId === 'w1' ? state('w1', 9) : null;

    const queue = buildPracticeQueue(candidates, lookup, NOW);

    expect(queue[0]?.item.id).toBe('w1');
    expect(queue[1]?.item.id).toBe('w0');
    expect(queue.slice(0, 2).every((q) => q.unscheduled !== true)).toBe(true);
  });

  it('never says there is nothing to do while something has been met', () => {
    // The whole point of the merge. Everything is scheduled a month out, so the
    // old session screen would have shown "Nothing due" and stopped.
    const queue = buildPracticeQueue(pool(200), met(idsUpTo(200)), NOW);

    expect(queue).toHaveLength(ROUND_SIZE);
  });

  it('keeps unseen words out of the practice that fills the round', () => {
    /*
     * The rule the merge turns on. Two words have been met and the pacer is
     * allowed to introduce one; the other 197 are unseen and must stay unseen,
     * however short the round is left.
     */
    const queue = buildPracticeQueue(pool(200), met(['w0', 'w1']), NOW, { maxNew: 1 });

    const introduced = queue.filter((q) => q.state === null);
    expect(introduced).toHaveLength(1);
    expect(introduced[0]?.unscheduled).toBeUndefined();
    expect(queue.filter((q) => q.unscheduled).every((q) => q.state !== null)).toBe(true);
  });

  it('introduces nothing at all when the pacer has rationed nothing', () => {
    // The state someone behind on their reviews is in, and the one where a
    // filler that reached for unseen material would do the most damage.
    const queue = buildPracticeQueue(pool(200), met(['w0', 'w1']), NOW, { maxNew: 0 });

    expect(queue.every((q) => q.state !== null)).toBe(true);
  });

  it('cannot lengthen the ration by drawing more new material', () => {
    // Nothing has ever been met, so there is nothing to fall through to. A
    // round of three is the honest answer; a round of fifteen would mean the
    // filler had introduced twelve words behind the pacer's back.
    const queue = buildPracticeQueue(pool(200), NONE, NOW, { maxNew: 3 });

    expect(queue).toHaveLength(3);
    expect(queue.every((q) => q.unscheduled !== true)).toBe(true);
  });

  it('marks the practice and leaves the schedule unmarked', () => {
    const lookup = met(idsUpTo(200));
    const queue = buildPracticeQueue(pool(200), lookup, NOW, { maxNew: 0 });

    expect(queue.every((q) => q.unscheduled === true)).toBe(true);
  });

  it('asks one memory once across both halves of a round', () => {
    // The planner dedupes inside itself and so does the draw, but neither can
    // see the other. A word answered as a review and then again as practice is
    // the same word twice in one sitting.
    const lookup = met(idsUpTo(40), 4);
    const queue = buildPracticeQueue(pool(40), lookup, NOW, { maxItems: 5, maxNew: 0 });

    const keys = queue.map((q) => `${q.mode}:${q.item.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('lets a long queue of due material run past the round size', () => {
    // The floor is a floor. A day with sixty things due is sixty questions,
    // because the pacer said so and it outranks the round size.
    const lookup = met(idsUpTo(60), 4);
    const queue = buildPracticeQueue(pool(60), lookup, NOW, {
      maxItems: 60,
      maxPerGroup: 60,
      maxNew: 0,
    });

    expect(queue).toHaveLength(60);
    expect(queue.some((q) => q.unscheduled)).toBe(false);
  });

  it('reports practice drawn early as early rather than as overdue', () => {
    const queue = buildPracticeQueue(pool(40), met(idsUpTo(40)), NOW, { maxNew: 0 });

    expect(queue.every((q) => q.overdueDays < 0)).toBe(true);
  });

  it('mixes question types through the practice as well as the schedule', () => {
    const candidates: Candidate[] = [
      ...pool(60, 'vocab-reading'),
      ...pool(60, 'kanji-writing', '3'),
      ...pool(60, 'fill-in'),
    ];

    const queue = buildPracticeQueue(candidates, met(idsUpTo(60)), NOW, { maxNew: 0 });
    const kinds = new Set(queue.filter((q) => q.unscheduled).map((q) => q.quiz));

    expect(kinds.size).toBeGreaterThan(1);
  });

  it('takes a round size when one is given', () => {
    const queue = buildPracticeQueue(pool(200), met(idsUpTo(200)), NOW, {
      maxNew: 0,
      roundSize: 4,
    });

    expect(queue).toHaveLength(4);
  });

  it('returns nothing for an empty pool', () => {
    expect(buildPracticeQueue([], NONE, NOW)).toEqual([]);
  });
});

function idsUpTo(size: number): string[] {
  return Array.from({ length: size }, (_, i) => `w${i}`);
}
