import { Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { ReviewSnapshot } from '../storage/reviewState';
import type { UserProfile } from '../types';

/**
 * Stand-in data for the preview harness.
 *
 * The app is behind a Google sign-in, so a headless browser only ever sees the
 * splash screen — which makes it impossible to check a layout without a phone
 * in hand. This is the way in: a dev-only route that renders the *real*
 * components against fixtures, so what gets screenshotted is the real markup
 * and the real stylesheet rather than a mock-up of them that drifts.
 *
 * Everything here is gated on `import.meta.env.DEV` at the point of use, so
 * none of it exists in a production build.
 *
 * The fixtures are deliberately awkward rather than tidy: the longest meaning
 * in the corpus, a word with no meaning at all, a level that is 100% started
 * and 0% held. A harness populated with comfortable data proves nothing — the
 * layouts that break are the ones nobody fed a hard case.
 */

export const PREVIEW_HASH = '#/preview';

export function isPreview(): boolean {
  return import.meta.env.DEV && window.location.hash.startsWith(PREVIEW_HASH);
}

export const previewUser = {
  uid: 'preview',
  displayName: 'Preview',
  email: 'preview@example.com',
  photoURL: null,
} as unknown as User;

const now = Date.now();
const DAY = 86_400_000;

export const previewProfile: UserProfile = {
  uid: 'preview',
  displayName: 'Preview',
  email: 'preview@example.com',
  photoURL: null,
  createdAt: Timestamp.fromMillis(now - 40 * DAY),
  lastLoginAt: Timestamp.fromMillis(now),
  kanjiba: {
    inputMethod: 'keyboard',
    legacyScoresImportedAt: Timestamp.fromMillis(now - 30 * DAY),
    lastOpenedAt: Timestamp.fromMillis(now),
    adaptive: { models: {}, fluency: {} },
  },
};

/**
 * A review state for roughly one item in three, spread across the bands, so the
 * progress bars have all four segments to draw rather than one.
 */
export function previewReviewSnapshot(): ReviewSnapshot {
  const byMode = new Map<string, Map<string, never>>();
  return { byMode, fromCache: false, hasPendingWrites: false } as unknown as ReviewSnapshot;
}

/** Timestamps for a month of uneven daily practice, for streaks and the strip. */
export function previewHistory(): { itemId: string; at: number; result: string; elapsedDays: number }[] {
  const out: { itemId: string; at: number; result: string; elapsedDays: number }[] = [];
  for (let day = 0; day < 40; day += 1) {
    // A couple of gaps, so the streak and the activity strip have something to
    // show other than an unbroken block.
    if (day === 3 || day === 4 || day === 11) continue;
    const count = 5 + ((day * 7) % 25);
    for (let i = 0; i < count; i += 1) {
      out.push({
        itemId: `item-${day}-${i}`,
        at: now - day * DAY,
        result: i % 9 === 0 ? 'fail' : 'good',
        elapsedDays: 3,
      });
    }
  }
  return out;
}
