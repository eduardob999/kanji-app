import { describe, expect, it } from 'vitest';
import { blankOut, chooseSentence, type Sentence } from './sentences';

describe('blankOut', () => {
  it('puts the reading in the gap', () => {
    expect(blankOut('毎月お金を貯めています。', '毎月', 'まいげつ')).toBe(
      '［まいげつ］お金を貯めています。',
    );
  });

  it('blanks every occurrence', () => {
    /*
     * This test used to assert the opposite, on the grounds that blanking both
     * "shows the answer's shape twice and makes the sentence harder to read for
     * nothing". The reasoning missed the thing that decides it: the second
     * occurrence *is the answer*, printed next to the question. Readability is
     * not worth a fill-in question that fills itself in.
     */
    expect(blankOut('本を読む。本が好き。', '本', 'ほん')).toBe('［ほん］を読む。［ほん］が好き。');
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


describe('a word that turns up twice', () => {
  it('blanks every occurrence, not just the first', () => {
    // Left as it was, this is a fill-in question with the answer still in it.
    expect(blankOut('私たちは代わる代わる寝た。', '代わる', 'かわる')).toBe(
      '私たちは［かわる］［かわる］寝た。',
    );
    expect(blankOut('誠に、誠に、あなたに告げます。', '誠', 'まこと')).toBe(
      '［まこと］に、［まこと］に、あなたに告げます。',
    );
  });

  it('leaves a sentence without the word alone', () => {
    expect(blankOut('猫が寝ている。', '犬', 'いぬ')).toBe('猫が寝ている。');
  });

  it('does not spin on an empty word', () => {
    expect(blankOut('猫が寝ている。', '', 'x')).toBe('猫が寝ている。');
  });

  it('prefers a sentence that uses the word once', () => {
    const twice = { id: 1, text: '誠に、誠に。' } satisfies Sentence;
    const once = { id: 2, text: '誠を尽くす。' } satisfies Sentence;

    // Whatever the rotation lands on, it lands inside the clean ones.
    for (let reps = 0; reps < 4; reps += 1) {
      expect(chooseSentence([twice, once], reps, '誠')).toBe(once);
    }
  });

  it('still answers when every sentence repeats the word', () => {
    const a = { id: 1, text: '空しいのに、空しい。' } satisfies Sentence;
    expect(chooseSentence([a], 0, '空しい')).toBe(a);
  });

  it('keeps the rotation stable when no word is given', () => {
    const a = { id: 1, text: 'A' } satisfies Sentence;
    const b = { id: 2, text: 'B' } satisfies Sentence;
    expect(chooseSentence([a, b], 0)).toBe(a);
    expect(chooseSentence([a, b], 1)).toBe(b);
    expect(chooseSentence([a, b], 2)).toBe(a);
  });
});
