import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import type { Level, Tier, VocabItem } from './items';
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
    // Everything scheduled a year out, so the planner would return nothing.
    // This is the draw that keeps a round going anyway.
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

/**
 * What the weighted draw is *for*, measured over many rounds.
 *
 * One round is fifteen draws, far too few to show a lean, so each of these runs
 * hundreds of seeded rounds (a different `now` seeds a different round) and
 * checks a rate. The thresholds are loose on purpose: they say "the lean exists
 * and has not run away", not what the exact weights are.
 */
describe('buildRandomQueue weighting', () => {
  const ROUNDS = 300;

  const tiered = (id: string, tier: Tier): VocabItem => ({ ...vocab(id), tier });

  function rounds(candidates: Candidate[], lookup: Parameters<typeof buildRandomQueue>[1] = NONE) {
    return Array.from({ length: ROUNDS }, (_, i) =>
      buildRandomQueue(candidates, lookup, new Date(NOW.getTime() + i * 60_000)),
    );
  }

  it('draws obscure words rarely, but does not shut them out', () => {
    const candidates: Candidate[] = [
      ...Array.from({ length: 300 }, (_, i) => ({
        quiz: 'vocab-reading' as const,
        item: tiered(`common${i}`, 1),
        level: '3' as const,
      })),
      ...Array.from({ length: 300 }, (_, i) => ({
        quiz: 'vocab-reading' as const,
        item: tiered(`rare${i}`, 4),
        level: '3' as const,
      })),
    ];

    const picks = rounds(candidates).flat();
    const rare = picks.filter((q) => q.item.id.startsWith('rare')).length / picks.length;

    // Half the pool is obscure; a uniform draw would give 0.5.
    expect(rare).toBeGreaterThan(0.01);
    expect(rare).toBeLessThan(0.15);
  });

  it('leans towards memories that are about to slip', () => {
    const DAYS = 86_400_000;
    const candidates = [...pool(200), ...pool(200).map((c) => ({ ...c, item: vocab(`old${c.item.id}`) }))];

    const lookup = (_mode: ReviewMode, id: string): ItemReviewState => ({
      itemId: id,
      stability: 10,
      lapses: 0,
      totalReps: 4,
      // The "old" half was last seen long ago; the rest a moment ago.
      lastReviewedAt: Timestamp.fromMillis(
        NOW.getTime() - (id.startsWith('old') ? 120 : 0.1) * DAYS,
      ),
    });

    const picks = rounds(candidates, lookup).flat();
    const fading = picks.filter((q) => q.item.id.startsWith('old')).length / picks.length;

    expect(fading).toBeGreaterThan(0.55);
    expect(fading).toBeLessThan(0.85);
  });

  it('keeps a round mixed: no question type takes over', () => {
    const candidates: Candidate[] = [
      ...pool(300, 'vocab-reading'),
      ...pool(300, 'fill-in'),
      ...pool(300, 'kanji-writing'),
    ].map((candidate, i) => ({ ...candidate, item: vocab(`i${i}`) }));

    for (const round of rounds(candidates)) {
      const counts = new Map<string, number>();
      for (const q of round) counts.set(q.quiz, (counts.get(q.quiz) ?? 0) + 1);
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(9);
    }
  });

  it('never asks one word twice in a round', () => {
    const candidates: Candidate[] = [
      ...pool(40, 'vocab-reading'),
      ...pool(40, 'fill-in'),
      ...pool(40, 'audio'),
    ];

    for (const round of rounds(candidates)) {
      const ids = round.map((q) => q.item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('copes when every weight but one is zero-ish', () => {
    // A pool of one word asked three ways yields one question, not a loop.
    const item = vocab('only');
    const candidates: Candidate[] = (['vocab-reading', 'fill-in', 'audio'] as const).map((quiz) => ({
      quiz,
      item,
      level: '5',
    }));
    expect(buildRandomQueue(candidates, NONE, NOW)).toHaveLength(1);
  });
});
