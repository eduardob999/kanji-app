import { isObscure, tierOf } from './commonness';
import { retrievability } from './fsrs';
import type { StudyItem, Tier } from './items';
import type { ItemReviewState } from './review';

/**
 * How much a candidate is wanted in unscheduled practice.
 *
 * The practice that fills out a round used to be a uniform draw over everything
 * already met. Uniform means a word met once in a corner of N1 is as likely as
 * 食べる, and the round is as likely to be fifteen of one kind of question as a
 * mix. This is the "semi-random filter": still random, so it never becomes a
 * second schedule, but random in proportion to what is worth the time.
 *
 * Three things raise or lower a weight, multiplied together:
 *
 * - **How common the word is.** Core words at full weight, common slightly less,
 *   uncommon and unlisted at a small fraction. Obscure words are not removed: a
 *   learner who has met one should still meet it again, just rarely.
 * - **How close to forgotten it is.** Practising what is about to slip is worth
 *   more than practising what was seen an hour ago. Read from FSRS's own
 *   retrievability, so it uses the model's idea of forgetting rather than a
 *   second one invented here. A word not yet reviewed enough to have one is
 *   weighted as if fresh.
 * - **A failure history.** Words that have been missed come back a little more
 *   often. Gentle, because the leech cap already handles the extreme.
 *
 * Variety is not a property of one candidate but of the round so far, so it
 * lives in `varietyDiscount` and is applied as the round is drawn.
 */

const TIER_WEIGHT: Record<Tier, number> = { 1: 1, 2: 0.8, 3: 0.15, 4: 0.08 };

/** How much a memory at retrievability 0 would be favoured over one at 1. */
const SLIPPING_BOOST = 2;
const LAPSE_BOOST = 0.2;
const LAPSE_CAP = 5;

const DAY_MS = 86_400_000;

export function tierWeight(item: StudyItem): number {
  return TIER_WEIGHT[tierOf(item)];
}

/** 1 for a memory that is fresh or unmeasured, rising towards 3 as it nears forgotten. */
export function slippingWeight(state: ItemReviewState | null, now: Date): number {
  const stability = state?.stability;
  const last = state?.lastReviewedAt;
  if (!state || !stability || stability <= 0 || !last) return 1;

  const elapsedDays = Math.max(0, (now.getTime() - last.toMillis()) / DAY_MS);
  const recall = retrievability(elapsedDays, stability);
  return 1 + SLIPPING_BOOST * (1 - Math.min(1, Math.max(0, recall)));
}

export function lapseWeight(state: ItemReviewState | null): number {
  return 1 + LAPSE_BOOST * Math.min(state?.lapses ?? 0, LAPSE_CAP);
}

export function practiceWeight(
  item: StudyItem,
  state: ItemReviewState | null,
  now: Date,
): number {
  return tierWeight(item) * slippingWeight(state, now) * lapseWeight(state);
}

/**
 * What the round so far does to the next draw, so fifteen questions are not
 * fifteen of one kind.
 *
 * Each question type already in the round halves the next one's weight, and each
 * level already in it trims by a fifth. Soft, deliberately: with a thin pool a
 * hard rule would leave nothing to draw, and a soft one only ever says "prefer
 * something else".
 */
export function varietyDiscount(sameQuizInRound: number, sameLevelInRound: number): number {
  return 1 / ((1 + 0.5 * sameQuizInRound) * (1 + 0.25 * sameLevelInRound));
}

/** Re-exported so callers deciding about "rare" use the same definition. */
export { isObscure };
