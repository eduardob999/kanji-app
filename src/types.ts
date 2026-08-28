import type { Timestamp } from 'firebase/firestore';
import type { InputMethod } from './domain/inputMethod';
import type { AdaptiveModel } from './storage/modelState';

/**
 * The document stored at /users/{uid}.
 *
 * **This document is shared with GHAPP**, which runs in the same Firebase
 * project — see `src/storage/userState.ts` for why that is deliberate. The
 * top-level fields here are identity, and mean the same thing to both apps.
 * Anything specific to this app lives under `kanjiba`, so neither app can
 * surprise the other by adding a field.
 *
 * Timestamp fields are nullable because Firestore writes `serverTimestamp()` as
 * null in the local cache until the server confirms the real value. Offline,
 * that null can stick around for a while — render accordingly.
 */
export interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  createdAt: Timestamp | null;
  /**
   * Last sign-in to *either* app, since both write it on the shared document.
   * `kanjiba.lastOpenedAt` is the one that means "last opened Kanjiba".
   */
  lastLoginAt: Timestamp | null;
  kanjiba: KanjibaProfile;
}

/** Everything under `/users/{uid}.kanjiba` — this app's own corner. */
export interface KanjibaProfile {
  /**
   * How this person answers: IME keyboard, handwriting, or multiple choice.
   *
   * Stored per user rather than per device. Someone who writes kanji by hand
   * does so on their tablet too, and a device-local setting would quietly make
   * the second device a second account's worth of preferences.
   */
  inputMethod?: InputMethod;
  /**
   * Set once the one-time import of the old CLI's scores has run, so it cannot
   * run twice and overwrite real reviews with seeded ones.
   */
  legacyScoresImportedAt?: Timestamp | null;
  lastOpenedAt?: Timestamp | null;
  /**
   * What the app has worked out about this learner: fitted FSRS weights per
   * review mode, and their own response-time thresholds. Both are derived from
   * the review log and both fall back to published defaults — see
   * `src/storage/modelState.ts`.
   */
  adaptive: AdaptiveModel;
  /**
   * How much new material a session may introduce, earned rather than measured.
   *
   * See `nextAppetite` in `src/domain/pacing.ts` for why this cannot simply be
   * derived from how many reviews the learner does. Absent until the first
   * session ends, which the pacing model reads as the default.
   */
  appetite?: number;
  /**
   * The session in progress, or the last one, whichever is more recent.
   *
   * Written when a session starts and updated when it ends. A record still
   * marked unfinished when the *next* session begins is how abandonment is
   * detected — no `beforeunload`, no visibility hooks, and it survives the tab
   * simply being closed.
   */
  session?: SessionRecord | null;
}

export interface SessionRecord {
  startedAt: Timestamp | null;
  /** Questions the planner put in the queue. */
  offered: number;
  answered: number;
  right: number;
  finished: boolean;
}

/**
 * Where a snapshot came from, so the UI can be honest about it.
 *
 * `cache` means Firestore answered from IndexedDB without reaching the server —
 * either you are offline, or the server round-trip has not landed yet.
 */
export interface ProfileSnapshot {
  profile: UserProfile | null;
  fromCache: boolean;
  hasPendingWrites: boolean;
}
