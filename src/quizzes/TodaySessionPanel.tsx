import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { QuizMode } from '../domain/modes';
import { countDue } from '../domain/sessionPlanner';
import { useJapaneseVoice } from '../hooks/useJapaneseVoice';
import { useReviewStates } from '../hooks/useReviewStates';
import { QuizFrame } from './QuizFrame';
import { loadQuizSource } from './source';

/**
 * Everything the schedule says is due, across all four question types.
 *
 * The screen the whole scheduler exists to serve. `planSession` already does
 * the work — due first, most overdue first, new material rationed, interleaved
 * so you never get forty N1 kanji in a row — and already dedupes by memory, so
 * a word cannot arrive as both a fill-in and a listening question in one
 * sitting.
 *
 * It opens on a count rather than on a question. Starting a session should be
 * something you decide to do, and "how much is waiting" is the thing you want
 * to know before deciding. It is also the honest answer on a day when nothing
 * is due, which a screen that dropped you straight into a question could not
 * give.
 */

const WITH_VOICE: readonly QuizMode[] = ['vocab-reading', 'kanji-writing', 'fill-in', 'audio'];
const WITHOUT_VOICE: readonly QuizMode[] = ['vocab-reading', 'kanji-writing', 'fill-in'];

export function TodaySessionPanel({ user }: { user: User }) {
  const { voice, checking } = useJapaneseVoice();
  const { lookup, loading: statesLoading } = useReviewStates(user);

  const [started, setStarted] = useState(false);
  const [counts, setCounts] = useState<{ due: number; unseen: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const modes = voice ? WITH_VOICE : WITHOUT_VOICE;

  const loadQuiz = useCallback(() => loadQuizSource(modes, voice), [modes, voice]);

  // The summary. Loads the same source the session will use — everything caches,
  // so starting costs nothing more.
  useEffect(() => {
    if (checking || statesLoading || started) return;

    let live = true;

    loadQuizSource(modes, voice).then(
      ({ candidates }) => {
        if (live) setCounts(countDue(candidates, lookup, new Date()));
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : 'Could not load the decks.');
      },
    );

    return () => {
      live = false;
    };
    // `lookup` changes on every snapshot; the count is a snapshot of when the
    // screen opened and should not flicker as writes land.
  }, [checking, statesLoading, started, modes, voice]);

  if (started) {
    return (
      <QuizFrame
        user={user}
        loadQuiz={loadQuiz}
        emptyTitle="Nothing due"
        emptyBody="Everything is scheduled for later. Random practice is there if you want to keep going."
      />
    );
  }

  return (
    <section className="card">
      <h1 className="card__title">Today’s Session</h1>

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : counts === null ? (
        <p className="card__body">Working out what is due…</p>
      ) : (
        <>
          <div className="tally">
            <div className="tally__figure">
              <span className="tally__number">{counts.due}</span>
              <span className="tally__label">due</span>
            </div>
            <div className="tally__figure tally__figure--muted">
              <span className="tally__number">{counts.unseen.toLocaleString()}</span>
              <span className="tally__label">not yet seen</span>
            </div>
          </div>

          {counts.due === 0 ? (
            <p className="card__body">
              Nothing is due. The session will introduce new material instead — or leave it, and
              come back when something comes round.
            </p>
          ) : (
            <p className="card__body">
              All four question types, interleaved, most overdue first. A few new words are mixed
              in so the pile does not stay still.
            </p>
          )}

          <button
            type="button"
            className="button button--primary button--block"
            onClick={() => setStarted(true)}
          >
            Start
          </button>

          {!voice ? (
            <p className="card__hint">
              Listening questions are left out: this device has no Japanese speech voice.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
