import { deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, type Unsubscribe } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * The learner's own background image, at `/users/{uid}/settings/background`.
 *
 * Its own document, deliberately, and not a field on the profile. The profile
 * is read on every launch by every screen that wants a setting; a background is
 * read once by one rule and weighs three hundred times what the rest of that
 * document does. Keeping it apart means the accent colour does not arrive
 * behind half a megabyte of JPEG.
 *
 * A subcollection rather than a bucket because there is no Storage in this
 * project and adding one would mean rules, a second SDK, a second offline
 * story and a second thing to be signed in to. Firestore already syncs, already
 * caches offline, and already has the security rules that say a user owns
 * `/users/{uid}/**`. The cost is the 1 MB document ceiling, which
 * `domain/image.ts` stays under by measuring.
 */

const SETTINGS = 'settings';
const BACKGROUND = 'background';

function backgroundDoc(uid: string) {
  return doc(db, 'users', uid, SETTINGS, BACKGROUND);
}

export interface StoredBackground {
  /** A JPEG data URL, or null when there is none. */
  image: string | null;
}

export function subscribeBackground(
  uid: string,
  onChange: (background: StoredBackground) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    backgroundDoc(uid),
    (snapshot) => {
      const image = snapshot.data()?.['image'];
      onChange({ image: typeof image === 'string' && image.startsWith('data:') ? image : null });
    },
    (error) => {
      console.error('[firestore] Background subscription failed.', error);
      onError?.(error);
    },
  );
}

export async function saveBackground(uid: string, image: string): Promise<void> {
  await setDoc(backgroundDoc(uid), { image, updatedAt: serverTimestamp() });
}

export async function clearBackground(uid: string): Promise<void> {
  await deleteDoc(backgroundDoc(uid));
}
