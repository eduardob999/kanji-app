import { describe, expect, it } from 'vitest';
import {
  INTAKE_DAYS,
  countSeeds,
  difficultyForLevel,
  seedStateFor,
  stabilityForStreak,
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
    const state = seedStateFor(entry(), NOW)!;

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
    expect(seedStateFor(entry(), NOW)!.predictedRecall).toBeUndefined();
  });

  it('dates the last review backwards, not to today', () => {
    // Saying it was reviewed today would tell the model a review happened that
    // did not, and make the item look fresher than the evidence supports.
    const state = seedStateFor(entry(), NOW)!;
    expect(state.lastReviewedAt!.toMillis()).toBeLessThan(NOW.getTime());
  });

  it('rejects a level it does not recognise', () => {
    expect(seedStateFor(entry({ l: 'N9' }), NOW)).toBeNull();
  });

  it('rejects a mode it does not recognise', () => {
    expect(seedStateFor(entry({ m: 'nonsense' as LegacyEntry['m'] }), NOW)).toBeNull();
  });

  it('rejects a streak of zero', () => {
    expect(seedStateFor(entry({ k: 0 }), NOW)).toBeNull();
  });

  it('is deterministic, so a re-import lands in the same place', () => {
    expect(seedStateFor(entry(), NOW)).toEqual(seedStateFor(entry(), NOW));
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
    // 1,117 items all due at the same instant is a wall no session can clear,
    // followed by weeks of nothing.
    const entries = Array.from({ length: 300 }, (_, i) => entry({ i: `item-${i}` }));
    const buckets = toBuckets(file(entries), NOW);

    const days = [...buckets.values()]
      .flatMap((bucket) => [...bucket.values()])
      .map((state) => Math.floor((state.dueAt!.toMillis() - NOW.getTime()) / DAY));

    expect(new Set(days).size).toBeGreaterThan(3);
    expect(Math.max(...days)).toBeLessThanOrEqual(INTAKE_DAYS);
    expect(Math.min(...days)).toBeGreaterThanOrEqual(0);
  });

  it('drops entries it cannot place instead of guessing', () => {
    const buckets = toBuckets(file([entry({ l: 'N9' }), entry({ k: 0 })]), NOW);
    expect(countSeeds(buckets)).toBe(0);
  });

  it('handles an empty file', () => {
    expect(countSeeds(toBuckets(file([]), NOW))).toBe(0);
  });
});
