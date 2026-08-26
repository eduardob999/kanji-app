import type { Timestamp } from 'firebase/firestore';
import type { InputMethod } from './domain/inputMethod';

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
