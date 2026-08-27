import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { QuizMode } from '../domain/modes';
import { countDue, planSession, type Candidate } from '../domain/sessionPlanner';
import { accuracyFrom, pace, throughputFrom, type Pacing } from '../domain/pacing';
import { loadReviewHistory } from '../storage/reviewLog';
import { useJapaneseVoice } from '../hooks/useJapaneseVoice';
import { useReviewStates } from '../hooks/useReviewStates';
import { useUserProfile } from '../hooks/useUserProfile';
import { LegacyImport } from '../components/LegacyImport';
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
  const { profile } = useUserProfile(user);

  const [started, setStarted] = useState(false);
  const [counts, setCounts] = useState<{ due: number; unseen: number } | null>(null);
  const [pacing, setPacing] = useState<Pacing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const modes = voice ? WITH_VOICE : WITHOUT_VOICE;

  const loadQuiz = useCallback(() => loadQuizSource(modes, voice), [modes, voice]);

  // Sized from the backlog and from what this learner actually gets through,
  // rather than a flat fifteen. Held in a ref so the session it starts with does
  // not change underneath it.
  const buildQueue = useCallback(
    (candidates: readonly Candidate[], lookup: Parameters<typeof planSession>[1], now: Date) =>
      planSession(candidates, lookup, now, {
        ...(pacing ? { maxItems: pacing.maxItems, maxNew: pacing.maxNew } : {}),
      }),
    [pacing],
  );

  // The summary. Loads the same source the session will use — everything caches,
  // so starting costs nothing more.
  useEffect(() => {
    if (checking || statesLoading || started) return;

    let live = true;

    // The history is for pacing only, so a failure to read it must not stop the
    // session. It used to be inside the same Promise.all as the decks, which
    // meant an unreadable review log — offline on a device whose log cache is
    // cold — killed the whole screen, and reported "could not load the decks"
    // about decks that had loaded perfectly. Pacing without history is a state
    // `pace` already handles: it is what a new account gets.
    const history = loadReviewHistory(user.uid).catch((caught: unknown) => {
      console.warn('[pacing] Could not read the review log; using default pacing.', caught);
      return [] as Awaited<ReturnType<typeof loadReviewHistory>>;
    });

    Promise.all([loadQuizSource(modes, voice), history]).then(
      ([{ candidates }, history]) => {
        if (!live) return;

        const now = new Date();
        const totals = countDue(candidates, lookup, now);
        const { throughput, measured } = throughputFrom(history.map((r) => r.at), now);

        setCounts(totals);
        setPacing(
          pace({
            due: totals.due,
            unseen: totals.unseen,
            throughput,
            accuracy: accuracyFrom(history, now),
            measured,
          }),
        );
      },
      (caught: unknown) => {
        // Only the decks can land here now, so the message is accurate again.
        if (live) setError(caught instanceof Error ? caught.message : 'Could not load the decks.');
      },
    );

    return () => {
      live = false;
    };
    // `lookup` changes on every snapshot; the count is a snapshot of when the
    // screen opened and should not flicker as writes land.
  }, [checking, statesLoading, started, modes, voice, user.uid]);

  if (started) {
    return (
      <QuizFrame
        user={user}
        loadQuiz={loadQuiz}
        buildQueue={buildQueue}
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

          {/*
            The one-time import, offered here rather than only on the Account
            screen. It is a thing you do once, on the first day, and burying it
            two taps into Tools means starting from zero without ever knowing
            there was an alternative. It disappears for good once run.
          */}
          {profile ? (
            <LegacyImport user={user} />
          ) : null}

          {pacing ? (
            <>
              <p className={`notice notice--${pacing.state === 'behind' || pacing.state === 'struggling' ? 'warn' : 'muted'}`}>
                {pacing.note}
              </p>
              <p className="card__body">
                {pacing.maxItems} question{pacing.maxItems === 1 ? '' : 's'} this time, all four
                types interleaved, most overdue first.
                {pacing.state === 'behind'
                  ? ` About ${pacing.sustainableRate} a day would stop the backlog growing.`
                  : ''}
              </p>
            </>
          ) : null}

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
