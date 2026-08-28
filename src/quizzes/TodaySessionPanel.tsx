import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import type { QuizMode } from '../domain/modes';
import { countDue, planSession, type Candidate } from '../domain/sessionPlanner';
import {
  BASE_NEW,
  MAX_APPETITE,
  accuracyFrom,
  nextAppetite,
  pace,
  throughputFrom,
  type Pacing,
} from '../domain/pacing';
import { hashFor } from '../domain/navigation';
import { loadReviewHistory } from '../storage/reviewLog';
import { finishSession, settleAbandonedSession, startSession } from '../storage/userState';
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
  const [counts, setCounts] = useState<ReturnType<typeof countDue> | null>(null);
  const [historyStats, setHistoryStats] = useState<
    { throughput: number; measured: boolean; accuracy: number } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const modes = voice ? WITH_VOICE : WITHOUT_VOICE;

  const appetite = profile?.kanjiba.appetite;

  /*
   * A session record still marked unfinished belongs to a sitting that was
   * walked away from — there is no other way for one to survive.
   *
   * Settled here, on the next visit, rather than when it happened: nothing
   * fires reliably when a tab closes, and this needs no hook at all. Clearing
   * the record is what stops the same abandonment being charged twice.
   */
  const abandoned = profile?.kanjiba.session;
  useEffect(() => {
    // Not while one is running: starting a session writes exactly this record,
    // and this panel stays mounted behind the quiz. Without the guard the app
    // would settle the session the learner is in the middle of.
    if (started) return;
    if (!abandoned || abandoned.finished || abandoned.offered <= 0) return;

    void settleAbandonedSession(user.uid, nextAppetite(appetite, abandoned)).catch(
      (caught: unknown) => {
        console.error('[firestore] Could not settle the abandoned session.', caught);
      },
    );
    // `appetite` is deliberately absent: this must run once for a given record,
    // and the write it makes changes the appetite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abandoned, started, user.uid]);

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
            arrivals: counts.arrivals,
            throughput: historyStats?.throughput ?? 0,
            accuracy: historyStats?.accuracy ?? 1,
            measured: historyStats?.measured ?? false,
            ...(appetite === undefined ? {} : { appetite }),
          })
        : null,
    [appetite, counts, historyStats],
  );

  const onPlanned = useCallback(
    (offered: number) => {
      void startSession(user.uid, offered).catch((caught: unknown) => {
        console.error('[firestore] Could not record the start of the session.', caught);
      });
    },
    [user.uid],
  );

  const onFinished = useCallback(
    (outcome: { offered: number; answered: number; right: number }) => {
      void finishSession(
        user.uid,
        { ...outcome, finished: true },
        nextAppetite(appetite, { ...outcome, finished: true }),
      ).catch((caught: unknown) => {
        console.error('[firestore] Could not record the end of the session.', caught);
      });
    },
    [appetite, user.uid],
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

  const renderFinished = ({
    offered,
    right,
    wrong,
    again,
  }: {
    offered: number;
    right: number;
    wrong: number;
    again: () => void;
  }) => (
    <SessionSummary
      offered={offered}
      right={right}
      wrong={wrong}
      {...(appetite === undefined ? {} : { appetite })}
      onAgain={again}
    />
  );

  if (started) {
    return (
      <QuizFrame
        user={user}
        loadQuiz={loadQuiz}
        buildQueue={buildQueue}
        onPlanned={onPlanned}
        onFinished={onFinished}
        renderFinished={renderFinished}
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
              <span className="tally__number">{counts.due.toLocaleString()}</span>
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
                  ? ` About ${pacing.sustainableRate.toLocaleString()} a day keeps pace with what falls due; the backlog on top of that comes down slower.`
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


/**
 * The schedule reporting back at the end of a session.
 *
 * Its own component, and exported, for two reasons: the ration moved — or held,
 * or eased — as a direct result of how this session went, and an adaptive
 * number nobody is told about is indistinguishable from a fixed one; and
 * reaching this screen through the quiz means answering every question in the
 * session, which is not something the preview harness can do. Rendering it
 * directly is the only way it gets looked at.
 */
export function SessionSummary({
  offered,
  right,
  wrong,
  appetite,
  onAgain,
}: {
  offered: number;
  right: number;
  wrong: number;
  appetite?: number;
  onAgain: () => void;
}) {
  const answered = right + wrong;
  const was = appetite ?? BASE_NEW;
  const now = nextAppetite(appetite, { finished: true, offered, answered, right });

  return (
    <section className="card">
      <h1 className="card__title">Session done</h1>

      <div className="tally">
        <div className="tally__figure">
          <span className="tally__number">{right}</span>
          <span className="tally__label">right</span>
        </div>
        <div className="tally__figure tally__figure--muted">
          <span className="tally__number">{wrong}</span>
          <span className="tally__label">missed</span>
        </div>
        <div className="tally__figure tally__figure--muted">
          <span className="tally__number">{offered}</span>
          <span className="tally__label">asked</span>
        </div>
      </div>

      <p className="card__body">
        {now > was
          ? `That went well, so the next session introduces ${now} new items instead of ${was}.`
          : now < was
            ? `The next session eases back to ${now} new items, to let what you have settle.`
            : now >= MAX_APPETITE
              ? `Holding at ${now} new items a session, which is as much as this will offer.`
              : `Holding at ${now} new items a session.`}
      </p>

      <button type="button" className="button button--primary button--block" onClick={onAgain}>
        Another round
      </button>

      <div className="quiz__afterthoughts">
        <a className="button button--ghost button--small" href={hashFor('study.random')}>
          Random practice
        </a>
      </div>

      <p className="card__hint">
        Anything still due comes back in another round. Random ignores due dates entirely, for when
        the queue is clear and you want to keep going.
      </p>
    </section>
  );
}
