import { baseLevel, levelRank, type Level, type StudyItem } from './items';
import { reviewModeFor, type QuizMode, type ReviewMode } from './modes';
import type { ItemReviewState } from './review';

/**
 * Choosing what to answer right now.
 *
 * Three rules do the work:
 *
 * 1. **Anything due comes first, most overdue first.** That is the schedule
 *    doing its job; everything else is what to do with the leftover room.
 * 2. **New material is rationed.** With 9,445 items and no history, "show me
 *    what is due" and "show me everything" are the same query, and a session
 *    that introduces 200 new words has taught you none of them. `maxNew` is the
 *    ration.
 * 3. **Nothing is blocked practice.** Ten N1 kanji in a row feels productive
 *    and transfers poorly. Selection caps each mode-and-level group, and then
 *    the chosen questions are interleaved round-robin so consecutive questions
 *    come from different groups wherever the material allows.
 *
 * Adapted from GHAPP's planner, which capped per family but did not interleave
 * the result — with 41 skills the cap was enough, and here it is not.
 *
 * Pure: `now` is a parameter, and the output for a given input never varies.
 */

/** One thing that *could* be asked: an item, and the question type to ask it as. */
export interface Candidate {
  quiz: QuizMode;
  item: StudyItem;
  level: Level;
}

export interface PlannedQuestion {
  quiz: QuizMode;
  mode: ReviewMode;
  level: Level;
  item: StudyItem;
  /** Absent for an item that has never been reviewed in this mode. */
  state: ItemReviewState | null;
  /** How overdue it was when planned, in days. Zero for new material. */
  overdueDays: number;
}

export interface PlanSessionOptions {
  /** Questions in a sitting. */
  maxItems?: number;
  /** Of those, how many may be material never seen before. */
  maxNew?: number;
  /** Cap per mode-and-level group, before interleaving. */
  maxPerGroup?: number;
}

/** Short enough to finish standing up. */
export const DEFAULT_MAX_ITEMS = 15;

/**
 * Enough to make progress, few enough to still be there tomorrow.
 *
 * Every new item is a review debt: it comes back today, tomorrow, in three
 * days. Introducing thirty in a sitting is how a spaced-repetition habit
 * collapses under its own backlog two weeks later.
 */
export const DEFAULT_MAX_NEW = 8;

export const DEFAULT_MAX_PER_GROUP = 5;

const MILLISECONDS_PER_DAY = 86_400_000;

export type ReviewLookup = (mode: ReviewMode, itemId: string) => ItemReviewState | null;

/**
 * What counts as "one kind of thing" for the purpose of not doing too much of
 * it at once.
 *
 * Keyed on the *base* JLPT level, so the four stored quarters of N1 share a
 * single allowance. Keying on the stored level let N1 contribute four times
 * what any other level could — the cap that exists to prevent blocked practice,
 * switched off for the largest level in the corpus by a change to how it was
 * filed.
 */
function groupKey(mode: ReviewMode, level: Level): string {
  return `${mode}:${baseLevel(level)}`;
}

/** The identity a schedule is kept against: one memory, however it is asked. */
function memoryKey(mode: ReviewMode, itemId: string): string {
  return `${mode}:${itemId}`;
}

export function dueDateOf(state: ItemReviewState | null): Date | null {
  return state?.dueAt ? state.dueAt.toDate() : null;
}

/**
 * Round-robin across groups.
 *
 * Takes one question from each group in turn, so a session of ten N3 vocab and
 * five N5 kanji comes out alternating rather than in two blocks. Groups are
 * visited in the order they first appear, which keeps the most overdue material
 * near the front where it belongs.
 */
function interleave(questions: PlannedQuestion[]): PlannedQuestion[] {
  const groups = new Map<string, PlannedQuestion[]>();

  for (const question of questions) {
    const key = groupKey(question.mode, question.level);
    const group = groups.get(key);
    if (group) group.push(question);
    else groups.set(key, [question]);
  }

  const queues = [...groups.values()];
  const out: PlannedQuestion[] = [];

  while (out.length < questions.length) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) out.push(next);
    }
  }

  return out;
}

export function planSession(
  candidates: readonly Candidate[],
  lookup: ReviewLookup,
  now: Date,
  options: PlanSessionOptions = {},
): PlannedQuestion[] {
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const maxNew = options.maxNew ?? DEFAULT_MAX_NEW;
  const maxPerGroup = options.maxPerGroup ?? DEFAULT_MAX_PER_GROUP;

  const due: PlannedQuestion[] = [];
  const fresh: PlannedQuestion[] = [];
  // One memory is asked at most once per session, however many question types
  // could test it. Fill-in and listening share a review state, so without this
  // the same word arrives twice wearing different clothes.
  const claimed = new Set<string>();

  candidates.forEach((candidate) => {
    const mode = reviewModeFor(candidate.quiz);
    const key = memoryKey(mode, candidate.item.id);
    if (claimed.has(key)) return;

    const state = lookup(mode, candidate.item.id);
    const base = { quiz: candidate.quiz, mode, level: candidate.level, item: candidate.item };

    if (!state) {
      claimed.add(key);
      fresh.push({ ...base, state: null, overdueDays: 0 });
      return;
    }

    const dueAt = dueDateOf(state);

    // A reviewed item with no due date should not exist, but if one does,
    // asking it is better than dropping it from every future session.
    const overdueMs = dueAt === null ? Infinity : now.getTime() - dueAt.getTime();
    if (overdueMs < 0) return;

    claimed.add(key);
    due.push({
      ...base,
      state,
      overdueDays: dueAt === null ? 0 : overdueMs / MILLISECONDS_PER_DAY,
    });
  });

  // Most overdue first.
  due.sort((a, b) => b.overdueDays - a.overdueDays);
  // Easiest unseen material first; candidate order breaks ties, so the result
  // is stable for a stable input.
  fresh.sort((a, b) => levelRank(a.level) - levelRank(b.level));

  const chosen: PlannedQuestion[] = [];
  const perGroup = new Map<string, number>();

  const take = (question: PlannedQuestion): boolean => {
    const key = groupKey(question.mode, question.level);
    const used = perGroup.get(key) ?? 0;
    if (used >= maxPerGroup) return false;

    perGroup.set(key, used + 1);
    chosen.push(question);
    return true;
  };

  for (const question of due) {
    if (chosen.length >= maxItems) break;
    take(question);
  }

  let introduced = 0;
  for (const question of fresh) {
    if (chosen.length >= maxItems || introduced >= maxNew) break;
    if (take(question)) introduced += 1;
  }

  return interleave(chosen);
}

/**
 * How much is waiting, without building a session for it.
 *
 * Used by the Study menu to say "42 due" before you commit to opening anything.
 * Counts memories rather than candidates, for the same reason the planner
 * claims them.
 */
export function countDue(
  candidates: readonly Candidate[],
  lookup: ReviewLookup,
  now: Date,
): { due: number; unseen: number } {
  const seen = new Set<string>();
  let due = 0;
  let unseen = 0;

  for (const candidate of candidates) {
    const mode = reviewModeFor(candidate.quiz);
    const key = memoryKey(mode, candidate.item.id);
    if (seen.has(key)) continue;
    seen.add(key);

    const state = lookup(mode, candidate.item.id);
    if (!state) {
      unseen += 1;
      continue;
    }

    const dueAt = dueDateOf(state);
    if (dueAt === null || dueAt.getTime() <= now.getTime()) due += 1;
  }

  return { due, unseen };
}
