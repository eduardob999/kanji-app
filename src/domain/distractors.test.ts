import { describe, expect, it } from 'vitest';
import { buildChoices, answerText, DEFAULT_CHOICES } from './distractors';
import type { KanjiItem, StudyItem, VocabItem } from './items';

function vocab(word: string, reading: string): VocabItem {
  return { id: `${word}|${reading}`, word, reading, meaning: 'x' };
}

function kanji(character: string): KanjiItem {
  return { id: character, kanji: character, readings: ['よみ'], meaning: 'x' };
}

describe('answerText', () => {
  it('is the reading for a reading question', () => {
    expect(answerText(vocab('毎月', 'まいげつ'), 'vocab-reading')).toBe('まいげつ');
  });

  it('is the written form for a writing question', () => {
    expect(answerText(vocab('毎月', 'まいげつ'), 'fill-in')).toBe('毎月');
    expect(answerText(kanji('山'), 'kanji-writing')).toBe('山');
  });
});

describe('buildChoices', () => {
  const pool: StudyItem[] = [
    vocab('公園', 'こうえん'),
    vocab('講演', 'こうえんかい'),
    vocab('後援', 'こうき'),
    vocab('高校', 'こうこう'),
    vocab('学校', 'がっこう'),
    vocab('猫', 'ねこ'),
    vocab('図書館', 'としょかん'),
    vocab('冷蔵庫', 'れいぞうこ'),
  ];

  it('always contains the correct answer', () => {
    const item = pool[0]!;
    expect(buildChoices(item, pool, 'vocab-reading')).toContain('こうえん');
  });

  it('returns the requested number of distinct options', () => {
    const options = buildChoices(pool[0]!, pool, 'vocab-reading');
    expect(options).toHaveLength(DEFAULT_CHOICES);
    expect(new Set(options).size).toBe(DEFAULT_CHOICES);
  });

  it('never repeats the answer as its own distractor', () => {
    // Two identical options make a question unanswerable rather than hard.
    const withDuplicate = [...pool, vocab('公園', 'こうえん')];
    const options = buildChoices(pool[0]!, withDuplicate, 'vocab-reading');
    expect(options.filter((o) => o === 'こうえん')).toHaveLength(1);
  });

  it('prefers confusable readings over unrelated ones', () => {
    // The whole point: こうえん against ねこ is not a question.
    const options = buildChoices(pool[0]!, pool, 'vocab-reading');
    const distractors = options.filter((o) => o !== 'こうえん');

    // At least one shares the opening mora, and the obviously-unrelated short
    // one is not preferred over the near-misses.
    expect(distractors.some((o) => o.startsWith('こう'))).toBe(true);
    expect(distractors).not.toContain('ねこ');
  });

  it('prefers similar lengths', () => {
    const options = buildChoices(pool[0]!, pool, 'vocab-reading');
    const distractors = options.filter((o) => o !== 'こうえん');
    const spread = distractors.map((o) => Math.abs(o.length - 'こうえん'.length));
    expect(Math.max(...spread)).toBeLessThanOrEqual(3);
  });

  it('is deterministic, so a re-render does not reshuffle the question', () => {
    const first = buildChoices(pool[0]!, pool, 'vocab-reading');
    const second = buildChoices(pool[0]!, pool, 'vocab-reading');
    expect(first).toEqual(second);
  });

  it('does not always put the answer in the same slot', () => {
    const positions = new Set(
      pool.map((item) => buildChoices(item, pool, 'vocab-reading').indexOf(answerText(item, 'vocab-reading'))),
    );
    expect(positions.size).toBeGreaterThan(1);
  });

  it('copes with a pool too small to fill the options', () => {
    const tiny = [pool[0]!, pool[1]!];
    const options = buildChoices(pool[0]!, tiny, 'vocab-reading');
    expect(options).toContain('こうえん');
    expect(options.length).toBeLessThanOrEqual(DEFAULT_CHOICES);
  });

  it('returns nothing when there is no answer to offer', () => {
    const blank: VocabItem = { id: 'x|', word: 'x', reading: '', meaning: '' };
    expect(buildChoices(blank, pool, 'vocab-reading')).toEqual([]);
  });

  it('works for single characters, which have no bigrams', () => {
    const characters = ['待', '持', '特', '侍', '時'].map(kanji);
    const options = buildChoices(characters[0]!, characters, 'kanji-writing');

    expect(options).toContain('待');
    expect(options).toHaveLength(DEFAULT_CHOICES);
  });
});


describe('answers that can be picked without reading them', () => {
  const reading = (id: string, r: string): StudyItem =>
    ({ id, word: id, reading: r, meaning: 'x' }) as unknown as StudyItem;

  it('does not leave the answer as the only option of its length', () => {
    /*
     * The failure this guards is not subtle once you see it: three two-mora
     * readings and one four-mora one, and the four-mora one is the answer. It
     * can be picked by counting, and counting teaches nothing.
     *
     * Measured over the whole corpus before this was weighted properly, 38.6%
     * of vocab-reading choice questions came out that way.
     */
    const target = reading('a', 'あいうえ');
    const pool = [
      target,
      reading('b', 'かき'),
      reading('c', 'さし'),
      reading('d', 'たち'),
      reading('e', 'なにぬね'),
      reading('f', 'はひふへ'),
      reading('g', 'まみむめ'),
    ];

    const choices = buildChoices(target, pool, 'vocab-reading');
    const sameLength = choices.filter((c) => c.length === 'あいうえ'.length);

    expect(choices).toHaveLength(4);
    expect(choices).toContain('あいうえ');
    expect(sameLength.length).toBeGreaterThan(1);
  });

  it('still takes what it can when nothing matches the length', () => {
    // A rare length is not a reason to offer fewer than four options.
    const target = reading('a', 'あいうえおかきく');
    const pool = [target, reading('b', 'かき'), reading('c', 'さし'), reading('d', 'たち')];

    const choices = buildChoices(target, pool, 'vocab-reading');
    expect(choices).toHaveLength(4);
    expect(choices).toContain('あいうえおかきく');
  });
});
