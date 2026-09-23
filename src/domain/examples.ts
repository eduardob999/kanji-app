import { levelRank, type Level, type VocabItem } from './items';

/**
 * Other words that use the same kanji, shown after a miss.
 *
 * A character missed on its own is a character met in isolation, and isolation
 * is the least memorable way to meet one: 土 means little until it is the 土 in
 * 土曜日. So after a miss on kanji writing or vocab reading the reveal lists a
 * few words from the vocabulary decks that contain the same character, with
 * their readings and meanings.
 *
 * Which few is the whole content of this file. Easier levels first, then the
 * more frequent within a level, because the point is to hang the character on
 * a word already known — an N1 compound is a second thing to forget. Words with
 * no recorded meaning are left out, since a word shown here *for* its meaning
 * is no use without one; and a surface with two readings is shown once.
 */

export interface ExampleWord {
  word: string;
  reading: string;
  meaning: string;
}

/** Character to the words containing it, best example first. */
export type ExampleIndex = Map<string, ExampleWord[]>;

/** Every distinct kanji in a string, in order of appearance. */
export function kanjiIn(text: string): string[] {
  return [...new Set(text.match(/\p{Script=Han}/gu) ?? [])];
}

export function buildExampleIndex(
  decks: readonly { level: Level; items: readonly VocabItem[] }[],
): ExampleIndex {
  const ranked = decks
    .flatMap((deck) => deck.items.map((item) => ({ item, level: levelRank(deck.level) })))
    .filter(({ item }) => item.meaning.trim() !== '')
    .sort(
      (a, b) =>
        a.level - b.level ||
        (a.item.rank ?? Number.MAX_SAFE_INTEGER) - (b.item.rank ?? Number.MAX_SAFE_INTEGER),
    );

  const index: ExampleIndex = new Map();
  const seen = new Set<string>();

  for (const { item } of ranked) {
    if (seen.has(item.word)) continue;
    seen.add(item.word);

    const example = { word: item.word, reading: item.reading, meaning: item.meaning };
    for (const kanji of kanjiIn(item.word)) {
      const words = index.get(kanji);
      if (words) words.push(example);
      else index.set(kanji, [example]);
    }
  }

  return index;
}

/**
 * Example words for everything written in `surface`, excluding `surface` itself.
 *
 * A single character gets up to `limit` words. A compound shares the same
 * limit between its characters, taking them in turn, so 毎月 shows words for
 * both 毎 and 月 rather than three for 毎 and none for 月.
 */
export function examplesFor(index: ExampleIndex, surface: string, limit = 3): ExampleWord[] {
  const pools = kanjiIn(surface).map((kanji) =>
    (index.get(kanji) ?? []).filter((example) => example.word !== surface),
  );

  const chosen: ExampleWord[] = [];
  const taken = new Set<string>();

  for (let depth = 0; chosen.length < limit; depth += 1) {
    let any = false;
    for (const pool of pools) {
      if (depth >= pool.length) continue;
      any = true;
      // A word two characters share is found through both; skip the repeat and
      // let this character's next word take the slot on a later pass.
      const candidate = pool[depth]!;
      if (taken.has(candidate.word)) continue;
      taken.add(candidate.word);
      chosen.push(candidate);
      if (chosen.length === limit) break;
    }
    if (!any) break;
  }

  return chosen;
}
