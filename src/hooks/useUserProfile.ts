import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { ensureUserProfile, subscribeToUserProfile } from '../storage/userState';
import type { ProfileSnapshot } from '../types';
import { describeFailure } from '../domain/failure';
import { isPreview, previewProfile } from '../preview/fixtures';

export interface UserProfileState extends ProfileSnapshot {
  loading: boolean;
  error: string | null;
}

const INITIAL: UserProfileState = {
  profile: null,
  fromCache: true,
  hasPendingWrites: false,
  loading: true,
  error: null,
};

/**
 * Keeps /users/{uid} in sync with the component tree, and stamps the sign-in
 * on the way in.
 *
 * The subscription is opened without awaiting `ensureUserProfile`, so a cached
 * profile paints immediately even when the write is stuck in the offline queue.
 */
export function useUserProfile(user: User): UserProfileState {
  const [state, setState] = useState<UserProfileState>(INITIAL);

  /*
   * The preview harness has no Firestore, so this subscription never settles
   * and `loading` stays true for ever — which every profile-driven control
   * reads as "not ready yet" and renders itself disabled. The input-method
   * chooser, the sound switch and the accent picker were all being
   * screenshotted in a state no learner will ever see, and could not be driven
   * by the audit at all.
   *
   * The same treatment `useReviewStates` already gives the harness, and for the
   * same reason: a screen that cannot be interacted with cannot be checked.
   * `import.meta.env.DEV` is a compile-time constant, so none of this exists in
   * a production build.
   */
  const previewing = import.meta.env.DEV && isPreview();

  useEffect(() => {
    if (previewing) {
      setState({
        profile: previewProfile,
        fromCache: false,
        hasPendingWrites: false,
        loading: false,
        error: null,
      });
      return;
    }

    setState(INITIAL);

    ensureUserProfile(user).catch((error: unknown) => {
      // Offline this never settles until reconnection, which is expected and
      // harmless — the write is already in the local cache. A rejection means
      // something else went wrong, most likely the security rules.
      console.error('[firestore] Could not write the user profile.', error);
    });

    const unsubscribe = subscribeToUserProfile(
      user.uid,
      (snapshot) => setState({ ...snapshot, loading: false, error: null }),
      (error) =>
        setState((previous) => ({
          ...previous,
          loading: false,
          error: describeFailure(error, 'Your account details could not be read.'),
        })),
    );

    return unsubscribe;
  }, [previewing, user]);

  return state;
}
