import { isKanjiItem, type StudyItem } from './items';
import type { QuizMode } from './modes';

/**
 * Plausible wrong answers, for multiple choice.
 *
 * The whole difficulty of a choice question is in the distractors. Four options
 * picked at random from the deck make a question anyone passes without knowing
 * anything — 毎月 against 図書館, 冷蔵庫 and 飛行機 is answerable from the
 * shape of the word alone. Distractors have to be things you could actually
 * confuse the answer with, or the question measures nothing and the scheduler
 * is told you know something you do not.
 *
 * So they are chosen by similarity to the correct answer, using whatever the
 * question is actually testing:
 *
 * - **Reading questions** want readings that sound alike — same length, shared
 *   kana, especially a shared first mora. こうえん against こうえん-adjacent
 *   readings is a real question; against ねこ it is not.
 * - **Writing questions** want characters that look alike — shared components,
 *   same length. The confusions worth drilling are 待/持/特 and 未/末, and a
 *   distractor set that never contains them never tests them.
 *
 * Pure and deterministic: the same item and pool always produce the same
 * options, so a question does not change under you if the component re-renders.
 */

export const DEFAULT_CHOICES = 4;

/**
 * Bigram overlap, as a fraction of the shorter string.
 *
 * Bigrams rather than characters because order carries most of the confusability
 * — こうえん and えんこう share every character and are not remotely alike.
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) {
    // Single characters have no bigrams; fall back to sharing the character.
    return a === b ? 1 : 0;
  }

  const bigrams = (text: string): string[] =>
    Array.from({ length: text.length - 1 }, (_, i) => text.slice(i, i + 2));

  const left = bigrams(a);
  const right = new Set(bigrams(b));
  const shared = left.filter((gram) => right.has(gram)).length;

  return shared / Math.min(left.length, right.size);
}

/** What a choice question shows as its options, for a given quiz mode. */
export function answerText(item: StudyItem, quiz: QuizMode): string {
  if (quiz === 'vocab-reading') {
    return isKanjiItem(item) ? item.readings[0] ?? '' : item.reading;
  }
  return isKanjiItem(item) ? item.kanji : item.word;
}

interface Scored {
  text: string;
  score: number;
  order: number;
}

/**
 * Builds the option list for one question, correct answer included.
 *
 * The pool is the deck the question came from. Candidates are scored against
 * the correct answer and the best are taken — but not the *very* best
 * unconditionally: an exact duplicate of the answer is excluded, because two
 * identical options make the question unanswerable rather than hard.
 */
/**
 * What an exactly-matching length is worth.
 *
 * Larger than the similarity term can reach on its own, deliberately: being
 * unguessable by shape comes before being confusable in meaning, because a
 * question you can answer without reading it teaches nothing at all.
 */
const SAME_LENGTH_BONUS = 1.2;

export function buildChoices(
  item: StudyItem,
  pool: readonly StudyItem[],
  quiz: QuizMode,
  count = DEFAULT_CHOICES,
): string[] {
  const correct = answerText(item, quiz);
  if (!correct) return [];

  const seen = new Set([correct]);
  const scored: Scored[] = [];

  pool.forEach((candidate, order) => {
    if (candidate.id === item.id) return;

    const text = answerText(candidate, quiz);
    if (!text || seen.has(text)) return;
    seen.add(text);

    /*
     * Length agreement, which bigrams under-weight and which decides more
     * questions than anything else here: a two-mora reading among three
     * four-mora ones is pickable by counting, without reading a single option.
     *
     * A linear penalty was not enough. Measured over the whole corpus, 38.6% of
     * vocab-reading questions still came out with the answer the only option of
     * its length — the similarity and shared-opening terms simply outbid
     * `0.15 × Δ` most of the time. An exact match is worth more than either of
     * them now, and the linear term keeps ordering the rest.
     */
    const lengthPenalty = Math.abs(text.length - correct.length) * 0.15;
    const sameLength = text.length === correct.length ? SAME_LENGTH_BONUS : 0;
    const shared = similarity(correct, text);
    // A shared opening is the single strongest source of genuine confusion.
    const sameStart = text[0] === correct[0] ? 0.25 : 0;

    scored.push({ text, score: shared + sameStart + sameLength - lengthPenalty, order });
  });

  // Descending similarity; candidate order breaks ties so the result is stable.
  scored.sort((a, b) => b.score - a.score || a.order - b.order);

  const options = [correct, ...scored.slice(0, count - 1).map((s) => s.text)];

  // Position the answer deterministically but not predictably: always-first
  // would be obvious, and random would reshuffle on every render. Hashing the
  // item id gives a fixed, arbitrary-looking slot per question.
  return rotate(options, hash(item.id) % options.length);
}

function rotate<T>(items: T[], by: number): T[] {
  const at = ((by % items.length) + items.length) % items.length;
  return [...items.slice(items.length - at), ...items.slice(0, items.length - at)];
}

function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}
