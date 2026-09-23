import { describe, expect, it } from 'vitest';
import { buildExampleIndex, examplesFor, kanjiIn } from './examples';
import type { Level, VocabItem } from './items';

function vocab(word: string, reading: string, meaning: string, rank?: number): VocabItem {
  return { id: `${word}|${reading}`, word, reading, meaning, ...(rank ? { rank } : {}) };
}

function deck(level: Level, items: VocabItem[]) {
  return { level, items };
}

describe('kanjiIn', () => {
  it('keeps kanji, drops kana, and lists each once', () => {
    expect(kanjiIn('食べ物を食べる')).toEqual(['食', '物']);
    expect(kanjiIn('ありがとう')).toEqual([]);
  });
});

describe('buildExampleIndex', () => {
  it('puts easier levels first, then more frequent words', () => {
    const index = buildExampleIndex([
      deck('5', [vocab('土地', 'とち', 'land', 9), vocab('土曜日', 'どようび', 'Saturday', 2)]),
      deck('1a', [vocab('粘土', 'ねんど', 'clay', 1)]),
    ]);

    expect(index.get('土')!.map((e) => e.word)).toEqual(['土曜日', '土地', '粘土']);
  });

  it('leaves out words with no meaning', () => {
    const index = buildExampleIndex([deck('5', [vocab('土産', 'みやげ', ''), vocab('土地', 'とち', 'land')])]);
    expect(index.get('土')!.map((e) => e.word)).toEqual(['土地']);
  });

  it('shows a surface with two readings once', () => {
    const index = buildExampleIndex([
      deck('5', [vocab('毎月', 'まいげつ', 'every month'), vocab('毎月', 'まいつき', 'every month')]),
    ]);
    expect(index.get('毎')).toHaveLength(1);
  });
});

describe('examplesFor', () => {
  const index = buildExampleIndex([
    deck('5', [
      vocab('毎日', 'まいにち', 'every day'),
      vocab('毎月', 'まいつき', 'every month'),
      vocab('毎朝', 'まいあさ', 'every morning'),
      vocab('毎年', 'まいとし', 'every year'),
      vocab('月曜日', 'げつようび', 'Monday'),
      vocab('今月', 'こんげつ', 'this month'),
    ]),
  ]);

  it('gives a single kanji up to the limit', () => {
    expect(examplesFor(index, '毎', 3).map((e) => e.word)).toEqual(['毎日', '毎月', '毎朝']);
  });

  it('never offers the word being asked about', () => {
    expect(examplesFor(index, '毎月', 10).map((e) => e.word)).not.toContain('毎月');
  });

  it('shares the limit between the characters of a compound', () => {
    expect(examplesFor(index, '毎月', 4).map((e) => e.word)).toEqual([
      '毎日',
      '月曜日',
      '毎朝',
      '今月',
    ]);
  });

  it('does not list a word twice when two characters share it', () => {
    const words = examplesFor(index, '毎日', 10).map((e) => e.word);
    expect(new Set(words).size).toBe(words.length);
  });

  it('is empty for a surface with no kanji, or kanji nothing else uses', () => {
    expect(examplesFor(index, 'ありがとう')).toEqual([]);
    expect(examplesFor(index, '鬱')).toEqual([]);
  });
});
