/**
 * The app's mark.
 *
 * Renders the icon itself rather than a hand-drawn approximation of it. An
 * earlier version drew 十 out of SVG rectangles, which was the right answer
 * when there was no artwork and the wrong one now: a brushed 漢 cannot be
 * reproduced with rectangles, and a mark that merely resembles the icon is a
 * mark that drifts from it.
 *
 * The file is already precached as part of the PWA icon set, so this costs
 * nothing extra and is available offline.
 */
// Resolved against Vite's build-time base, which is the Pages sub-path — the
// same two-step the deck and sentence loaders use.
const SRC = new URL(
  'icons/icon-192.png',
  new URL(import.meta.env.BASE_URL, window.location.href),
).toString();

export function AppMark({ size = 56 }: { size?: number }) {
  return (
    <img
      className="app-mark"
      src={SRC}
      width={size}
      height={size}
      alt="Kanjiba"
      // Decorative wherever it sits beside the app's name; the alt text carries
      // it where it stands alone.
      draggable={false}
    />
  );
}
