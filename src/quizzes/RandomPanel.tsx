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
 *
 * `silent` is the other reason to drop it: not that the device cannot speak,
 * but that this is a bus, a library or a shared room. It is a separate leaf in
 * the nav rather than a toggle on this screen, because a toggle is state that
 * would have to be stored, restored, and reasoned about when it changes
 * mid-round — and changing which question types are in play mid-round is a
 * different sitting, so it would have to reset the tally. Two menu entries are
 * cheaper and are decided before anything starts.
 *
 * It doubles as the fallback for a device whose speech synthesis is present but
 * broken, which the voice check cannot detect.
 */

const WITH_VOICE: readonly QuizMode[] = ['vocab-reading', 'kanji-writing', 'fill-in', 'audio'];
const WITHOUT_VOICE: readonly QuizMode[] = ['vocab-reading', 'kanji-writing', 'fill-in'];

export function RandomPanel({ user, silent = false }: { user: User; silent?: boolean }) {
  const { voice, checking } = useJapaneseVoice();
  const speaking = silent ? null : voice;

  const loadQuiz = useCallback(
    () => loadQuizSource(speaking ? WITH_VOICE : WITHOUT_VOICE, speaking),
    [speaking],
  );

  // Nothing to wait for when the answer will not be used either way.
  if (checking && !silent) {
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
