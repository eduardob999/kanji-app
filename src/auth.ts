import { FirebaseError } from 'firebase/app';
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

/**
 * Google is the only sign-in method this app supports. Keeping the provider in
 * one place means there is a single thing to change if that ever grows.
 */
function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  // Always let the user pick an account rather than silently reusing the last
  // one — people practise on shared tablets.
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

/** Popup failures that mean "this browser won't do popups", not "it broke". */
const REDIRECT_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported',
]);

/** Popup failures that mean the user backed out. Not worth surfacing as errors. */
const USER_ABORTED_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
]);

export class SignInAbortedError extends Error {
  constructor() {
    super('Sign-in was cancelled.');
    this.name = 'SignInAbortedError';
  }
}

/**
 * Signs in with Google.
 *
 * Popup first, because it keeps the app state intact and works everywhere on
 * desktop. Installed PWAs and some mobile browsers block popups outright, so
 * those fall back to a full-page redirect — in which case this never returns
 * and the result is picked up by `completeRedirectSignIn()` on the next load.
 */
export async function signInWithGoogle(): Promise<User> {
  try {
    const credential = await signInWithPopup(auth, googleProvider());
    return credential.user;
  } catch (error) {
    const code = error instanceof FirebaseError ? error.code : '';

    if (USER_ABORTED_CODES.has(code)) {
      throw new SignInAbortedError();
    }

    if (REDIRECT_FALLBACK_CODES.has(code)) {
      await signInWithRedirect(auth, googleProvider());
      // The page navigates away here; this promise never settles.
      return new Promise<User>(() => {});
    }

    throw error;
  }
}

/**
 * Picks up a sign-in that completed via redirect. Safe to call on every load —
 * it resolves to null when there is no pending redirect.
 *
 * Note: redirect sign-in relies on storage partitioned to your `authDomain`. If
 * you serve the app from GitHub Pages and the browser blocks third-party
 * cookies, prefer the popup path or move `authDomain` onto your own domain.
 */
export async function completeRedirectSignIn(): Promise<User | null> {
  try {
    const credential = await getRedirectResult(auth);
    return credential?.user ?? null;
  } catch (error) {
    console.warn('[auth] Could not complete the redirect sign-in.', error);
    return null;
  }
}

export function signOutUser(): Promise<void> {
  return signOut(auth);
}

export function watchAuthState(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

/** Turns a Firebase auth error into something worth showing a human. */
export function describeAuthError(error: unknown): string {
  if (error instanceof SignInAbortedError) {
    return 'Sign-in was cancelled.';
  }

  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/network-request-failed':
        return 'No connection. Sign in once while online — after that the app works offline.';
      case 'auth/unauthorized-domain':
        return 'This domain is not authorised in Firebase Auth. Add it under Authentication -> Settings -> Authorized domains.';
      case 'auth/invalid-api-key':
      case 'auth/api-key-not-valid-please-pass-a-valid-api-key':
        return 'The Firebase API key is missing or wrong. Check src/firebaseConfig.ts.';
      case 'auth/operation-not-allowed':
        return 'Google sign-in is not enabled for this Firebase project yet.';
      default:
        return `Sign-in failed (${error.code}).`;
    }
  }

  return 'Sign-in failed for an unknown reason.';
}
