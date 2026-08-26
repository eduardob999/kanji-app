import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
  documentId,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { InputMethod } from '../domain/inputMethod';
import type { QuizMode, ReviewMode } from '../domain/modes';
import type { PracticeResult } from '../domain/review';
import type { ReviewRecord } from '../domain/optimiser';

/**
 * Every answer, kept.
 *
 * `reviewState.ts` stores where each item stands *now*, which is all the
 * scheduler needs to run. It is not enough to make the scheduler better: fitting
 * the memory model to a person means replaying what actually happened to them,
 * and a current-state document has thrown that away by design.
 *
 * So this is the append-only history the optimiser reads. It is also what the
 * Progress screen's calibration curve is drawn from, and what the response-time
 * thresholds are learnt from.
 *
 * ## Daily documents
 *
 * `/users/{uid}/reviewLog/{YYYY-MM-DD}`, each holding that day's answers.
 *
 * Firestore syncs whole documents, so the bucket size is a direct trade between
 * write cost and read cost. A month per document would mean re-sending up to a
 * megabyte on every answer. A document per answer would mean thousands of reads
 * to fit anything. A day is a few hundred answers — around 25 kB — rewritten as
 * the day goes on, and a year of history is 365 reads for something that runs
 * occasionally.
 *
 * Appends use `arrayUnion`, which merges rather than overwrites, so two devices
 * answering offline on the same day both survive the reconnect.
 */

const USERS_COLLECTION = 'users';
const LOG_SUBCOLLECTION = 'reviewLog';

/** Short keys: this is the collection that grows without limit. */
interface LoggedReview {
  /** Answered at, epoch milliseconds. */
  t: number;
  /** Item id. */
  i: string;
  /** Review mode — the memory being tested. */
  m: ReviewMode;
  /** Quiz mode — how it was asked. */
  q: QuizMode;
  /** Input method used. */
  n: InputMethod;
  /** The grade given. */
  g: PracticeResult;
  /** Days since this item's previous review; 0 for a first rep. */
  e: number;
  /** What the model predicted before this rep, 0-1. */
  p: number;
  /** Time from prompt to submit, milliseconds. */
  r: number;
}

export interface ReviewEvent {
  itemId: string;
  mode: ReviewMode;
  quiz: QuizMode;
  input: InputMethod;
  result: PracticeResult;
  elapsedDays: number;
  predictedRecall: number;
  responseMs: number;
  at?: Date;
}

/** `YYYY-MM-DD` in local time, so a day boundary is the learner's midnight. */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Appends one answer.
 *
 * **Not awaited for UI purposes**, like every other write here: offline this
 * stays pending until the server acknowledges. Losing a log entry costs a
 * slightly worse fit months from now, so a failure is worth reporting and not
 * worth blocking on.
 */
export async function appendReview(uid: string, event: ReviewEvent): Promise<void> {
  const at = event.at ?? new Date();

  const entry: LoggedReview = {
    t: at.getTime(),
    i: event.itemId,
    m: event.mode,
    q: event.quiz,
    n: event.input,
    g: event.result,
    e: Math.round(event.elapsedDays * 1000) / 1000,
    p: Math.round(event.predictedRecall * 1000) / 1000,
    r: Math.round(event.responseMs),
  };

  await setDoc(
    doc(db, USERS_COLLECTION, uid, LOG_SUBCOLLECTION, dayKey(at)),
    // arrayUnion rather than a read-modify-write: two devices answering offline
    // on the same day merge instead of one overwriting the other.
    { entries: arrayUnion(entry) },
    { merge: true },
  );
}

function isLoggedReview(value: unknown): value is LoggedReview {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['t'] === 'number' && typeof v['i'] === 'string' && typeof v['g'] === 'string';
}

export interface HistoryOptions {
  /** How far back to read. Defaults to two years, which is all of it so far. */
  sinceDays?: number;
  /** Only this memory, for fitting weights per mode. */
  mode?: ReviewMode;
}

/**
 * Reads the log back, oldest first.
 *
 * Ranged by document id, which is the date — so this is one query rather than a
 * fetch per day, and Firestore serves it from the local cache when offline
 * without any special handling.
 */
export async function loadReviewHistory(
  uid: string,
  options: HistoryOptions = {},
): Promise<ReviewRecord[]> {
  const sinceDays = options.sinceDays ?? 730;
  const from = new Date(Date.now() - sinceDays * 86_400_000);

  const logs = collection(db, USERS_COLLECTION, uid, LOG_SUBCOLLECTION);
  const snapshot = await getDocs(
    query(logs, where(documentId(), '>=', dayKey(from))),
  );

  const records: ReviewRecord[] = [];

  for (const day of snapshot.docs) {
    const entries = (day.data() as DocumentData)['entries'];
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      if (!isLoggedReview(entry)) continue;
      if (options.mode && entry.m !== options.mode) continue;

      records.push({
        itemId: entry.i,
        at: entry.t,
        result: entry.g,
        elapsedDays: typeof entry.e === 'number' ? entry.e : 0,
      });
    }
  }

  records.sort((a, b) => a.at - b.at);
  return records;
}

/**
 * How many answers are on record, without pulling them all into memory.
 *
 * Used to decide whether a refit is worth attempting. Still reads the documents
 * — Firestore has no count that works offline — but discards as it goes.
 */
export async function countReviews(uid: string, sinceDays = 730): Promise<number> {
  const from = new Date(Date.now() - sinceDays * 86_400_000);
  const logs = collection(db, USERS_COLLECTION, uid, LOG_SUBCOLLECTION);
  const snapshot = await getDocs(query(logs, where(documentId(), '>=', dayKey(from))));

  let total = 0;
  for (const day of snapshot.docs) {
    const entries = (day.data() as DocumentData)['entries'];
    if (Array.isArray(entries)) total += entries.length;
  }
  return total;
}
