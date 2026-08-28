import { describe, expect, it } from 'vitest';
import {
  BASE_NEW,
  BASE_SESSION,
  MAX_APPETITE,
  MAX_SESSION,
  MIN_APPETITE,
  MIN_REVIEWS_TO_MEASURE,
  STRUGGLING_BELOW,
  THROUGHPUT_WINDOW_DAYS,
  accuracyFrom,
  nextAppetite,
  pace,
  throughputFrom,
  type Load,
} from './pacing';

const NOW = new Date('2026-08-27T10:00:00Z');
const DAY = 86_400_000;

function load(over: Partial<Load> = {}): Load {
  return { due: 0, unseen: 1_000, throughput: 30, accuracy: 0.9, measured: true, ...over };
}

describe('pace', () => {
  it('uses defaults until there is something to measure', () => {
    const p = pace(load({ measured: false }));
    expect(p.maxItems).toBe(BASE_SESSION);
    expect(p.maxNew).toBe(BASE_NEW);
    expect(p.state).toBe('starting');
  });

  it('introduces nothing new while behind', () => {
    // The one rule here that is not a matter of taste: adding debt while behind
    // is how a backlog becomes permanent.
    const p = pace(load({ due: 200, throughput: 30 }));
    expect(p.maxNew).toBe(0);
    expect(p.state).toBe('behind');
  });

  it('grows the session to meet what is due', () => {
    // Offering fifteen when eighty are due guarantees sixty-five roll over.
    const p = pace(load({ due: 50, throughput: 60 }));
    expect(p.maxItems).toBeGreaterThan(BASE_SESSION);
    expect(p.maxItems).toBeGreaterThanOrEqual(50);
  });

  it('will not propose more than anyone sits through', () => {
    const p = pace(load({ due: 5_000, throughput: 5_000 }));
    expect(p.maxItems).toBeLessThanOrEqual(MAX_SESSION);
  });

  it('does not shrink below a worthwhile session', () => {
    const p = pace(load({ due: 1, unseen: 0, throughput: 40 }));
    expect(p.maxItems).toBeGreaterThanOrEqual(5);
  });

  it('holds new material back when accuracy is poor, even with headroom', () => {
    const p = pace(load({ due: 0, throughput: 60, accuracy: STRUGGLING_BELOW - 0.05 }));
    expect(p.maxNew).toBe(0);
    expect(p.state).toBe('struggling');
  });

  it('introduces new material when nothing is due and answers are landing', () => {
    const p = pace(load({ due: 0, throughput: 40, accuracy: 0.95 }));
    expect(p.maxNew).toBeGreaterThan(0);
    expect(p.state).toBe('ahead');
  });

  it('scales new material with the headroom, not to a flat number', () => {
    const roomy = pace(load({ due: 0, throughput: 60 }));
    const tight = pace(load({ due: 10, throughput: 20 }));
    expect(roomy.maxNew).toBeGreaterThan(tight.maxNew);
  });

  it('never promises more new material than exists', () => {
    expect(pace(load({ due: 0, throughput: 60, unseen: 2 })).maxNew).toBe(2);
    expect(pace(load({ due: 0, throughput: 60, unseen: 0 })).maxNew).toBe(0);
  });

  it('caps new material even with vast headroom', () => {
    // A day of enthusiasm should not mortgage the next fortnight.
    expect(pace(load({ due: 0, throughput: 500 })).maxNew).toBeLessThanOrEqual(BASE_NEW);
  });

  it('reports a sustainable rate that does not flatter', () => {
    // An encouraging number that is wrong is worse than a discouraging one that
    // is right.
    const p = pace(load({ due: 90, throughput: 20 }));
    expect(p.sustainableRate).toBeGreaterThanOrEqual(90);
  });

  it('always explains the number it is showing', () => {
    for (const l of [
      load({ measured: false }),
      load({ due: 200 }),
      load({ due: 0 }),
      load({ due: 10 }),
      load({ accuracy: 0.5 }),
    ]) {
      expect(pace(l).note.length).toBeGreaterThan(10);
    }
  });
});

describe('throughputFrom', () => {
  const at = (daysAgo: number) => NOW.getTime() - daysAgo * DAY;

  it('reports nothing measurable with no history', () => {
    expect(throughputFrom([], NOW)).toEqual({ throughput: 0, measured: false });
  });

  it('stays unmeasured until there is enough of it', () => {
    const few = Array.from({ length: MIN_REVIEWS_TO_MEASURE - 1 }, () => at(1));
    expect(throughputFrom(few, NOW).measured).toBe(false);
  });

  it('averages over calendar days, not active days', () => {
    // A backlog accrues on skipped days too, so a rate that ignored them would
    // licence a session nobody sustains.
    const burst = Array.from({ length: 140 }, () => at(THROUGHPUT_WINDOW_DAYS - 1));
    const { throughput } = throughputFrom(burst, NOW);

    // 140 answers spread over the 13 days since the first of them, not 140 a
    // day. The exact divisor is days-since-first-review rather than the whole
    // window, so this checks the magnitude rather than pinning the arithmetic.
    expect(throughput).toBeGreaterThan(9);
    expect(throughput).toBeLessThan(12);
  });

  it('ignores activity older than the window', () => {
    // Four hundred reviews last spring say nothing about this week.
    const old = Array.from({ length: 400 }, () => at(200));
    expect(throughputFrom(old, NOW).throughput).toBe(0);
  });

  it('does not read a strong first day as a low daily rate', () => {
    const today = Array.from({ length: 60 }, () => at(0));
    expect(throughputFrom(today, NOW).throughput).toBeGreaterThanOrEqual(60 / 1.01);
  });
});

describe('accuracyFrom', () => {
  const at = (daysAgo: number) => NOW.getTime() - daysAgo * DAY;

  it('is optimistic with no history, so a first session is not throttled', () => {
    expect(accuracyFrom([], NOW)).toBe(1);
  });

  it('counts everything that was not a failure', () => {
    const results = [
      { result: 'good', at: at(1) },
      { result: 'easy', at: at(1) },
      { result: 'hard', at: at(1) },
      { result: 'fail', at: at(1) },
    ];
    expect(accuracyFrom(results, NOW)).toBe(0.75);
  });

  it('ignores answers older than the window', () => {
    const results = [
      { result: 'fail', at: at(200) },
      { result: 'good', at: at(1) },
    ];
    expect(accuracyFrom(results, NOW)).toBe(1);
  });
});

describe('the earned new-item ration', () => {
  const measured = {
    due: 0,
    unseen: 5_000,
    throughput: 20,
    accuracy: 0.95,
    measured: true,
  };

  it('is what a session with nothing due is made of', () => {
    // The complaint this exists to answer: eight questions a day for ever,
    // however easy they were. With nothing due the session *is* the ration.
    const eight = pace({ ...measured, measured: false, appetite: 8 });
    const twenty = pace({ ...measured, measured: false, appetite: 20 });

    expect(eight.maxItems).toBe(15);
    expect(eight.maxNew).toBe(8);
    expect(twenty.maxNew).toBe(20);
    expect(twenty.maxItems).toBe(20);
  });

  it('does not let the session ceiling truncate what it just allowed', () => {
    // `maxItems` used to be clamped to a ceiling of at least BASE_SESSION, so
    // an appetite above fifteen silently dropped the difference.
    const pacing = pace({ ...measured, measured: false, appetite: 25 });
    expect(pacing.maxItems).toBeGreaterThanOrEqual(pacing.maxNew);
  });

  it('is still bounded by what today can afford', () => {
    // A big appetite does not buy new material when the day is already full:
    // each new item is three near-term reviews, and that rule outranks it.
    const pacing = pace({ ...measured, due: 22, appetite: 30 });
    expect(pacing.maxNew).toBeLessThanOrEqual(1);
  });

  it('cannot override being behind or struggling', () => {
    expect(pace({ ...measured, due: 200, appetite: 30 }).maxNew).toBe(0);
    expect(pace({ ...measured, accuracy: 0.5, appetite: 30 }).maxNew).toBe(0);
  });

  it('grows on a session finished accurately', () => {
    expect(nextAppetite(8, { finished: true, offered: 10, answered: 10, right: 10 })).toBe(10);
  });

  it('holds steady on a session finished with ordinary accuracy', () => {
    expect(nextAppetite(8, { finished: true, offered: 10, answered: 10, right: 8 })).toBe(8);
  });

  it('falls when a session is walked away from', () => {
    expect(nextAppetite(12, { finished: false, offered: 20, answered: 4, right: 4 })).toBe(9);
  });

  it('does not punish someone who all but finished', () => {
    // Eighteen of twenty and then the tab closed is not a rejection of the
    // size, and treating it as one would penalise the wrong thing.
    expect(nextAppetite(8, { finished: false, offered: 20, answered: 18, right: 17 })).toBe(10);
  });

  it('falls on a session finished badly', () => {
    expect(nextAppetite(12, { finished: true, offered: 10, answered: 10, right: 5 })).toBe(9);
  });

  it('stays inside its bounds, and treats an empty session as no evidence', () => {
    expect(nextAppetite(MAX_APPETITE, { finished: true, offered: 5, answered: 5, right: 5 }))
      .toBe(MAX_APPETITE);
    expect(nextAppetite(MIN_APPETITE, { finished: false, offered: 5, answered: 1, right: 0 }))
      .toBe(MIN_APPETITE);
    expect(nextAppetite(11, { finished: false, offered: 0, answered: 0, right: 0 })).toBe(11);
  });
});
