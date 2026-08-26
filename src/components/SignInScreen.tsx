import { useState } from 'react';
import { describeAuthError, signInWithGoogle, SignInAbortedError } from '../auth';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { AppMark } from './AppMark';
import { GoogleIcon } from './GoogleIcon';

export function SignInScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = useOnlineStatus();

  async function handleSignIn() {
    setBusy(true);
    setError(null);

    try {
      await signInWithGoogle();
      // On success the auth listener swaps this screen out, so there is nothing
      // to do here — and no setBusy(false), which would flash the idle button.
    } catch (err) {
      if (!(err instanceof SignInAbortedError)) {
        console.error('[auth] Google sign-in failed.', err);
      }
      setError(describeAuthError(err));
      setBusy(false);
    }
  }

  return (
    <main className="screen screen--centred">
      <section className="signin card">
        <AppMark size={64} />

        <h1 className="signin__title">Kanjiba</h1>
        <p className="signin__tagline">
          JLPT kanji and vocabulary, scheduled so you review each one just before you would have
          forgotten it. Your progress follows your Google account across every device.
        </p>

        <button
          type="button"
          className="button button--google"
          onClick={() => void handleSignIn()}
          disabled={busy}
        >
          <GoogleIcon />
          <span>{busy ? 'Opening Google…' : 'Sign in with Google'}</span>
        </button>

        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}

        {!online ? (
          <p className="notice notice--muted">
            You are offline. The first sign-in needs a connection — after that the app runs without
            one.
          </p>
        ) : null}

        <p className="signin__footnote">
          Google is the only sign-in method. We store your name, email and review history, and
          nothing else.
        </p>
      </section>
    </main>
  );
}
