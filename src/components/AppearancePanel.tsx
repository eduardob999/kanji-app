import { useState } from 'react';
import type { User } from 'firebase/auth';
import { DEFAULT_GROUND_HUE, DEFAULT_HUE, isHue } from '../domain/theme';
import { toStoredImage } from '../domain/image';
import { applyTheme } from '../hooks/useTheme';
import { applyBackground } from '../hooks/useBackground';
import { useUserProfile } from '../hooks/useUserProfile';
import { clearBackground, saveBackground } from '../storage/background';
import { setAccentHue, setBackgroundDim, setGroundHue } from '../storage/userState';

/**
 * How far the dimming goes, and why it can go this low.
 *
 * It is a taste control, not a safety one. Every piece of text in the app sits
 * on a surface of its own — cards are opaque, and the header, breadcrumb and
 * tab bar get a 92% ground of their own as soon as there is a picture behind
 * them — so the scrim is deciding how much photograph you want to see rather
 * than whether the app is readable.
 *
 * It started at a floor of 70 with the scrim carrying both jobs, which was safe
 * and pointless: at 85 the picture someone had just chosen was a rumour.
 */
const MIN_DIM = 25;
const DEFAULT_DIM = 62;

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

  /*
   * The ground, which has a third state: unchosen.
   *
   * Unchosen is not the same as 249 — the app's own ground is ink at 249 on
   * dark and washi at 81 on light, and only "unchosen" reproduces both. So the
   * slider shows 249 for want of anywhere else to sit, while what is *applied*
   * stays undefined until a learner actually picks something.
   */
  const [chosenGround, setChosenGround] = useState<number | null>(null);
  const storedGround = isHue(profile?.kanjiba.groundHue) ? profile.kanjiba.groundHue : undefined;
  const groundChoice = chosenGround ?? storedGround;
  const showingGround = groundChoice ?? DEFAULT_GROUND_HUE;

  /*
   * The picture, held locally as well as stored.
   *
   * `useBackground` in the shell is what puts a *saved* image on screen; this
   * is the one being chosen right now, which has to appear before the write
   * lands and which — in the preview harness, where there is no Firestore —
   * is the only one there will ever be.
   */
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dim, setDim] = useState(profile?.kanjiba.backgroundDim ?? DEFAULT_DIM);

  const pick = async (file: File | null) => {
    if (!file) return;

    setBusy(true);
    setError(null);

    try {
      // Resized and re-encoded before it goes anywhere: a phone photo is 8 MB
      // and Firestore's ceiling is 1. See `domain/image.ts`.
      const stored = await toStoredImage(file);
      applyBackground(stored);
      // The dimming the app is about to use, published now rather than waiting
      // for the slider to be touched.
      document.documentElement.style.setProperty('--app-dim', String(dim));
      setImage(stored);
      void saveBackground(user.uid, stored).catch((caught: unknown) => {
        console.error('[firestore] The background did not reach the server.', caught);
      });
    } catch (caught: unknown) {
      console.error('[appearance] Could not prepare that image.', caught);
      setError(
        caught instanceof Error && caught.message.includes('too detailed')
          ? caught.message
          : 'That picture could not be read. Try another, or a photo rather than a screenshot.',
      );
    } finally {
      setBusy(false);
    }
  };

  const dimTo = (next: number) => {
    setDim(next);
    document.documentElement.style.setProperty('--app-dim', String(next));
    void setBackgroundDim(user.uid, next).catch((caught: unknown) => {
      console.error('[profile] Dimming did not reach the server.', caught);
    });
  };

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
    applyTheme(rounded, groundChoice);

    void setAccentHue(user.uid, rounded).catch((error: unknown) => {
      console.error('[profile] Accent colour did not reach the server.', error);
    });
  };

  const chooseGround = (next: number) => {
    const rounded = Math.round(next);

    setChosenGround(rounded);
    applyTheme(showing, rounded);

    void setGroundHue(user.uid, rounded).catch((error: unknown) => {
      console.error('[profile] Background colour did not reach the server.', error);
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

      <hr className="rule" />

      <h2 className="card__subtitle">Background colour</h2>
      <p className="card__body">
        The ground everything sits on — the page, the cards, and the fields inside them. The app
        keeps hold of how light each of those is, which is what keeps the writing on them
        readable.
      </p>

      <fieldset className="field" disabled={loading}>
        <legend className="visually-hidden">Background hue</legend>
        <div className="swatches">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`swatch swatch--ground${
                Math.abs(swatch - showingGround) < 15 ? ' swatch--chosen' : ''
              }`}
              style={{ '--swatch-hue': swatch } as React.CSSProperties}
              aria-label={`Background hue ${swatch} degrees`}
              aria-pressed={Math.abs(swatch - showingGround) < 15}
              onClick={() => chooseGround(swatch)}
            />
          ))}
        </div>

        <label className="field__label field__label--inline" htmlFor="ground-hue">
          Fine tune
        </label>
        <input
          id="ground-hue"
          className="slider"
          type="range"
          min={0}
          max={359}
          step={1}
          value={showingGround}
          onChange={(event) => chooseGround(Number(event.target.value))}
        />
      </fieldset>

      <button
        type="button"
        className="button button--ghost button--small"
        onClick={() => chooseGround(DEFAULT_GROUND_HUE)}
      >
        Back to the original ink
      </button>

      <hr className="rule" />

      <h2 className="card__subtitle">Background picture</h2>
      <p className="card__body">
        A picture of your own behind the app. It sits under the cards rather than under the
        writing — and the header, the tabs and the cards all carry their own surface — so nothing
        gets harder to read whatever you choose. The dimming is only how much picture you want.
      </p>

      <div className="field">
        <label className="button button--ghost button--block" htmlFor="background-file">
          {busy ? 'Preparing…' : image ? 'Choose another picture' : 'Choose a picture'}
        </label>
        <input
          id="background-file"
          className="visually-hidden"
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(event) => void pick(event.target.files?.[0] ?? null)}
        />
      </div>

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      {image ? (
        <>
          <fieldset className="field">
            <label className="field__label field__label--inline" htmlFor="background-dim">
              Dimming
            </label>
            <input
              id="background-dim"
              className="slider"
              type="range"
              min={MIN_DIM}
              max={96}
              step={1}
              value={dim}
              onChange={(event) => dimTo(Number(event.target.value))}
            />
          </fieldset>

          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => {
              applyBackground(null);
              setImage(null);
              void clearBackground(user.uid).catch((caught: unknown) => {
                console.error('[firestore] Removing the background failed.', caught);
              });
            }}
          >
            Remove the picture
          </button>
        </>
      ) : null}
    </section>
  );
}
