import { reviewModeFor } from './modes';
import type { Candidate, PlannedQuestion, ReviewLookup } from './sessionPlanner';

/**
 * Endless mixed practice, ignoring the schedule.
 *
 * The CLI's Random Quiz "pulled from a different category each question, to
 * simulate the unpredictability of JLPT exams". This is that: any word, any
 * question type, no regard for what is due.
 *
 * It is deliberately *not* a second scheduler. Today's Session is what the
 * spacing model says you should do, and doing more than that has diminishing
 * returns — which is why this is a separate screen you choose rather than an
 * extension of the session. What it is for is the case the schedule cannot
 * serve: you have cleared today's reviews and want to keep going, or you want
 * the unpredictability of not knowing which of four ways a word will be asked.
 *
 * Answers still count. A review that arrives before its due date is real
 * evidence and FSRS handles it correctly — an early success grows stability
 * less than a late one, because the model reads recall at the time of the
 * review. Practising ahead therefore cannot inflate a schedule.
 *
 * Pure, and deterministic given `now`: the frame passes a fresh `now` per
 * round, so each round is a different draw and a re-render inside a round is
 * not.
 */

/** Questions per round. The screen refills endlessly, a round at a time. */
export const ROUND_SIZE = 15;

/**
 * A small deterministic PRNG.
 *
 * `Math.random()` would reshuffle the queue on every re-render, which is the
 * bug where the question changes underneath you as your own answer lands.
 * Seeded from `now`, so a round is fixed once it starts.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface RandomOptions {
  size?: number;
}

export function buildRandomQueue(
  candidates: readonly Candidate[],
  lookup: ReviewLookup,
  now: Date,
  options: RandomOptions = {},
): PlannedQuestion[] {
  const size = options.size ?? ROUND_SIZE;
  if (candidates.length === 0) return [];

  const random = mulberry32(now.getTime());
  const chosen: PlannedQuestion[] = [];
  // One memory per round, however many question types could test it — the same
  // rule the planner applies, and for the same reason: fill-in and listening
  // share a review state, so without this one word arrives twice in a round
  // wearing different clothes.
  const claimed = new Set<string>();

  // Rejection sampling rather than a shuffle: the pool is ~23,000 candidates
  // and a round is fifteen, so copying and shuffling the whole thing to take
  // fifteen is work nobody needs. The attempt cap stops this spinning when the
  // pool is smaller than the round.
  const maxAttempts = size * 40;

  for (let attempt = 0; attempt < maxAttempts && chosen.length < size; attempt += 1) {
    const candidate = candidates[Math.floor(random() * candidates.length)];
    if (!candidate) continue;

    const mode = reviewModeFor(candidate.quiz);
    const key = `${mode}:${candidate.item.id}`;
    if (claimed.has(key)) continue;
    claimed.add(key);

    const state = lookup(mode, candidate.item.id);
    const dueAt = state?.dueAt?.toDate() ?? null;

    chosen.push({
      quiz: candidate.quiz,
      mode,
      level: candidate.level,
      item: candidate.item,
      state,
      // Reported honestly even though it played no part in the selection: the
      // frame shows it, and a negative number here is the truthful "you are
      // practising this early".
      overdueDays: dueAt ? (now.getTime() - dueAt.getTime()) / 86_400_000 : 0,
    });
  }

  return chosen;
}
