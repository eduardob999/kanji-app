import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isKanjiItem, type StudyItem } from './items';

/**
 * Invariants of the built decks, checked against the files that actually ship.
 *
 * These are properties the rest of the app quietly relies on and that nothing
 * else would notice breaking — they are decided by `npm run decks`, which is
 * run by hand, from CSVs edited by hand.
 */

const DECKS = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/decks');

function load(prefix: string): StudyItem[] {
  return readdirSync(DECKS)
    .filter((file) => file.startsWith(prefix))
    .flatMap((file) => JSON.parse(readFileSync(resolve(DECKS, file), 'utf8')).items as StudyItem[]);
}

const kanji = load('kanji-');
const vocab = load('vocab-');
const all = [...kanji, ...vocab];

describe('the corpus', () => {
  it('is the size everything else claims it is', () => {
    expect(kanji).toHaveLength(2_211);
    expect(vocab).toHaveLength(7_234);
  });

  it('gives every item an id nothing else shares', () => {
    // Ids key the review state. A collision would merge two words into one
    // memory and there would be no symptom beyond a schedule that felt wrong.
    expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
  });

  it('keeps words apart when they are written the same', () => {
    /*
     * The measure this corpus was built with, and worth guarding because it is
     * invisible when it works and silent when it breaks.
     *
     * 弾く is はじく and it is ひく — two words, two meanings, two things to
     * learn. Keyed on the surface alone they would share one schedule, and
     * answering one would mark the other as known. The reading is part of the
     * id for exactly that reason.
     */
    const byWord = new Map<string, StudyItem[]>();
    for (const item of vocab) {
      const word = (item as unknown as { word: string }).word;
      byWord.set(word, [...(byWord.get(word) ?? []), item]);
    }

    const shared = [...byWord.values()].filter((group) => group.length > 1);
    expect(shared.length).toBeGreaterThan(200);

    for (const group of shared) {
      expect(new Set(group.map((item) => item.id)).size).toBe(group.length);
      for (const item of group) {
        expect(item.id).toContain((item as unknown as { reading: string }).reading);
      }
    }
  });

  it('uses ids Firestore can store as map keys', () => {
    // Review state is a map keyed by item id inside a bucket document. An id
    // with a slash, a leading double underscore or a control character would be
    // rejected by the server — after the write had already been applied to the
    // local cache and looked like it worked.
    const control = /[\u0000-\u001f\u007f]/;

    for (const item of all) {
      expect(item.id.length).toBeGreaterThan(0);
      expect(Buffer.byteLength(item.id, 'utf8')).toBeLessThan(1_500);
      expect(item.id).not.toContain('/');
      expect(item.id.startsWith('__')).toBe(false);
      expect(control.test(item.id)).toBe(false);
    }
  });

  it('gives almost every item a place in the introduction queue', () => {
    // `rank` is what orders new material by how often it actually appears.
    // Missing ranks fall back to CSV order, which is arbitrary.
    const ranked = all.filter((item) => typeof item.rank === 'number');
    expect(ranked.length / all.length).toBeGreaterThan(0.99);
  });

  it('gives every kanji a reading, and every word one too', () => {
    for (const item of kanji) {
      expect(isKanjiItem(item)).toBe(true);
      if (isKanjiItem(item)) expect(item.readings.length).toBeGreaterThan(0);
    }
    for (const item of vocab) {
      expect((item as unknown as { reading: string }).reading.length).toBeGreaterThan(0);
    }
  });
});
