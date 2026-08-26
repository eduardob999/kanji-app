import {
  LEVELS,
  isLevel,
  type Deck,
  type DeckIndex,
  type DeckType,
  type Level,
  type StudyItem,
} from './items';

/**
 * Loading the decks.
 *
 * The one impure module in `src/domain/` — it fetches — and it is here rather
 * than in `src/storage/` because the decks are not user data. They are static
 * files that ship with the build, precached by the service worker, identical
 * for everyone and never written to. `src/storage/` means Firestore.
 *
 * Loading is lazy and cached. All sixteen decks are 1.1 MB; a session touches
 * one or two, and someone drilling N5 should not pay for N1 on every launch.
 * The service worker has them all locally either way, so a cache miss offline
 * is still an instant read from disk rather than a failure.
 */

/** Resolves against Vite's build-time base, which is the Pages sub-path. */
function deckUrl(path: string): string {
  return new URL(`decks/${path}`, new URL(import.meta.env.BASE_URL, window.location.href)).toString();
}

const deckCache = new Map<string, Promise<Deck>>();
let indexCache: Promise<DeckIndex> | null = null;

/**
 * Fails loudly when the build script and `items.ts` disagree about the levels.
 *
 * They are two hand-maintained lists of the same thing — one in Node, one in
 * TypeScript — and the failure mode if they drift is a level that silently
 * never appears in any session.
 */
function assertKnownLevels(index: DeckIndex): void {
  const unknown = index.levels.filter((level) => !isLevel(level));
  if (unknown.length > 0) {
    throw new Error(
      `Deck index lists levels this build does not know about: ${unknown.join(', ')}. ` +
        `Update LEVELS in src/domain/items.ts to match scripts/build-decks.mjs.`,
    );
  }

  const missing = LEVELS.filter((level) => !index.levels.includes(level));
  if (missing.length > 0) {
    throw new Error(
      `Deck index is missing levels this build expects: ${missing.join(', ')}. ` +
        `Re-run \`npm run decks\`.`,
    );
  }
}

export async function loadDeckIndex(): Promise<DeckIndex> {
  indexCache ??= (async () => {
    const response = await fetch(deckUrl('index.json'));
    if (!response.ok) {
      throw new Error(`Could not load the deck index (${response.status}). Run \`npm run decks\`.`);
    }
    const index = (await response.json()) as DeckIndex;
    assertKnownLevels(index);
    return index;
  })().catch((error: unknown) => {
    // Do not cache a failure: offline-then-online should be able to recover
    // without a reload.
    indexCache = null;
    throw error;
  });

  return indexCache;
}

export async function loadDeck<T extends StudyItem = StudyItem>(
  type: DeckType,
  level: Level,
): Promise<Deck<T>> {
  const id = `${type}-${level}`;

  let pending = deckCache.get(id);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(deckUrl(`${id}.json`));
      if (!response.ok) {
        throw new Error(`Could not load deck ${id} (${response.status}).`);
      }
      return (await response.json()) as Deck;
    })().catch((error: unknown) => {
      deckCache.delete(id);
      throw error;
    });

    deckCache.set(id, pending);
  }

  return pending as Promise<Deck<T>>;
}

/** Every deck of one type, in level order. Used by the planner and by Browse. */
export async function loadAllDecks<T extends StudyItem = StudyItem>(
  type: DeckType,
): Promise<Deck<T>[]> {
  return Promise.all(LEVELS.map((level) => loadDeck<T>(type, level)));
}
