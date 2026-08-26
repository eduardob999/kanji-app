/**
 * The app's mark: 十 in a writing frame, matching public/icons.
 *
 * Drawn as rectangles rather than set as text. A CJK glyph in an SVG `<text>`
 * depends on the viewer having a Japanese font installed and falls back to a
 * tofu box when they do not — which is precisely the audience most likely to be
 * setting one up for the first time.
 */
export function AppMark({ size = 56 }: { size?: number }) {
  return (
    <svg
      className="app-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Kanjiba"
    >
      <rect width="64" height="64" rx="14" fill="#12131f" />
      <rect x="10" y="10" width="44" height="44" fill="none" stroke="#3a3e60" strokeWidth="2.6" />
      {/* The horizontal sits above the midpoint; centre it and this is a plus sign. */}
      <rect x="16.6" y="27.4" width="30.8" height="5.2" fill="#5b6ee1" />
      <rect x="29.4" y="13.9" width="5.2" height="36.2" fill="#5b6ee1" />
    </svg>
  );
}
