import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { countSeeds, intakeDaysFor, toBuckets, type LegacySeedFile } from '../domain/legacySeed';
import { markLegacyScoresImported } from '../storage/userState';
import { seedReviewBuckets } from '../storage/reviewState';
import { useReviewStates } from '../hooks/useReviewStates';
import { describeFailure } from '../domain/failure';

/**
 * Importing the CLI's scores.
 *
 * **Gap-filling, not overwriting.** Any item that already has review state is
 * skipped, so this can be run again safely and only ever adds what is missing.
 * That is not a nicety: the first version wrote every seeded item
 * unconditionally, which would have discarded real reviews on a second run —
 * and a second run turned out to be necessary the moment a fuller export
 * appeared. It also means the offer can stay visible while anything is left,
 * rather than vanishing behind a one-time flag that might have been set against
 * a stale file.
 *
 * Offered rather than done automatically. The flag is still written when it
 * finishes, but it now records "this has been done" rather than gating whether
 * it may be done again.
 *
 * The counts in the copy are read from the seed file rather than written into
 * it. They were hardcoded once, against a 1,117-item export that was later
 * replaced by one holding 6,328, and the screen went on quoting the old figure
 * — which is exactly the number someone uses to decide whether this is worth
 * pressing.
 */

type Status = 'idle' | 'loading' | 'working' | 'done' | 'error';

/**
 * How long to wait for the server before saying so.
 *
 * Not a failure when it expires — the writes are in the local cache and queued.
 * It is the difference between "imported" and "imported, and syncing".
 */
const SERVER_WAIT_MS = 10_000;

/** Roughly how many will come due per day, from the same rule `toBuckets` uses. */
function perDay(count: number): number {
  return Math.max(1, Math.round(count / intakeDaysFor(count)));
}

/**
 * How long the intake runs, in words.
 *
 * "About 25 a day" is only half the sentence, and the missing half is the one
 * that would surprise someone: 6,326 items at 25 a day is **eight months**
 * before the last of them comes round. That is the right pace — they are items
 * you already knew, and a wall of six thousand on day one would be neither
 * useful nor survivable — but it should be said rather than discovered.
 */
function overHowLong(days: number): string {
  if (days <= 1) return 'today';
  if (days < 14) return `over the next ${Math.round(days)} days`;
  if (days < 60) return `over the next ${Math.round(days / 7)} weeks`;
  return `over the next ${Math.round(days / 30)} months`;
}

function seedUrl(): string {
  return new URL(
    'legacy-seed.json',
    new URL(import.meta.env.BASE_URL, window.location.href),
  ).toString();
}

export function LegacyImport({ user, onDone }: { user: User; onDone?: () => void }) {
  const { lookup, loading: statesLoading } = useReviewStates(user);
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
      // Only what is still missing. An item you have actually answered holds a
      // measurement; a seed value is a guess, and a guess must never replace a
      // measurement.
      const pending = { ...file, entries: file.entries.filter((e) => !lookup(e.m, e.i)) };
      const buckets = toBuckets(pending, new Date());
      const seeded = countSeeds(buckets);

      /*
       * Awaited, unlike every other write in this app: a deliberate
       * administrative action with a result to report, not something happening
       * behind a question.
       *
       * But not awaited *forever*. Offline, Firestore applies a write to the
       * local cache at once and leaves the promise pending until a server
       * acknowledges — possibly for hours — so an import run on a train sat on
       * "Bringing them across…" with the work already done. The data is in the
       * cache either way and the header's badge reports the rest; what this
       * must not do is hang or, worse, report a failure that did not happen.
       */
      const landed = await Promise.race([
        seedReviewBuckets(user.uid, buckets).then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SERVER_WAIT_MS)),
      ]);

      // The flag records that this has been done, and it has: the batch is in
      // the local queue in front of this write, and Firestore preserves that
      // order on reconnect.
      void markLegacyScoresImported(user.uid);

      setStatus('done');
      const pace = `coming due at about ${perDay(seeded)} a day, ${overHowLong(intakeDaysFor(seeded))}`;
      setMessage(
        landed
          ? `${seeded.toLocaleString()} items imported, ${pace}.`
          : `${seeded.toLocaleString()} items imported and saved on this device, ${pace}. They will reach the server when you are back online.`,
      );
      onDone?.();
    } catch (error) {
      console.error('[migrate] Legacy score import failed.', error);
      setStatus('error');
      setMessage(
        describeFailure(
          error,
          'The import did not finish. It is written as one batch, so nothing was half-applied, and running it again is safe — it only ever fills in what is missing.',
        ),
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

  // Recomputed against live state, so the number shrinks as items are answered
  // and reaches zero when there is nothing left to bring across.
  const remaining = seed ? seed.entries.filter((e) => !lookup(e.m, e.i)) : [];
  const count = remaining.length;
  const alreadyHave = (seed?.entries.length ?? 0) - count;

  // Nothing left to do, and nothing worth saying about it.
  if (status === 'idle' && !statesLoading && seed && count === 0) return null;

  return (
    <div className="field">
      <p className="card__body">
        Bring across what the old command-line app knew.{' '}
        {count > 0 ? (
          <>
            <strong>{count.toLocaleString()} items</strong> from its records are not here yet.
            {alreadyHave > 0
              ? ` ${alreadyHave.toLocaleString()} already are, and will be left exactly as they are.`
              : ' The rest of that file was its way of writing down a word’s JLPT level, which is not evidence of anything.'}
          </>
        ) : (
          'Reading the export…'
        )}
      </p>
      <p className="card__hint">
        They start with a small amount of remembered strength and come back for checking at about{' '}
        {count > 0 ? perDay(count) : '—'} a day{count > 0 ? `, ${overHowLong(intakeDaysFor(count))}` : ''},
        weakest evidence first. Everything else starts unseen, in level order. Nothing is invented
        for words you were never tested on, and the first real answer replaces the guess with
        something measured.
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
