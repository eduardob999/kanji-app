import { useState } from 'react';
import type { User } from 'firebase/auth';
import type { Timestamp } from 'firebase/firestore';
import { signOutUser } from '../auth';
import { persistenceStatus } from '../firebase';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useUserProfile } from '../hooks/useUserProfile';
import { SyncBadge } from './SyncBadge';

/**
 * Where your progress is stored, and whether it has landed.
 *
 * Behind a menu rather than under the drills: it answers "did that save?",
 * which is a question you ask occasionally and never mid-question.
 */

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Pending `serverTimestamp()` values read back as null until the server lands. */
function formatTimestamp(value: Timestamp | null | undefined): string {
  if (!value) return 'waiting for the server…';
  return DATE_FORMAT.format(value.toDate());
}

export function AccountPanel({ user }: { user: User }) {
  const online = useOnlineStatus();
  const { profile, fromCache, hasPendingWrites, loading, error } = useUserProfile(user);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOutUser();
    } catch (err) {
      console.error('[auth] Sign-out failed.', err);
      setSigningOut(false);
    }
  }

  return (
    <section className="card">
      <div className="card__header">
        <SyncBadge online={online} fromCache={fromCache} hasPendingWrites={hasPendingWrites} />
      </div>

      <p className="card__body">
        Signed in as {user.email}. Your review history is stored under your account, so a second
        device is never a second account.
      </p>

      {error ? (
        <p className="notice notice--error" role="alert">
          Could not read your profile: {error}
        </p>
      ) : loading ? (
        <p className="card__body">Loading your profile…</p>
      ) : profile ? (
        <dl className="datalist">
          <div className="datalist__row">
            <dt>Account created</dt>
            <dd>{formatTimestamp(profile.createdAt)}</dd>
          </div>
          <div className="datalist__row">
            <dt>Last sign-in</dt>
            <dd>{formatTimestamp(profile.lastLoginAt)}</dd>
          </div>
          <div className="datalist__row">
            <dt>Old CLI scores imported</dt>
            <dd>
              {profile.legacyScoresImportedAt
                ? formatTimestamp(profile.legacyScoresImportedAt)
                : 'not yet'}
            </dd>
          </div>
          <div className="datalist__row">
            <dt>Local cache</dt>
            <dd>
              {persistenceStatus === 'persistent'
                ? 'IndexedDB, shared across tabs'
                : 'in-memory only'}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="card__body">
          No profile document yet. It is created on your first sign-in — if this persists, check
          your Firestore security rules.
        </p>
      )}

      <button
        type="button"
        className="button button--ghost"
        onClick={() => void handleSignOut()}
        disabled={signingOut}
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </section>
  );
}
