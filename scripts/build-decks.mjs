/**
 * Compiles data/*.csv into the per-level decks the app loads at runtime.
 *
 * Run with `npm run decks`. Output goes to public/decks/, which the service
 * worker precaches wholesale - the app has to work on a train.
 *
 * Two things here are more than a format change:
 *
 *   1. **Item ids.** A vocabulary item is identified by word *and* reading,
 *      because the source genuinely contains words that only their reading
 *      tells apart - the two readings of every-month have different meanings.
 *      The CLI keyed its scores on the word alone and so could not tell them
 *      apart at all.
 *
 *   2. **Deduplication.** 45 vocabulary entries appear twice, at two different
 *      JLPT levels, with meanings that are usually the same idea written twice
 *      ("to clean, to sweep" at N5 and "cleaning,sweeping" at N3). Left alone
 *      these become two independently scheduled items for one word, which is
 *      review effort spent on the CSV's history rather than on Japanese. See
 *      `dedupe` below for what is kept.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'public/decks');

/**
 * JLPT levels, easiest first. This is also the order material is introduced in,
 * so it is the one place that ordering is written down.
 *
 * N1 is split into four because it is otherwise a third of the entire corpus in
 * a single undifferentiated block. The split comes from the CLI and is kept so
 * the old scores still line up.
 */
const LEVELS = ['5', '4', '3', '2', '1a', '1b', '1c', '1d'];

/* --- CSV ------------------------------------------------------------------ */

/**
 * A real CSV parser, because the meanings need one.
 *
 * 4,749 of the quote characters in Vocab.csv are there to protect commas inside
 * a meaning, as in "(1) aunt,(2) middle-aged lady". Splitting on commas yields
 * rows with anything up to 17 fields.
 */
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
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function readCsv(name) {
  const rows = parseCsv(readFileSync(resolve(ROOT, 'data', name), 'utf8')).filter((row) =>
    row.some((cell) => cell.trim() !== ''),
  );
  const header = rows.shift().map((h) => h.trim());
  return rows.map((row) => Object.fromEntries(header.map((key, i) => [key, (row[i] ?? '').trim()])));
}

/* --- Shaping -------------------------------------------------------------- */

/** The separator between a kanji's readings in the source column. */
const READING_SEPARATOR = '・';

/**
 * Kanji readings arrive as one separated string.
 *
 * The dots inside a reading are a different thing entirely - they mark where
 * the okurigana starts, in the KANJIDIC convention - so they are left alone.
 */
function splitReadings(field) {
  return field
    .split(READING_SEPARATOR)
    .map((r) => r.trim())
    .filter(Boolean);
}

/** For comparing two meanings that differ only in punctuation and case. */
function normaliseMeaning(meaning) {
  return meaning
    .toLowerCase()
    .replace(/[(),;/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Collapses entries that share a word and a reading.
 *
 * Keeps the **earliest** JLPT level, on the grounds that if a word is worth
 * teaching at N5 then meeting it again at N3 is not new material. Meanings are
 * unioned rather than overwritten, so a genuinely different sense survives -
 * "Aunt" and "(1) aunt,(2) middle-aged lady" both mean aunt, but the second
 * carries something the first does not. Meanings that differ only in
 * punctuation are dropped as the restatements they are.
 */
function dedupe(entries) {
  const byKey = new Map();
  let merged = 0;

  for (const entry of entries) {
    const key = `${entry.word} ${entry.reading}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { ...entry, meanings: [entry.meaning] });
      continue;
    }

    merged += 1;

    // Earliest level wins; LEVELS is ordered easiest first.
    if (LEVELS.indexOf(entry.level) < LEVELS.indexOf(existing.level)) {
      existing.level = entry.level;
    }

    const seen = existing.meanings.map(normaliseMeaning);
    if (entry.meaning && !seen.includes(normaliseMeaning(entry.meaning))) {
      existing.meanings.push(entry.meaning);
    }
  }

  return { entries: [...byKey.values()], merged };
}

/* --- Build ---------------------------------------------------------------- */

function bucketByLevel(items) {
  const buckets = new Map(LEVELS.map((level) => [level, []]));
  const strays = [];

  for (const item of items) {
    const bucket = buckets.get(item.level);
    if (bucket) bucket.push(item);
    else strays.push(item);
  }

  return { buckets, strays };
}

function writeDeck(type, level, items) {
  const id = `${type}-${level}`;
  const deck = { id, type, level, count: items.length, items };
  writeFileSync(resolve(OUT_DIR, `${id}.json`), `${JSON.stringify(deck)}\n`);
  return { id, type, level, count: items.length };
}

function buildKanji() {
  const rows = readCsv('Kanji.csv');
  const items = rows
    .filter((row) => row.Kanji)
    .map((row) => ({
      id: row.Kanji,
      kanji: row.Kanji,
      readings: splitReadings(row.Readings),
      meaning: row.Meaning,
      level: row.Level,
    }));

  const { buckets, strays } = bucketByLevel(items);
  if (strays.length > 0) {
    console.warn(`  ! ${strays.length} kanji with an unrecognised level, skipped`);
  }

  return LEVELS.map((level) =>
    writeDeck(
      'kanji',
      level,
      buckets.get(level).map(({ level: _level, ...item }) => item),
    ),
  );
}

function buildVocab() {
  const rows = readCsv('Vocab.csv');
  const raw = rows
    .filter((row) => row.Kanji)
    .map((row) => ({
      word: row.Kanji,
      reading: row.Reading,
      meaning: row.Meaning,
      level: row.Level,
    }));

  const { entries, merged } = dedupe(raw);
  console.log(`  merged ${merged} duplicate word/reading pairs`);

  const missingMeaning = entries.filter((e) => e.meanings.every((m) => !m)).length;
  if (missingMeaning > 0) {
    console.warn(
      `  ! ${missingMeaning} entries have no meaning; they still work as reading and` +
        ' fill-in questions, which do not need one',
    );
  }

  const items = entries.map((entry) => ({
    // Word and reading, so words that differ only by reading stay distinct.
    id: `${entry.word}|${entry.reading}`,
    word: entry.word,
    reading: entry.reading,
    meaning: entry.meanings.filter(Boolean).join('; '),
    level: entry.level,
  }));

  const { buckets, strays } = bucketByLevel(items);
  if (strays.length > 0) {
    console.warn(`  ! ${strays.length} vocab entries with an unrecognised level, skipped`);
  }

  return LEVELS.map((level) =>
    writeDeck(
      'vocab',
      level,
      buckets.get(level).map(({ level: _level, ...item }) => item),
    ),
  );
}

mkdirSync(OUT_DIR, { recursive: true });

console.log('Building decks from data/*.csv:');
console.log('kanji');
const kanjiDecks = buildKanji();
console.log('vocab');
const vocabDecks = buildVocab();

const decks = [...kanjiDecks, ...vocabDecks];
writeFileSync(
  resolve(OUT_DIR, 'index.json'),
  `${JSON.stringify({ levels: LEVELS, decks }, null, 2)}\n`,
);

console.log('\n  deck        items');
for (const deck of decks) {
  console.log(`  ${deck.id.padEnd(10)}  ${String(deck.count).padStart(5)}`);
}
console.log(`  ${'total'.padEnd(10)}  ${String(decks.reduce((n, d) => n + d.count, 0)).padStart(5)}`);
