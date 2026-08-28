import type { Level } from './items';

/**
 * Example sentences, loaded per level.
 *
 * Built at build time by `scripts/build-sentences.mjs` from the Tatoeba export
 * and shipped with the app, rather than fetched per question as the CLI's
 * `sentence_cache.py` did. A network round-trip in front of a question is a
 * question you cannot answer on a train.
 *
 * 90% of the corpus has at least one sentence — 99% at N5 and N3, 83% at N1,
 * which is the expected shape: Tatoeba is a corpus of things people actually
 * say. The rest fall back to a prompt built from the reading and meaning, which
 * is exactly what the CLI did when the API returned nothing.
 *
 * Sentences are CC-BY 2.0 FR and carry their Tatoeba id so any one of them can
 * be traced to its contributor.
 */

export interface Sentence {
  /** Tatoeba sentence id, kept for attribution. */
  id: number;
  text: string;
}

export interface SentencePack {
  id: string;
  level: Level;
  source: string;
  licence: string;
  /** Keyed by the written form of the word. */
  sentences: Record<string, Sentence[]>;
}

function packUrl(level: Level): string {
  return new URL(
    `sentences/vocab-${level}.json`,
    new URL(import.meta.env.BASE_URL, window.location.href),
  ).toString();
}

const cache = new Map<Level, Promise<SentencePack>>();

export async function loadSentencePack(level: Level): Promise<SentencePack> {
  let pending = cache.get(level);

  if (!pending) {
    pending = (async () => {
      const response = await fetch(packUrl(level));
      if (!response.ok) {
        throw new Error(`Could not load sentences for N${level} (${response.status}).`);
      }
      return (await response.json()) as SentencePack;
    })().catch((error: unknown) => {
      cache.delete(level);
      throw error;
    });

    cache.set(level, pending);
  }

  return pending;
}

/**
 * The sentence with the word blanked out.
 *
 * The reading goes in the gap, in brackets — the CLI's format, and the right
 * one: a bare blank leaves you guessing at a word that fits, while the reading
 * makes the question "which characters spell this", which is what is being
 * tested. Without the reading a fill-in question is a comprehension exercise
 * with many defensible answers, only one of which is marked correct.
 *
 * Only the first occurrence is replaced. A sentence using the word twice would
 * otherwise show the answer's shape twice over, and blanking both makes the
 * sentence harder to read than it needs to be.
 */
export function blankOut(sentence: string, word: string, reading: string): string {
  if (!word) return sentence;

  /*
   * Every occurrence, not the first.
   *
   * Blanking only the first left the answer sitting in the sentence whenever a
   * word turned up twice — 私たちは代わる代わる寝た, 誠に、誠に、あなたに告げます —
   * which is a fill-in question that fills itself in. 75 of the corpus's 18,408
   * word-and-sentence pairs did that.
   *
   * The cost is that a short word inside a longer compound gets blanked too:
   * 銅 in 青銅 becomes 青［どう］. That reads oddly, and it is still the better
   * trade — the question stays answerable and nothing is given away, where the
   * alternative hands over the answer. `chooseSentence` avoids these sentences
   * where a cleaner one exists, so this is the backstop for the six words in
   * the corpus that have no alternative at all.
   */
  const parts: string[] = [];
  let from = 0;

  for (;;) {
    const at = sentence.indexOf(word, from);
    if (at < 0) break;

    parts.push(sentence.slice(from, at), `［${reading}］`);
    from = at + word.length;
  }

  if (parts.length === 0) return sentence;

  parts.push(sentence.slice(from));
  return parts.join('');
}

/** How many times `word` appears, without overlapping itself. */
function occurrences(text: string, word: string): number {
  if (!word) return 0;

  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(word, from);
    if (at < 0) return count;
    count += 1;
    from = at + word.length;
  }
}

/**
 * Picks which sentence to show, stably.
 *
 * Same item, same sentence, every time it comes round — until the item is
 * genuinely known, in which case a different one is more useful. Rotating by
 * the review count does both: the sentence changes as an item matures, and
 * never changes while you are looking at it.
 */
export function chooseSentence(
  sentences: readonly Sentence[],
  reps: number,
  word?: string,
): Sentence | null {
  if (sentences.length === 0) return null;

  /*
   * Prefer a sentence that uses the word once.
   *
   * A sentence using it twice can still be asked — `blankOut` hides both — but
   * two blanks in one sentence is a worse question than one, and 66 of the 72
   * affected words have a cleaner sentence sitting right beside the one that
   * was being picked. Filtering before the rotation keeps the rotation's whole
   * point: the same item gets the same sentence until it matures.
   */
  const usable = word ? sentences.filter((s) => occurrences(s.text, word) === 1) : [];
  const pool = usable.length > 0 ? usable : sentences;

  return pool[reps % pool.length] ?? null;
}
