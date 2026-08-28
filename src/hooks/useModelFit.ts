import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { REVIEW_MODES, reviewModeLabel, type ReviewMode } from '../domain/modes';
import { fitWeights, MIN_REVIEWS_TO_FIT, type FitResult } from '../domain/optimiser';
import { loadReviewHistory } from '../storage/reviewLog';
import { saveFittedModel, weightsFor, type AdaptiveModel } from '../storage/modelState';
import { describeFailure } from '../domain/failure';

/**
 * Refitting the memory model to this learner.
 *
 * Runs per review mode, because producing a kanji from its readings and
 * recalling a word's reading are different tasks that decay differently, and
 * fitting them together describes neither.
 *
 * ## When it runs
 *
 * Automatically, once enough new answers have accumulated since the last fit,
 * and only when the browser is idle. A fit over 20,000 reviews takes about
 * 350 ms — cheap enough to do without ceremony, expensive enough that doing it
 * during the first paint would be felt. `requestIdleCallback` puts it in the
 * gap after the app has settled.
 *
 * It is also exposed as a button on the Scheduler screen, because a thing that
 * silently retunes your schedule should be something you can also look at and
 * ask to run.
 */

/** New answers needed since the last fit before another is worth the cycles. */
export const REFIT_EVERY = 200;

export interface ModeFit {
  mode: ReviewMode;
  label: string;
  result: FitResult;
}

export interface ModelFitState {
  running: boolean;
  /** What the last run concluded, per mode. Empty until one has happened. */
  results: ModeFit[];
  error: string | null;
  /** Runs a fit now, regardless of how many new reviews there are. */
  refit: () => void;
}

/** `requestIdleCallback` where it exists, a timeout where it does not (Safari). */
function whenIdle(run: () => void): () => void {
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;

  if (typeof idle === 'function') {
    const handle = idle(run);
    return () => {
      (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(
        handle,
      );
    };
  }

  const handle = window.setTimeout(run, 2_000);
  return () => window.clearTimeout(handle);
}

export function useModelFit(user: User, adaptive: AdaptiveModel, auto = true): ModelFitState {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ModeFit[]>([]);
  const [error, setError] = useState<string | null>(null);

  // The model is read inside the callback but must not retrigger the automatic
  // run — saving a fit changes it, which would otherwise loop.
  const adaptiveRef = useRef(adaptive);
  adaptiveRef.current = adaptive;

  const inFlight = useRef(false);

  const run = useCallback(
    async (force: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setRunning(true);
      setError(null);

      try {
        const model = adaptiveRef.current;
        const fits: ModeFit[] = [];

        for (const mode of REVIEW_MODES) {
          const history = await loadReviewHistory(user.uid, { mode });
          const lastFitAt = model.models[mode]?.reviews ?? 0;

          // Nothing new worth refitting on. Reported rather than skipped
          // silently, so the Scheduler screen can say why.
          if (!force && history.length - lastFitAt < REFIT_EVERY) {
            fits.push({
              mode,
              label: reviewModeLabel(mode),
              result: {
                weights: weightsFor(model, mode),
                adopted: false,
                baselineLoss: Number.NaN,
                fittedLoss: Number.NaN,
                reviewsUsed: history.length,
                reason:
                  history.length < MIN_REVIEWS_TO_FIT
                    ? `${history.length} of ${MIN_REVIEWS_TO_FIT} reviews needed`
                    : `only ${history.length - lastFitAt} new since the last fit`,
              },
            });
            continue;
          }

          const result = fitWeights(history, weightsFor(model, mode));
          fits.push({ mode, label: reviewModeLabel(mode), result });

          if (result.adopted) {
            await saveFittedModel(user.uid, mode, {
              weights: result.weights,
              loss: result.fittedLoss,
              previousLoss: result.baselineLoss,
              reviews: result.reviewsUsed,
            });
          }
        }

        setResults(fits);
      } catch (caught) {
        console.error('[model] Refit failed.', caught);
        setError(describeFailure(caught, 'The schedule could not be retuned this time.'));
      } finally {
        inFlight.current = false;
        setRunning(false);
      }
    },
    [user.uid],
  );

  useEffect(() => {
    if (!auto) return;
    return whenIdle(() => {
      void run(false);
    });
  }, [auto, run]);

  const refit = useCallback(() => {
    void run(true);
  }, [run]);

  return { running, results, error, refit };
}
