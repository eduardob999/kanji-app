import { describe, expect, it } from 'vitest';
import {
  expandReadings,
  isAnyReadingCorrect,
  isReadingCorrect,
  isWritingCorrect,
  normalise,
  toHiragana,
} from './answerCheck';

/**
 * The cases here are the corpus's, not invented ones: every reading quoted
 * below appears in data/Vocab.csv or data/Kanji.csv. The CLI's
 * `_expand_readings` was shaped by exactly these, and the point of the port is
 * that it still handles them.
 */

describe('normalise', () => {
  it('treats the ideographic space as a space', () => {
    expect(normalise('まい　げつ')).toBe('まい げつ');
  });

  it('trims and collapses runs of whitespace', () => {
    expect(normalise('  まい   げつ  ')).toBe('まい げつ');
  });
});

describe('toHiragana', () => {
  it('converts katakana', () => {
    expect(toHiragana('マイゲツ')).toBe('まいげつ');
  });

  it('leaves hiragana and kanji alone', () => {
    expect(toHiragana('まいげつ毎月')).toBe('まいげつ毎月');
  });

  it('keeps the long vowel mark, which has no hiragana counterpart', () => {
    // Shifting it by the kana offset would produce a random CJK character, and
    // the mark is meaningful in the katakana it appears in.
    expect(toHiragana('コーヒー')).toBe('こーひー');
  });
});

describe('expandReadings', () => {
  it('returns a single reading unchanged', () => {
    expect(expandReadings('まいげつ')).toEqual(['まいげつ']);
  });

  it('splits on every separator the corpus uses', () => {
    expect(expandReadings('ド・ト・つち')).toEqual(['ド', 'ト', 'つち']);
    expect(expandReadings('あ、い')).toEqual(['あ', 'い']);
    expect(expandReadings('あ;い/う,え')).toEqual(['あ', 'い', 'う', 'え']);
  });

  it('unwraps parentheses of both widths', () => {
    expect(expandReadings('(まいげつ)')).toEqual(['まいげつ']);
    expect(expandReadings('（まいげつ）')).toEqual(['まいげつ']);
  });

  it('drops duplicates but keeps the first occurrence in place', () => {
    expect(expandReadings('あ・い・あ')).toEqual(['あ', 'い']);
  });

  it('ignores empty segments', () => {
    expect(expandReadings('あ・・い')).toEqual(['あ', 'い']);
    expect(expandReadings('')).toEqual([]);
  });
});

describe('isReadingCorrect', () => {
  it('accepts the reading', () => {
    expect(isReadingCorrect('まいげつ', 'まいげつ')).toBe(true);
  });

  it('accepts any of several alternatives', () => {
    expect(isReadingCorrect('つち', 'ド・ト・つち')).toBe(true);
    expect(isReadingCorrect('ド', 'ド・ト・つち')).toBe(true);
  });

  it('rejects a different reading of the same word', () => {
    // 毎月 has two entries with two readings and two meanings; getting the
    // other one is wrong, which is the whole reason ids carry the reading.
    expect(isReadingCorrect('まいつき', 'まいげつ')).toBe(false);
  });

  it('accepts katakana for a hiragana answer', () => {
    // A software IME left in katakana mode is not a memory failure.
    expect(isReadingCorrect('マイゲツ', 'まいげつ')).toBe(true);
  });

  it('ignores the okurigana dot in a KANJIDIC reading', () => {
    expect(isReadingCorrect('まず', 'セン・さき・ま.ず')).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(isReadingCorrect('  まいげつ ', 'まいげつ')).toBe(true);
  });

  it('rejects an empty answer even against an empty field', () => {
    expect(isReadingCorrect('', 'まいげつ')).toBe(false);
    expect(isReadingCorrect('', '')).toBe(false);
  });
});

describe('isAnyReadingCorrect', () => {
  it('accepts either reading of a prompt the data cannot disambiguate', () => {
    // 四 is both し and よん behind the prompt "four". Marking one of two right
    // answers wrong would tell the scheduler a memory had failed when it had
    // not — see markUnanswerablePrompts in scripts/build-decks.mjs.
    expect(isAnyReadingCorrect('し', ['よん', 'し'])).toBe(true);
    expect(isAnyReadingCorrect('よん', ['よん', 'し'])).toBe(true);
  });

  it('still rejects a reading that is not one of them', () => {
    expect(isAnyReadingCorrect('ご', ['よん', 'し'])).toBe(false);
  });

  it('rejects an empty answer', () => {
    expect(isAnyReadingCorrect('', ['よん', 'し'])).toBe(false);
  });
});

describe('isWritingCorrect', () => {
  it('accepts the exact characters', () => {
    expect(isWritingCorrect('毎月', '毎月')).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(isWritingCorrect(' 毎月 ', '毎月')).toBe(true);
  });

  it('rejects wrong okurigana', () => {
    // Accepting this would teach the wrong okurigana, which is worse than
    // marking a near-miss wrong.
    expect(isWritingCorrect('見', '見る')).toBe(false);
    expect(isWritingCorrect('見る', '見')).toBe(false);
  });

  it('rejects the reading in place of the characters', () => {
    expect(isWritingCorrect('まいげつ', '毎月')).toBe(false);
  });

  it('rejects an empty answer', () => {
    expect(isWritingCorrect('', '毎月')).toBe(false);
  });
});
