import { describe, expect, it } from 'vitest';
import {
  MAX_ENTRIES,
  REPO_URL,
  buildSubmission,
  countByStatus,
  knownVocab,
  parseWordList,
  toCsv,
} from './wordList';

const known = knownVocab([
  { id: '毎月|まいげつ', word: '毎月' },
  { id: '毎月|まいつき', word: '毎月' },
  { id: '太い|ふとい', word: '太い' },
]);

const parse = (text: string) => parseWordList(text, known);

describe('parseWordList', () => {
  it('reads a bare word, a word and reading, and all three columns', () => {
    const [a, b, c] = parse('猫\n犬,いぬ\n鳥,とり,bird');
    expect([a?.word, a?.reading, a?.meaning]).toEqual(['猫', '', '']);
    expect([b?.word, b?.reading, b?.meaning]).toEqual(['犬', 'いぬ', '']);
    expect([c?.word, c?.reading, c?.meaning]).toEqual(['鳥', 'とり', 'bird']);
  });

  it('keeps commas inside a meaning', () => {
    const [entry] = parse('鳥,とり,"bird, fowl, poultry"');
    expect(entry?.meaning).toBe('bird, fowl, poultry');
    const [bare] = parse('鳥,とり,bird, fowl');
    expect(bare?.meaning).toBe('bird, fowl');
  });

  it('reads tab-separated lists from a spreadsheet', () => {
    const [entry] = parse('鳥\tとり\tbird, fowl');
    expect(entry).toMatchObject({ word: '鳥', reading: 'とり', meaning: 'bird, fowl' });
  });

  it('skips blanks, comments, a header row and a byte order mark', () => {
    const entries = parse('﻿Word,Reading,Meaning\n\n# my list\n猫,ねこ,cat\n');
    expect(entries.map((e) => e.word)).toEqual(['猫']);
  });

  it('numbers lines as the sender sees them', () => {
    const entries = parse('猫\n\nabc\n犬');
    expect(entries.map((e) => [e.word, e.line])).toEqual([
      ['猫', 1],
      ['abc', 3],
      ['犬', 4],
    ]);
  });

  it('refuses what is not Japanese, and says why', () => {
    const [entry] = parse('hello,world');
    expect(entry).toMatchObject({ status: 'invalid', note: 'Not a Japanese word.' });
  });

  it('refuses a reading that is not kana', () => {
    expect(parse('猫,cat')[0]).toMatchObject({ status: 'invalid' });
    expect(parse('猫,ねこ')[0]?.status).toBe('new');
    expect(parse('猫,ネコ')[0]?.status).toBe('new');
  });

  it('refuses an over-long word or meaning', () => {
    expect(parse('あ'.repeat(21))[0]?.status).toBe('invalid');
    expect(parse(`猫,ねこ,${'x'.repeat(201)}`)[0]?.status).toBe('invalid');
  });

  it('marks a word already taught, by reading when one is given', () => {
    expect(parse('太い')[0]?.status).toBe('known');
    expect(parse('太い,ふとい')[0]?.status).toBe('known');
    // The corpus holds words that differ only by reading; this is the other one.
    expect(parse('毎月,まいにち')[0]?.status).toBe('new');
    expect(parse('毎月')[0]?.status).toBe('known');
  });

  it('marks a repeat within the list, once', () => {
    const entries = parse('猫,ねこ\n猫,ねこ');
    expect(entries.map((e) => e.status)).toEqual(['new', 'repeat']);
  });

  it('stops at the limit and says so rather than reading on', () => {
    const text = Array.from({ length: MAX_ENTRIES + 20 }, (_, i) =>
      String.fromCharCode(0x4e00 + i),
    ).join('\n');
    const entries = parse(text);
    const last = entries.at(-1);
    expect(entries.filter((e) => e.status === 'new')).toHaveLength(MAX_ENTRIES);
    expect(last?.status).toBe('invalid');
    expect(last?.note).toContain(String(MAX_ENTRIES));
  });
});

describe('buildSubmission', () => {
  const entries = parse('猫,ねこ,cat\n太い\n犬,いぬ,"dog, hound"\nabc');

  it('sends only the words that are new', () => {
    expect(countByStatus(entries)).toEqual({ new: 2, known: 1, repeat: 0, invalid: 1 });
    expect(toCsv(entries)).toBe('Word,Reading,Meaning\n猫,ねこ,cat\n犬,いぬ,"dog, hound"');
  });

  it('puts the list in a fenced block a reviewer can copy', () => {
    const { title, body, url, fits } = buildSubmission(entries, 'from my textbook');
    expect(title).toBe('Word list: 2 words');
    expect(body).toContain('```csv\nWord,Reading,Meaning\n猫,ねこ,cat');
    expect(body).toContain('from my textbook');
    expect(fits).toBe(true);
    expect(url.startsWith(`${REPO_URL}/issues/new?title=`)).toBe(true);
    expect(decodeURIComponent(url.split('body=')[1]!)).toBe(body);
  });

  it('cannot be made to close its own fence', () => {
    const hostile = parse('猫,ねこ,"cat ``` # injected"');
    const { body } = buildSubmission(hostile, '``` more');
    expect(body.match(/```/g)).toHaveLength(2);
  });

  it('falls back to a blank issue when the list is too long for a link', () => {
    const long = parse(
      Array.from({ length: MAX_ENTRIES }, (_, i) => `語${String.fromCharCode(0x4e00 + i)},ご,${'m'.repeat(150)}`).join('\n'),
    );
    const submission = buildSubmission(long, '');
    expect(submission.fits).toBe(false);
    expect(submission.url).not.toContain('body=');
    // The text is still there to copy or download.
    expect(submission.body).toContain('```csv');
  });

  it('carries nothing about who sent it', () => {
    const { body, url } = buildSubmission(entries, '');
    expect(`${body}${url}`).not.toMatch(/@|uid|email/i);
  });
});
