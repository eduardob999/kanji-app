import { dueDateOf, type ReviewLookup } from './sessionPlanner';
import { deckTypeForReviewMode, REVIEW_MODES, type ReviewMode } from './modes';
import type { DeckType } from './items';

/**
 * When an item is next coming round, said in a few words.
 *
 * Browse claims in the nav — and in the roadmap — to show every kanji and word
 * "with its schedule", and it showed the reading and the meaning and nothing
 * else. Looking a word up to find out when you will next see it is a reasonable
 * thing to want, and it is the only screen that could answer it.
 *
 * An item is not one memory. A vocabulary entry is scheduled separately for
 * reading it and for producing it in context, and those fall due on different
 * days. The **soonest** is what to report: it is the day the item next appears
 * in front of you, which is the question being asked.
 */

export interface NextDue {
  /** Null when nothing about this item has been scheduled yet. */
  at: Date | null;
  /** How many of this item's memories have been started at all. */
  started: number;
  /** How many it has, so "1 of 2" means something. */
  total: number;
}

function modesFor(type: DeckType): ReviewMode[] {
  return REVIEW_MODES.filter((mode) => deckTypeForReviewMode(mode) === type);
}

export function nextDue(itemId: string, type: DeckType, lookup: ReviewLookup): NextDue {
  const modes = modesFor(type);
  let soonest: Date | null = null;
  let started = 0;

  for (const mode of modes) {
    const state = lookup(mode, itemId);
    if (!state) continue;

    started += 1;
    const due = dueDateOf(state);
    // A reviewed item with no due date should not exist; treat it as waiting
    // rather than as unscheduled, which is what the planner does with it.
    if (due === null) return { at: new Date(0), started, total: modes.length };
    if (soonest === null || due < soonest) soonest = due;
  }

  return { at: soonest, started, total: modes.length };
}

/**
 * "due now", "tomorrow", "in 3 weeks".
 *
 * Rounded to the unit someone would use out loud. Precision past that is noise:
 * nobody plans around whether a word is back in 19 or 21 days.
 */
export function describeDue(at: Date | null, now: Date): string {
  /*
   * An em dash rather than "not started".
   *
   * On a new account every row is unstarted, so the words repeat down the whole
   * list and say nothing — a column of identical text where a schedule should
   * be. The dash is the same "nothing here" this app already uses for a missing
   * meaning, and it lets the column speak only when it has something to say.
   */
  if (at === null) return '—';

  const days = (at.getTime() - now.getTime()) / 86_400_000;
  if (days <= 0) return 'due now';
  if (days < 1) return 'later today';
  if (days < 2) return 'tomorrow';
  if (days < 14) return `in ${Math.round(days)} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  if (days < 365) return `in ${Math.round(days / 30)} months`;
  return 'in over a year';
}
