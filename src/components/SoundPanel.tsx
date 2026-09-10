import type { User } from 'firebase/auth';
import { playCue } from '../audio/cues';
import { useUserProfile } from '../hooks/useUserProfile';
import { setSounds } from '../storage/userState';

/**
 * Whether answering makes a sound.
 *
 * One switch, and a way to hear what it does — a setting for a sound that you
 * cannot hear from the settings screen is a setting you have to go and test by
 * getting a question wrong.
 *
 * The cues themselves are synthesised rather than downloaded; see
 * `src/audio/cues.ts` for what they are and why they are that quiet.
 */
export function SoundPanel({ user }: { user: User }) {
  const { profile, loading } = useUserProfile(user);
  const on = profile?.kanjiba.sounds ?? true;

  const choose = (next: boolean) => {
    // Not awaited: the switch moves from the local cache at once, and playing
    // the cue immediately is the point of pressing it.
    void setSounds(user.uid, next).catch((error: unknown) => {
      console.error('[profile] Sound setting did not reach the server.', error);
    });
    if (next) playCue('correct', { enabled: true, silent: false });
  };

  return (
    <section className="card">
      <h1 className="card__title">Sound</h1>
      <p className="card__body">
        A short chime when an answer lands, and a longer one when a round ends.
      </p>

      <fieldset className="field" disabled={loading}>
        <legend className="field__label">Answer sounds</legend>
        <div className="segmented segmented--wrap">
          {[true, false].map((value) => (
            <button
              key={String(value)}
              type="button"
              className={`segmented__option${on === value ? ' segmented__option--active' : ''}`}
              aria-pressed={on === value}
              onClick={() => choose(value)}
            >
              {value ? 'On' : 'Off'}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <span className="field__label">Hear them</span>
        <div className="segmented segmented--wrap">
          <button type="button" className="segmented__option" onClick={() => playCue('correct', { enabled: true, silent: false })}>
            Correct
          </button>
          <button type="button" className="segmented__option" onClick={() => playCue('wrong', { enabled: true, silent: false })}>
            Missed
          </button>
          <button type="button" className="segmented__option" onClick={() => playCue('finish', { enabled: true, silent: false })}>
            Round done
          </button>
        </div>
      </div>

      <p className="card__hint">
        Nothing plays while Japanese is being read aloud, and nothing plays at all in
        <strong> Practice (silent)</strong> — that screen exists for a room where sound is not
        allowed, and a chime is still a sound.
      </p>
    </section>
  );
}
