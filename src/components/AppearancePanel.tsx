import { useState } from 'react';
import type { User } from 'firebase/auth';
import { DEFAULT_HUE, isHue } from '../domain/theme';
import { applyAccent } from '../hooks/useAccent';
import { useUserProfile } from '../hooks/useUserProfile';
import { setAccentHue } from '../storage/userState';

/**
 * The colour of the app, chosen by the person using it.
 *
 * A hue and nothing else. Lightness and chroma are fixed by the app at values
 * that clear WCAG AA against both themes' backgrounds — `theme.test.ts` checks
 * all 360 of them — so this control cannot produce a primary button whose label
 * nobody can read. A colour wheel where a third of the wheel is broken is not a
 * feature.
 *
 * There is no preview pane, on purpose: the whole app is the preview. Tokens
 * are global, so the swatch you touch repaints the header, the tab bar, the
 * button under your thumb and the progress bars behind this screen at once,
 * which is a better answer to "what will it look like" than a rectangle.
 */

/** Twelve hues at 30° steps: enough to choose from, few enough to see at once. */
const SWATCHES = Array.from({ length: 12 }, (_, index) => index * 30);

export function AppearancePanel({ user }: { user: User }) {
  const { profile, loading } = useUserProfile(user);
  const hue = isHue(profile?.kanjiba.accentHue) ? profile.kanjiba.accentHue : DEFAULT_HUE;

  const [chosen, setChosen] = useState<number | null>(null);
  const showing = chosen ?? hue;

  const choose = (next: number) => {
    const rounded = Math.round(next);

    /*
     * Painted first, stored second.
     *
     * The write is not awaited — Firestore updates its local cache and the
     * profile subscription follows — and that is fast but it is not this frame.
     * A colour picker that answers late feels broken however reliably it saves,
     * so the app repaints now and the stored value catches up. They agree
     * within a tick, and the swatch state is local until it does.
     */
    setChosen(rounded);
    applyAccent(rounded);

    void setAccentHue(user.uid, rounded).catch((error: unknown) => {
      console.error('[profile] Accent colour did not reach the server.', error);
    });
  };

  return (
    <section className="card">
      <h1 className="card__title">Appearance</h1>
      <p className="card__body">
        The accent runs through every button, tab and bar in the app. Pick a hue; the app keeps
        hold of how light it is, which is what keeps text on it readable.
      </p>

      <fieldset className="field" disabled={loading}>
        <legend className="field__label">Accent</legend>
        <div className="swatches">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`swatch${Math.abs(swatch - showing) < 15 ? ' swatch--chosen' : ''}`}
              style={{ '--swatch-hue': swatch } as React.CSSProperties}
              aria-label={`Accent hue ${swatch} degrees`}
              aria-pressed={Math.abs(swatch - showing) < 15}
              onClick={() => choose(swatch)}
            />
          ))}
        </div>

        <label className="field__label field__label--inline" htmlFor="accent-hue">
          Fine tune
        </label>
        <input
          id="accent-hue"
          className="slider"
          type="range"
          min={0}
          max={359}
          step={1}
          value={showing}
          onChange={(event) => choose(Number(event.target.value))}
        />
      </fieldset>

      <button
        type="button"
        className="button button--ghost button--small"
        onClick={() => choose(DEFAULT_HUE)}
      >
        Back to the original blue
      </button>
    </section>
  );
}
