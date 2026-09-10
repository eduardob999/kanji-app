import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { isPreview } from '../preview/fixtures';
import { subscribeBackground } from '../storage/background';

/**
 * Puts the learner's own picture behind the app.
 *
 * Two custom properties and an attribute: the image itself, how strongly it is
 * dimmed, and a flag saying there is one — the flag being what lets the
 * stylesheet keep its ordinary ground colour when there is not, rather than
 * painting a transparent layer over nothing.
 *
 * **Nothing readable ever sits on the photograph.** Text in this app lives on
 * cards, and cards are opaque; what the image is behind is the space around
 * them. That is not a promise about taste, it is the reason a background cannot
 * break contrast — see `styles.css` for the scrim and the floor under how far
 * it can be turned down.
 */
/**
 * Shows an image immediately, before it has been stored.
 *
 * Same reason as `applyAccent`: the write is not awaited, and a background that
 * appears a beat after you choose it feels like it did not work. Also the only
 * way the preview harness — which has no Firestore — can show one at all, which
 * is what lets the audit prove the scrim keeps text readable.
 */
export function applyBackground(image: string | null): void {
  const root = document.documentElement;

  if (image) {
    root.style.setProperty('--app-image', `url("${image}")`);
    root.dataset.background = 'on';
  } else {
    root.style.removeProperty('--app-image');
    delete root.dataset.background;
  }
}

export function useBackground(user: User, dim: number | undefined): void {
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    // The preview harness has no Firestore; a background there comes from the
    // audit driving the panel, not from a subscription.
    if (import.meta.env.DEV && isPreview()) return;

    return subscribeBackground(user.uid, ({ image: stored }) => setImage(stored));
  }, [user.uid]);

  useEffect(() => {
    applyBackground(image);
  }, [image]);

  useEffect(() => {
    document.documentElement.style.setProperty('--app-dim', String(dim ?? 85));
  }, [dim]);
}
