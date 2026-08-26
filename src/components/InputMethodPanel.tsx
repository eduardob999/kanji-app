import type { User } from 'firebase/auth';
import {
  DEFAULT_INPUT_METHOD,
  describeInputMethod,
  inputMethodLabel,
  type InputMethod,
} from '../domain/inputMethod';
import { useUserProfile } from '../hooks/useUserProfile';
import { setInputMethod } from '../storage/userState';

/**
 * How you answer.
 *
 * Stored on the profile rather than per device, so it follows you — but it is
 * genuinely a per-situation choice, which is why the quiz screen can switch it
 * too. Handwriting on a tablet and multiple choice one-handed on a bus are the
 * same person on the same day.
 *
 * Handwriting is deliberately absent from this list until it works. A settings
 * screen that offers a method which silently falls back to another one is worse
 * than a settings screen with one fewer option.
 */

const AVAILABLE: readonly InputMethod[] = ['keyboard', 'choice'];

export function InputMethodPanel({ user }: { user: User }) {
  const { profile, loading } = useUserProfile(user);
  const current = profile?.kanjiba.inputMethod ?? DEFAULT_INPUT_METHOD;

  return (
    <section className="card">
      <h1 className="card__title">Input method</h1>
      <p className="card__body">
        Japanese input is the one thing that cannot be assumed about a device, so it is a choice
        rather than a guess.
      </p>

      <fieldset className="field" disabled={loading}>
        <legend className="field__label">How you answer</legend>
        <div className="segmented segmented--wrap">
          {AVAILABLE.map((method) => (
            <button
              key={method}
              type="button"
              className={`segmented__option${current === method ? ' segmented__option--active' : ''}`}
              aria-pressed={current === method}
              data-method={method}
              onClick={() => {
                // Not awaited: the local cache switches the input on screen at
                // once, and the write lands whenever the network allows.
                void setInputMethod(user.uid, method).catch((error: unknown) => {
                  console.error('[profile] Input method did not reach the server.', error);
                });
              }}
            >
              {inputMethodLabel(method)}
            </button>
          ))}
        </div>
        <p className="card__hint">{describeInputMethod(current)}</p>
      </fieldset>

      <p className="notice notice--muted">
        Handwriting is not ready yet. It needs a stroke database that covers this app’s kanji, and
        the one available is missing 205 of them along with every kana.
      </p>

      <p className="card__hint">
        Your answering speed is tracked separately for each method, so switching does not confuse
        the scheduler about how well you know something — see <strong>Tools → Scheduler</strong>.
      </p>
    </section>
  );
}
