import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KNOWN_FROM } from './progress';
import { scheduleNext } from './scheduler';
import type { ItemReviewState } from './review';
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

  it('hands out imported items no faster than a session can absorb them', () => {
    // The bug this pins: the intake target and the session size are the same
    // quantity and were picked independently, so 6,328 items were handed out at
    // 53 a day to a screen offering 15.
    const rate = 6_328 / intakeDaysFor(6_328);
    expect(rate).toBeLessThanOrEqual(TARGET_PER_DAY * 1.05);
    expect(intakeDaysFor(6_328)).toBeLessThanOrEqual(MAX_INTAKE_DAYS);
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

describe('the states the real export produces', () => {
  /*
   * The import writes 6,326 FSRS states into an account in one batch, and a
   * malformed one is not a visible error — it is an item that schedules itself
   * strangely for ever. The seed file ships in `public/`, so every state it
   * would produce can be checked here rather than discovered later.
   */
  const file = JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../public/legacy-seed.json'),
      'utf8',
    ),
  ) as LegacySeedFile;

  const NOW = new Date('2026-08-28T09:00:00Z');
  const buckets = toBuckets(file, NOW);

  it('produces a state the scheduler can use for every entry', () => {
    const wrong: string[] = [];

    for (const items of buckets.values()) {
      for (const [itemId, state] of items) {
        if (!(state.stability !== undefined && state.stability > 0)) {
          wrong.push(`${itemId} stability ${state.stability}`);
        }
        // FSRS difficulty is 1 (easy) to 10 (punishing); outside that the
        // interval maths produces nonsense rather than an error.
        if (!(state.difficulty !== undefined && state.difficulty >= 1 && state.difficulty <= 10)) {
          wrong.push(`${itemId} difficulty ${state.difficulty}`);
        }
        if (!state.dueAt) wrong.push(`${itemId} has no due date`);
        if (!(state.totalReps !== undefined && state.totalReps >= 1)) {
          wrong.push(`${itemId} reps ${state.totalReps}`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  it('does not make day one a wall', () => {
    // Every seeded item due at once is 6,326 questions and the end of the
    // habit. They are spread, and none of them lands in the past.
    const due = [...buckets.values()]
      .flatMap((items) => [...items.values()])
      .map((state) => (state.dueAt!.toMillis() - NOW.getTime()) / 86_400_000);

    expect(Math.min(...due)).toBeGreaterThanOrEqual(0);

    const perDay = new Map<number, number>();
    for (const days of due) {
      const day = Math.floor(days);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }

    // Evenly enough that no single day is a session nobody would finish.
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(TARGET_PER_DAY + 5);
  });
});

describe('what the import is actually worth', () => {
  /*
   * A seeded state is a guess, and a guess that never turns into a measurement
   * would make the whole import decorative. This traces the path from the seed
   * to what Progress calls "held", because the answer is not obvious and it
   * changed my mind twice.
   *
   * Straight after importing, almost nothing reads as held — 6,122 of the 6,326
   * seeded items land in Learning, because a stability of two days cannot
   * vouch for a month, and it should not pretend to.
   *
   * What redeems that is the intake spread. An item seeded at two days is not
   * asked for weeks, so when it *is* asked the elapsed time is real calendar
   * time in which the word went unseen — and recalling it then is strong
   * evidence rather than a formality. Everything above the lowest streak
   * reaches "known" on its first correct answer; the lowest takes three.
   *
   * The failure this guards is a plausible one: make the seeds more
   * conservative, or the intake faster, and the import quietly stops paying
   * for itself.
   */
  const file = JSON.parse(
    readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../public/legacy-seed.json'),
      'utf8',
    ),
  ) as LegacySeedFile;

  const NOW = new Date('2026-08-28T09:00:00Z');

  it('turns a seeded guess into a measurement the first time it is answered', () => {
    const buckets = toBuckets(file, NOW);

    // One representative per distinct seeded stability.
    const representative = new Map<number, ItemReviewState>();
    for (const items of buckets.values()) {
      for (const state of items.values()) {
        if (state.stability !== undefined && !representative.has(state.stability)) {
          representative.set(state.stability, state);
        }
      }
    }

    expect(representative.size).toBeGreaterThan(1);

    for (const [stability, seeded] of representative) {
      const update = scheduleNext(
        {
          stability,
          difficulty: seeded.difficulty!,
          reps: seeded.totalReps!,
          lapses: 0,
          lastPracticedAt: seeded.lastReviewedAt?.toDate() ?? NOW,
          intervalDays: seeded.intervalDays!,
        },
        'good',
        // Answered when it comes round, which is the only time it is asked.
        seeded.dueAt!.toDate(),
      );

      // Answering a seeded item correctly must always be worth something.
      expect(update.stability).toBeGreaterThan(stability);
    }
  });

  it('does not leave the commonest case stuck in Learning for ever', () => {
    // Streak 1 is 3,425 of the 6,328 entries — over half — and it seeds the
    // lowest stability there is. Three correct answers should carry it to what
    // Progress is willing to call known.
    const buckets = toBuckets(file, NOW);
    const lowest = Math.min(
      ...[...buckets.values()].flatMap((items) =>
        [...items.values()].map((state) => state.stability ?? Infinity),
      ),
    );

    const seeded = [...buckets.values()]
      .flatMap((items) => [...items.values()])
      .find((state) => state.stability === lowest)!;

    let state = {
      stability: lowest,
      difficulty: seeded.difficulty!,
      reps: seeded.totalReps!,
      lapses: 0,
      lastPracticedAt: seeded.lastReviewedAt?.toDate() ?? NOW,
      intervalDays: seeded.intervalDays!,
    };
    let when = seeded.dueAt!.toDate();

    for (let answer = 0; answer < 3; answer += 1) {
      const update = scheduleNext(state, 'good', when);
      state = {
        stability: update.stability,
        difficulty: update.difficulty,
        reps: update.reps,
        lapses: update.lapses,
        lastPracticedAt: when,
        intervalDays: update.intervalDays,
      };
      when = update.dueAt;
    }

    expect(state.stability).toBeGreaterThanOrEqual(KNOWN_FROM);
  });
});
