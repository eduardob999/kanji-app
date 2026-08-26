import { useCallback } from 'react';
import type { User } from 'firebase/auth';
import { isWritingCorrect } from '../domain/answerCheck';
import { loadAllDecks } from '../domain/decks';
import type { KanjiItem, StudyItem } from '../domain/items';
import type { Candidate } from '../domain/sessionPlanner';
import { QuizFrame } from './QuizFrame';

/**
 * Readings and meaning; you supply the character.
 *
 * Ported from `kanji_quiz.py`. This is the mode the whole handwriting question
 * hangs off: with the keyboard, typing the reading hands you the character in
 * the IME's candidate list before you have recalled anything, so what gets
 * tested is whether you can read your own answer back. That is worth knowing
 * about rather than pretending otherwise — see `src/input/`.
 */

function asKanji(item: StudyItem): KanjiItem {
  return item as KanjiItem;
}

export function KanjiWritingPanel({ user }: { user: User }) {
  const loadCandidates = useCallback(async (): Promise<Candidate[]> => {
    const decks = await loadAllDecks<KanjiItem>('kanji');

    return decks.flatMap((deck) =>
      deck.items.map((item) => ({ quiz: 'kanji-writing' as const, item, level: deck.level })),
    );
  }, []);

  return (
    <QuizFrame
      user={user}
      quiz="kanji-writing"
      loadCandidates={loadCandidates}
      placeholder="The character"
      check={(input, item) => isWritingCorrect(input, asKanji(item).kanji)}
      answerOf={(item) => asKanji(item).kanji}
      renderPrompt={({ item }) => (
        <>
          <p className="quiz__readings" lang="ja">
            {asKanji(item).readings.join('・')}
          </p>
          <p className="quiz__gloss">{asKanji(item).meaning || 'no meaning recorded'}</p>
        </>
      )}
      renderReveal={(item) => (
        <dl className="datalist">
          <div className="datalist__row">
            <dt>Character</dt>
            <dd className="datalist__surface" lang="ja">
              {asKanji(item).kanji}
            </dd>
          </div>
          <div className="datalist__row">
            <dt>Readings</dt>
            <dd lang="ja">{asKanji(item).readings.join('・')}</dd>
          </div>
          <div className="datalist__row">
            <dt>Meaning</dt>
            <dd>{asKanji(item).meaning || '—'}</dd>
          </div>
        </dl>
      )}
    />
  );
}
