import { describe, expect, it } from 'vitest';
import { blankOut, chooseSentence, type Sentence } from './sentences';

describe('blankOut', () => {
  it('puts the reading in the gap', () => {
    expect(blankOut('毎月お金を貯めています。', '毎月', 'まいげつ')).toBe(
      '［まいげつ］お金を貯めています。',
    );
  });

  it('blanks only the first occurrence', () => {
    // Blanking both shows the answer's shape twice and makes the sentence
    // harder to read for nothing.
    expect(blankOut('本を読む。本が好き。', '本', 'ほん')).toBe('［ほん］を読む。本が好き。');
  });

  it('works mid-sentence and at the end', () => {
    expect(blankOut('私は毎月行く', '毎月', 'まいげつ')).toBe('私は［まいげつ］行く');
    expect(blankOut('これは本', '本', 'ほん')).toBe('これは［ほん］');
  });

  it('leaves a sentence that does not contain the word alone', () => {
    // Should not happen — the packs are built from containment — but silently
    // mangling the sentence would be worse than showing it whole.
    expect(blankOut('猫が好き。', '毎月', 'まいげつ')).toBe('猫が好き。');
  });
});

describe('chooseSentence', () => {
  const sentences: Sentence[] = [
    { id: 1, text: 'one' },
    { id: 2, text: 'two' },
    { id: 3, text: 'three' },
  ];

  it('returns null when the word has none', () => {
    expect(chooseSentence([], 0)).toBeNull();
  });

  it('is stable for a given rep count', () => {
    expect(chooseSentence(sentences, 4)).toBe(chooseSentence(sentences, 4));
  });

  it('rotates as the item matures', () => {
    // A word met five times should not have been met in the same frame five
    // times.
    const seen = new Set([0, 1, 2, 3, 4].map((reps) => chooseSentence(sentences, reps)?.id));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('wraps rather than running off the end', () => {
    expect(chooseSentence(sentences, 3)).toEqual(sentences[0]);
    expect(chooseSentence(sentences, 99)).not.toBeNull();
  });

  it('copes with a single sentence', () => {
    const one = [sentences[0]!];
    expect(chooseSentence(one, 0)).toEqual(one[0]);
    expect(chooseSentence(one, 7)).toEqual(one[0]);
  });
});
