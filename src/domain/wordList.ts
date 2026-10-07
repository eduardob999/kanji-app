/**
 * Word lists people send in, and the checking that happens before they leave.
 *
 * Pure: no React, no network. The panel calls `parseWordList` as someone types,
 * so everything here has to be cheap and has to say *why* a line was refused
 * rather than silently dropping it.
 *
 * **Why the submission is a GitHub issue and not a Firestore document.** The
 * rules (`firestore.rules`) are shared with GHAPP and say "you may touch your
 * own document and nothing else", which is the right rule for study data and
 * makes a shared inbox impossible without widening it for two apps. The repo
 * is public and the reviewer is the maintainer, so the review queue is the
 * issue tracker: it needs no backend, no rule change, and every submission
 * arrives somewhere a human will read it. The cost is that the sender needs a
 * GitHub account, which `buildSubmission` offsets with a copy and a download.
 *
 * Nothing about the sender goes into the text. A submission is published, so the
 * panel says so before it is sent, and this module only ever sees the words.
 */

import type { VocabItem } from './items';

export const MAX_ENTRIES = 150;
const MAX_WORD_LENGTH = 20;
const MAX_MEANING_LENGTH = 200;

/** A GitHub new-issue URL longer than this is refused by some browsers and proxies. */
const MAX_URL_LENGTH = 7000;

export const REPO_URL = 'https://github.com/eduardob999/kanji-app';

export type SuggestionStatus =
  /** Not in the decks: worth sending. */
  | 'new'
  /** Already taught, so sending it would only cost the reviewer time. */
  | 'known'
  /** The same word and reading earlier in the same list. */
  | 'repeat'
  /** Refused, with `note` saying what to fix. */
  | 'invalid';

export interface Suggestion {
  /** 1-based line in what was pasted, so a message can point at it. */
  line: number;
  word: string;
  reading: string;
  meaning: string;
  status: SuggestionStatus;
  note: string;
}

const JAPANESE = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ々〆ヶ]/;
const KANA_ONLY = /^[぀-ゟ゠-ヿー・]+$/;

/** A first line naming the columns, as a spreadsheet export has. */
const HEADER = /^(word|kanji|vocab|term|単語)\b/i;

/** Splits on commas that are not inside double quotes. */
function splitCsv(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;

  for (const char of line) {
    if (char === '"') quoted = !quoted;
    if ((char === ',' || char === '，') && !quoted) {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

function splitLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((part) => part.trim());

  // A meaning may itself contain commas, so only the first two commas outside
  // quotes separate columns and the rest belongs to the meaning.
  const parts = splitCsv(line);
  if (parts.length <= 3) return parts.map((part) => part.trim());
  return [parts[0]!, parts[1]!, parts.slice(2).map((part) => part.trim()).join(', ')].map((part) => part.trim());
}

function unquote(field: string): string {
  const match = /^"(.*)"$/.exec(field);
  return match ? match[1]!.replace(/""/g, '"') : field;
}

/**
 * What the decks already hold, as the two lookups a suggestion needs.
 *
 * With a reading, only that exact pair is a duplicate: the corpus has words
 * that differ only by reading and a suggestion may be the other one. Without
 * one, any entry for the written form counts.
 */
export interface KnownVocab {
  ids: ReadonlySet<string>;
  words: ReadonlySet<string>;
}

export function knownVocab(items: readonly Pick<VocabItem, 'id' | 'word'>[]): KnownVocab {
  return {
    ids: new Set(items.map((item) => item.id)),
    words: new Set(items.map((item) => item.word)),
  };
}

export function parseWordList(text: string, known: KnownVocab): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  let firstRow = true;

  const lines = text.replace(/^﻿/, '').split(/\r?\n/);

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;

    if (firstRow) {
      firstRow = false;
      if (HEADER.test(line)) return;
    }

    if (out.length >= MAX_ENTRIES) {
      if (out.length === MAX_ENTRIES) {
        out.push({
          line: index + 1,
          word: '',
          reading: '',
          meaning: '',
          status: 'invalid',
          note: `Only the first ${MAX_ENTRIES} words are read. Send the rest in a second list.`,
        });
      }
      return;
    }

    const [rawWord = '', rawReading = '', rawMeaning = ''] = splitLine(line).map(unquote);
    const word = rawWord.trim();
    const reading = rawReading.trim();
    const meaning = rawMeaning.trim();

    const entry = (status: SuggestionStatus, note = ''): Suggestion => ({
      line: index + 1,
      word,
      reading,
      meaning,
      status,
      note,
    });

    if (!JAPANESE.test(word)) return void out.push(entry('invalid', 'Not a Japanese word.'));
    if (word.length > MAX_WORD_LENGTH) {
      return void out.push(entry('invalid', `Longer than ${MAX_WORD_LENGTH} characters.`));
    }
    if (reading !== '' && !KANA_ONLY.test(reading)) {
      return void out.push(entry('invalid', 'The reading must be in kana.'));
    }
    if (meaning.length > MAX_MEANING_LENGTH) {
      return void out.push(entry('invalid', `The meaning is over ${MAX_MEANING_LENGTH} characters.`));
    }

    const key = `${word}|${reading}`;
    if (seen.has(key)) return void out.push(entry('repeat', 'Already earlier in this list.'));
    seen.add(key);

    const alreadyTaught = reading ? known.ids.has(key) : known.words.has(word);
    if (alreadyTaught) return void out.push(entry('known', 'Already in the decks.'));

    out.push(entry('new'));
  });

  return out;
}

export function countByStatus(entries: readonly Suggestion[]): Record<SuggestionStatus, number> {
  const counts: Record<SuggestionStatus, number> = { new: 0, known: 0, repeat: 0, invalid: 0 };
  for (const entry of entries) counts[entry.status] += 1;
  return counts;
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The words worth sending, as the CSV the review script reads back. */
export function toCsv(entries: readonly Suggestion[]): string {
  const rows = entries
    .filter((entry) => entry.status === 'new')
    .map((entry) => [entry.word, entry.reading, entry.meaning].map(csvField).join(','));
  return ['Word,Reading,Meaning', ...rows].join('\n');
}

export interface Submission {
  title: string;
  /** The issue body: a short header, the CSV in a fence, the sender's note. */
  body: string;
  /** Opens a pre-filled issue, or a blank one when the list is too long for a URL. */
  url: string;
  /** Whether `url` carries the whole list. When false the sender has to paste it. */
  fits: boolean;
}

export function buildSubmission(entries: readonly Suggestion[], note: string): Submission {
  const csv = toCsv(entries);
  const count = entries.filter((entry) => entry.status === 'new').length;
  const title = `Word list: ${count} ${count === 1 ? 'word' : 'words'}`;

  // A fence the list cannot close early, whatever is in it.
  const safeCsv = csv.replace(/`/g, "'");
  const trimmedNote = note.trim().replace(/`/g, "'");

  const body = [
    'Submitted from the Word list screen in Kanjiba.',
    '',
    '```csv',
    safeCsv,
    '```',
    ...(trimmedNote ? ['', '**Note**', '', trimmedNote] : []),
  ].join('\n');

  const full = `${REPO_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  const fits = full.length <= MAX_URL_LENGTH;

  return {
    title,
    body,
    fits,
    url: fits ? full : `${REPO_URL}/issues/new?title=${encodeURIComponent(title)}`,
  };
}
