/**
 * Template for src/firebaseConfig.ts (which is gitignored).
 *
 * `npm run dev` / `npm run build` copy this file to src/firebaseConfig.ts the
 * first time they run, so you never have to do it by hand. Fill in the copy,
 * not this template.
 *
 * There are two ways to supply the values, and you only need one:
 *
 *   1. Environment variables — put VITE_FIREBASE_* in a .env.local file (see
 *      .env.example). This is what the GitHub Pages workflow uses, since it can
 *      read them from repository secrets.
 *   2. Hard-coded literals — replace the "YOUR_..." fallbacks below.
 *
 * These values are not secrets. Firebase web config is public by design and
 * ships inside every client bundle; what actually protects your data is the
 * Firestore security rules in firestore.rules, which scope every document to
 * the signed-in user's uid.
 *
 * Find these values in the Firebase console under
 * Project settings -> General -> Your apps -> Web app -> SDK setup.
 */

const env = import.meta.env;

/**
 * Reads an environment variable, treating blank as absent.
 *
 * `??` is not enough here. GitHub Actions substitutes an **empty string** for a
 * secret that does not exist, so `env.VITE_FIREBASE_API_KEY ?? 'YOUR_API_KEY'`
 * happily yields `''` in CI. Firebase then rejects that at import time with
 * `auth/invalid-api-key`, which throws before React mounts and leaves a blank
 * white page instead of the setup card below.
 */
function envOr(value: string | undefined, fallback: string): string {
  return value !== undefined && value.trim() !== '' ? value : fallback;
}

export const firebaseConfig = {
  apiKey: envOr(env.VITE_FIREBASE_API_KEY, 'YOUR_API_KEY'),
  authDomain: envOr(env.VITE_FIREBASE_AUTH_DOMAIN, 'YOUR_PROJECT.firebaseapp.com'),
  projectId: envOr(env.VITE_FIREBASE_PROJECT_ID, 'YOUR_PROJECT_ID'),
  storageBucket: envOr(env.VITE_FIREBASE_STORAGE_BUCKET, 'YOUR_PROJECT.appspot.com'),
  messagingSenderId: envOr(env.VITE_FIREBASE_MESSAGING_SENDER_ID, 'YOUR_SENDER_ID'),
  appId: envOr(env.VITE_FIREBASE_APP_ID, 'YOUR_APP_ID'),
};

/**
 * Lets the UI show a "finish your Firebase setup" card instead of letting the
 * SDK throw an opaque `auth/invalid-api-key` at first sign-in.
 *
 * The emptiness check matters as much as the placeholder one: a blank key is
 * "not configured" too, and must not be mistaken for a real one.
 */
export const isFirebaseConfigured =
  firebaseConfig.apiKey.trim() !== '' && !firebaseConfig.apiKey.startsWith('YOUR_');
