import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { EMPTY_SNAPSHOT, lookupReview, subscribeReviewStates, type ReviewSnapshot } from '../storage/reviewState';
import type { ReviewLookup } from '../domain/sessionPlanner';
import { isPreview, previewLookup } from '../preview/fixtures';
import { describeFailure } from '../domain/failure';

export interface ReviewStates {
  snapshot: ReviewSnapshot;
  /** The planner's view of the same data. */
  lookup: ReviewLookup;
  /** No snapshot has arrived yet. What a spinner should watch. */
  loading: boolean;
  /**
   * The lookup can be trusted to say what has *not* been reviewed.
   *
   * Stricter than `!loading`, and the distinction is the whole point. The first
   * snapshot may be the bootstrap cache read, which comes back empty on a cold
   * cache — no history on this device yet, or a browser where IndexedDB
   * persistence was refused and every reload starts cold. Empty and unseen are
   * the same value to `lookup`, so anything that reads a null as "never
   * studied" must wait for this instead: planning a round against a cold cache
   * offers the first words of N5 to someone who has answered them all, and
   * grading one of those answers writes a fresh schedule over a real memory.
   *
   * Satisfied by whichever comes first: a snapshot from the live listener, a
   * bootstrap that actually had something in it, a subscription error, or
   * `SETTLE_MS` passing. The last is the offline-first escape hatch — a genuine
   * cold start with no server reachable has nothing better coming, and an empty
   * lookup is then the true answer rather than a premature one.
   */
  ready: boolean;
  error: string | null;
}

/**
 * How long to wait for the listener before believing the cache.
 *
 * Long enough for a round trip on a poor connection, short enough that a new
 * account offline is not left staring at a spinner. Only ever reached when the
 * cache was cold *and* the listener has said nothing, which is the first launch
 * on a device and nothing else.
 */
const SETTLE_MS = 3_000;

/**
 * Live review state for the signed-in user.
 *
 * One subscription for the whole app rather than one per quiz: it is 24
 * documents, every screen wants some of it, and Firestore de-duplicates
 * nothing for us if we ask twice.
 */
export function useReviewStates(user: User): ReviewStates {
  const [snapshot, setSnapshot] = useState<ReviewSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The preview harness has no Firestore, so every screen that reads review
   * state used to render as a brand-new account: empty bars, no streak, no
   * sticking points, nothing due. Which meant the parts of those screens that
   * only exist when there *is* data had never been looked at.
   *
   * `import.meta.env.DEV` is a compile-time constant, so this branch and the
   * fixture behind it are eliminated from a production build.
   */
  const previewing = import.meta.env.DEV && isPreview();

  useEffect(() => {
    if (previewing) {
      setLoading(false);
      setSettled(true);
      return;
    }

    setSnapshot(EMPTY_SNAPSHOT);
    setLoading(true);
    setSettled(false);
    setError(null);

    const timer = setTimeout(() => setSettled(true), SETTLE_MS);

    const unsubscribe = subscribeReviewStates(
      user.uid,
      (next) => {
        setSnapshot(next);
        setLoading(false);
      },
      (subscriptionError) => {
        setError(
          describeFailure(subscriptionError, 'Your progress could not be read from the server.'),
        );
        setLoading(false);
        // Nothing further is coming. Waiting on it would strand every screen
        // that holds off until the state is trustworthy.
        setSettled(true);
      },
    );

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [previewing, user.uid]);

  const lookup = useCallback<ReviewLookup>(
    (mode, itemId) =>
      previewing ? previewLookup(mode, itemId) : lookupReview(snapshot, mode, itemId),
    [previewing, snapshot],
  );

  const ready =
    previewing || (!loading && (snapshot.live || snapshot.byMode.size > 0 || settled));

  return useMemo(
    () => ({ snapshot, lookup, loading, ready, error }),
    [snapshot, lookup, loading, ready, error],
  );
}
