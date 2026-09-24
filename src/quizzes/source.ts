import { loadAllDecks } from '../domain/decks';
import { buildExampleIndex, type ExampleIndex } from '../domain/examples';
import type { KanjiItem, Level, VocabItem } from '../domain/items';
import { deckTypeFor, type QuizMode } from '../domain/modes';
import { loadSentencePack, type Sentence } from '../domain/sentences';
import type { Candidate } from '../domain/sessionPlanner';
import { quizDefinitions, type QuizDefinition } from './definitions';

/**
 * Everything a sitting needs, loaded once.
 *
 * A screen names the question types it wants and gets back the candidate pool
 * plus the definitions to render them with. Both come from one call because the
 * definitions *close over* what was loaded — the fill-in prompt needs the
 * sentence index, the listening prompt needs the voice — and handing those to
 * the frame separately would mean a window where the queue exists and the
 * sentences do not.
 *
 * **The decks are loaded here; the sentences are not.** The planner has to see
 * every deck to know what is due, since due material is scattered across levels
 * by definition — that is 832 kB and unavoidable. The sentence packs are 1.3 MB
 * more, and a round needs the examples for the fifteen questions it actually
 * chose, which come from two or three levels. Loading all eight up front put a
 * megabyte of Japanese nobody was going to read in front of the first question.
 *
 * `decks.ts` and `sentences.ts` both cache, so a second round in the same
 * session pays for nothing it already has.
 */

export interface QuizSource {
  candidates: Candidate[];
  definitions: Record<QuizMode, QuizDefinition>;
  /**
   * Loads the example sentences for these levels, if this quiz uses sentences
   * at all. Awaited by the frame once the queue is known and before the first
   * question renders.
   */
  ensureSentences: (levels: readonly Level[]) => Promise<void>;
}

/** Which modes draw on the Tatoeba packs. */
export const NEEDS_SENTENCES: readonly QuizMode[] = ['fill-in', 'audio'];

/** Which modes list other words using the same kanji after a miss. */
const SHOWS_EXAMPLES: readonly QuizMode[] = ['kanji-writing', 'vocab-reading'];

/** Whether a question will read an example sentence. */
export function usesSentences(quiz: QuizMode): boolean {
  return NEEDS_SENTENCES.includes(quiz);
}

export async function loadQuizSource(
  modes: readonly QuizMode[],
  voice: SpeechSynthesisVoice | null,
): Promise<QuizSource> {
  const wantsVocab = modes.some((mode) => deckTypeFor(mode) === 'vocab');
  const wantsKanji = modes.some((mode) => deckTypeFor(mode) === 'kanji');
  const wantsSentences = modes.some((mode) => NEEDS_SENTENCES.includes(mode));

  const [vocabDecks, kanjiDecks] = await Promise.all([
    wantsVocab ? loadAllDecks<VocabItem>('vocab') : Promise.resolve([]),
    wantsKanji ? loadAllDecks<KanjiItem>('kanji') : Promise.resolve([]),
  ]);

  /*
   * Keyed by item id, which is how the packs are built: a sentence is verified
   * against one reading of one word, and 弾く(はじく) must not be handed the
   * sentences of 弾く(ひく). See `domain/sentences.ts`.
   *
   * Empty here, and filled by `ensureSentences` once the round is planned. The
   * definitions hold this exact object, so what they read is whatever has been
   * loaded by the time a question renders.
   */
  const sentences = new Map<string, Sentence[]>();
  const loaded = new Set<Level>();

  const ensureSentences = async (levels: readonly Level[]): Promise<void> => {
    if (!wantsSentences) return;

    const wanted = [...new Set(levels)].filter((level) => !loaded.has(level));
    if (wanted.length === 0) return;

    const packs = await Promise.all(wanted.map((level) => loadSentencePack(level)));

    for (const pack of packs) {
      for (const [itemId, entries] of Object.entries(pack.sentences)) {
        sentences.set(itemId, entries);
      }
    }
    for (const level of wanted) loaded.add(level);
  };

  /*
   * Filled in place, like the sentences, and not awaited: the examples are
   * wanted only after a miss, and a kanji-only sitting would otherwise wait on
   * the vocabulary decks before its first question. When the vocab decks are
   * already loaded for the quiz itself this resolves at once. A failure leaves
   * the index empty and the reveal without examples, which is all it costs.
   */
  const examples: ExampleIndex = new Map();
  if (modes.some((mode) => SHOWS_EXAMPLES.includes(mode))) {
    const decks = wantsVocab ? Promise.resolve(vocabDecks) : loadAllDecks<VocabItem>('vocab');
    decks
      .then((loaded) => {
        for (const [kanji, words] of buildExampleIndex(loaded)) examples.set(kanji, words);
      })
      .catch((error: unknown) => console.warn('Example words unavailable:', error));
  }

  const candidates: Candidate[] = [];
  for (const mode of modes) {
    const decks = deckTypeFor(mode) === 'kanji' ? kanjiDecks : vocabDecks;
    for (const deck of decks) {
      for (const item of deck.items) {
        candidates.push({ quiz: mode, item, level: deck.level });
      }
    }
  }

  return { candidates, definitions: quizDefinitions({ sentences, voice, examples }), ensureSentences };
}
