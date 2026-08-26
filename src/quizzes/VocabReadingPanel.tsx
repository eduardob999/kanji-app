import { useCallback } from 'react';
import type { User } from 'firebase/auth';
import { isReadingCorrect } from '../domain/answerCheck';
import { loadAllDecks } from '../domain/decks';
import type { StudyItem, VocabItem } from '../domain/items';
import type { Candidate } from '../domain/sessionPlanner';
import { QuizFrame } from './QuizFrame';

/**
 * The word and its meaning; you supply the reading.
 *
 * Ported from `vocab_quiz.py`. The CLI showed the kanji and the meaning and
 * asked for the reading, and there is nothing to improve about that — the
 * change is what happens afterwards, which is now a schedule rather than an
 * incremented counter.
 */

function asVocab(item: StudyItem): VocabItem {
  return item as VocabItem;
}

export function VocabReadingPanel({ user }: { user: User }) {
  /**
   * All eight vocabulary decks, about 770 kB of JSON.
   *
   * Loaded whole rather than level by level because the planner has to see
   * everything to know what is due: due material is scattered across levels by
   * definition, and guessing which levels to load would mean guessing the
   * answer to the question being asked. `decks.ts` caches, and the service
   * worker has them locally either way.
   *
   * `useCallback` with no dependencies is doing real work: QuizFrame replans
   * whenever this identity changes, so an inline function would restart the
   * session on every render.
   */
  const loadCandidates = useCallback(async (): Promise<Candidate[]> => {
    const decks = await loadAllDecks<VocabItem>('vocab');

    return decks.flatMap((deck) =>
      deck.items.map((item) => ({ quiz: 'vocab-reading' as const, item, level: deck.level })),
    );
  }, []);

  return (
    <QuizFrame
      user={user}
      quiz="vocab-reading"
      loadCandidates={loadCandidates}
      placeholder="Reading in kana"
      check={(input, item) => isReadingCorrect(input, asVocab(item).reading)}
      answerOf={(item) => asVocab(item).reading}
      renderPrompt={(item) => (
        <>
          <p className="quiz__surface" lang="ja">
            {asVocab(item).word}
          </p>
          <p className="quiz__gloss">{asVocab(item).meaning || 'no meaning recorded'}</p>
        </>
      )}
      renderReveal={(item) => (
        <dl className="datalist">
          <div className="datalist__row">
            <dt>Reading</dt>
            <dd lang="ja">{asVocab(item).reading}</dd>
          </div>
          <div className="datalist__row">
            <dt>Meaning</dt>
            <dd>{asVocab(item).meaning || '—'}</dd>
          </div>
        </dl>
      )}
    />
  );
}
