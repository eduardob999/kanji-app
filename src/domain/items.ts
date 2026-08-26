/**
 * What the app is made of: kanji and vocabulary, grouped into decks by JLPT
 * level.
 *
 * These types describe the JSON that `scripts/build-decks.mjs` writes into
 * `public/decks/`. Nothing here loads anything — see `decks.ts` for that — and
 * nothing here knows about scheduling, which is `review.ts`.
 */

/**
 * JLPT levels, easiest first.
 *
 * Ordering is meaningful: it is the order material is introduced in when
 * nothing is due. N1 is split into four sub-levels because it is otherwise a
 * third of the corpus in one undifferentiated block; the split is inherited
 * from the CLI, and keeping it is what lets the old scores line up.
 *
 * Kept in step with `LEVELS` in scripts/build-decks.mjs, which is checked at
 * load time — see `assertKnownLevels` in `decks.ts`.
 */
export const LEVELS = ['5', '4', '3', '2', '1a', '1b', '1c', '1d'] as const;

export type Level = (typeof LEVELS)[number];

export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

/** How far into the course a level sits. Lower is earlier. */
export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

/** "N5", "N1 (a)" — how a level is written for a human. */
export function levelLabel(level: Level): string {
  return level.length === 1 ? `N${level}` : `N${level[0]} (${level.slice(1)})`;
}

export type DeckType = 'kanji' | 'vocab';

export interface KanjiItem {
  /** The character itself. Unique across the whole corpus. */
  id: string;
  kanji: string;
  /** On and kun readings, already split. A dot marks the okurigana boundary. */
  readings: string[];
  meaning: string;
}

export interface VocabItem {
  /**
   * `word|reading`.
   *
   * The reading is part of the identity because the corpus contains words that
   * only their reading tells apart, with different meanings for each.
   */
  id: string;
  word: string;
  reading: string;
  /** Occasionally empty; reading and fill-in questions do not need one. */
  meaning: string;
}

export type StudyItem = KanjiItem | VocabItem;

export function isKanjiItem(item: StudyItem): item is KanjiItem {
  return 'kanji' in item;
}

/** The written form, whichever kind of item this is. */
export function itemSurface(item: StudyItem): string {
  return isKanjiItem(item) ? item.kanji : item.word;
}

export interface Deck<T extends StudyItem = StudyItem> {
  id: string;
  type: DeckType;
  level: Level;
  count: number;
  items: T[];
}

/** Summary of one deck, as listed in `public/decks/index.json`. */
export interface DeckSummary {
  id: string;
  type: DeckType;
  level: Level;
  count: number;
}

export interface DeckIndex {
  levels: Level[];
  decks: DeckSummary[];
}

export function deckId(type: DeckType, level: Level): string {
  return `${type}-${level}`;
}
