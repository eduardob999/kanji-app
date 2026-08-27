import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { countSeeds, intakeDaysFor, toBuckets, type LegacySeedFile } from '../domain/legacySeed';
import { markLegacyScoresImported } from '../storage/userState';
import { seedReviewBuckets } from '../storage/reviewState';

/**
 * The one-time import of the CLI's scores.
 *
 * Offered rather than done automatically, and offered *once*: the flag is
 * written only after the buckets land, so a failure half-way through leaves it
 * unset and the import offerable again. Re-running is safe; skipping a
 * half-finished one is not.
 *
 * The counts in the copy are read from the seed file rather than written into
 * it. They were hardcoded once, against a 1,117-item export that was later
 * replaced by one holding 6,328, and the screen went on quoting the old figure
 * — which is exactly the number someone uses to decide whether this is worth
 * pressing.
 */

type Status = 'idle' | 'loading' | 'working' | 'done' | 'error';

/** Roughly how many will come due per day, from the same rule `toBuckets` uses. */
function perDay(count: number): number {
  return Math.max(1, Math.round(count / intakeDaysFor(count)));
}

function seedUrl(): string {
  return new URL(
    'legacy-seed.json',
    new URL(import.meta.env.BASE_URL, window.location.href),
  ).toString();
}

export function LegacyImport({ user, onDone }: { user: User; onDone?: () => void }) {
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [seed, setSeed] = useState<LegacySeedFile | null>(null);

  // Fetched up front so the offer can state what it would actually do.
  useEffect(() => {
    let live = true;

    fetch(seedUrl())
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('missing'))))
      .then((file: LegacySeedFile) => {
        if (!live) return;
        setSeed(file);
        setStatus('idle');
      })
      .catch(() => {
        if (!live) return;
        setStatus('error');
        setMessage('Could not read the exported scores.');
      });

    return () => {
      live = false;
    };
  }, []);

  async function run() {
    setStatus('working');
    setMessage(null);

    try {
      const file = seed ?? ((await (await fetch(seedUrl())).json()) as LegacySeedFile);
      const buckets = toBuckets(file, new Date());
      const seeded = countSeeds(buckets);

      // Awaited, unlike every other write in this app. This one is a deliberate
      // administrative action with a result to report, not something happening
      // behind a question — and the flag must not be set before the data lands.
      await seedReviewBuckets(user.uid, buckets);
      await markLegacyScoresImported(user.uid);

      setStatus('done');
      setMessage(
        `${seeded.toLocaleString()} items imported, coming due at about ${perDay(seeded)} a day.`,
      );
      onDone?.();
    } catch (error) {
      console.error('[migrate] Legacy score import failed.', error);
      setStatus('error');
      setMessage(
        error instanceof Error ? error.message : 'The import failed. Nothing was changed.',
      );
    }
  }

  if (status === 'done') {
    return (
      <p className="notice notice--ok" role="status">
        {message}
      </p>
    );
  }

  const count = seed?.entries.length ?? 0;

  return (
    <div className="field">
      <p className="card__body">
        Bring across what the old command-line app knew.{' '}
        {count > 0 ? (
          <>
            <strong>{count.toLocaleString()} items</strong> in its records were answered correctly
            at least once — the rest of that file was its way of writing down a word’s JLPT level,
            which is not evidence of anything.
          </>
        ) : (
          'Reading the export…'
        )}
      </p>
      <p className="card__hint">
        They start with a small amount of remembered strength and come back for checking at about{' '}
        {count > 0 ? perDay(count) : '—'} a day, weakest evidence first. Everything else starts
        unseen, in level order. Nothing is invented for words you were never tested on, and the
        first real answer replaces the guess with something measured.
      </p>

      {status === 'error' ? (
        <p className="notice notice--error" role="alert">
          {message}
        </p>
      ) : null}

      <button
        type="button"
        className="button button--primary button--block"
        onClick={() => void run()}
        disabled={status === 'working' || status === 'loading' || count === 0}
      >
        {status === 'working' ? 'Importing…' : 'Import my old scores'}
      </button>
    </div>
  );
}
