/**
 * How much to ask for today.
 *
 * The session used to be a flat fifteen questions with up to eight new items,
 * whatever was waiting. That is fine until something puts a real backlog in
 * front of it — an import, or a fortnight away — and then it is quietly wrong
 * in both directions: it offers fifteen when eighty are due, and it keeps
 * introducing new material while you are falling behind, which is how a
 * spaced-repetition habit collapses.
 *
 * The goal here is narrow and worth stating: **hold the due backlog flat**. Not
 * clear it — an app cannot make anyone answer more questions — but stop it
 * growing on its own, and be honest about the rate that would hold it.
 *
 * Three levers, in order of how much they matter:
 *
 * 1. **New material stops when you are behind.** Every new item is a debt that
 *    comes back today, tomorrow, in three days. Adding debt while behind is the
 *    single fastest way to make a backlog permanent, and it is the one thing
 *    here that is not a matter of taste.
 * 2. **The session grows to meet what is due**, up to what you have actually
 *    been willing to do. Offering fifteen when eighty are due guarantees the
 *    other sixty-five roll over.
 * 3. **New material also stops when accuracy drops.** A high failure rate means
 *    what you have is not consolidated, and piling on more is the wrong answer
 *    regardless of what the backlog says.
 *
 * Pure. Everything it needs is measured elsewhere and passed in.
 */

/** What the learner's situation actually is. */
export interface Load {
  /** Memories due at or before now. */
  due: number;
  /** Never studied in this mode. */
  unseen: number;
  /**
   * Reviews answered per calendar day, measured over the recent past.
   *
   * Calendar days rather than active days on purpose: a backlog accrues on the
   * days you skip too, so a rate that ignores them would licence a session size
   * nobody sustains.
   */
  throughput: number;
  /** Fraction of recent answers that were not failures, 0-1. */
  accuracy: number;
  /** Whether there is enough history for `throughput` and `accuracy` to mean anything. */
  measured: boolean;
}

export type PaceState = 'starting' | 'ahead' | 'steady' | 'behind' | 'struggling';

export interface Pacing {
  /** Questions to offer in this sitting. */
  maxItems: number;
  /** Of those, how many may be new material. */
  maxNew: number;
  /** Reviews per day that would hold the backlog where it is. */
  sustainableRate: number;
  state: PaceState;
  /** One line for the learner, explaining the number they are being shown. */
  note: string;
}

/** Before this many reviews, there is nothing to measure and defaults apply. */
export const MIN_REVIEWS_TO_MEASURE = 30;

/** The session size for someone with no history yet. */
export const BASE_SESSION = 15;
export const BASE_NEW = 8;

/** A session is never shorter than this when there is anything to ask. */
export const MIN_SESSION = 5;

/**
 * However eager the numbers look, no session is longer than this.
 *
 * A ceiling that tracks throughput with nothing above it will happily propose
 * two hundred questions to someone who once cleared a backlog on a long train
 * journey.
 */
export const MAX_SESSION = 80;

/** How far above measured throughput the session may reach. */
const STRETCH = 1.2;

/**
 * Near-term reviews each new item is expected to generate.
 *
 * A new item is not one question, it is one question today, another tomorrow,
 * another in a few days. Three is the conservative end of what the literature
 * and every SRS implementation observes for the first fortnight, and being
 * conservative here is right: overestimating capacity is what produces the
 * backlog this module exists to prevent.
 */
const NEW_ITEM_COST = 3;

/** Below this recent accuracy, new material waits. */
export const STRUGGLING_BELOW = 0.75;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function pace(load: Load): Pacing {
  const { due, unseen, throughput, accuracy, measured } = load;

  // No history: the defaults, which are a guess but a well-behaved one.
  if (!measured) {
    return {
      maxItems: BASE_SESSION,
      maxNew: Math.min(BASE_NEW, unseen),
      sustainableRate: BASE_SESSION,
      state: 'starting',
      note: 'Finding your rhythm — the session settles once there is enough history to measure.',
    };
  }

  // What a session may reach: what you have shown you will do, plus a little.
  const ceiling = clamp(Math.round(throughput * STRETCH), BASE_SESSION, MAX_SESSION);

  // Capacity left over once today's due material is accounted for. A stock
  // against a flow, deliberately: the question is whether today's queue can be
  // cleared today.
  const headroom = ceiling - due;

  const struggling = accuracy < STRUGGLING_BELOW;
  const behind = headroom <= 0;

  let maxNew = 0;
  if (!behind && !struggling) {
    maxNew = clamp(Math.floor(headroom / NEW_ITEM_COST), 0, BASE_NEW);
  }
  maxNew = Math.min(maxNew, unseen);

  const maxItems = clamp(due + maxNew, MIN_SESSION, ceiling);

  // What it would take to stop the backlog growing. Reported whether or not it
  // is comfortable, because an encouraging number that is wrong is worse than a
  // discouraging one that is right.
  const sustainableRate = Math.max(due, Math.round(throughput));

  const state: PaceState = struggling
    ? 'struggling'
    : behind
      ? 'behind'
      : due === 0
        ? 'ahead'
        : 'steady';

  return { maxItems, maxNew, sustainableRate, state, note: noteFor(state, due, maxNew), };
}

function noteFor(state: PaceState, due: number, maxNew: number): string {
  switch (state) {
    case 'ahead':
      return maxNew > 0
        ? `Nothing due. ${maxNew} new ${maxNew === 1 ? 'item' : 'items'} to get on with.`
        : 'Nothing due, and nothing left to introduce in this mode.';
    case 'steady':
      return maxNew > 0
        ? `Keeping up. ${maxNew} new ${maxNew === 1 ? 'item' : 'items'} mixed in.`
        : 'Keeping up. No new material today — the queue comes first.';
    case 'behind':
      return `${due} due is more than you have been getting through, so nothing new is being introduced until it comes down.`;
    case 'struggling':
      return 'A lot of misses lately, so nothing new today. Consolidating what you have is the faster route.';
    case 'starting':
      return 'Finding your rhythm.';
  }
}

/**
 * Reviews per calendar day, from the timestamps in the review log.
 *
 * Windowed rather than lifetime: someone who did four hundred reviews in a
 * fortnight last spring and nothing since has a lifetime average that would
 * propose a session they will not finish.
 */
export const THROUGHPUT_WINDOW_DAYS = 14;

export function throughputFrom(timestamps: readonly number[], now: Date): {
  throughput: number;
  measured: boolean;
} {
  if (timestamps.length === 0) return { throughput: 0, measured: false };

  const since = now.getTime() - THROUGHPUT_WINDOW_DAYS * 86_400_000;
  const recent = timestamps.filter((at) => at >= since);

  const earliest = Math.min(...timestamps);
  // Divide by the window, or by however long they have been using the app if
  // that is shorter — otherwise a first strong day reads as a low daily rate.
  const days = clamp((now.getTime() - Math.max(earliest, since)) / 86_400_000, 1, THROUGHPUT_WINDOW_DAYS);

  return {
    throughput: recent.length / days,
    measured: timestamps.length >= MIN_REVIEWS_TO_MEASURE,
  };
}

/** Fraction of recent answers that were not failures. */
export function accuracyFrom(results: readonly { result: string; at: number }[], now: Date): number {
  const since = now.getTime() - THROUGHPUT_WINDOW_DAYS * 86_400_000;
  const recent = results.filter((r) => r.at >= since);
  if (recent.length === 0) return 1;

  return recent.filter((r) => r.result !== 'fail').length / recent.length;
}
