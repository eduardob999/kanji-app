import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type DocumentReference,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../firebase';
import { isInputMethod } from '../domain/inputMethod';
import type { InputMethod } from '../domain/inputMethod';
import type { ProfileSnapshot, UserProfile } from '../types';

/**
 * Every read and write of user-scoped data goes through this module. The rest
 * of the app never imports `db` directly, so the collection layout stays in one
 * place — here for the profile, and `reviewState.ts` for /users/{uid}/reviews.
 *
 * A note on awaiting writes: while offline, Firestore applies a write to the
 * local cache immediately but does not settle the returned promise until the
 * server acknowledges it. `await setDoc(...)` therefore hangs — sometimes for
 * hours — with no error. Treat these promises as "confirmed by the server",
 * never as "the write happened", and let onSnapshot drive the UI instead.
 */

const USERS_COLLECTION = 'users';

function userDoc(uid: string): DocumentReference<DocumentData> {
  return doc(db, USERS_COLLECTION, uid);
}

function toUserProfile(uid: string, data: DocumentData | undefined): UserProfile | null {
  if (!data) return null;

  return {
    uid,
    displayName: data['displayName'] ?? null,
    email: data['email'] ?? null,
    photoURL: data['photoURL'] ?? null,
    createdAt: data['createdAt'] ?? null,
    lastLoginAt: data['lastLoginAt'] ?? null,
    ...(isInputMethod(data['inputMethod']) ? { inputMethod: data['inputMethod'] } : {}),
    legacyScoresImportedAt: data['legacyScoresImportedAt'] ?? null,
  };
}

/**
 * Creates or refreshes /users/{uid} at sign-in. Idempotent: safe to call on
 * every auth state change.
 *
 * `createdAt` is only written when we can confirm it is missing. If the profile
 * cannot be read at all (offline with a cold cache) we skip it rather than risk
 * overwriting a real creation date with today's — a later online sign-in will
 * fill it in.
 */
export async function ensureUserProfile(user: User): Promise<void> {
  let existing: DocumentData | undefined;
  let couldRead = true;

  try {
    const snapshot = await getDoc(userDoc(user.uid));
    existing = snapshot.data();
  } catch {
    couldRead = false;
  }

  const isNewProfile = couldRead && existing === undefined;
  const missingCreatedAt = couldRead && existing !== undefined && !existing['createdAt'];

  await setDoc(
    userDoc(user.uid),
    {
      uid: user.uid,
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
      lastLoginAt: serverTimestamp(),
      ...(isNewProfile ? { createdAt: serverTimestamp() } : {}),
      ...(missingCreatedAt ? { createdAt: serverTimestamp() } : {}),
    },
    { merge: true },
  );
}

/**
 * Reads /users/{uid} once. Offline this resolves from the IndexedDB cache; it
 * only rejects when the document has never been cached and there is no network.
 */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await getDoc(userDoc(uid));
  return toUserProfile(uid, snapshot.data());
}

/** Merges a partial update into /users/{uid}. */
export async function updateUserProfile(uid: string, patch: Partial<UserProfile>): Promise<void> {
  // uid is the document key and createdAt is write-once; neither is patchable.
  const { uid: _uid, createdAt: _createdAt, ...writable } = patch;
  await setDoc(userDoc(uid), writable, { merge: true });
}

/**
 * Live subscription to /users/{uid}.
 *
 * `includeMetadataChanges` makes Firestore re-emit when only the metadata moves
 * — cache to server, pending write to committed — which is what lets the
 * dashboard show sync state truthfully.
 */
export function subscribeToUserProfile(
  uid: string,
  onChange: (snapshot: ProfileSnapshot) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    userDoc(uid),
    { includeMetadataChanges: true },
    (snapshot) => {
      onChange({
        profile: toUserProfile(uid, snapshot.data()),
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
    },
    (error) => {
      console.error('[firestore] Subscription to the user profile failed.', error);
      onError?.(error);
    },
  );
}

/**
 * Sets how this person answers.
 *
 * Not awaited by callers, like every other write here: the local cache — and so
 * the input on screen — switches immediately.
 */
export async function setInputMethod(uid: string, inputMethod: InputMethod): Promise<void> {
  await setDoc(userDoc(uid), { inputMethod }, { merge: true });
}

/**
 * Stamps the one-time import of the old CLI's scores as done.
 *
 * Written *after* the review buckets, so a failure part-way through leaves the
 * flag unset and the import offerable again. Re-running it is safe; skipping a
 * half-finished one is not.
 */
export async function markLegacyScoresImported(uid: string): Promise<void> {
  await setDoc(userDoc(uid), { legacyScoresImportedAt: serverTimestamp() }, { merge: true });
}
