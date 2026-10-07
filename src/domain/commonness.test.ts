import { describe, expect, it } from 'vitest';
import { byIntroduction, isObscure, tierOf } from './commonness';
import type { KanjiItem, Tier, VocabItem } from './items';

function word(id: string, tier?: Tier, rank?: number): VocabItem {
  return {
    id,
    word: id,
    reading: 'よみ',
    meaning: 'm',
    ...(tier ? { tier } : {}),
    ...(rank ? { rank } : {}),
  };
}

describe('tierOf', () => {
  it('reads an item with no tier as common rather than demoting it blind', () => {
    expect(tierOf(word('a'))).toBe(2);
  });

  it('reads a kanji as common, since kanji carry no tier', () => {
    const kanji: KanjiItem = { id: '山', kanji: '山', readings: ['やま'], meaning: 'mountain' };
    expect(tierOf(kanji)).toBe(2);
    expect(isObscure(kanji)).toBe(false);
  });
});

describe('isObscure', () => {
  it('is true for uncommon and unlisted, false for core and common', () => {
    expect([1, 2, 3, 4].map((tier) => isObscure(word('a', tier as Tier)))).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});

describe('byIntroduction', () => {
  it('puts every common word before any obscure one, whatever their ranks', () => {
    const items = [word('rare', 4, 1), word('common', 2, 900), word('core', 1, 500)];
    expect(items.sort(byIntroduction).map((i) => i.id)).toEqual(['core', 'common', 'rare']);
  });

  it('does not order core against common by tier, only by rank', () => {
    const items = [word('b', 2, 10), word('a', 1, 20)];
    expect(items.sort(byIntroduction).map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('orders within a group by rank, and puts the unranked last', () => {
    const items = [word('none', 1), word('late', 1, 50), word('early', 1, 5)];
    expect(items.sort(byIntroduction).map((i) => i.id)).toEqual(['early', 'late', 'none']);
  });
});
