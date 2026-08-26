import { useEffect, useState } from 'react';

/**
 * The browser's view of connectivity.
 *
 * `navigator.onLine` only knows whether a network interface exists, not whether
 * Firestore can actually reach Google — so this drives cosmetics only. The
 * authoritative "are we synced" signal is `fromCache` on a Firestore snapshot.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
