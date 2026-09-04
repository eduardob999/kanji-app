import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { QuizMode } from '../domain/modes';
import { buildPracticeQueue } from '../domain/practiceQueue';
import { ROUND_SIZE } from '../domain/randomPractice';
import { countDue, type Candidate, type ReviewLookup } from '../domain/sessionPlanner';
import {
  BASE_NEW,
  MAX_APPETITE,
  accuracyFrom,
  nextAppetite,
  pace,
  throughputFrom,
  type Pacing,
} from '../domain/pacing';
import { loadReviewHistory } from '../storage/reviewLog';
import { finishSession, settleAbandonedSession, startSession } from '../storage/userState';
import { useJapaneseVoice } from '../hooks/useJapaneseVoice';
import { useReviewStates } from '../hooks/useReviewStates';
import { useUserProfile } from '../hooks/useUserProfile';
import { LegacyImport } from '../components/LegacyImport';
import { QuizFrame } from './QuizFrame';
import { loadQuizSource } from './source';

/**
 * The one place studying happens.
 *
 * It is the old Today's Session and the old Random, which turned out to be one
 * screen described from two sides. The session was the schedule and stopped
 * dead when the schedule was clear, which on a real backlog meant it offered
 * eight items and called it a day. Random kept going but ignored the schedule,
 * so the material it chose was never the material that was actually owed.
 *
 * Here the question types alternate the way Random's did, and each question
 * arrives exactly as it would have in the mode it belongs to, with the same
 * scheduling behind it and the same interval after it. What is due comes first,
 * new material stays rationed by the pacer, and once both run out the round
 * carries on with words already met rather than announcing there is nothing to
 * do. `domain/practiceQueue.ts` holds that logic and the reason unseen words
 * cannot enter through the tail.
 *
 * It still opens on a count rather than on a question, because "how much is
 * waiting" is the thing worth knowing before deciding to start. The change is
 * that Start now always works.
 *
 * `silent` is the same screen with listening dropped: a bus, a library, a
 * shared room. A separate nav leaf rather than a toggle, because changing which
 * question types are in play mid-round is a different sitting and would have to
 * reset the tally.
 */

const WITH_VOICE: readonly QuizMode[] = ['vocab-reading', 'kanji-writing', 'fill-in', 'audio'];
const WITHOUT_VOICE: readonly QuizMode[] = ['vocab-reading', 'kanji-writing', 'fill-in'];

export function PracticePanel({ user, silent = false }: { user: User; silent?: boolean }) {
  const { voice, checking } = useJapaneseVoice();
  const { lookup, loading: statesLoading } = useReviewStates(user);
  const { profile } = useUserProfile(user);

  // Silence is a choice about the room, no voice is a fact about the device,
  // and both drop listening from the mix.
  const speaking = silent ? null : voice;

  const [started, setStarted] = useState(false);
  const [counts, setCounts] = useState<ReturnType<typeof countDue> | null>(null);
  const [historyStats, setHistoryStats] = useState<
    { throughput: number; measured: boolean; accuracy: number } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by "Try again", which is the only thing that re-runs the load. */
  const [attempt, setAttempt] = useState(0);

  const modes = speaking ? WITH_VOICE : WITHOUT_VOICE;

  const appetite = profile?.kanjiba.appetite;

  /*
   * A session record still marked unfinished belongs to a sitting that was
   * walked away from: there is no other way for one to survive.
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

  const loadQuiz = useCallback(() => loadQuizSource(modes, speaking), [modes, speaking]);

  /**
   * Derived rather than stored, so it simply improves when the log arrives.
   *
   * Until then it paces on "no measurable history", which is the same state a
   * new account is in and which `pace` is built to handle, rather than the
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

  /** What the schedule itself will hold, as opposed to what it may. */
  const scheduled = counts && pacing ? Math.min(pacing.maxItems, counts.due + pacing.maxNew) : 0;
  /*
   * And what fills the rest of the round.
   *
   * Bounded by what has actually been met, because that is the only pool the
   * queue may draw a filler from. On a brand-new account it is zero, and the
   * screen has to say so rather than promise fifteen questions it cannot ask.
   */
  const practice = counts
    ? Math.max(0, Math.min(ROUND_SIZE - scheduled, counts.seen - scheduled))
    : 0;
  const round = scheduled + practice;

  /*
   * How much of the round the schedule asked for, kept from the build.
   *
   * The appetite loop is fed with this rather than with the length of the
   * round, and the difference is not cosmetic. Padding the round with practice
   * and then judging completion against the padded number would read "did more
   * than the schedule asked and stopped early" as an abandoned session, and
   * cut the ration for it. A round that is all practice reports zero, which
   * `nextAppetite` correctly treats as no evidence either way.
   */
  const askedFor = useRef(0);

  const onPlanned = useCallback(() => {
    if (askedFor.current <= 0) return;
    void startSession(user.uid, askedFor.current).catch((caught: unknown) => {
      console.error('[firestore] Could not record the start of the session.', caught);
    });
  }, [user.uid]);

  const onFinished = useCallback(
    (outcome: { offered: number; answered: number; right: number }) => {
      const scored = { ...outcome, offered: askedFor.current, finished: true };
      void finishSession(user.uid, scored, nextAppetite(appetite, scored)).catch(
        (caught: unknown) => {
          console.error('[firestore] Could not record the end of the session.', caught);
        },
      );
    },
    [appetite, user.uid],
  );

  /*
   * Sized from the backlog and from what this learner actually gets through,
   * rather than a flat fifteen.
   *
   * The pacing is read through a ref, and that is load-bearing rather than
   * tidiness. The frame rebuilds its queue whenever this callback's identity
   * changes, and finishing a round writes a new ration, which changes the
   * pacing, which would change the callback: the summary would be replaced by
   * a fresh round before it could be read. A ref keeps the identity fixed and
   * still gives the next round the newest ration, which is the same reason the
   * frame holds its review lookup in one.
   */
  const pacingRef = useRef(pacing);
  pacingRef.current = pacing;

  const buildQueue = useCallback(
    (candidates: readonly Candidate[], states: ReviewLookup, now: Date) => {
      const current = pacingRef.current;
      const queue = buildPracticeQueue(candidates, states, now, {
        ...(current ? { maxItems: current.maxItems, maxNew: current.maxNew } : {}),
      });
      askedFor.current = queue.filter((question) => !question.unscheduled).length;
      return queue;
    },
    [],
  );

  // The summary. Loads the same source the session will use: everything caches,
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
     * took: on a phone that had just been opened, that is a title and one line
     * of text on an otherwise empty screen, which is the first thing you see.
     *
     * So the counts land as soon as they can and the pacing note fills in
     * after. The Start button does not wait for pacing either, because
     * `buildPracticeQueue` has sensible defaults, which is exactly what someone
     * with no history gets anyway.
     */
    loadQuizSource(modes, speaking).then(
      ({ candidates }) => {
        if (live) setCounts(countDue(candidates, lookup, new Date()));
      },
      (caught: unknown) => {
        console.error('[decks] Could not load the word lists.', caught);
        if (live) setError('unreachable');
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
  }, [attempt, checking, statesLoading, started, modes, speaking, user.uid]);

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
      askedFor={askedFor.current}
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
        emptyTitle="Nothing to ask"
        emptyBody="The word lists arrived with no questions in them, which should not happen. Try again once you are back online."
      />
    );
  }

  return (
    <section className="card">
      <h1 className="card__title">{silent ? 'Practice (silent)' : 'Practice'}</h1>

      {error ? (
        <>
          <p className="notice notice--error" role="alert">
            The word lists could not be fetched. They are stored on your device after the first
            visit, so this usually means a first launch without a connection.
          </p>
          <p className="card__hint">Nothing you have answered is affected.</p>
          <button
            type="button"
            className="button button--primary button--block"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </>
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

          {pacing ? (
            <>
              <p className={`notice notice--${pacing.state === 'behind' || pacing.state === 'struggling' ? 'warn' : 'muted'}`}>
                {pacing.note}
              </p>
              <p className="card__body">
                {/*
                  What the round will be, not what it is allowed to be.
                  `maxItems` is a ceiling: with nothing due and a ration of
                  eight, it reads fifteen while the schedule is eight, and the
                  line above has just said eight, so the screen contradicted
                  itself on the first launch of a new account.
                */}
                {round} question{round === 1 ? '' : 's'} this time, all four types interleaved
                {counts.due > 0 ? ', most overdue first' : ''}.
                {practice === 0
                  ? ''
                  : scheduled > 0
                    ? ' Once what is due and today’s new words run out it keeps going, with words you have already met.'
                    : ' Nothing is waiting, so this round is practice on words you have already met.'}
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

          {/*
            The one-time import, below Start rather than above it.

            Offered here rather than only on the Account screen, because it is a
            thing you do once on the first day and burying it two taps into
            Tools means starting from zero without ever knowing there was an
            alternative. But it is two paragraphs and a button, and above Start
            it pushed the screen's whole purpose below the fold on a phone,
            which is what a new account sees and nobody else ever would. An
            offer goes under the action it is an alternative to.
          */}
          {profile ? <LegacyImport user={user} /> : null}

          {!silent && !voice ? (
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
 * The schedule reporting back at the end of a round.
 *
 * Its own component, and exported, for two reasons: the ration moved, or held,
 * or eased, as a direct result of how this round went, and an adaptive number
 * nobody is told about is indistinguishable from a fixed one; and reaching this
 * screen through the quiz means answering every question in the round, which is
 * not something the preview harness can do. Rendering it directly is the only
 * way it gets looked at.
 */
export function SessionSummary({
  offered,
  askedFor,
  right,
  wrong,
  appetite,
  onAgain,
}: {
  /** Questions in the round, practice included. The number shown. */
  offered: number;
  /**
   * How many of them the schedule asked for. The number the ration is judged
   * against, and never the one on screen: doing extra practice must not be
   * able to look like an abandoned session. Defaults to the whole round for a
   * caller that has no separate figure.
   */
  askedFor?: number;
  right: number;
  wrong: number;
  appetite?: number;
  onAgain: () => void;
}) {
  const answered = right + wrong;
  const was = appetite ?? BASE_NEW;
  const now = nextAppetite(appetite, {
    finished: true,
    offered: askedFor ?? offered,
    answered,
    right,
  });

  return (
    <section className="card">
      <h1 className="card__title">Round done</h1>

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
          ? `That went well, so the next round introduces ${now} new items instead of ${was}.`
          : now < was
            ? `The next round eases back to ${now} new items, to let what you have settle.`
            : now >= MAX_APPETITE
              ? `Holding at ${now} new items a round, which is as much as this will offer.`
              : `Holding at ${now} new items a round.`}
      </p>

      <button type="button" className="button button--primary button--block" onClick={onAgain}>
        Another round
      </button>

      <p className="card__hint">
        Anything still due comes back in the next one. When there is nothing left that is due, a
        round is practice on words you have already met, and those answers count too.
      </p>
    </section>
  );
}
