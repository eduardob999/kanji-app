import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { EMPTY_SNAPSHOT, lookupReview, subscribeReviewStates, type ReviewSnapshot } from '../storage/reviewState';
import type { ReviewLookup } from '../domain/sessionPlanner';

export interface ReviewStates {
  snapshot: ReviewSnapshot;
  /** The planner's view of the same data. */
  lookup: ReviewLookup;
  loading: boolean;
  error: string | null;
}

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSnapshot(EMPTY_SNAPSHOT);
    setLoading(true);
    setError(null);

    return subscribeReviewStates(
      user.uid,
      (next) => {
        setSnapshot(next);
        setLoading(false);
      },
      (subscriptionError) => {
        setError(subscriptionError.message);
        setLoading(false);
      },
    );
  }, [user.uid]);

  const lookup = useCallback<ReviewLookup>(
    (mode, itemId) => lookupReview(snapshot, mode, itemId),
    [snapshot],
  );

  return useMemo(
    () => ({ snapshot, lookup, loading, error }),
    [snapshot, lookup, loading, error],
  );
}
