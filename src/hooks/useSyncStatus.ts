import { useMemo } from 'react';
import type { User } from 'firebase/auth';
import { useOnlineStatus } from './useOnlineStatus';
import { useReviewStates } from './useReviewStates';
import { useUserProfile } from './useUserProfile';

/**
 * Whether anything the learner has done is still waiting to reach the server.
 *
 * The badge on the Account screen used to ask the *profile* document this, and
 * the profile is not where practice goes. Answering a question writes review
 * state and a log entry; the profile only moves when a setting changes or a
 * session ends. So the one screen that claimed to answer "is my practice
 * saved?" could say **Synced** with an entire session queued behind it.
 *
 * Both documents now, and pending wins: it is the case where the user has done
 * something the server has not seen.
 *
 * One thing this still cannot see: the review *log*. Its daily documents are
 * appended to but never subscribed to, so their pending state is not
 * observable. That is the right trade — a subscription per day of history to
 * report on a write whose only consumer is a model fit months away would cost
 * more than it tells anyone — but it means "synced" means the schedule is
 * safe, not that every byte has landed.
 */
export interface SyncStatus {
  online: boolean;
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export function useSyncStatus(user: User): SyncStatus {
  const online = useOnlineStatus();
  const { snapshot } = useReviewStates(user);
  const { fromCache: profileCached, hasPendingWrites: profilePending } = useUserProfile(user);

  return useMemo(
    () => ({
      online,
      fromCache: snapshot.fromCache || profileCached,
      hasPendingWrites: snapshot.hasPendingWrites || profilePending,
    }),
    [online, profileCached, profilePending, snapshot.fromCache, snapshot.hasPendingWrites],
  );
}
