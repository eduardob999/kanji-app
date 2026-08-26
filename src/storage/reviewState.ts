import {
  Timestamp,
  collection,
  deleteField,
  getDocsFromCache,
  onSnapshot,
  serverTimestamp,
  setDoc,
  doc,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import { scheduleNext } from '../domain/scheduler';
import { bucketId, parseBucketId, type ReviewMode } from '../domain/modes';
import type { Level } from '../domain/items';
import type { ItemReviewState, PracticeResult } from '../domain/review';

/**
 * Review state, at `/users/{uid}/reviews/{mode}:{level}`.
 *
 * **This is the one place the app departs from GHAPP's data model, and the
 * reason is scale.** GHAPP stores one document per skill and subscribes to the
 * collection; it has 41 skills. This app has 9,445 items across three review
 * modes. One document each would mean up to ~19,000 document reads on a cold
 * start, an IndexedDB cache to match, and a first paint that waits for all of
 * it — to carry six numbers per item.
 *
 * So state is bucketed: one document per review mode per level, 24 in all, each
 * holding a map of item id to a compact record. A cold start is 24 reads.
 *
 * Three things make this safe rather than merely small:
 *
 * - **Size.** The largest bucket is vocab-writing at N3: 1,548 items at roughly
 *   100 bytes each, so ~170 kB against Firestore's 1 MB document limit. Five
 *   times the headroom, and the corpus is fixed.
 * - **Concurrent writes.** `setDoc(..., { merge: true })` deep-merges nested
 *   maps, so two devices grading *different* items in the same bucket both
 *   land. Only the same item on two devices at once is last-write-wins, and
 *   that is the correct answer anyway.
 * - **Rules.** `firestore.rules` already scopes `/users/{uid}/{document=**}` to
 *   its owner, so subcollections needed no rules change.
 *
 * Everything outside this module sees `ItemReviewState` and never learns that
 * items share a document.
 */

const USERS_COLLECTION = 'users';
const REVIEWS_SUBCOLLECTION = 'reviews';

/**
 * The stored form. Short keys because they repeat once per item, and 9,445
 * copies of "stability" is a quarter of the document budget spent on the word.
 */
interface CompactReview {
  /** Stability, in days. */
  s: number;
  /** Difficulty, 1-10. */
  d: number;
  /** Reps, successes and lapses alike. */
  r: number;
  /** Lapses. */
  l: number;
  /** Due at, epoch milliseconds. */
  due: number;
  /** Last reviewed at, epoch milliseconds. */
  last: number;
  /** Interval in days that produced `due`. */
  i: number;
  /** What the model predicted before that rep, 0-1. */
  p: number;
  /** The grade given. */
  g: PracticeResult;
}

const GRADES: readonly PracticeResult[] = ['easy', 'good', 'hard', 'fail'];

function isCompactReview(value: unknown): value is CompactReview {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['s'] === 'number' &&
    typeof v['d'] === 'number' &&
    typeof v['due'] === 'number' &&
    typeof v['last'] === 'number'
  );
}

function toItemReviewState(itemId: string, stored: CompactReview): ItemReviewState {
  const state: ItemReviewState = {
    itemId,
    stability: stored.s,
    difficulty: stored.d,
    totalReps: typeof stored.r === 'number' ? stored.r : 1,
    lapses: typeof stored.l === 'number' ? stored.l : 0,
    dueAt: Timestamp.fromMillis(stored.due),
    lastReviewedAt: Timestamp.fromMillis(stored.last),
  };

  if (typeof stored.i === 'number') state.intervalDays = stored.i;
  if (typeof stored.p === 'number') state.predictedRecall = stored.p;
  if (GRADES.includes(stored.g)) state.lastResult = stored.g;

  return state;
}

function bucketDoc(uid: string, mode: ReviewMode, level: Level) {
  return doc(db, USERS_COLLECTION, uid, REVIEWS_SUBCOLLECTION, bucketId(mode, level));
}

/* --- Reading -------------------------------------------------------------- */

/**
 * Everything known about what has been reviewed.
 *
 * Keyed by mode then item id. Levels do not appear: item ids are unique across
 * the corpus, so which bucket a state arrived in is a storage detail. Writing
 * needs the level (it picks the document) and reading does not.
 */
export interface ReviewSnapshot {
  byMode: Map<ReviewMode, Map<string, ItemReviewState>>;
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export const EMPTY_SNAPSHOT: ReviewSnapshot = {
  byMode: new Map(),
  fromCache: true,
  hasPendingWrites: false,
};

export function lookupReview(
  snapshot: ReviewSnapshot,
  mode: ReviewMode,
  itemId: string,
): ItemReviewState | null {
  return snapshot.byMode.get(mode)?.get(itemId) ?? null;
}

/** Every state recorded for one mode, in no particular order. */
export function reviewsForMode(snapshot: ReviewSnapshot, mode: ReviewMode): ItemReviewState[] {
  return [...(snapshot.byMode.get(mode)?.values() ?? [])];
}

function readBuckets(docs: { id: string; data: () => DocumentData | undefined }[]): ReviewSnapshot['byMode'] {
  const byMode = new Map<ReviewMode, Map<string, ItemReviewState>>();

  for (const snapshot of docs) {
    const parsed = parseBucketId(snapshot.id);
    if (!parsed) {
      console.warn(`[firestore] Ignoring review bucket with an unrecognised id: ${snapshot.id}`);
      continue;
    }

    const items = snapshot.data()?.['items'];
    if (typeof items !== 'object' || items === null) continue;

    let forMode = byMode.get(parsed.mode);
    if (!forMode) {
      forMode = new Map();
      byMode.set(parsed.mode, forMode);
    }

    for (const [itemId, stored] of Object.entries(items as Record<string, unknown>)) {
      if (!isCompactReview(stored)) continue;
      forMode.set(itemId, toItemReviewState(itemId, stored));
    }
  }

  return byMode;
}

/**
 * Live subscription to every review bucket.
 *
 * **Cache-first, deliberately** — the same trap GHAPP documents in
 * `skillsState.ts`. `onSnapshot` on a *cold* cache with no reachable server can
 * wait indefinitely for its first snapshot: there is nothing local to serve and
 * nothing remote to ask. A first-ever launch offline would then sit on "working
 * out what is due…" forever, making a liar of the whole offline-first design.
 * Reading the cache explicitly settles it in milliseconds — with an empty
 * result, which is the correct answer for someone who has never reviewed
 * anything — and the live listener takes over from there.
 */
export function subscribeReviewStates(
  uid: string,
  onChange: (snapshot: ReviewSnapshot) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const reviews = collection(db, USERS_COLLECTION, uid, REVIEWS_SUBCOLLECTION);

  let livePublished = false;

  void getDocsFromCache(reviews)
    .then((cached) => {
      if (livePublished) return;
      onChange({ byMode: readBuckets(cached.docs), fromCache: true, hasPendingWrites: false });
    })
    .catch(() => {
      if (!livePublished) onChange(EMPTY_SNAPSHOT);
    });

  return onSnapshot(
    reviews,
    { includeMetadataChanges: true },
    (snapshot) => {
      livePublished = true;
      onChange({
        byMode: readBuckets(snapshot.docs),
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
    },
    (error) => {
      console.error('[firestore] Review state subscription failed.', error);
      onError?.(error);
    },
  );
}

/* --- Writing -------------------------------------------------------------- */

export interface RecordReviewInput {
  mode: ReviewMode;
  /** Picks the bucket. The caller has it from the item's deck. */
  level: Level;
  itemId: string;
  result: PracticeResult;
  /**
   * The state this grade applies to, from the live subscription. Passing it
   * skips a read entirely, which is what lets the write land immediately while
   * offline.
   */
  current: ItemReviewState | null;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

/**
 * Applies one graded answer and writes the new schedule.
 *
 * **Do not await this for UI purposes.** Offline, Firestore applies the write
 * to the local cache at once but leaves the returned promise pending until the
 * server acknowledges it — potentially for hours. Fire it, catch failures, and
 * let `subscribeReviewStates` drive the interface.
 *
 * Returns what was stored, so an undo can put back exactly what was there.
 */
export async function recordReview(
  uid: string,
  input: RecordReviewInput,
): Promise<ItemReviewState> {
  const now = input.now ?? new Date();
  const current = input.current;

  const update = scheduleNext(
    {
      ...(current?.stability !== undefined ? { stability: current.stability } : {}),
      ...(current?.difficulty !== undefined ? { difficulty: current.difficulty } : {}),
      ...(current?.intervalDays !== undefined ? { intervalDays: current.intervalDays } : {}),
      ...(current?.totalReps !== undefined ? { reps: current.totalReps } : {}),
      ...(current?.lapses !== undefined ? { lapses: current.lapses } : {}),
      lastPracticedAt: current?.lastReviewedAt?.toDate() ?? null,
    },
    input.result,
    now,
  );

  const compact: CompactReview = {
    s: update.stability,
    d: update.difficulty,
    r: update.reps,
    l: update.lapses,
    // Epoch milliseconds rather than a Timestamp: the planner reads `due` back
    // from the cache the instant after this write, and these are plain numbers
    // inside a map — there is no serverTimestamp() to resolve and nothing to
    // read as null.
    due: update.dueAt.getTime(),
    last: now.getTime(),
    i: update.intervalDays,
    p: update.predictedRecall,
    g: input.result,
  };

  await writeBucketEntry(uid, input.mode, input.level, input.itemId, compact);

  return toItemReviewState(input.itemId, compact);
}

function writeBucketEntry(
  uid: string,
  mode: ReviewMode,
  level: Level,
  itemId: string,
  value: CompactReview | ReturnType<typeof deleteField>,
): Promise<void> {
  return setDoc(
    bucketDoc(uid, mode, level),
    {
      // A nested map under `items`, merged rather than replaced: two devices
      // grading different items in this bucket both land.
      items: { [itemId]: value },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export interface UndoReviewInput {
  mode: ReviewMode;
  level: Level;
  itemId: string;
  /** What was there before the grade being undone. Null if it was the first. */
  previous: ItemReviewState | null;
}

/**
 * Puts back the state that existed before the last grade.
 *
 * The CLI had this — `run_quiz_with_undo` in `core/utils.py` — and it was worth
 * keeping. Answering on a phone means fat-fingering the submit button, and
 * without an undo the only way to fix a schedule is to wait for the item to
 * come round again.
 *
 * A first-ever review undoes to *absent*, not to zero: an item with no state is
 * unseen, and one recorded as reviewed-then-reverted would otherwise be
 * scheduled as if it had a memory behind it.
 */
export async function undoReview(uid: string, input: UndoReviewInput): Promise<void> {
  const { previous } = input;

  if (!previous) {
    await writeBucketEntry(uid, input.mode, input.level, input.itemId, deleteField());
    return;
  }

  await writeBucketEntry(uid, input.mode, input.level, input.itemId, {
    s: previous.stability ?? 0,
    d: previous.difficulty ?? 5,
    r: previous.totalReps ?? 1,
    l: previous.lapses ?? 0,
    due: previous.dueAt?.toMillis() ?? Date.now(),
    last: previous.lastReviewedAt?.toMillis() ?? Date.now(),
    i: previous.intervalDays ?? 1,
    p: previous.predictedRecall ?? 1,
    g: previous.lastResult ?? 'good',
  });
}

/**
 * Writes many states at once, for the one-time import of the CLI's scores.
 *
 * Grouped by bucket so the whole import is 24 writes rather than one per item.
 * Each bucket is written whole — this only ever runs against an account with no
 * review history, which the caller checks before offering it.
 */
export async function seedReviewBuckets(
  uid: string,
  seeds: Map<string, Map<string, ItemReviewState>>,
): Promise<void> {
  const writes: Promise<void>[] = [];

  for (const [id, items] of seeds) {
    const parsed = parseBucketId(id);
    if (!parsed) continue;

    const compact: Record<string, CompactReview> = {};
    for (const [itemId, state] of items) {
      compact[itemId] = {
        s: state.stability ?? 0,
        d: state.difficulty ?? 5,
        r: state.totalReps ?? 1,
        l: state.lapses ?? 0,
        due: state.dueAt?.toMillis() ?? Date.now(),
        last: state.lastReviewedAt?.toMillis() ?? Date.now(),
        i: state.intervalDays ?? 1,
        p: state.predictedRecall ?? 1,
        g: state.lastResult ?? 'good',
      };
    }

    writes.push(
      setDoc(
        doc(db, USERS_COLLECTION, uid, REVIEWS_SUBCOLLECTION, id),
        { items: compact, updatedAt: serverTimestamp() },
        { merge: true },
      ),
    );
  }

  await Promise.all(writes);
}
