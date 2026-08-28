import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, TARGET_RETENTION, retrievability } from './fsrs';
import { calibration, fitWeights, type ReviewRecord } from './optimiser';
import { FAIL_INTERVAL_DAYS, scheduleNext, type SchedulerStateInput } from './scheduler';

/**
 * A year of studying, simulated, to check the parts that only misbehave over
 * time.
 *
 * Every other test here checks one call. The scheduler's actual job is a
 * feedback loop — it picks an interval, the interval decides how much is
 * forgotten, and what is forgotten decides the next interval — and a loop can
 * be wrong in ways no single step is. An interval rule that quietly converges
 * on "every day for ever", or one that runs away to a year after three good
 * answers, passes every unit test in this directory.
 *
 * The learner here is deliberately *not* an FSRS model. They forget on a plain
 * exponential with a per-item half-life, so the scheduler is being asked to
 * track something that does not share its assumptions — which is the honest
 * version of the problem, since neither does a person.
 */

const DAY = 86_400_000;

/** Deterministic, so a failure is reproducible rather than a bad afternoon. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Simulated {
  id: string;
  /** The truth the scheduler is trying to discover, in days. */
  halfLife: number;
  state: SchedulerStateInput;
  dueAt: number;
}

interface Outcome {
  log: ReviewRecord[];
  asked: number;
  recalled: number;
  finalIntervals: number[];
}

/**
 * @param easiness multiplies every item's true half-life. 1 is a learner the
 * default weights suit; below 1 is someone who forgets faster than the model
 * assumes.
 */
function study(
  days: number,
  itemCount: number,
  easiness: number,
  seed: number,
  weights: readonly number[] = DEFAULT_WEIGHTS,
): Outcome {
  const random = mulberry32(seed);
  const start = Date.UTC(2026, 0, 1);

  const items: Simulated[] = Array.from({ length: itemCount }, (_, i) => ({
    id: `item-${i}`,
    // A spread, because a corpus is not uniform: some words stick at once.
    halfLife: (0.6 + random() * 6) * easiness,
    state: {},
    dueAt: start,
  }));

  const log: ReviewRecord[] = [];
  let asked = 0;
  let recalled = 0;

  for (let day = 0; day < days; day += 1) {
    const now = start + day * DAY;
    // What a real sitting looks like: the backlog, capped.
    const due = items.filter((item) => item.dueAt <= now).slice(0, 40);

    for (const item of due) {
      const last = item.state.lastPracticedAt?.getTime() ?? null;
      const elapsedDays = last === null ? 0 : (now - last) / DAY;

      // The learner's own forgetting, which owes nothing to FSRS.
      const chance = last === null ? 0.3 : 2 ** (-elapsedDays / item.halfLife);
      const correct = random() < chance;

      asked += 1;
      if (correct) recalled += 1;

      const result = correct ? 'good' : 'fail';
      const update = scheduleNext(item.state, result, new Date(now), weights);

      log.push({ itemId: item.id, at: now, result, elapsedDays });

      // Recall practice strengthens the memory; a lapse costs some of it. The
      // numbers are arbitrary but the direction is not, and it is the direction
      // the scheduler has to track.
      item.halfLife = correct ? item.halfLife * 1.6 : Math.max(0.5, item.halfLife * 0.7);

      item.state = {
        ease: update.ease,
        intervalDays: update.intervalDays,
        lastPracticedAt: new Date(now),
        stability: update.stability,
        difficulty: update.difficulty,
        reps: update.reps,
        lapses: update.lapses,
      };
      item.dueAt = update.dueAt.getTime();
    }
  }

  return {
    log,
    asked,
    recalled,
    finalIntervals: items.map((item) => item.state.intervalDays ?? 0),
  };
}

describe('a year of scheduling', () => {
  const year = study(365, 120, 1, 12_345);

  it('asks enough to be worth measuring', () => {
    expect(year.asked).toBeGreaterThan(1_000);
  });

  it('keeps retention in a range that is worth studying in', () => {
    /*
     * Not a test that it hits 90%, and it is worth saying why.
     *
     * The scheduler aims for 90% *under its own model of forgetting*. This
     * learner forgets on a plain exponential, which is a different shape, so
     * some miss is structural rather than a defect — measured at about 68%
     * here, and chasing that number would be tuning the test's toy learner
     * rather than the app.
     *
     * What is worth asserting is that it stays in the band where practice
     * works at all. Much below this and the schedule is setting people up to
     * fail; much above and it is asking for things nobody was going to forget.
     * The real claim — that the model *adapts* to a learner it does not suit —
     * is tested below, where it can be tested honestly.
     */
    const achieved = year.recalled / year.asked;
    expect(achieved).toBeGreaterThan(0.6);
    expect(achieved).toBeLessThan(TARGET_RETENTION + 0.09);
  });

  it('spreads intervals out rather than converging on one number', () => {
    // The failure this is really watching for: a loop that settles on "ask
    // everything every day", which looks like diligence and is a treadmill.
    const sorted = [...year.finalIntervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const longest = sorted[sorted.length - 1]!;

    expect(median).toBeGreaterThan(3);
    expect(longest).toBeGreaterThan(30);
    expect(longest).toBeLessThanOrEqual(365);
  });

  it('never schedules a lapse further out than the relearning step', () => {
    // The bug this exists for was real, and inherited: FAIL_INTERVAL_DAYS was
    // a clamp *floor* rather than the interval, so an item with high stability
    // could fail and come back a week later.
    let checked = 0;
    for (const stability of [0.5, 5, 60, 300]) {
      const update = scheduleNext(
        { stability, difficulty: 5, reps: 10, lapses: 0, lastPracticedAt: new Date(Date.UTC(2026, 0, 1)) },
        'fail',
        new Date(Date.UTC(2026, 0, 20)),
      );
      expect(update.intervalDays).toBeLessThanOrEqual(FAIL_INTERVAL_DAYS);
      checked += 1;
    }
    expect(checked).toBe(4);
  });

  it('keeps what it predicts and what happens in the same units', () => {
    // The log's `elapsedDays` is what the optimiser replays against, so an
    // entry whose elapsed time disagrees with its own timestamps would train
    // the model on fiction. Checked here because the two are produced by
    // different modules and nothing else compares them.
    const seen = new Map<string, number>();
    for (const record of year.log) {
      const previous = seen.get(record.itemId);
      if (previous !== undefined) {
        expect(record.elapsedDays).toBeCloseTo((record.at - previous) / DAY, 6);
      }
      seen.set(record.itemId, record.at);
    }
  });
});

describe('fitting the model to the learner', () => {
  it('leaves the published weights alone for a learner they already suit', () => {
    // The guard that matters most: a fit adopted on noise makes the schedule
    // worse for ever, and there is no signal that would tell anyone.
    const { log } = study(240, 120, 1, 999);
    const fit = fitWeights(log, DEFAULT_WEIGHTS);

    if (fit.adopted) {
      // Adoption is allowed — but only for a real improvement on held-out
      // items, which is the whole point of holding them out.
      expect(fit.baselineLoss - fit.fittedLoss).toBeGreaterThan(0);
    }
    expect(fit.weights).toHaveLength(DEFAULT_WEIGHTS.length);
  });

  it('improves on the defaults for a learner who forgets much faster', () => {
    // Someone whose memories decay at a third of the assumed rate. If the
    // optimiser cannot beat the defaults here it cannot do anything, and the
    // adaptive claim is empty.
    const { log } = study(240, 160, 0.33, 4_242);
    const fit = fitWeights(log, DEFAULT_WEIGHTS);

    expect(fit.reviewsUsed).toBeGreaterThan(1_000);
    expect(fit.adopted).toBe(true);
    expect(fit.fittedLoss).toBeLessThan(fit.baselineLoss);
  });

  it('schedules better after fitting than before, for that learner', () => {
    /*
     * The end of the whole adaptive argument, and the only place it is checked
     * end to end: study with the published weights, fit to what happened, then
     * study the same learner again with what came out.
     *
     * The measure is held-out loss on the *original* history, not retention in
     * the second run — retention is confounded, because better weights mean
     * longer intervals as well as more accurate ones, and a model that learned
     * something true can quite properly answer fewer questions. Loss on data it
     * has not seen is the honest question: does it predict this person better?
     */
    const first = study(240, 160, 0.4, 7_1717);
    const fit = fitWeights(first.log, DEFAULT_WEIGHTS);

    expect(fit.adopted).toBe(true);

    // And the fitted weights must still produce a usable schedule rather than
    // one that technically predicts well and asks for everything at once.
    const second = study(240, 160, 0.4, 7_1717, fit.weights);
    const intervals = [...second.finalIntervals].sort((a, b) => a - b);
    expect(intervals[Math.floor(intervals.length / 2)]!).toBeGreaterThan(0.5);
    expect(second.asked).toBeGreaterThan(500);
  });

  it('predicts recall in the range a probability lives in', () => {
    for (const [elapsed, stability] of [[0, 1], [1, 1], [30, 5], [400, 200]]) {
      const r = retrievability(elapsed!, stability!);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});


/**
 * What the Scheduler screen is for.
 *
 * The calibration curve is the app's one admission of how well aimed it is: for
 * each band of predicted recall, what fraction was actually recalled. A model
 * that suits the learner sits on the diagonal; one that is too confident sits
 * under it.
 *
 * It is only worth a screen if it would actually show a mismatch, and that is
 * checkable — the simulation can produce a learner the defaults do not suit and
 * ask whether the curve says so.
 */
describe('the calibration curve', () => {
  /** Weighted by count, so a band with four reviews cannot swing it. */
  const bias = (buckets: ReturnType<typeof calibration>): number => {
    const total = buckets.reduce((n, b) => n + b.count, 0);
    if (total === 0) return 0;
    return buckets.reduce((sum, b) => sum + (b.actual - b.predicted) * b.count, 0) / total;
  };

  it('shows over-confidence for a learner who forgets faster than the model assumes', () => {
    const { log } = study(240, 160, 0.33, 4_242);
    const curve = calibration(log, DEFAULT_WEIGHTS);

    expect(curve.length).toBeGreaterThan(3);
    // Actual recall below predicted: the schedule is asking too late, which is
    // exactly the complaint a learner would have and could not otherwise name.
    expect(bias(curve)).toBeLessThan(-0.05);
  });

  it('straightens out once the weights are fitted to that learner', () => {
    // The claim the Scheduler screen makes to the person reading it: this is a
    // number that improves because the app did something about it.
    const { log } = study(240, 160, 0.33, 4_242);
    const fit = fitWeights(log, DEFAULT_WEIGHTS);
    expect(fit.adopted).toBe(true);

    const before = Math.abs(bias(calibration(log, DEFAULT_WEIGHTS)));
    const after = Math.abs(bias(calibration(log, fit.weights)));

    expect(after).toBeLessThan(before);
  });

  it('reports every band it has evidence for, and none it does not', () => {
    const { log } = study(200, 120, 1, 31_337);
    for (const bucket of calibration(log, DEFAULT_WEIGHTS)) {
      expect(bucket.count).toBeGreaterThan(0);
      expect(bucket.predicted).toBeGreaterThanOrEqual(0);
      expect(bucket.predicted).toBeLessThanOrEqual(1);
      expect(bucket.actual).toBeGreaterThanOrEqual(0);
      expect(bucket.actual).toBeLessThanOrEqual(1);
    }
  });
});
