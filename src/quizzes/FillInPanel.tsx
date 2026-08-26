import { useCallback, useRef } from 'react';
import type { User } from 'firebase/auth';
import { isWritingCorrect } from '../domain/answerCheck';
import { loadAllDecks } from '../domain/decks';
import { LEVELS, type StudyItem, type VocabItem } from '../domain/items';
import { blankOut, chooseSentence, loadSentencePack, type Sentence } from '../domain/sentences';
import type { Candidate } from '../domain/sessionPlanner';
import { QuizFrame } from './QuizFrame';

/**
 * A real sentence with the word taken out; you supply the characters.
 *
 * Ported from `filling_quiz.py`, including its fallback: 10% of the corpus has
 * no Tatoeba sentence, and those words are asked from their reading and meaning
 * instead rather than being dropped from the mode. The CLI did the same thing
 * whenever the API came back empty.
 *
 * The reading goes in the gap rather than a bare blank. Without it the question
 * is a comprehension exercise with several defensible answers, only one of
 * which is marked right; with it, the question is "which characters spell
 * this", which is the thing being tested.
 */

function asVocab(item: StudyItem): VocabItem {
  return item as VocabItem;
}

export function FillInPanel({ user }: { user: User }) {
  // Sentences are looked up while rendering a prompt, which is synchronous, so
  // the packs are loaded alongside the decks and held here.
  const sentences = useRef<Map<string, Sentence[]>>(new Map());

  const loadCandidates = useCallback(async (): Promise<Candidate[]> => {
    const [decks, packs] = await Promise.all([
      loadAllDecks<VocabItem>('vocab'),
      Promise.all(LEVELS.map((level) => loadSentencePack(level))),
    ]);

    const index = new Map<string, Sentence[]>();
    for (const pack of packs) {
      for (const [word, entries] of Object.entries(pack.sentences)) {
        index.set(word, entries);
      }
    }
    sentences.current = index;

    return decks.flatMap((deck) =>
      deck.items.map((item) => ({ quiz: 'fill-in' as const, item, level: deck.level })),
    );
  }, []);

  return (
    <QuizFrame
      user={user}
      quiz="fill-in"
      loadCandidates={loadCandidates}
      placeholder="Kanji, with any okurigana"
      check={(input, item) => isWritingCorrect(input, asVocab(item).word)}
      answerOf={(item) => asVocab(item).word}
      renderPrompt={({ item, state }) => {
        const vocab = asVocab(item);
        const available = sentences.current.get(vocab.word) ?? [];
        // Rotates as the item matures, so something well known is not always
        // met in the same frame — and never changes while it is on screen.
        const sentence = chooseSentence(available, state?.totalReps ?? 0);

        if (!sentence) {
          return (
            <>
              <p className="quiz__readings" lang="ja">
                {vocab.reading}
              </p>
              <p className="quiz__gloss">{vocab.meaning || 'no meaning recorded'}</p>
              <p className="quiz__note">No example sentence for this word.</p>
            </>
          );
        }

        return (
          <>
            <p className="quiz__sentence" lang="ja">
              {blankOut(sentence.text, vocab.word, vocab.reading)}
            </p>
            <p className="quiz__gloss">{vocab.meaning || 'no meaning recorded'}</p>
          </>
        );
      }}
      renderReveal={(item) => {
        const vocab = asVocab(item);
        const available = sentences.current.get(vocab.word) ?? [];

        return (
          <>
            <dl className="datalist">
              <div className="datalist__row">
                <dt>Word</dt>
                <dd className="datalist__surface" lang="ja">
                  {vocab.word}
                </dd>
              </div>
              <div className="datalist__row">
                <dt>Reading</dt>
                <dd lang="ja">{vocab.reading}</dd>
              </div>
              <div className="datalist__row">
                <dt>Meaning</dt>
                <dd>{vocab.meaning || '—'}</dd>
              </div>
            </dl>
            {available.length > 0 ? (
              <p className="quiz__note">
                Sentence from{' '}
                <a href={`https://tatoeba.org/en/sentences/show/${available[0]!.id}`}>Tatoeba</a>,
                CC-BY 2.0 FR.
              </p>
            ) : null}
          </>
        );
      }}
    />
  );
}
