interface SyncBadgeProps {
  online: boolean;
  fromCache: boolean;
  hasPendingWrites: boolean;
}

/**
 * The honest answer to "is my practice saved?".
 *
 * Pending writes win over everything else: they are the case where the user has
 * done something the server has not seen yet.
 */
export function SyncBadge({ online, fromCache, hasPendingWrites }: SyncBadgeProps) {
  if (hasPendingWrites) {
    return (
      <span className="badge badge--pending">
        <span className="badge__dot" aria-hidden="true" />
        Saved locally, syncing…
      </span>
    );
  }

  if (fromCache) {
    return (
      <span className="badge badge--cache">
        <span className="badge__dot" aria-hidden="true" />
        {online ? 'From cache' : 'Offline — from cache'}
      </span>
    );
  }

  return (
    <span className="badge badge--synced">
      <span className="badge__dot" aria-hidden="true" />
      Synced
    </span>
  );
}
