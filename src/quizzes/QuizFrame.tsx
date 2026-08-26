import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { DEFAULT_INPUT_METHOD } from '../domain/inputMethod';
import { gradeAnswer, gradeLabel, downgrade } from '../domain/grading';
import { observeResponse, profileFor } from '../domain/fluency';
import { retrievability } from '../domain/fsrs';
import type { QuizMode } from '../domain/modes';
import type { StudyItem } from '../domain/items';
import type { ItemReviewState, PracticeResult } from '../domain/review';
import { describeInterval } from '../domain/scheduler';
import { planSession, type Candidate, type PlannedQuestion } from '../domain/sessionPlanner';
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
  quiz: QuizMode;
  /** The pool to plan from. Async because decks load on demand. */
  loadCandidates: () => Promise<Candidate[]>;
  /** The question, before it is answered. */
  renderPrompt: (item: StudyItem) => ReactNode;
  /** The rest of the entry, shown once it has been. */
  renderReveal: (item: StudyItem) => ReactNode;
  /** Marks the answer. */
  check: (input: string, item: StudyItem) => boolean;
  /** What the answer was, for a miss. */
  answerOf: (item: StudyItem) => string;
  placeholder: string;
}

interface Verdict {
  question: PlannedQuestion;
  correct: boolean;
  result: PracticeResult;
  intervalDays: number;
  /** What was stored before this answer, so an undo can put it back. */
  previous: ItemReviewState | null;
  overridden: boolean;
}

type Status = 'loading' | 'ready' | 'empty' | 'error';

export function QuizFrame({
  user,
  quiz,
  loadCandidates,
  renderPrompt,
  renderReveal,
  check,
  answerOf,
  placeholder,
}: QuizFrameProps) {
  const { lookup, error: reviewError } = useReviewStates(user);
  const { profile } = useUserProfile(user);
  const inputMethod = profile?.kanjiba.inputMethod ?? DEFAULT_INPUT_METHOD;
  const adaptive = profile?.kanjiba.adaptive ?? EMPTY_MODEL;

  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [queue, setQueue] = useState<PlannedQuestion[]>([]);
  // Kept so multiple choice can draw distractors from the same deck the
  // question came from. Similar-looking wrong answers are the entire
  // difficulty of a choice question — see domain/distractors.ts.
  const [pool, setPool] = useState<StudyItem[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [tally, setTally] = useState({ right: 0, wrong: 0 });
  const [round, setRound] = useState(0);

  // The lookup changes on every snapshot; planning must not. Held in a ref so
  // the planning effect can read the current value without depending on it.
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;

  const askedAt = useRef<number>(Date.now());

  useEffect(() => {
    let live = true;
    setStatus('loading');
    setMessage(null);

    loadCandidates().then(
      (candidates) => {
        if (!live) return;
        const planned = planSession(candidates, lookupRef.current, new Date());
        setQueue(planned);
        setPool(candidates.map((candidate) => candidate.item));
        setIndex(0);
        setAnswer('');
        setVerdict(null);
        setTally({ right: 0, wrong: 0 });
        askedAt.current = Date.now();
        setStatus(planned.length > 0 ? 'ready' : 'empty');
      },
      (error: unknown) => {
        if (!live) return;
        setMessage(error instanceof Error ? error.message : 'Could not load the deck.');
        setStatus('error');
      },
    );

    return () => {
      live = false;
    };
    // Bumping `round` is what restarts the session. `lookup` is deliberately
    // absent: it changes on every snapshot, and is read through the ref so a
    // landing write cannot reshuffle the queue mid-session.
  }, [loadCandidates, round]);

  const question = queue[index];

  const submit = useCallback(
    (given?: string) => {
    if (!question || verdict) return;

    // Methods where choosing is submitting hand the answer over directly; the
    // frame's own state has not caught up yet.
    const trimmed = (given ?? answer).trim();
    if (!trimmed) return;

    const correct = check(trimmed, question.item);
    const elapsedMs = Date.now() - askedAt.current;
    // Graded against this learner's own response times once there are enough of
    // them, and against the static guesses until then.
    const result = gradeAnswer(
      { correct, elapsedMs },
      profileFor(adaptive.fluency, quiz, inputMethod),
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
      quiz,
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
        observeResponse(adaptive.fluency, quiz, inputMethod, elapsedMs),
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

    setVerdict({ question, correct, result, intervalDays: 0, previous, overridden: false });
    setTally((current) => ({
      right: current.right + (correct ? 1 : 0),
      wrong: current.wrong + (correct ? 0 : 1),
    }));
    },
    [adaptive, answer, check, inputMethod, question, quiz, user.uid, verdict],
  );

  const next = useCallback(() => {
    setVerdict(null);
    setAnswer('');
    setIndex((current) => current + 1);
    askedAt.current = Date.now();
  }, []);

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
    askedAt.current = Date.now();
  }, [user.uid, verdict]);

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
        <p className="notice notice--error" role="alert">
          {message}
        </p>
      </section>
    );
  }

  if (status === 'empty') {
    return (
      <section className="card">
        <h1 className="card__title">Nothing due</h1>
        <p className="card__body">
          Everything in this mode is scheduled for later. Come back when something is due, or pick
          another mode.
        </p>
      </section>
    );
  }

  if (!question) {
    return (
      <section className="card">
        <h1 className="card__title">Round finished</h1>
        <p className="card__body">
          {tally.right} right, {tally.wrong} missed, out of {queue.length}.
        </p>
        <button
          type="button"
          className="button button--primary button--block"
          onClick={() => setRound((n) => n + 1)}
        >
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
        <span className="pill pill--muted">
          {tally.right}✓ {tally.wrong}✗
        </span>
      </div>

      {reviewError ? (
        <p className="notice notice--warn" role="alert">
          Your progress is not syncing: {reviewError}
        </p>
      ) : null}

      <div className="quiz__prompt">{renderPrompt(question.item)}</div>

      <AnswerInput
        method={inputMethod}
        value={answer}
        onChange={setAnswer}
        onSubmit={submit}
        disabled={verdict !== null}
        placeholder={placeholder}
        {...(inputMethod === 'choice'
          ? { choices: buildChoices(question.item, pool, quiz) }
          : {})}
      />

      {verdict ? (
        <>
          <p
            className={`verdict ${verdict.correct ? 'verdict--hit' : 'verdict--wrong'}`}
            role="status"
          >
            {verdict.correct ? 'Correct' : answerOf(verdict.question.item)}
          </p>

          <div className="quiz__reveal">{renderReveal(question.item)}</div>

          <p className="card__hint">
            {gradeLabel(verdict.result)}
            {verdict.intervalDays > 0 ? ` — back in ${describeInterval(verdict.intervalDays)}` : ''}
          </p>

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
        </>
      ) : (
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
      )}
    </section>
  );
}
