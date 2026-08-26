/**
 * Salvages what is real out of the CLI's scores.
 *
 * Run with `npm run migrate`. Reads `data/legacy-scores.txt` — a dump the CLI
 * wrote at version 0.6.17 — and emits `public/legacy-seed.json`, which the app
 * offers to import once, at first sign-in.
 *
 * ## Why most of that file is not progress
 *
 * `reset_scores` in the CLI set every item to a baseline derived from its JLPT
 * level (N5 to 0, N4 to 1, … N1 to 4). `update_score` then added 1 for each
 * correct answer and dropped to 0 on a miss. So a score is only evidence of
 * anything in the amount by which it exceeds its own level's baseline, and
 * measured that way the file holds roughly 1,100 real streaks out of ~16,000
 * numbers. The rest is the JLPT level, restated.
 *
 * This script emits **only** the items with a streak. Everything else gets no
 * seeded memory at all, and its level decides introduction order instead —
 * which is what `sessionPlanner.ts` already does with unseen material.
 *
 * Fabricating memory for 15,000 items nobody has been tested on would be worse
 * than starting clean: it would schedule confidently on an invention, and it
 * would poison the weight fitting in `optimiser.ts` from the first session,
 * because the model would be fitted against reviews that never happened.
 *
 * ## The join
 *
 * `scores.txt` is a row-ordered dump of both CSVs with no ids in it, so entries
 * are matched to rows by position. That is only safe if it is checked, so every
 * row's key is compared and any mismatch aborts the whole run rather than
 * silently seeding the wrong words.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCORES = resolve(ROOT, 'data/legacy-scores.txt');
const DECK_DIR = resolve(ROOT, 'public/decks');
const OUT = resolve(ROOT, 'public/legacy-seed.json');

/** What `reset_scores` set each level to, and therefore what counts as zero. */
const BASELINE = { 5: 0, 4: 1, 3: 2, 2: 3, '1a': 4, '1b': 4, '1c': 4, '1d': 4 };

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readCsv(name) {
  const rows = parseCsv(readFileSync(resolve(ROOT, 'data', name), 'utf8')).filter((r) =>
    r.some((c) => c.trim() !== ''),
  );
  const header = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(header.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/** Every item id the decks actually contain, so nothing is seeded for a word that was dropped. */
function knownIds() {
  const ids = new Set();
  for (const file of readdirSync(DECK_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
    const deck = JSON.parse(readFileSync(resolve(DECK_DIR, file), 'utf8'));
    for (const item of deck.items) ids.add(item.id);
  }
  return ids;
}

if (!existsSync(SCORES)) {
  console.error(`Missing ${SCORES}. Copy it from the CLI's source/public/scores.txt.`);
  process.exit(1);
}
if (!existsSync(DECK_DIR)) {
  console.error('No decks found. Run `npm run decks` first.');
  process.exit(1);
}

const lines = readFileSync(SCORES, 'utf8').split('\n');
const kanjiStart = lines.indexOf('Kanji Scores:') + 1;
const vocabStart = lines.indexOf('Vocab Scores:');

if (kanjiStart === 0 || vocabStart < 0) {
  console.error('Could not find the section headers in the scores file.');
  process.exit(1);
}

const kanjiLines = lines.slice(kanjiStart, vocabStart).filter((l) => l.trim());
const vocabLines = lines.slice(vocabStart + 1).filter((l) => l.trim());

const kanjiRows = readCsv('Kanji.csv');
const vocabRows = readCsv('Vocab.csv');

if (kanjiLines.length !== kanjiRows.length || vocabLines.length !== vocabRows.length) {
  console.error(
    `Row counts disagree: ${kanjiLines.length} kanji scores against ${kanjiRows.length} rows, ` +
      `${vocabLines.length} vocab scores against ${vocabRows.length}. The join is by position, ` +
      'so it cannot proceed.',
  );
  process.exit(1);
}

const ids = knownIds();
const entries = [];
let mismatches = 0;
let dropped = 0;
const distribution = new Map();

function record(mode, level, itemId, streak) {
  if (streak <= 0) return;
  if (!ids.has(itemId)) {
    dropped += 1;
    return;
  }
  entries.push({ m: mode, l: level, i: itemId, k: streak });
  distribution.set(streak, (distribution.get(streak) ?? 0) + 1);
}

kanjiLines.forEach((line, index) => {
  const row = kanjiRows[index];
  const separator = line.lastIndexOf(': ');
  const key = line.slice(0, separator);
  const score = Number(line.slice(separator + 2));

  if (key !== row.Kanji) {
    mismatches += 1;
    return;
  }
  record('kanji', row.Level, row.Kanji, score - BASELINE[row.Level]);
});

const VOCAB_LINE = /^(.*): Vocab Quiz Score = (-?\d+), Filling Quiz Score = (-?\d+)$/;

vocabLines.forEach((line, index) => {
  const row = vocabRows[index];
  const match = VOCAB_LINE.exec(line);
  if (!match) {
    mismatches += 1;
    return;
  }

  const [, key, vocabScore, fillingScore] = match;
  if (key !== row.Kanji) {
    mismatches += 1;
    return;
  }

  const baseline = BASELINE[row.Level];
  // Word and reading, matching the ids build-decks.mjs writes.
  const id = `${row.Kanji}|${row.Reading}`;

  record('vocab-reading', row.Level, id, Number(vocabScore) - baseline);
  // The CLI wrote fill-in and listening to one column, which is why they share
  // a review mode here. See domain/modes.ts.
  record('vocab-writing', row.Level, id, Number(fillingScore) - baseline);
});

if (mismatches > 0) {
  console.error(
    `${mismatches} row(s) did not line up between the scores file and the CSVs. The join is by ` +
      'position and cannot be trusted, so nothing was written.',
  );
  process.exit(1);
}

writeFileSync(
  OUT,
  `${JSON.stringify({
    source: 'PracticeJapanese scores.txt (CLI v0.6.17)',
    generatedAt: new Date().toISOString(),
    note: 'Only items whose score exceeded their JLPT level baseline; see scripts/migrate-scores.mjs.',
    entries,
  })}\n`,
);

const total = kanjiLines.length + vocabLines.length * 2;
console.log(`Read ${kanjiLines.length} kanji and ${vocabLines.length} vocab rows, 0 mismatches.`);
console.log(`\n  streak  items`);
for (const streak of [...distribution.keys()].sort((a, b) => a - b)) {
  console.log(`  ${String(streak).padStart(6)}  ${String(distribution.get(streak)).padStart(5)}`);
}
console.log(
  `\n  ${entries.length} of ${total} scores carry a real streak (${((entries.length / total) * 100).toFixed(1)}%).`,
);
if (dropped > 0) {
  console.log(`  ${dropped} skipped: the word is no longer in a deck (merged or dropped).`);
}
console.log(`\nWrote ${OUT}`);
