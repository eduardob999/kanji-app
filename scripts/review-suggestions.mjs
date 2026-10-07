/**
 * Reviews a word list sent in through the app's "Send a word list" screen.
 *
 *   npm run review -- path/to/issue-body.md          report only
 *   npm run review -- path/to/list.csv --add 3       also append the accepted rows
 *
 * The input is whatever the sender produced: the issue body copied from GitHub
 * (the list is in a ```csv fence), or the .csv they downloaded.
 *
 * Reporting is the default, and `--add` is the deliberate act. A word is only
 * accepted for adding when it
 *
 *   - is not already in data/Vocab.csv, by word *and* reading;
 *   - is not listed in data/archaic.csv, which would drop it from the decks
 *     again at the next build;
 *   - has a reading and a meaning. Neither is guessed. The decks' rule is that a
 *     visible gap beats an invented gloss (see data/README.md), so a row missing
 *     either is listed for the reviewer to complete, not appended half-made.
 *
 * Nothing is appended without a level, because the level is the reviewer's
 * judgement and not the sender's.
 *
 * What this does not do: rebuild the sentence packs or data/frequency.json. Those
 * are committed on purpose and rebuilding them is a separate, deliberate act (see
 * CLAUDE.md). A word added here therefore has no example sentence and ranks last
 * in its level until someone chooses to run `npm run sentences`. Every other
 * check in `npm test` still holds, because corpus.test.ts only forbids the
 * combination of no meaning, no sentence and a homophone.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS = ['5', '4', '3', '2', '1a', '1b', '1c', '1d'];

function parseArgs(argv) {
  const args = { file: null, level: null, add: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--add') {
      args.add = true;
      args.level = argv[i + 1] ?? null;
      i += 1;
    } else if (!args.file) {
      args.file = argv[i];
    }
  }
  return args;
}

/** One CSV record per line; quotes protect commas, "" is a quote. */
function parseLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

function csvField(value) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The list inside a ```csv fence if there is one, otherwise the whole text. */
function extractList(text) {
  const fenced = /```csv\r?\n([\s\S]*?)```/.exec(text);
  return fenced ? fenced[1] : text;
}

function readRows(path) {
  return readFileSync(path, 'utf8')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map(parseLine);
}

const { file, level, add } = parseArgs(process.argv.slice(2));

if (!file) {
  console.error('Usage: npm run review -- <file> [--add <level>]');
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`No such file: ${file}`);
  process.exit(2);
}
if (add && !LEVELS.includes(level)) {
  console.error(`--add needs a level, one of: ${LEVELS.join(', ')}`);
  process.exit(2);
}

const vocabPath = resolve(ROOT, 'data/Vocab.csv');
const existing = readRows(vocabPath).slice(1);
const haveIds = new Set(existing.map(([word, reading]) => `${word}|${reading}`));
const haveWords = new Set(existing.map(([word]) => word));

const archaicPath = resolve(ROOT, 'data/archaic.csv');
const archaic = new Set(
  existsSync(archaicPath)
    ? readRows(archaicPath)
        .slice(1)
        .map(([word, reading]) => `${word}|${reading}`)
    : [],
);

const submitted = extractList(readFileSync(file, 'utf8'))
  .split(/\r?\n/)
  .filter((line) => line.trim() !== '' && !/^word\b/i.test(line.trim()))
  .map(parseLine);

const verdicts = { accept: [], known: [], archaic: [], incomplete: [], repeat: [] };
const seen = new Set();

for (const [word = '', reading = '', meaning = ''] of submitted) {
  const id = `${word}|${reading}`;
  const row = { word, reading, meaning };

  // Archaic is tested before known: archaic words stay in Vocab.csv, so they would
  // otherwise always be reported as merely "already there".
  if (seen.has(id)) verdicts.repeat.push(row);
  else if (archaic.has(id)) verdicts.archaic.push(row);
  else if (haveIds.has(id) || (reading === '' && haveWords.has(word))) verdicts.known.push(row);
  else if (reading === '' || meaning === '') verdicts.incomplete.push(row);
  else verdicts.accept.push(row);

  seen.add(id);
}

const show = (rows) =>
  rows.map((r) => `    ${r.word}${r.reading ? `  ${r.reading}` : ''}${r.meaning ? `  ${r.meaning}` : ''}`);

console.log(`\n${submitted.length} submitted\n`);
const sections = [
  ['accept', 'Ready to add'],
  ['incomplete', 'Needs a reading or a meaning before it can be added (nothing is guessed)'],
  ['known', 'Already in Vocab.csv'],
  ['archaic', 'In data/archaic.csv, so the build would drop it again'],
  ['repeat', 'Repeated within the list'],
];
for (const [key, label] of sections) {
  if (verdicts[key].length === 0) continue;
  console.log(`  ${label}: ${verdicts[key].length}`);
  console.log(show(verdicts[key]).join('\n'));
  console.log('');
}

if (!add) {
  console.log(
    verdicts.accept.length > 0
      ? `Nothing was changed. To append the ${verdicts.accept.length} ready word(s): npm run review -- ${file} --add <level>\n`
      : 'Nothing to add.\n',
  );
  process.exit(0);
}

if (verdicts.accept.length === 0) {
  console.log('Nothing to add.\n');
  process.exit(0);
}

const raw = readFileSync(vocabPath, 'utf8');
const lines = verdicts.accept.map(
  ({ word, reading, meaning }) =>
    `${[word, reading, meaning].map(csvField).join(',')},0,0,${level}`,
);
appendFileSync(vocabPath, `${raw.endsWith('\n') ? '' : '\n'}${lines.join('\n')}\n`);

console.log(`Appended ${lines.length} row(s) to data/Vocab.csv at level ${level}.`);
console.log('Next: npm run decks, then npm test. Sentence packs and frequency.json were not rebuilt.\n');
