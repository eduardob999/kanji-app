import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { completeRedirectSignIn, watchAuthState } from '../auth';

export interface AuthState {
  user: User | null;
  /** True until Firebase has restored (or ruled out) a persisted session. */
  loading: boolean;
}

/**
 * Tracks the Firebase auth session.
 *
 * `loading` matters more than it looks: Firebase restores a persisted session
 * asynchronously, so rendering on the first tick would flash the sign-in screen
 * at users who are already signed in — every single launch.
 */
export function useAuthUser(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => {
    // Collect a sign-in that finished via full-page redirect. onAuthStateChanged
    // reports the user either way, so we only need this for its errors.
    void completeRedirectSignIn();

    return watchAuthState((user) => {
      setState({ user, loading: false });
    });
  }, []);

  return state;
}
