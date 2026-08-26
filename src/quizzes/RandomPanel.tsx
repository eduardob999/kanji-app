import { useCallback } from 'react';
import type { User } from 'firebase/auth';
import { buildRandomQueue } from '../domain/randomPractice';
import type { QuizMode } from '../domain/modes';
import { useJapaneseVoice } from '../hooks/useJapaneseVoice';
import { QuizFrame } from './QuizFrame';
import { loadQuizSource } from './source';

/**
 * Anything, asked any way, for as long as you want.
 *
 * The counterpart to Today's Session rather than a replacement for it: the
 * session is what the schedule says is due, and this is what to reach for once
 * that is cleared. "Another round" refills from the whole corpus, which is what
 * makes it endless.
 *
 * Listening is dropped from the mix on a device with no Japanese voice, rather
 * than coming up and failing a question the learner could not have answered.
 */

const WITH_VOICE: readonly QuizMode[] = ['vocab-reading', 'kanji-writing', 'fill-in', 'audio'];
const WITHOUT_VOICE: readonly QuizMode[] = ['vocab-reading', 'kanji-writing', 'fill-in'];

export function RandomPanel({ user }: { user: User }) {
  const { voice, checking } = useJapaneseVoice();

  const loadQuiz = useCallback(
    () => loadQuizSource(voice ? WITH_VOICE : WITHOUT_VOICE, voice),
    [voice],
  );

  if (checking) {
    return (
      <section className="card">
        <p className="card__body">Getting ready…</p>
      </section>
    );
  }

  return (
    <QuizFrame
      user={user}
      loadQuiz={loadQuiz}
      buildQueue={buildRandomQueue}
      emptyTitle="Nothing to ask"
      emptyBody="The decks did not load. Check your connection and try again."
    />
  );
}
