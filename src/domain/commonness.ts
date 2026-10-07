import type { StudyItem, Tier } from './items';

/**
 * How common an item is, and what that is allowed to decide.
 *
 * The tier comes from JMdict's priority tags (see `scripts/build-commonness.py`
 * and `docs/WORD-SELECTION.md`). It answers a different question from `rank`:
 * `rank` orders words *within* a level by how often Tatoeba uses them, and says
 * nothing about whether a word is worth knowing; the tier says that.
 *
 * Two uses, both here so the cut is made in one place:
 *
 * - **Introduction order** (`byIntroduction`): within a level, common words are
 *   met before uncommon ones.
 * - **Practice weight** (`practiceWeight`): the unscheduled filler leans towards
 *   common words and is only occasionally an obscure one.
 *
 * Tiers 1 and 2 are treated alike for ordering. The line between "core" and
 * "common" is a band boundary in a frequency list (nf12 against nf13), and
 * ordering across it would be ordering by noise; Tatoeba rank already sorts
 * the pair sensibly. The line that means something is between a word JMdict
 * lists as common and one it does not.
 *
 * Kanji items carry no tier and read as common: the kanji deck is the JLPT
 * list, and what is worth knowing about a kanji is already in its level.
 */

/** The tier assumed when an item has none: common, so nothing is demoted blind. */
export const DEFAULT_TIER: Tier = 2;

export function tierOf(item: StudyItem): Tier {
  return ('tier' in item ? item.tier : undefined) ?? DEFAULT_TIER;
}

/** Whether JMdict lists the word as uncommon or leaves it unlisted. */
export function isObscure(item: StudyItem): boolean {
  return tierOf(item) >= 3;
}

/**
 * Orders two items of one level for introduction: every common word before any
 * obscure one, then by Tatoeba rank. Negative when `a` comes first.
 */
export function byIntroduction(a: StudyItem, b: StudyItem): number {
  return (
    Number(isObscure(a)) - Number(isObscure(b)) ||
    (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)
  );
}
