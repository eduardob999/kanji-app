import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import type { Level, VocabItem } from './items';
import type { QuizMode, ReviewMode } from './modes';
import type { ItemReviewState } from './review';
import { ROUND_SIZE, buildRandomQueue } from './randomPractice';
import type { Candidate } from './sessionPlanner';

const NOW = new Date('2026-08-26T09:00:00Z');
const DAY = 86_400_000;

function vocab(id: string): VocabItem {
  return { id, word: id, reading: 'よみ', meaning: 'meaning' };
}

function pool(size: number, quiz: QuizMode = 'vocab-reading', level: Level = '5'): Candidate[] {
  return Array.from({ length: size }, (_, i) => ({ quiz, item: vocab(`w${i}`), level }));
}

const NONE = () => null;

describe('buildRandomQueue', () => {
  it('fills a round from the pool', () => {
    expect(buildRandomQueue(pool(500), NONE, NOW)).toHaveLength(ROUND_SIZE);
  });

  it('ignores due dates entirely', () => {
    // Everything scheduled a year out. Today's Session would return nothing;
    // this is the screen for when you want to practise anyway.
    const future: ItemReviewState = {
      itemId: 'x',
      stability: 50,
      difficulty: 5,
      dueAt: Timestamp.fromMillis(NOW.getTime() + 365 * DAY),
    };

    const queue = buildRandomQueue(pool(500), () => future, NOW);

    expect(queue).toHaveLength(ROUND_SIZE);
    // Reported honestly as practising early, rather than as overdue.
    expect(queue.every((q) => q.overdueDays < 0)).toBe(true);
  });

  it('is stable for a given round', () => {
    // The bug this prevents: the question changing underneath you as your own
    // answer lands and the component re-renders.
    const candidates = pool(500);
    const first = buildRandomQueue(candidates, NONE, NOW);
    const second = buildRandomQueue(candidates, NONE, NOW);

    expect(first.map((q) => q.item.id)).toEqual(second.map((q) => q.item.id));
  });

  it('draws differently on a later round', () => {
    const candidates = pool(500);
    const first = buildRandomQueue(candidates, NONE, NOW);
    const later = buildRandomQueue(candidates, NONE, new Date(NOW.getTime() + 60_000));

    expect(first.map((q) => q.item.id)).not.toEqual(later.map((q) => q.item.id));
  });

  it('mixes question types when several are offered', () => {
    const candidates: Candidate[] = [
      ...pool(200, 'vocab-reading'),
      ...pool(200, 'fill-in'),
      ...pool(200, 'kanji-writing', '3'),
    ];

    const kinds = new Set(buildRandomQueue(candidates, NONE, NOW).map((q) => q.quiz));

    expect(kinds.size).toBeGreaterThan(1);
  });

  it('asks one memory once per round', () => {
    // Fill-in and listening share a review state, so without the claim one word
    // arrives twice in a round wearing different clothes.
    const item = vocab('word');
    const candidates: Candidate[] = [
      { quiz: 'fill-in', item, level: '5' },
      { quiz: 'audio', item, level: '5' },
    ];

    const queue = buildRandomQueue(candidates, NONE, NOW);

    expect(queue).toHaveLength(1);
    expect(queue[0]!.mode).toBe<ReviewMode>('vocab-writing');
  });

  it('does not spin when the pool is smaller than a round', () => {
    const queue = buildRandomQueue(pool(3), NONE, NOW);
    expect(queue).toHaveLength(3);
  });

  it('returns nothing for an empty pool', () => {
    expect(buildRandomQueue([], NONE, NOW)).toEqual([]);
  });

  it('carries the review state through for items that have one', () => {
    const state: ItemReviewState = {
      itemId: 'w0',
      stability: 4,
      difficulty: 5,
      dueAt: Timestamp.fromMillis(NOW.getTime() - 2 * DAY),
    };

    const queue = buildRandomQueue(pool(1), () => state, NOW);

    expect(queue[0]!.state).toBe(state);
    expect(queue[0]!.overdueDays).toBeCloseTo(2, 5);
  });
});
