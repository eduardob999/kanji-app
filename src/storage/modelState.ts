import { serverTimestamp, setDoc, doc, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { DEFAULT_WEIGHTS, type FsrsWeights } from '../domain/fsrs';
import type { FluencyTable } from '../domain/fluency';
import { REVIEW_MODES, type ReviewMode } from '../domain/modes';

/**
 * What the app has learnt about this learner, as opposed to about their kanji.
 *
 * Two things live here, both small, both derived from the review log and both
 * stored on the profile document under `kanjiba` rather than in a collection of
 * their own — they are read on every question and written rarely.
 *
 * - **Fitted FSRS weights, per review mode.** Producing a kanji from its
 *   readings and recalling a reading are not the same task and do not decay at
 *   the same rate; fitting them together averages two different memories into
 *   one that describes neither. Each mode gets its own fit as soon as it has
 *   the history to support one, and falls back to the published weights until
 *   then.
 * - **Response-time thresholds**, see `domain/fluency.ts`.
 */

const USERS_COLLECTION = 'users';

function userDoc(uid: string) {
  return doc(db, USERS_COLLECTION, uid);
}

export interface FittedModel {
  weights: number[];
  /** Held-out loss this fit achieved, for the Progress screen. */
  loss: number;
  /** Held-out loss of what it replaced. */
  previousLoss: number;
  /** Reviews the fit was made from. */
  reviews: number;
  fittedAt: Timestamp | null;
}

/** Everything under `/users/{uid}.kanjiba.model`. */
export type FittedModels = Partial<Record<ReviewMode, FittedModel>>;

export interface AdaptiveModel {
  models: FittedModels;
  fluency: FluencyTable;
}

export const EMPTY_MODEL: AdaptiveModel = { models: {}, fluency: {} };

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Reads the adaptive state off a raw profile document's `kanjiba` map. */
export function toAdaptiveModel(kanjiba: Record<string, unknown> | undefined): AdaptiveModel {
  if (!kanjiba) return EMPTY_MODEL;

  const rawModels = (kanjiba['model'] ?? {}) as Record<string, unknown>;
  const models: FittedModels = {};

  for (const mode of REVIEW_MODES) {
    const entry = rawModels[mode] as Record<string, unknown> | undefined;
    if (!entry || !isNumberArray(entry['weights'])) continue;

    models[mode] = {
      weights: entry['weights'],
      loss: typeof entry['loss'] === 'number' ? entry['loss'] : Number.NaN,
      previousLoss: typeof entry['previousLoss'] === 'number' ? entry['previousLoss'] : Number.NaN,
      reviews: typeof entry['reviews'] === 'number' ? entry['reviews'] : 0,
      fittedAt: (entry['fittedAt'] ?? null) as Timestamp | null,
    };
  }

  const rawFluency = (kanjiba['fluency'] ?? {}) as Record<string, unknown>;
  const fluency: FluencyTable = {};

  for (const [key, value] of Object.entries(rawFluency)) {
    const bucket = value as Record<string, unknown>;
    if (
      typeof bucket?.['n'] === 'number' &&
      typeof bucket['fast'] === 'number' &&
      typeof bucket['slow'] === 'number'
    ) {
      fluency[key] = { n: bucket['n'], fast: bucket['fast'], slow: bucket['slow'] };
    }
  }

  return { models, fluency };
}

/**
 * The weights to schedule one mode with.
 *
 * Falls back to the published defaults, which is the right answer until there
 * is enough of this learner's history to beat them — see `optimiser.ts`, which
 * refuses to hand back a fit that did not.
 */
export function weightsFor(model: AdaptiveModel, mode: ReviewMode): FsrsWeights {
  return model.models[mode]?.weights ?? DEFAULT_WEIGHTS;
}

/**
 * Stores a fit.
 *
 * Nested under `kanjiba.model.{mode}` so it merges field by field: fitting one
 * mode never disturbs another's, and neither disturbs GHAPP's half of the
 * document.
 */
export async function saveFittedModel(
  uid: string,
  mode: ReviewMode,
  fit: { weights: readonly number[]; loss: number; previousLoss: number; reviews: number },
): Promise<void> {
  await setDoc(
    userDoc(uid),
    {
      kanjiba: {
        model: {
          [mode]: {
            weights: [...fit.weights],
            loss: fit.loss,
            previousLoss: fit.previousLoss,
            reviews: fit.reviews,
            fittedAt: serverTimestamp(),
          },
        },
      },
    },
    { merge: true },
  );
}

/**
 * Stores the response-time thresholds.
 *
 * Written on every answer. That is one extra small merge per question, which is
 * the price of the thresholds tracking someone who is getting faster; batching
 * it would save writes and lose the answers in the batch whenever a session
 * ends by closing the tab, which is how most sessions end.
 */
export async function saveFluency(uid: string, fluency: FluencyTable): Promise<void> {
  await setDoc(userDoc(uid), { kanjiba: { fluency } }, { merge: true });
}
