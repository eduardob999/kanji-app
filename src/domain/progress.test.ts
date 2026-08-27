import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import type { Deck, Level, StudyItem, VocabItem } from './items';
import type { ItemReviewState } from './review';
import {
  FAMILIAR_FROM,
  KNOWN_FROM,
  activityStrip,
  bandFor,
  dayKey,
  streaksFrom,
  summarise,
  summariseLevel,
} from './progress';

const NOW = new Date('2026-08-27T10:00:00');
const DAY = 86_400_000;

function vocab(id: string): VocabItem {
  return { id, word: id, reading: 'よみ', meaning: 'x' };
}

function deck(level: Level, size: number): Deck<StudyItem> {
  return {
    id: `vocab-${level}`,
    type: 'vocab',
    level,
    count: size,
    items: Array.from({ length: size }, (_, i) => vocab(`${level}-${i}`)),
  };
}

function state(stability: number, dueInDays = 5): ItemReviewState {
  return {
    itemId: 'x',
    stability,
    difficulty: 5,
    dueAt: Timestamp.fromMillis(NOW.getTime() + dueInDays * DAY),
  };
}

describe('bandFor', () => {
  it('calls an item with no state unseen', () => {
    expect(bandFor(null)).toBe('unseen');
  });

  it('calls an item with a state but no stability unseen', () => {
    // Should not happen, but guessing a band from nothing would put a made-up
    // item in the "known" column.
    expect(bandFor({ itemId: 'x' })).toBe('unseen');
  });

  it('bands by how long the memory is expected to last', () => {
    expect(bandFor(state(1))).toBe('learning');
    expect(bandFor(state(FAMILIAR_FROM))).toBe('familiar');
    expect(bandFor(state(KNOWN_FROM))).toBe('known');
    expect(bandFor(state(400))).toBe('known');
  });

  it('treats the thresholds as inclusive', () => {
    expect(bandFor(state(FAMILIAR_FROM - 0.01))).toBe('learning');
    expect(bandFor(state(KNOWN_FROM - 0.01))).toBe('familiar');
  });
});

describe('summariseLevel', () => {
  it('counts every item into exactly one band', () => {
    const d = deck('5', 10);
    const summary = summariseLevel(d, 'vocab-reading', () => null, NOW);

    expect(summary.total).toBe(10);
    expect(summary.counts.unseen).toBe(10);
    const counted = Object.values(summary.counts).reduce((a, b) => a + b, 0);
    expect(counted).toBe(10);
  });

  it('scores familiar items as half', () => {
    // Otherwise a bar sits still for weeks while real progress is happening.
    const d = deck('5', 4);
    const byId: Record<string, ItemReviewState> = {
      '5-0': state(KNOWN_FROM),
      '5-1': state(FAMILIAR_FROM),
    };

    const summary = summariseLevel(d, 'vocab-reading', (_m, id) => byId[id] ?? null, NOW);

    expect(summary.counts).toEqual({ known: 1, familiar: 1, learning: 0, unseen: 2 });
    expect(summary.score).toBeCloseTo((1 + 0.5) / 4, 5);
  });

  it('counts what is due', () => {
    const d = deck('5', 3);
    const byId: Record<string, ItemReviewState> = {
      '5-0': state(10, -2),
      '5-1': state(10, 5),
    };

    const summary = summariseLevel(d, 'vocab-reading', (_m, id) => byId[id] ?? null, NOW);

    // Only the overdue one; unseen items are not "due", they are unstarted.
    expect(summary.due).toBe(1);
  });

  it('scores an empty deck as zero rather than dividing by it', () => {
    const summary = summariseLevel(deck('5', 0), 'vocab-reading', () => null, NOW);
    expect(summary.score).toBe(0);
  });
});

describe('summarise', () => {
  it('totals across levels', () => {
    const decks = [deck('5', 4), deck('4', 6)];
    const summary = summarise(decks, 'vocab-reading', () => state(KNOWN_FROM), NOW);

    expect(summary.total).toBe(10);
    expect(summary.counts.known).toBe(10);
    expect(summary.score).toBe(1);
    expect(summary.levels).toHaveLength(2);
  });
});

describe('streaksFrom', () => {
  const at = (daysAgo: number) => NOW.getTime() - daysAgo * DAY;

  it('counts consecutive days up to today', () => {
    expect(streaksFrom([at(0), at(1), at(2)], NOW).current).toBe(3);
  });

  it('survives today being empty', () => {
    // Opening the app at nine in the morning after thirty days should not say
    // the streak is zero.
    expect(streaksFrom([at(1), at(2), at(3)], NOW).current).toBe(3);
  });

  it('breaks when a whole day passes unanswered', () => {
    expect(streaksFrom([at(2), at(3), at(4)], NOW).current).toBe(0);
  });

  it('ignores how many reviews happened on a day', () => {
    const many = [at(0), at(0), at(0), at(1)];
    expect(streaksFrom(many, NOW).current).toBe(2);
  });

  it('finds the longest run even when it is not the current one', () => {
    const days = [10, 9, 8, 7, 6, 1, 0].map(at);
    const streaks = streaksFrom(days, NOW);

    expect(streaks.longest).toBe(5);
    expect(streaks.current).toBe(2);
  });

  it('counts today and the total', () => {
    const streaks = streaksFrom([at(0), at(0), at(3)], NOW);
    expect(streaks.today).toBe(2);
    expect(streaks.totalReviews).toBe(3);
  });

  it('handles no history at all', () => {
    const streaks = streaksFrom([], NOW);
    expect(streaks).toMatchObject({ current: 0, longest: 0, today: 0, totalReviews: 0 });
  });

  it('counts a single day as a streak of one', () => {
    expect(streaksFrom([at(0)], NOW).longest).toBe(1);
  });

  it('does not break a run across a month boundary', () => {
    // The naive "same day number plus one" comparison fails on the 1st.
    const across = new Date('2026-09-02T10:00:00');
    const days = [
      new Date('2026-08-31T10:00:00').getTime(),
      new Date('2026-09-01T10:00:00').getTime(),
      new Date('2026-09-02T10:00:00').getTime(),
    ];
    expect(streaksFrom(days, across).current).toBe(3);
  });
});

describe('activityStrip', () => {
  it('returns one cell per day, oldest first, ending today', () => {
    const strip = activityStrip(streaksFrom([NOW.getTime()], NOW), NOW, 8);

    expect(strip).toHaveLength(56);
    expect(strip.at(-1)!.day).toBe(dayKey(NOW));
    expect(strip.at(-1)!.active).toBe(true);
  });

  it('marks only days with reviews', () => {
    const strip = activityStrip(streaksFrom([NOW.getTime() - 3 * DAY], NOW), NOW, 1);
    expect(strip.filter((d) => d.active)).toHaveLength(1);
  });
});
