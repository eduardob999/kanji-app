import { loadAllDecks } from '../domain/decks';
import { LEVELS, type KanjiItem, type VocabItem } from '../domain/items';
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
 * Loading is deliberately coarse: all eight decks of a type, and all eight
 * sentence packs when any mode needs them. The planner has to see everything to
 * know what is due, since due material is scattered across levels by
 * definition. `decks.ts` and `sentences.ts` both cache, so a second screen in
 * the same session pays nothing.
 */

export interface QuizSource {
  candidates: Candidate[];
  definitions: Record<QuizMode, QuizDefinition>;
}

/** Which modes draw on the Tatoeba packs. */
const NEEDS_SENTENCES: readonly QuizMode[] = ['fill-in', 'audio'];

export async function loadQuizSource(
  modes: readonly QuizMode[],
  voice: SpeechSynthesisVoice | null,
): Promise<QuizSource> {
  const wantsVocab = modes.some((mode) => deckTypeFor(mode) === 'vocab');
  const wantsKanji = modes.some((mode) => deckTypeFor(mode) === 'kanji');
  const wantsSentences = modes.some((mode) => NEEDS_SENTENCES.includes(mode));

  const [vocabDecks, kanjiDecks, packs] = await Promise.all([
    wantsVocab ? loadAllDecks<VocabItem>('vocab') : Promise.resolve([]),
    wantsKanji ? loadAllDecks<KanjiItem>('kanji') : Promise.resolve([]),
    wantsSentences
      ? Promise.all(LEVELS.map((level) => loadSentencePack(level)))
      : Promise.resolve([]),
  ]);

  const sentences = new Map<string, Sentence[]>();
  for (const pack of packs) {
    for (const [word, entries] of Object.entries(pack.sentences)) {
      sentences.set(word, entries);
    }
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

  return { candidates, definitions: quizDefinitions({ sentences, voice }) };
}
