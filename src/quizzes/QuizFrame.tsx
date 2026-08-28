import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { DEFAULT_INPUT_METHOD } from '../domain/inputMethod';
import { gradeAnswer, gradeLabel, downgrade } from '../domain/grading';
import { observeResponse, profileFor } from '../domain/fluency';
import { retrievability } from '../domain/fsrs';
import { isSlipping } from '../domain/leech';
import type { ItemReviewState, PracticeResult } from '../domain/review';
import { describeInterval } from '../domain/scheduler';
import { planSession, type Candidate, type PlannedQuestion, type ReviewLookup } from '../domain/sessionPlanner';
import type { StudyItem } from '../domain/items';
import type { QuizSource } from './source';
import { buildChoices } from '../domain/distractors';
import { useReviewStates } from '../hooks/useReviewStates';
import { useUserProfile } from '../hooks/useUserProfile';
import { AnswerInput } from '../input/AnswerInput';
import { recordReview, undoReview } from '../storage/reviewState';
import { appendReview } from '../storage/reviewLog';
import { EMPTY_MODEL, saveFluency, weightsFor } from '../storage/modelState';

/**
 * The shape every quiz has: prompt, answer, verdict, on to the next.
 *
 * All four question types differ only in what they show and how the answer is
 * marked, so those are the props and everything else — the session queue, the
 * clock, the grading, the write, the undo — lives here once.
 *
 * Two things are load-bearing and easy to get wrong:
 *
 * - **The session is planned once.** Review state is live, and replanning when
 *   it changes would reshuffle the queue underneath someone every time their
 *   own answer landed. The plan is taken at the moment the deck arrives and
 *   held until the round ends.
 * - **Writes are not awaited.** Offline, Firestore applies a write to the local
 *   cache immediately but leaves the promise pending until the server
 *   acknowledges — possibly for hours. Awaiting it would freeze the quiz on the
 *   first question of a train journey.
 *
 * Every answer produces three writes, and they are not redundant. The *state*
 * write is what the scheduler reads back. The *log* append is the history the
 * model is later fitted to, which current state has thrown away by design. The
 * *fluency* write is what makes "fast" mean fast for this person rather than
 * fast by my guess.
 */

export interface QuizFrameProps {
  user: User;
  /**
   * The candidate pool and the definitions to render it with, loaded together.
   *
   * One call rather than two props because the definitions close over what was
   * loaded — the fill-in prompt needs the sentence index — so separating them
   * would leave a window where the queue exists and its sentences do not.
   *
   * Must be stable: the frame replans whenever this identity changes, so an
   * inline arrow would restart the session on every render.
   */
  loadQuiz: () => Promise<QuizSource>;
  /**
   * Turns the candidate pool into a queue.
   *
   * Defaults to `planSession` — due first, new material rationed, interleaved.
   * Random supplies its own, which ignores due dates entirely and refills from
   * the whole corpus on every round, which is what makes it endless.
   */
  buildQueue?: (candidates: readonly Candidate[], lookup: ReviewLookup, now: Date) => PlannedQuestion[];
  /** Shown when the queue comes back empty. */
  emptyTitle?: string;
  emptyBody?: string;
  /**
   * How many questions the planner produced, once it has.
   *
   * Only Today's Session cares: it is the denominator that makes "finished" and
   * "walked away from" different things. Random has no such notion — it refills
   * for ever — and passes neither of these.
   */
  onPlanned?: (offered: number) => void;
  /** The queue ran out. Fires once per round. */
  onFinished?: (outcome: { offered: number; answered: number; right: number }) => void;
  /**
   * What to show when the queue runs out, if the default is not enough.
   *
   * Today's Session has more to say than a tally: it is the screen where the
   * schedule reports back, and the size of the next session was just decided by
   * how this one went. Random has nothing to add — it never ends, it only
   * refills — and passes nothing.
   */
  renderFinished?: (outcome: {
    offered: number;
    right: number;
    wrong: number;
    again: () => void;
  }) => ReactNode;
}

interface Verdict {
  question: PlannedQuestion;
  correct: boolean;
  result: PracticeResult;
  intervalDays: number;
  /** What was stored before this answer, so an undo can put it back. */
  previous: ItemReviewState | null;
  overridden: boolean;
  /**
   * What was actually given, so a miss can show it beside the right answer.
   *
   * Carried on the verdict rather than read from the live answer state, because
   * the answer field is no longer on screen once the verdict is: it lives in
   * the dock, which the verdict replaces. Empty for "I don't know".
   */
  given: string;
}

type Status = 'loading' | 'ready' | 'empty' | 'error';

export function QuizFrame({
  user,
  loadQuiz,
  buildQueue = planSession,
  emptyTitle = 'Nothing due',
  emptyBody = 'Everything in this mode is scheduled for later. Come back when something is due, or pick another mode.',
  onPlanned,
  onFinished,
  renderFinished,
}: QuizFrameProps) {
  const { lookup, error: reviewError } = useReviewStates(user);
  const { profile } = useUserProfile(user);
  const inputMethod = profile?.kanjiba.inputMethod ?? DEFAULT_INPUT_METHOD;
  const adaptive = profile?.kanjiba.adaptive ?? EMPTY_MODEL;

  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [queue, setQueue] = useState<PlannedQuestion[]>([]);
  const [definitions, setDefinitions] = useState<QuizSource['definitions'] | null>(null);
  // Kept so multiple choice can draw distractors from the same deck the
  // question came from. Similar-looking wrong answers are the entire
  // difficulty of a choice question — see domain/distractors.ts.
  const [pool, setPool] = useState<StudyItem[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [tally, setTally] = useState({ right: 0, wrong: 0 });
  const [round, setRound] = useState(0);

  /*
   * Reproducing the answer after a miss.
   *
   * `copy` is what is being written, `copyAttempts` counts the tries that did
   * not match, and `corrected` is what releases the Next button. Skipping is
   * offered once it has cost something — two failed attempts or twenty seconds
   * — because required is not the same as trapped and there are honest ways to
   * be stuck: a recogniser that will not produce the character, or one of the
   * 205 kanji with no reference pattern at all.
   */
  const [copy, setCopy] = useState('');
  const [copyAttempts, setCopyAttempts] = useState(0);
  const [corrected, setCorrected] = useState(false);
  const [canSkipCopy, setCanSkipCopy] = useState(false);

  // The lookup changes on every snapshot; planning must not. Held in a ref so
  // the planning effect can read the current value without depending on it.
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;

  // The finish fires from an effect, and the condition that triggers it stays
  // true for every subsequent render. Guarded rather than debounced.
  const reported = useRef(false);

  const askedAt = useRef<number>(Date.now());
  // Whether the prompt gave anything away before the answer came in.
  const helped = useRef(false);

  useEffect(() => {
    let live = true;
    setStatus('loading');
    setMessage(null);

    loadQuiz().then(
      ({ candidates, definitions: loaded }) => {
        if (!live) return;
        const planned = buildQueue(candidates, lookupRef.current, new Date());
        setDefinitions(loaded);
        setQueue(planned);
        setPool(candidates.map((candidate: Candidate) => candidate.item));
        setIndex(0);
        setAnswer('');
        setVerdict(null);
        resetCorrection();
        setTally({ right: 0, wrong: 0 });
        askedAt.current = Date.now();
        helped.current = false;
        reported.current = false;
        setStatus(planned.length > 0 ? 'ready' : 'empty');
        if (planned.length > 0) onPlanned?.(planned.length);
      },
      (error: unknown) => {
        if (!live) return;
        // The exception's own message is for the console. "Failed to fetch" is
        // what a browser says to a programmer; a learner needs to know whether
        // this is their fault, whether anything is lost, and what to press.
        console.error('[decks] Could not load the questions.', error);
        setMessage(null);
        setStatus('error');
      },
    );

    return () => {
      live = false;
    };
    // Bumping `round` is what restarts the session. `lookup` is deliberately
    // absent: it changes on every snapshot, and is read through the ref so a
    // landing write cannot reshuffle the queue mid-session.
  }, [buildQueue, loadQuiz, onPlanned, round]);

  const question = queue[index];
  // Every per-question behaviour — how it is prompted, marked and timed —
  // follows from the question's own mode, not from the screen it is on.
  const definition = question && definitions ? definitions[question.quiz] : null;

  /**
   * Records one answer and shows the verdict.
   *
   * Reached either by answering or by giving up. Giving up is a `fail` and is
   * recorded exactly like a wrong answer, because it is one: you could not
   * recall the item, and the schedule should hear that.
   */
  const resolve = useCallback(
    (correct: boolean, given = '') => {
    if (!question || verdict) return;

    const elapsedMs = Date.now() - askedAt.current;
    // Graded against this learner's own response times once there are enough of
    // them, and against the static guesses until then.
    const result = gradeAnswer(
      { correct, elapsedMs, usedHint: helped.current },
      profileFor(adaptive.fluency, question.quiz, inputMethod),
    );

    // Read the state this grade applies to *before* writing, so an undo has
    // something exact to restore.
    const previous = lookupRef.current(question.mode, question.item.id);

    // How overdue this was, and what the model therefore expected — both are
    // needed to replay this review when the weights are next fitted, and
    // neither can be reconstructed afterwards.
    const lastAt = previous?.lastReviewedAt?.toDate() ?? null;
    const elapsedDays = lastAt ? Math.max(0, (Date.now() - lastAt.getTime()) / 86_400_000) : 0;
    const predictedRecall = previous?.stability
      ? retrievability(elapsedDays, previous.stability)
      : 1;

    void appendReview(user.uid, {
      itemId: question.item.id,
      mode: question.mode,
      quiz: question.quiz,
      input: inputMethod,
      result,
      elapsedDays,
      predictedRecall,
      responseMs: elapsedMs,
    }).catch((error: unknown) => {
      // Losing a log entry costs a slightly worse fit months from now. Worth
      // reporting, not worth interrupting anyone over.
      console.error('[firestore] Review log entry did not reach the server.', error);
    });

    if (correct) {
      // Only correct answers. How long someone stared at a word they did not
      // know is a fact about patience, not fluency.
      void saveFluency(
        user.uid,
        observeResponse(adaptive.fluency, question.quiz, inputMethod, elapsedMs),
      ).catch((error: unknown) => {
        console.error('[firestore] Response-time update did not reach the server.', error);
      });
    }

    void recordReview(user.uid, {
      mode: question.mode,
      level: question.level,
      itemId: question.item.id,
      result,
      current: previous,
      weights: weightsFor(adaptive, question.mode),
    })
      .then((stored) => {
        setVerdict((current) =>
          current && current.question === question
            ? { ...current, intervalDays: stored.intervalDays ?? current.intervalDays }
            : current,
        );
      })
      .catch((error: unknown) => {
        // Offline this promise simply stays pending; a rejection means the
        // write genuinely failed, most likely on the security rules.
        console.error('[firestore] Review did not reach the server.', error);
      });

    setVerdict({ question, correct, result, intervalDays: 0, previous, overridden: false, given });
    setTally((current) => ({
      right: current.right + (correct ? 1 : 0),
      wrong: current.wrong + (correct ? 0 : 1),
    }));
    },
    [adaptive, inputMethod, question, user.uid, verdict],
  );

  const submit = useCallback(
    (given?: string) => {
      if (!question || verdict) return;

      // Methods where choosing is submitting hand the answer over directly; the
      // frame's own state has not caught up yet.
      const trimmed = (given ?? answer).trim();
      if (!trimmed) return;

      const active = definitions?.[question.quiz];
      if (!active) return;

      resolve(active.check(trimmed, question.item), trimmed);
    },
    [answer, definitions, question, resolve, verdict],
  );

  /**
   * "I don't know."
   *
   * Not a nicety. Submitting requires a non-empty answer, so on a handwriting
   * question with nothing drawn the Check button is disabled and there is no way
   * forward at all — the session simply stops. Even where the input allows
   * nonsense to be typed, making someone invent a wrong answer to escape a
   * question wastes their time and tells the scheduler the same thing this does.
   *
   * Deliberately not a skip. A skip that recorded nothing would leave the item
   * due and looping, and would let the backlog be walked past rather than
   * worked through.
   */
  const giveUp = useCallback(() => resolve(false), [resolve]);

  const resetCorrection = useCallback(() => {
    setCopy('');
    setCopyAttempts(0);
    setCorrected(false);
    setCanSkipCopy(false);
  }, []);

  /**
   * Marking the reproduction.
   *
   * Marked by `definition.check` — the very function that marked the question —
   * so it can never be stricter than the question was, and an item with several
   * accepted readings needs no second rule.
   *
   * Nothing is recorded. The grade and all three writes happened in `resolve`
   * before this appeared: the correction is rehearsal, not evidence. Grading it
   * would mean every failure was immediately followed by a success, and the
   * model would stop being able to learn anything from failures at all.
   */
  const submitCopy = useCallback(
    (given?: string) => {
      if (!question || !definitions) return;

      const trimmed = (given ?? copy).trim();
      if (!trimmed) return;

      if (definitions[question.quiz].check(trimmed, question.item)) {
        setCorrected(true);
        return;
      }

      setCopy('');
      setCopyAttempts((n) => n + 1);
    },
    [copy, definitions, question],
  );

  const next = useCallback(() => {
    setVerdict(null);
    setAnswer('');
    resetCorrection();
    setIndex((current) => current + 1);
    askedAt.current = Date.now();
    helped.current = false;
  }, [resetCorrection]);

  /**
   * "That was a typo."
   *
   * Re-records the same item one grade lower. Cheap because the write is a
   * merge of one map entry, and honest because it can only ever move the grade
   * down — see `downgrade`.
   */
  const softenGrade = useCallback(() => {
    if (!verdict || verdict.overridden) return;

    const softened = downgrade(verdict.result);
    if (softened === verdict.result) return;

    void recordReview(user.uid, {
      mode: verdict.question.mode,
      level: verdict.question.level,
      itemId: verdict.question.item.id,
      result: softened,
      current: verdict.previous,
      weights: weightsFor(adaptive, verdict.question.mode),
    }).catch((error: unknown) => {
      console.error('[firestore] Adjusted review did not reach the server.', error);
    });

    setVerdict({ ...verdict, result: softened, overridden: true });
  }, [adaptive, user.uid, verdict]);

  const undo = useCallback(() => {
    if (!verdict) return;

    void undoReview(user.uid, {
      mode: verdict.question.mode,
      level: verdict.question.level,
      itemId: verdict.question.item.id,
      previous: verdict.previous,
    }).catch((error: unknown) => {
      console.error('[firestore] Undo did not reach the server.', error);
    });

    setTally((current) => ({
      right: current.right - (verdict.correct ? 1 : 0),
      wrong: current.wrong - (verdict.correct ? 0 : 1),
    }));
    setVerdict(null);
    setAnswer('');
    resetCorrection();
    askedAt.current = Date.now();
    helped.current = false;
  }, [resetCorrection, user.uid, verdict]);

  // Reaching the end of the queue, reported once.
  useEffect(() => {
    if (status !== 'ready' || queue.length === 0) return;
    if (index < queue.length || reported.current) return;

    reported.current = true;
    onFinished?.({
      offered: queue.length,
      answered: tally.right + tally.wrong,
      right: tally.right,
    });
  }, [index, onFinished, queue.length, status, tally]);

  /*
   * The way out, after twenty seconds of being stuck.
   *
   * Deliberately not offered immediately: an escape that is there from the
   * first frame is the button everyone presses, and the copying is the point.
   */
  const stuck = verdict !== null && !verdict.correct && !corrected;
  useEffect(() => {
    if (!stuck) return;
    const timer = window.setTimeout(() => setCanSkipCopy(true), 20_000);
    return () => window.clearTimeout(timer);
  }, [stuck]);

  if (status === 'loading') {
    return (
      <section className="card">
        <p className="card__body">Working out what is due…</p>
      </section>
    );
  }

  if (status === 'error') {
    return (
      <section className="card">
        <h1 className="card__title">The questions did not load</h1>
        <p className="notice notice--error" role="alert">
          {message ??
            'The word lists could not be fetched. They are stored on your device after the ' +
              'first visit, so this usually means a first launch without a connection.'}
        </p>
        <p className="card__hint">Nothing you have answered is affected.</p>
        <button
          type="button"
          className="button button--primary button--block"
          onClick={() => setRound((n) => n + 1)}
        >
          Try again
        </button>
      </section>
    );
  }

  if (status === 'empty') {
    return (
      <section className="card">
        <h1 className="card__title">{emptyTitle}</h1>
        <p className="card__body">{emptyBody}</p>
      </section>
    );
  }

  if (!question || !definition) {
    const again = () => setRound((n) => n + 1);

    if (renderFinished) {
      return (
        <>
          {renderFinished({
            offered: queue.length,
            right: tally.right,
            wrong: tally.wrong,
            again,
          })}
        </>
      );
    }

    return (
      <section className="card">
        <h1 className="card__title">Round finished</h1>
        <p className="card__body">
          {tally.right} right, {tally.wrong} missed, out of {queue.length}.
        </p>
        <button type="button" className="button button--primary button--block" onClick={again}>
          Another round
        </button>
      </section>
    );
  }

  return (
    <section className="card quiz">
      <div className="card__header">
        <span className="pill">
          {index + 1} / {queue.length}
        </span>
        {isSlipping(question.state) ? (
          <span className="pill pill--slipping">keeps slipping</span>
        ) : null}
        <span className="pill pill--muted">
          {tally.right}✓ {tally.wrong}✗
        </span>
      </div>

      {reviewError ? (
        <p className="notice notice--warn" role="alert">
          {/* The message is a whole sentence now, so it is not a suffix. */}
          {reviewError}
        </p>
      ) : null}

      <div className="quiz__prompt">
        {definition.renderPrompt(question, {
          markHelped: () => {
            helped.current = true;
          },
        })}
      </div>

      {verdict ? (
        <>
          <p
            className={`verdict ${verdict.correct ? 'verdict--hit' : 'verdict--wrong'}`}
            role="status"
          >
            {verdict.correct
              ? 'Correct'
              : definitions?.[verdict.question.quiz].answerOf(verdict.question.item)}
          </p>

          {!verdict.correct && verdict.given ? (
            <p className="quiz__given">
              You wrote{' '}
              <span lang="ja">{verdict.given}</span>
            </p>
          ) : null}

          <div className="quiz__reveal">{definition.renderReveal(question.item)}</div>

          <p className="card__hint">
            {gradeLabel(verdict.result)}
            {verdict.intervalDays > 0 ? ` — back in ${describeInterval(verdict.intervalDays)}` : ''}
          </p>

          {stuck ? (
            /*
             * Write it once before moving on.
             *
             * Copying after a failed recall is the only rehearsal that miss was
             * ever going to get, and it costs a moment that was dead anyway.
             * The answer stays on screen throughout — this is copying, not a
             * second attempt, and hiding it would just be asking the same
             * question twice.
             *
             * The input is whatever the learner already uses, so nobody is
             * asked for an IME they do not have: multiple choice re-presents
             * the options and wants the right one, handwriting wants it drawn,
             * which on a writing question is the whole exercise.
             */
            <div className="quiz__dock">
              <p className="card__hint quiz__copyprompt">
                Write it out once — that is what makes it stick.
              </p>

              <AnswerInput
                method={inputMethod}
                value={copy}
                onChange={setCopy}
                onSubmit={submitCopy}
                disabled={false}
                placeholder={definition.placeholder}
                {...(inputMethod === 'choice'
                  ? { choices: buildChoices(question.item, pool, question.quiz) }
                  : {})}
              />

              <button
                type="button"
                className="button button--primary button--block"
                onClick={() => submitCopy()}
                disabled={copy.trim() === ''}
              >
                Done
              </button>

              <div className="quiz__afterthoughts">
                {copyAttempts > 0 ? (
                  <span className="quiz__copyhint" role="status">
                    Not quite — it is on screen above.
                  </span>
                ) : null}
                {canSkipCopy || copyAttempts >= 2 ? (
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => setCorrected(true)}
                  >
                    Skip this
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="quiz__dock">
              <button type="button" className="button button--primary button--block" onClick={next}>
                Next
              </button>

              <div className="quiz__afterthoughts">
                {verdict.correct && !verdict.overridden && downgrade(verdict.result) !== verdict.result ? (
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={softenGrade}
                  >
                    That was harder than it looked
                  </button>
                ) : null}
                <button type="button" className="button button--ghost button--small" onClick={undo}>
                  Undo
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="quiz__dock">
          <AnswerInput
            method={inputMethod}
            value={answer}
            onChange={setAnswer}
            onSubmit={submit}
            disabled={false}
            placeholder={definition.placeholder}
            {...(inputMethod === 'choice'
              ? { choices: buildChoices(question.item, pool, question.quiz) }
              : {})}
          />

          <button
            type="button"
            className="button button--primary button--block"
            // Wrapped, not passed directly: submit's optional argument would
            // otherwise receive the click event as the answer.
            onClick={() => submit()}
            disabled={answer.trim() === ''}
          >
            Check
          </button>
          <div className="quiz__afterthoughts">
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={giveUp}
            >
              I don’t know
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
