import { describe, expect, it } from 'vitest';
import {
  MAX_INTAKE_DAYS,
  TARGET_PER_DAY,
  countSeeds,
  difficultyForLevel,
  seedStateFor,
  stabilityForStreak,
  intakeDaysFor,
  toBuckets,
  type LegacyEntry,
  type LegacySeedFile,
} from './legacySeed';

const NOW = new Date('2026-08-26T09:00:00Z');
const DAY = 86_400_000;

function entry(over: Partial<LegacyEntry> = {}): LegacyEntry {
  return { m: 'kanji', l: '5', i: '土', k: 1, ...over };
}

function file(entries: LegacyEntry[]): LegacySeedFile {
  return { source: 'test', generatedAt: NOW.toISOString(), note: '', entries };
}

describe('stabilityForStreak', () => {
  it('gives a streak nothing at all', () => {
    expect(stabilityForStreak(0)).toBe(0);
    expect(stabilityForStreak(-3)).toBe(0);
  });

  it('grows with the streak but stays modest', () => {
    // The CLI's scheduler asked whatever had the lowest score, often the same
    // day, so two correct answers is not two spaced reviews.
    expect(stabilityForStreak(2)).toBeGreaterThan(stabilityForStreak(1));
    expect(stabilityForStreak(2)).toBeLessThan(7);
  });

  it('is capped, so a hand-edited file cannot claim a year of memory', () => {
    expect(stabilityForStreak(500)).toBeLessThanOrEqual(14);
  });
});

describe('difficultyForLevel', () => {
  it('rates N1 harder than N5', () => {
    expect(difficultyForLevel('1d')).toBeGreaterThan(difficultyForLevel('5'));
  });

  it('stays inside the FSRS 1-10 range', () => {
    for (const level of ['5', '4', '3', '2', '1a', '1b', '1c', '1d'] as const) {
      expect(difficultyForLevel(level)).toBeGreaterThanOrEqual(1);
      expect(difficultyForLevel(level)).toBeLessThanOrEqual(10);
    }
  });
});

describe('seedStateFor', () => {
  it('produces a usable state', () => {
    const state = seedStateFor(entry(), NOW, 3)!;

    expect(state.itemId).toBe('土');
    expect(state.stability).toBeGreaterThan(0);
    expect(state.totalReps).toBe(1);
    expect(state.lapses).toBe(0);
    expect(state.dueAt).toBeDefined();
  });

  it('leaves predictedRecall unset', () => {
    // Nothing predicted these. A fabricated value would be fed straight into
    // the calibration curve on the Scheduler screen as if it were a real
    // prediction the model had made and been judged on.
    expect(seedStateFor(entry(), NOW, 3)!.predictedRecall).toBeUndefined();
  });

  it('dates the last review backwards, not to today', () => {
    // Saying it was reviewed today would tell the model a review happened that
    // did not, and make the item look fresher than the evidence supports.
    const state = seedStateFor(entry(), NOW, 3)!;
    expect(state.lastReviewedAt!.toMillis()).toBeLessThan(NOW.getTime());
  });

  it('rejects a level it does not recognise', () => {
    expect(seedStateFor(entry({ l: 'N9' }), NOW, 3)).toBeNull();
  });

  it('rejects a mode it does not recognise', () => {
    expect(seedStateFor(entry({ m: 'nonsense' as LegacyEntry['m'] }), NOW, 3)).toBeNull();
  });

  it('rejects a streak of zero', () => {
    expect(seedStateFor(entry({ k: 0 }), NOW, 3)).toBeNull();
  });

  it('is deterministic, so a re-import lands in the same place', () => {
    expect(seedStateFor(entry(), NOW, 3)).toEqual(seedStateFor(entry(), NOW, 3));
  });
});

describe('toBuckets', () => {
  it('groups by mode and level', () => {
    const buckets = toBuckets(
      file([
        entry({ m: 'kanji', l: '5', i: '土' }),
        entry({ m: 'kanji', l: '3', i: '語' }),
        entry({ m: 'vocab-reading', l: '5', i: '毎月|まいげつ' }),
      ]),
      NOW,
    );

    expect([...buckets.keys()].sort()).toEqual(['kanji:3', 'kanji:5', 'vocab-reading:5']);
    expect(countSeeds(buckets)).toBe(3);
  });

  it('spreads due dates across the intake window rather than piling them on one day', () => {
    // Thousands of items all due at once is a wall no session can clear,
    // followed by weeks of nothing.
    const entries = Array.from({ length: 300 }, (_, i) => entry({ i: `item-${i}` }));
    const buckets = toBuckets(file(entries), NOW);

    const days = [...buckets.values()]
      .flatMap((bucket) => [...bucket.values()])
      .map((state) => Math.floor((state.dueAt!.toMillis() - NOW.getTime()) / DAY));

    expect(new Set(days).size).toBeGreaterThan(3);
    expect(Math.max(...days)).toBeLessThanOrEqual(MAX_INTAKE_DAYS);
    expect(Math.min(...days)).toBeGreaterThanOrEqual(0);
  });

  it('widens the window with the size of the import', () => {
    // A fortnight was right for 1,117 items and is nonsense for 6,328: it would
    // ask for 450 reviews a day, so the backlog would never clear.
    expect(intakeDaysFor(200)).toBeLessThan(intakeDaysFor(6_000));
  });

  it('holds the daily rate at the target until the ceiling bites', () => {
    const size = 2_000;
    expect(intakeDaysFor(size)).toBe(Math.ceil(size / TARGET_PER_DAY));
  });

  it('accepts a busier day rather than an endless window on a large import', () => {
    // 6,328 items at 50 a day is 127 days; the ceiling trades that for ~53 a
    // day over four months, which is the better of the two.
    expect(intakeDaysFor(6_328)).toBe(MAX_INTAKE_DAYS);
    expect(6_328 / MAX_INTAKE_DAYS).toBeLessThan(TARGET_PER_DAY * 1.25);
  });

  it('keeps the window inside sane bounds', () => {
    expect(intakeDaysFor(1)).toBeGreaterThanOrEqual(14);
    expect(intakeDaysFor(1_000_000)).toBeLessThanOrEqual(MAX_INTAKE_DAYS);
  });

  it('brings the weakest evidence back first', () => {
    // A streak of one is a guess worth checking soon; a streak of five can
    // wait, which is also what its larger stability implies.
    const entries = [
      entry({ i: 'strong', k: 5 }),
      entry({ i: 'weak', k: 1 }),
      entry({ i: 'middling', k: 3 }),
    ];
    const buckets = toBuckets(file(entries), NOW);
    const all = [...buckets.values()].flatMap((b) => [...b.entries()]);
    const due = Object.fromEntries(all.map(([id, s]) => [id, s.dueAt!.toMillis()]));

    expect(due['weak']).toBeLessThan(due['middling']!);
    expect(due['middling']).toBeLessThan(due['strong']!);
  });

  it('drops entries it cannot place instead of guessing', () => {
    const buckets = toBuckets(file([entry({ l: 'N9' }), entry({ k: 0 })]), NOW);
    expect(countSeeds(buckets)).toBe(0);
  });

  it('handles an empty file', () => {
    expect(countSeeds(toBuckets(file([]), NOW))).toBe(0);
  });
});
