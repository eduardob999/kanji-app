import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [historyStats, setHistoryStats] = useState<
    { throughput: number; measured: boolean; accuracy: number } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const modes = voice ? WITH_VOICE : WITHOUT_VOICE;

  const loadQuiz = useCallback(() => loadQuizSource(modes, voice), [modes, voice]);

  /**
   * Derived rather than stored, so it simply improves when the log arrives.
   *
   * Until then it paces on "no measurable history", which is the same state a
   * new account is in and which `pace` is built to handle — rather than the
   * screen having nothing to say.
   */
  const pacing = useMemo<Pacing | null>(
    () =>
      counts
        ? pace({
            due: counts.due,
            unseen: counts.unseen,
            throughput: historyStats?.throughput ?? 0,
            accuracy: historyStats?.accuracy ?? 1,
            measured: historyStats?.measured ?? false,
          })
        : null,
    [counts, historyStats],
  );

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

    /*
     * Two loads, resolved separately and deliberately.
     *
     * The counts come from the decks alone; only the pacing note needs the
     * review log. Waiting for both before showing anything made the app's home
     * screen sit on "Working out what is due…" for as long as the slowest read
     * took — on a phone that had just been opened, that is a title and one line
     * of text on an otherwise empty screen, which is the first thing you see.
     *
     * So the counts land as soon as they can and the pacing note fills in
     * after. The Start button does not wait for pacing either: `planSession`
     * has sensible defaults, which is exactly what someone with no history gets
     * anyway.
     */
    loadQuizSource(modes, voice).then(
      ({ candidates }) => {
        if (live) setCounts(countDue(candidates, lookup, new Date()));
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : 'Could not load the decks.');
      },
    );

    // Pacing is advisory: a log that cannot be read leaves the session running
    // on defaults rather than not running.
    loadReviewHistory(user.uid).then(
      (history) => {
        if (!live) return;
        const now = new Date();
        const { throughput, measured } = throughputFrom(history.map((r) => r.at), now);
        setHistoryStats({ throughput, measured, accuracy: accuracyFrom(history, now) });
      },
      (caught: unknown) => {
        console.warn('[pacing] Could not read the review log; using default pacing.', caught);
        if (live) setHistoryStats({ throughput: 0, measured: false, accuracy: 1 });
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
