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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/**
 * A kana hint appended to a meaning, as in "every month (\u3052)".
 *
 * This is a deliberate convention in the source data, not noise: 433 entries
 * carry one. When a surface has two readings, the meaning alone cannot tell you
 * which is being asked for, so a distinguishing kana from the reading is
 * appended to the prompt. It is the difference between an answerable question
 * and a coin flip.
 *
 * Anything that would erase or blur one of these is a bug.
 */
const KANA_TAG = /[\uff08(]\s*[\u3040-\u309f\u30a0-\u30ff]+\s*[)\uff09]\s*$/;

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

    // Never merge across a disambiguator. Two entries carrying one are being
    // held apart on purpose, and joining their meanings would produce a prompt
    // like "shop (\u307f); shop (\u3066)" that answers itself for neither reading.
    // Same word *and* same reading *and* a tag should be impossible; if the data
    // ever gets there, say so rather than quietly averaging it away.
    if (KANA_TAG.test(entry.meaning) || KANA_TAG.test(existing.meaning)) {
      console.warn(
        `  ! ${entry.word}/${entry.reading} is duplicated *and* carries a kana` +
          ' disambiguator; keeping both rather than merging. Check the source data.',
      );
      byKey.set(`${key} ${byKey.size}`, { ...entry, meanings: [entry.meaning] });
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

/* --- Introduction order --------------------------------------------------- */

/**
 * How far apart to push two entries that share a written form.
 *
 * Frequency alone puts them adjacent — the two readings of 分 have identical
 * counts, so they sort together — and introducing まいげつ and まいつき on the
 * same day is the most confusable possible pairing at the worst possible
 * moment.
 *
 * Twenty places within a level is a couple of weeks apart at the default rate:
 * long enough for the first reading to have been answered several times before
 * the second turns up.
 */
const SAME_SURFACE_SPACING = 20;

/**
 * Assigns each item its place in the introduction queue *for its level*.
 *
 * Ordered by how often the thing actually appears in Japanese, because within a
 * level the previous order was whatever the CSV happened to be in — and at
 * eight new items a day, N3 vocabulary alone is 194 days, so that arbitrary
 * order decided what a learner spent most of a year on.
 *
 * **Per level, not globally**, and that distinction is the whole reason the
 * spacing below works. Ranking the whole corpus at once put 金/かね and 金/きん
 * thirty global ranks apart — but the planner introduces within a level, and
 * only eight of those thirty items were in N3, so they arrived eight apart. In
 * the queue that actually exists, the gap has to be measured in the queue that
 * actually exists.
 *
 * Items the corpus never attests keep a rank, at the end. They are not dropped:
 * an absence in a 249,000-sentence corpus of everyday speech means "rare", not
 * "not a word".
 */
function assignRanks(items, counts, surfaceOf) {
  const scored = items.map((item, order) => ({
    item,
    count: counts[surfaceOf(item)] ?? 0,
    order,
  }));

  // Commonest first; the original order breaks ties so the result is stable.
  scored.sort((a, b) => b.count - a.count || a.order - b.order);

  const seenSurface = new Map();
  const placed = scored.map((entry, position) => {
    const surface = surfaceOf(entry.item);
    const seen = seenSurface.get(surface) ?? 0;
    seenSurface.set(surface, seen + 1);
    return { item: entry.item, at: position + seen * SAME_SURFACE_SPACING };
  });

  placed.sort((a, b) => a.at - b.at);
  placed.forEach((entry, index) => {
    entry.item.rank = index + 1;
  });
}

function loadFrequency() {
  const path = resolve(ROOT, 'data/frequency.json');
  if (!existsSync(path)) {
    console.warn(
      '  ! data/frequency.json is missing, so items keep their CSV order.\n' +
        '    Run `npm run sentences` then `npm run frequency` to build it.',
    );
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8'));
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

function buildKanji(frequency) {
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

  return LEVELS.map((level) => {
    const forLevel = buckets.get(level);
    if (frequency) assignRanks(forLevel, frequency.kanji, (item) => item.kanji);
    return writeDeck(
      'kanji',
      level,
      forLevel.map(({ level: _level, ...item }) => item),
    );
  });
}

/**
 * Marks prompts that more than one reading legitimately answers.
 *
 * The disambiguator convention covers most of the corpus, but four surfaces
 * slip through with two readings behind one identical prompt - \u56db as both
 * \u3057 and \u3088\u3093 for "four", and three others. Asked as a reading question those
 * are coin flips, and marking a coin flip wrong teaches nothing and tells the
 * scheduler the learner has forgotten something they have not.
 *
 * So the item records every reading its own prompt admits, and the quiz accepts
 * any of them. Fixing the source data by adding disambiguators would be better
 * and would make this pass find nothing; until then it stops the schedule being
 * poisoned by an unanswerable question.
 */
function markUnanswerablePrompts(items) {
  const bySurface = new Map();
  for (const item of items) {
    const group = bySurface.get(item.word);
    if (group) group.push(item);
    else bySurface.set(item.word, [item]);
  }

  const flagged = [];

  for (const group of bySurface.values()) {
    if (group.length < 2) continue;

    const byPrompt = new Map();
    for (const item of group) {
      const prompt = normaliseMeaning(item.meaning);
      const sharing = byPrompt.get(prompt);
      if (sharing) sharing.push(item);
      else byPrompt.set(prompt, [item]);
    }

    for (const sharing of byPrompt.values()) {
      const readings = [...new Set(sharing.map((i) => i.reading))];
      if (readings.length < 2) continue;

      for (const item of sharing) item.accepts = readings;
      flagged.push(`${sharing[0].word} (${readings.join(', ')})`);
    }
  }

  if (flagged.length > 0) {
    console.warn(
      `  ! ${flagged.length} prompt(s) that more than one reading answers; all are` +
        ` accepted: ${flagged.join('; ')}`,
    );
    console.warn('    Adding a kana disambiguator to their meanings would fix this properly.');
  }
}

function buildVocab(frequency) {
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

  markUnanswerablePrompts(items);

  const { buckets, strays } = bucketByLevel(items);
  if (strays.length > 0) {
    console.warn(`  ! ${strays.length} vocab entries with an unrecognised level, skipped`);
  }

  return LEVELS.map((level) => {
    const forLevel = buckets.get(level);
    if (frequency) assignRanks(forLevel, frequency.words, (item) => item.word);
    return writeDeck(
      'vocab',
      level,
      forLevel.map(({ level: _level, ...item }) => item),
    );
  });
}

mkdirSync(OUT_DIR, { recursive: true });

console.log('Building decks from data/*.csv:');
const frequency = loadFrequency();
console.log('kanji');
const kanjiDecks = buildKanji(frequency);
console.log('vocab');
const vocabDecks = buildVocab(frequency);

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
