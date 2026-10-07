import { reviewModeFor } from './modes';
import { practiceWeight, varietyDiscount } from './practiceWeight';
import type { Candidate, PlannedQuestion, ReviewLookup } from './sessionPlanner';

/**
 * A draw from a pool, ignoring the schedule.
 *
 * The CLI's Random Quiz "pulled from a different category each question, to
 * simulate the unpredictability of JLPT exams". This is that: any word in the
 * pool, any question type, no regard for what is due.
 *
 * It is deliberately *not* a second scheduler, and it is no longer a screen
 * either. `domain/practiceQueue.ts` uses it for one job: filling out the tail
 * of a round once what is due and the day's ration of new material have run
 * out. Which pool it draws from is that caller's decision and carries the rule
 * this file cannot enforce, that the tail is drilling rather than introduction,
 * so the pool it is handed holds only material already met.
 *
 * Answers still count. A review that arrives before its due date is real
 * evidence and FSRS handles it correctly: an early success grows stability less
 * than a late one, because the model reads recall at the time of the review.
 * Practising ahead therefore cannot inflate a schedule.
 *
 * Random in proportion to what is worth the time rather than uniformly: see
 * `practiceWeight.ts`, which makes common words likelier than obscure ones, leans
 * towards memories that are slipping, and spreads a round across question types
 * and levels.
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

  /*
   * A weighted draw, not a uniform one. What a candidate is worth — how common
   * the word is, how close the memory is to slipping, whether it has been missed
   * — is `practiceWeight`'s business and argued there; the round's own variety is
   * applied below as it fills. Weights are worked out once, because the pool is
   * ~23,000 candidates and only the variety terms change between draws.
   *
   * Each draw walks the pool once to total the weights and again to land on the
   * chosen one. That is fifteen draws over a pool this size, which is nothing,
   * and it keeps the sampler something a reader can check, unlike an alias table.
   */
  const states = candidates.map((candidate) =>
    lookup(reviewModeFor(candidate.quiz), candidate.item.id),
  );
  const base = candidates.map((candidate, i) =>
    practiceWeight(candidate.item, states[i] ?? null, now),
  );

  const chosen: PlannedQuestion[] = [];
  // One word per round, however many question types could test it. This is
  // stricter than the planner's one *memory* rule, and deliberately: practice is
  // chosen for variety, and the same word twice in fifteen is not.
  const taken = new Set<string>();
  const perQuiz = new Map<string, number>();
  const perLevel = new Map<string, number>();

  while (chosen.length < size) {
    const adjusted = candidates.map((candidate, i) =>
      taken.has(candidate.item.id)
        ? 0
        : base[i]! *
          varietyDiscount(perQuiz.get(candidate.quiz) ?? 0, perLevel.get(candidate.level) ?? 0),
    );

    const total = adjusted.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) break;

    let target = random() * total;
    let pick = adjusted.length - 1;
    for (let i = 0; i < adjusted.length; i += 1) {
      target -= adjusted[i]!;
      if (target < 0 && adjusted[i]! > 0) {
        pick = i;
        break;
      }
    }

    const candidate = candidates[pick]!;
    // The last index can be a rounding fallback onto a zero-weight candidate.
    if (taken.has(candidate.item.id)) break;

    taken.add(candidate.item.id);
    perQuiz.set(candidate.quiz, (perQuiz.get(candidate.quiz) ?? 0) + 1);
    perLevel.set(candidate.level, (perLevel.get(candidate.level) ?? 0) + 1);

    const mode = reviewModeFor(candidate.quiz);
    const state = states[pick] ?? null;
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
