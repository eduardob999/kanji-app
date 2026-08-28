import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { DEFAULT_INPUT_METHOD } from '../domain/inputMethod';
import { QUIZ_MODES, quizModeLabel } from '../domain/modes';
import { isAdapted, profileFor } from '../domain/fluency';
import { calibration, calibrationBias, type CalibrationBucket } from '../domain/optimiser';
import { useModelFit } from '../hooks/useModelFit';
import { useUserProfile } from '../hooks/useUserProfile';
import { EMPTY_MODEL, weightsFor } from '../storage/modelState';
import { loadReviewHistory } from '../storage/reviewLog';

/**
 * What the scheduler currently believes, and how well it has been doing.
 *
 * A spaced-repetition app that retunes itself should be able to show its
 * working. Two things are worth seeing:
 *
 * - **Calibration.** Of the reviews the model was 90% sure of, how many did you
 *   actually get? Matching numbers mean the intervals are aimed correctly. A
 *   gap means they are systematically too long or too short, and it is the one
 *   measurement that says so without needing to trust anything.
 * - **What has been fitted.** Which modes have enough history to have moved off
 *   the published weights, and by how much they improved.
 */

const PERCENT = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });

export function SchedulerPanel({ user }: { user: User }) {
  const { profile } = useUserProfile(user);
  const adaptive = profile?.kanjiba.adaptive ?? EMPTY_MODEL;
  const inputMethod = profile?.kanjiba.inputMethod ?? DEFAULT_INPUT_METHOD;

  // No automatic run from here: the app already schedules one when idle, and a
  // second on every visit to this screen would fight it.
  const { running, results, error, refit } = useModelFit(user, adaptive, false);

  const [buckets, setBuckets] = useState<CalibrationBucket[] | null>(null);
  const [reviews, setReviews] = useState<number | null>(null);

  /**
   * The curve, said in a sentence.
   *
   * Five points is the threshold for saying anything at all: below that the
   * difference is inside what a few hundred reviews can tell apart, and
   * announcing it would be reporting noise as a finding.
   */
  const verdict = useMemo(() => {
    const bias = calibrationBias(buckets ?? []);
    const points = Math.round(Math.abs(bias) * 100);

    if (points < 5) {
      return { tone: 'muted', text: 'Aimed about right — what the model expects and what happens agree.' };
    }

    return bias < 0
      ? {
          tone: 'warn',
          text: `Asking about ${points} points too late: you are forgetting more than the model expects. A refit is what corrects that.`,
        }
      : {
          tone: 'muted',
          text: `Asking about ${points} points too early: you are remembering more than the model expects, so some of these reviews were not needed yet.`,
        };
  }, [buckets]);

  useEffect(() => {
    let live = true;

    loadReviewHistory(user.uid)
      .then((history) => {
        if (!live) return;
        setReviews(history.length);
        setBuckets(calibration(history, weightsFor(adaptive, 'vocab-reading')));
      })
      .catch((caught: unknown) => {
        console.error('[model] Could not read the review log.', caught);
        if (live) setReviews(0);
      });

    return () => {
      live = false;
    };
    // Re-reading on every model change would refetch the whole log each time a
    // fit lands; the count and curve are a snapshot of when the screen opened.
  }, [user.uid]);

  return (
    <section className="card">
      <h1 className="card__title">Scheduler</h1>
      <p className="card__body">
        The intervals come from FSRS, a model of forgetting. It starts from published averages and
        moves toward you as it collects evidence.
      </p>

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      <h2 className="card__subtitle">How well aimed it is</h2>
      {reviews === null ? (
        <p className="card__body">Reading your history…</p>
      ) : buckets && buckets.length > 0 ? (
        <>
          {/*
            The answer, above the evidence. Six bands of predicted-versus-actual
            is a table someone has to do a weighted average of in their head to
            find out the only thing they wanted to know.
          */}
          <p className={`notice notice--${verdict.tone}`}>{verdict.text}</p>

          <dl className="datalist">
            {buckets
              .filter((bucket) => bucket.count >= 10)
              .map((bucket) => (
                <div className="datalist__row" key={bucket.band}>
                  <dt>
                    Predicted {PERCENT.format(bucket.predicted)}
                    <span className="datalist__note"> · {bucket.count} reviews</span>
                  </dt>
                  <dd>
                    <span
                      className={
                        Math.abs(bucket.actual - bucket.predicted) < 0.05
                          ? 'figure figure--ok'
                          : 'figure figure--off'
                      }
                    >
                      {PERCENT.format(bucket.actual)}
                    </span>
                  </dd>
                </div>
              ))}
          </dl>
          <p className="card__hint">
            Left is what the model expected, right is what happened. Close together means the
            schedule is aimed correctly. Consistently lower on the right means it is asking too
            late, and the refit below is what corrects it.
          </p>
        </>
      ) : (
        <p className="notice notice--muted">
          {reviews === 0
            ? 'Nothing answered yet. This fills in as you review.'
            : 'Not enough second reviews yet — the first time you see an item there is nothing to predict from.'}
        </p>
      )}

      <h2 className="card__subtitle">Fitted to you</h2>
      <dl className="datalist">
        {(['kanji', 'vocab-reading', 'vocab-writing'] as const).map((mode) => {
          const fitted = adaptive.models[mode];
          return (
            <div className="datalist__row" key={mode}>
              <dt>{mode === 'kanji' ? 'Kanji writing' : mode === 'vocab-reading' ? 'Vocab reading' : 'Writing in context'}</dt>
              <dd>
                {fitted
                  ? `fitted on ${fitted.reviews} reviews`
                  : 'published defaults'}
              </dd>
            </div>
          );
        })}
      </dl>

      {results.length > 0 ? (
        <ul className="itemlist">
          {results.map(({ mode, label, result }) => (
            <li className="itemlist__row itemlist__row--stacked" key={mode}>
              <span className="itemlist__meaning">
                <strong>{label}</strong> — {result.adopted ? 'improved' : 'unchanged'}: {result.reason}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        className="button button--primary button--block"
        onClick={refit}
        disabled={running}
      >
        {running ? 'Fitting…' : 'Refit now'}
      </button>
      <p className="card__hint">
        Runs on its own once enough new answers have built up. A fit is only kept if it predicts
        held-out items better than what it would replace.
      </p>

      <h2 className="card__subtitle">Your answering speed</h2>
      <dl className="datalist">
        {QUIZ_MODES.map((quiz) => {
          const timing = profileFor(adaptive.fluency, quiz, inputMethod);
          const learnt = isAdapted(adaptive.fluency, quiz, inputMethod);
          return (
            <div className="datalist__row" key={quiz}>
              <dt>
                {quizModeLabel(quiz)}
                {learnt ? null : <span className="datalist__note"> · still using defaults</span>}
              </dt>
              <dd>
                {(timing.fastMs / 1000).toFixed(1)}s / {(timing.slowMs / 1000).toFixed(1)}s
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="card__hint">
        Answer faster than the first number and it counts as knowing it outright; slower than the
        second and it counts as a struggle. Both are learnt from your own times on this input
        method, so &ldquo;fast&rdquo; means fast for you.
      </p>
    </section>
  );
}
