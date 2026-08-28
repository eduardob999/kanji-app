import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RefPattern } from './pipeline';

/**
 * The shipped reference patterns, checked as data.
 *
 * `npm run strokes` is run by hand and pulls from two sources — Kanji Canvas's
 * published patterns and KanjiVG — so what ends up in `public/strokes/` is not
 * reproducible from the repository alone. These are the properties the
 * recogniser depends on, checked against the files that actually ship.
 *
 * Deliberately not a recognition-accuracy test: that needs KanjiVG's 13 MB
 * dump, which is gitignored, and it lives in the build script's own self-check
 * instead. This is the part that can be checked from a clone.
 */

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public');

function patterns(name: string): RefPattern[] {
  return JSON.parse(readFileSync(resolve(PUBLIC, 'strokes', name), 'utf8')).patterns;
}

const kanji = patterns('kanji.json');
const kana = patterns('kana.json');

describe('the handwriting reference', () => {
  it('covers every kanji the app can ask about', () => {
    const wanted = new Set<string>();
    for (const file of readdirSync(resolve(PUBLIC, 'decks')).filter((f) => f.startsWith('kanji-'))) {
      for (const item of JSON.parse(readFileSync(resolve(PUBLIC, 'decks', file), 'utf8')).items) {
        wanted.add(item.kanji);
      }
    }

    const have = new Set(kanji.map((p) => p[0]));
    expect([...wanted].filter((k) => !have.has(k))).toEqual([]);
  });

  it('agrees with itself about how many strokes each character has', () => {
    /*
     * The count is not decoration: `coarseClassification` filters by it before
     * it looks at shape, so a character whose declared count does not match its
     * data is one nobody can draw. This is how 臨 came to be unreachable — its
     * published pattern was six strokes of an eighteen-stroke character, count
     * and data agreeing with each other and both wrong. Nothing in a clone can
     * catch *that*; this catches the cheaper corruption of the two disagreeing.
     */
    for (const [character, count, strokes] of [...kanji, ...kana]) {
      expect(strokes.length, character).toBe(count);
      expect(count).toBeGreaterThan(0);
    }
  });

  it('names each character once', () => {
    for (const set of [kanji, kana]) {
      expect(new Set(set.map((p) => p[0])).size).toBe(set.length);
    }
  });

  it('gives every stroke at least two points to make a line from', () => {
    for (const [character, , strokes] of [...kanji, ...kana]) {
      for (const stroke of strokes) {
        expect(stroke.length, character).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('stores whole numbers, which is the entire size saving', () => {
    // 6.37 MB of fourteen-decimal coordinates became 1.6 MB of integers. A
    // float creeping back in would not break anything and would quietly undo
    // that, which is the kind of regression nobody notices.
    for (const [character, , strokes] of [...kanji, ...kana]) {
      for (const stroke of strokes) {
        for (const [x, y] of stroke) {
          expect(Number.isInteger(x), character).toBe(true);
          expect(Number.isInteger(y), character).toBe(true);
        }
      }
    }
  });
});
