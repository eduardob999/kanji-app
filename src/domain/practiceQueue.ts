import { reviewModeFor } from './modes';
import { ROUND_SIZE, buildRandomQueue } from './randomPractice';
import {
  planSession,
  type Candidate,
  type PlanSessionOptions,
  type PlannedQuestion,
  type ReviewLookup,
} from './sessionPlanner';

/**
 * One queue for the one practice screen.
 *
 * This is the merge of Today's Session and Random. They were two screens
 * describing the same sitting from opposite ends: the session was the schedule
 * with nothing after it, and Random was everything after it with no schedule.
 * Between them sat the failure that made the session useless in practice, which
 * is that a modest backlog leaves no headroom for new material, so the front
 * door offered eight items while seven thousand words sat unlearned.
 *
 * So the mode stops being a place you go and becomes the form the next question
 * takes. A round is built in two parts, in this order:
 *
 * 1. **What the schedule asked for.** `planSession`, unchanged: due first, most
 *    overdue first, new material rationed by the pacer, interleaved across the
 *    four question types, one memory at most once. Nothing here second-guesses
 *    it, and nothing here may lengthen the ration.
 * 2. **Practice, once that runs out.** Drawn at random from material he has
 *    already met, so a round is never shorter than `roundSize` and the screen
 *    can never truthfully say there is nothing to do.
 *
 * Answers to the second part still count, and that is safe rather than
 * generous: FSRS reads recall at the time of the review, so an early success
 * grows stability less than a late one and practising ahead cannot inflate a
 * schedule. The reasoning is written out in `randomPractice.ts`.
 *
 * **Unseen material never enters through part two.** That is the one rule this
 * module exists to hold. Introducing a word is a decision the pacer makes,
 * because every new item is a review debt that comes back today, tomorrow and
 * in three days; letting the filler introduce words would make the ration
 * decorative and hand back the backlog it exists to prevent. The pool for part
 * two is therefore filtered to memories that already have a review state, which
 * is the only thing "already met" can mean.
 *
 * Pure, and deterministic given `now`, like both halves it is built from.
 */

export interface PracticeQueueOptions extends PlanSessionOptions {
  /**
   * How long a round is when the schedule alone would not fill one.
   *
   * A floor, never a ceiling: a day with eighty things due produces a round of
   * eighty, because the pacer decided that and it outranks this.
   */
  roundSize?: number;
}

/** The identity a schedule is kept against: one memory, however it is asked. */
function memoryKey(mode: string, itemId: string): string {
  return `${mode}:${itemId}`;
}

export function buildPracticeQueue(
  candidates: readonly Candidate[],
  lookup: ReviewLookup,
  now: Date,
  options: PracticeQueueOptions = {},
): PlannedQuestion[] {
  const { roundSize = ROUND_SIZE, ...planning } = options;

  const scheduled = planSession(candidates, lookup, now, planning);

  const shortfall = roundSize - scheduled.length;
  if (shortfall <= 0) return scheduled;

  /*
   * The filler pool: already met, and not already in this round.
   *
   * Both conditions are applied here, to the pool, rather than to the draw.
   * Filtering the source is what makes the guarantee checkable: nothing
   * downstream can reintroduce a word that was excluded, because it was never
   * offered one.
   */
  const claimed = new Set(scheduled.map((q) => memoryKey(q.mode, q.item.id)));

  const met = candidates.filter((candidate) => {
    const mode = reviewModeFor(candidate.quiz);
    const key = memoryKey(mode, candidate.item.id);
    if (claimed.has(key)) return false;
    // No review state is exactly what "never seen in this mode" means, and it
    // is the same test `planSession` uses to decide something is new material.
    return lookup(mode, candidate.item.id) !== null;
  });

  const filler = buildRandomQueue(met, lookup, now, { size: shortfall }).map((question) => ({
    ...question,
    unscheduled: true,
  }));

  return [...scheduled, ...filler];
}
