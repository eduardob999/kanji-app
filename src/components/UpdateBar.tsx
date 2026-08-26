import { useEffect, useState } from 'react';
import { onServiceWorkerUpdate } from '../pwa/registerServiceWorker';

/**
 * "A new version is ready."
 *
 * Sits at the app root rather than inside the signed-in shell: a new build is
 * worth offering whoever is looking at the page, and the sign-in screen is
 * exactly where someone might sit on a stale bundle for weeks.
 *
 * Dismissible, and that means it. Someone three activities into a session
 * should be able to say "later" and have nothing happen — the update is still
 * waiting on the next launch, which is the whole reason it no longer takes
 * control on its own.
 */
export function UpdateBar() {
  const [apply, setApply] = useState<(() => void) | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => onServiceWorkerUpdate((run) => setApply(() => run)), []);

  if (!apply || dismissed) return null;

  return (
    <div className="updatebar" role="status" data-testid="update-bar">
      <span className="updatebar__text">A new version is ready.</span>
      <div className="updatebar__actions">
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => setDismissed(true)}
        >
          Later
        </button>
        <button
          type="button"
          className="button button--primary button--small"
          onClick={apply}
          data-testid="update-apply"
        >
          Update
        </button>
      </div>
    </div>
  );
}
