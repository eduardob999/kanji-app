import { useState } from 'react';
import type { User } from 'firebase/auth';
import { countSeeds, toBuckets, type LegacySeedFile } from '../domain/legacySeed';
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
 * The copy is honest about how little is being imported, because the number is
 * surprising: 1,117 items out of ~16,700 scores. Someone expecting years of
 * progress to arrive should know before they press it that most of that file
 * was the JLPT level written down again.
 */

type Status = 'idle' | 'working' | 'done' | 'error';

function seedUrl(): string {
  return new URL(
    'legacy-seed.json',
    new URL(import.meta.env.BASE_URL, window.location.href),
  ).toString();
}

export function LegacyImport({ user, onDone }: { user: User; onDone?: () => void }) {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setStatus('working');
    setMessage(null);

    try {
      const response = await fetch(seedUrl());
      if (!response.ok) {
        throw new Error(`Could not read the seed file (${response.status}).`);
      }

      const file = (await response.json()) as LegacySeedFile;
      const buckets = toBuckets(file, new Date());
      const seeded = countSeeds(buckets);

      // Awaited, unlike every other write in this app. This one is a deliberate
      // administrative action with a result to report, not something happening
      // behind a question — and the flag must not be set before the data lands.
      await seedReviewBuckets(user.uid, buckets);
      await markLegacyScoresImported(user.uid);

      setStatus('done');
      setMessage(`${seeded} items imported, spread over the next two weeks.`);
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

  return (
    <div className="field">
      <p className="card__body">
        Bring across what the old command-line app knew. Of its ~16,700 stored scores, about 1,100
        are a real record of answering something correctly — the rest were its way of writing down
        a word’s JLPT level, and are not evidence of anything.
      </p>
      <p className="card__hint">
        Those 1,100 start with a small amount of remembered strength and come due over the next
        fortnight. Everything else starts unseen, in level order. Nothing is invented for words you
        were never tested on.
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
        disabled={status === 'working'}
      >
        {status === 'working' ? 'Importing…' : 'Import my old scores'}
      </button>
    </div>
  );
}
