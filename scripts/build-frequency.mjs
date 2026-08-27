/**
 * Counts how often each kanji and word actually appears in Japanese.
 *
 * Run with `npm run frequency`. Reads the Tatoeba export already downloaded by
 * `npm run sentences` and writes `data/frequency.json`, which `build-decks.mjs`
 * turns into an introduction order.
 *
 * ## Why this matters more than it sounds
 *
 * Items are introduced easiest-JLPT-level-first, and *within* a level in
 * whatever order the CSV happened to be in — which is arbitrary. At eight new
 * items a day, N3 vocabulary alone is 194 days, so that arbitrary order decides
 * what you spend most of a year learning. Learning the thousandth-most-useful
 * word in a level before the most useful one is a real cost, paid daily.
 *
 * ## Why this corpus
 *
 * Because the app already ships sentences from it, so the frequencies and the
 * examples agree: a word ranked common here is one the learner will actually
 * meet in the fill-in and listening quizzes. A frequency list from newspaper
 * text would rank differently and match nothing else in the app.
 *
 * Its bias is worth naming. Tatoeba is largely translated sentences, and
 * English uses pronouns far more than Japanese does, so 彼 and 私 come out
 * higher than they would in native text. They are still words a beginner should
 * meet early, so the bias does not hurt the ordering it is used for.
 *
 * ## Counting words
 *
 * By substring, without a morphological analyser. That overcounts short words
 * appearing inside longer ones — 人 is credited for every 人間 — and pulls
 * one-character words up.
 *
 * That is left uncorrected, deliberately: those words genuinely are more
 * frequent and more useful, and the alternative is a tokeniser, which is a
 * megabyte of dictionary and a new failure mode to decide an ordering that only
 * needs to be roughly right. The counts are a ranking signal, not a statistic
 * anyone should quote.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSV = resolve(ROOT, 'data/tatoeba/jpn_sentences.tsv');
const OUT = resolve(ROOT, 'data/frequency.json');

const KANJI_START = 0x4e00;
const KANJI_END = 0x9fff;

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

if (!existsSync(TSV)) {
  console.error(
    `Missing ${TSV}.\nRun \`npm run sentences\` first — it downloads the corpus this reads.`,
  );
  process.exit(1);
}

console.log('Reading the corpus…');
const sentences = [];
for (const line of readFileSync(TSV, 'utf8').split('\n')) {
  const parts = line.split('\t');
  if (parts.length >= 3 && parts[2].trim()) sentences.push(parts[2].trim());
}

/* --- Kanji: one pass over every character --------------------------------- */

const kanji = {};
for (const sentence of sentences) {
  for (const char of sentence) {
    const code = char.codePointAt(0);
    if (code >= KANJI_START && code <= KANJI_END) {
      kanji[char] = (kanji[char] ?? 0) + 1;
    }
  }
}

/* --- Words: one pass, checking every substring against the corpus ---------- */

const words = {};
const wanted = new Set(readCsv('Vocab.csv').map((row) => row.Kanji).filter(Boolean));
const maxLength = Math.max(...[...wanted].map((w) => w.length));

console.log(`Counting ${wanted.size} words across ${sentences.length} sentences…`);

for (const sentence of sentences) {
  // Every distinct wanted word this sentence contains. Counted once per
  // sentence rather than once per occurrence: a sentence that repeats a word is
  // still one attestation of it, and counting repeats rewards verbose examples.
  const seen = new Set();

  for (let i = 0; i < sentence.length; i += 1) {
    const limit = Math.min(maxLength, sentence.length - i);
    for (let length = 1; length <= limit; length += 1) {
      const candidate = sentence.slice(i, i + length);
      if (wanted.has(candidate)) seen.add(candidate);
    }
  }

  for (const word of seen) words[word] = (words[word] ?? 0) + 1;
}

writeFileSync(
  OUT,
  `${JSON.stringify({
    source: 'Tatoeba Japanese sentences (CC-BY 2.0 FR)',
    sentences: sentences.length,
    generatedAt: new Date().toISOString(),
    note: 'Word counts are per sentence and by substring; see scripts/build-frequency.mjs.',
    kanji,
    words,
  })}\n`,
);

const kanjiSeen = Object.keys(kanji).length;
const wordsSeen = Object.values(words).filter((n) => n > 0).length;

console.log(`\n  kanji attested : ${kanjiSeen}`);
console.log(`  words attested : ${wordsSeen} of ${wanted.size} (${((wordsSeen / wanted.size) * 100).toFixed(0)}%)`);

const topKanji = Object.entries(kanji).sort((a, b) => b[1] - a[1]).slice(0, 12);
const topWords = Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log(`\n  most frequent kanji: ${topKanji.map(([c, n]) => `${c}(${n})`).join(' ')}`);
console.log(`  most frequent words: ${topWords.map(([w, n]) => `${w}(${n})`).join(' ')}`);
console.log(`\nWrote ${OUT}`);
