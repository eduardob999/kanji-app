/**
 * Builds the example-sentence packs the fill-in and listening quizzes use.
 *
 * Run with `npm run sentences`. Downloads the Tatoeba Japanese export if it is
 * not already in `data/tatoeba/` (3.4 MB compressed), then writes one pack per
 * JLPT level into `public/sentences/`.
 *
 * This replaces the CLI's `sentence_cache.py`, which called the Tatoeba API
 * live, mid-quiz, one word at a time. That made a session without a connection
 * a degraded session and put a network round-trip in front of a question —
 * neither of which an offline-first app can do. The whole corpus is 3.4 MB
 * compressed, so fetching it once at build time is strictly better.
 *
 * ## Licence
 *
 * Tatoeba sentences are CC-BY 2.0 FR, which requires attribution. The packs
 * carry the licence and a sentence id for every sentence, so any one of them
 * can be traced back to its contributor, and the About screen credits Tatoeba.
 * Do not strip the ids to save space.
 */
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DECK_DIR = resolve(ROOT, 'public/decks');
const OUT_DIR = resolve(ROOT, 'public/sentences');
const RAW_DIR = resolve(ROOT, 'data/tatoeba');
const ARCHIVE = resolve(RAW_DIR, 'jpn_sentences_detailed.tsv.bz2');
const TSV = resolve(RAW_DIR, 'jpn_sentences_detailed.tsv');
const SOURCE =
  'https://downloads.tatoeba.org/exports/per_language/jpn/jpn_sentences_detailed.tsv.bz2';

/* The detailed export rather than the plain one, for one extra column: the
   owner. It costs 0.9 MB more and it is what lets a sentence be ranked by who
   wrote it. */
const LANGS = resolve(RAW_DIR, 'user_languages.csv');
const LANGS_SOURCE = 'https://downloads.tatoeba.org/exports/user_languages.csv';

/**
 * Sentences containing these are translation exercises, not Japanese.
 *
 * Tatoeba's Japanese half is largely translated from English drill sentences,
 * and those carry the English original's cast. Measured on the 2026-09-03
 * export: 17,042 of the 239,494 sentences inside the length window contain one
 * of these, which is 7.1%, or one sentence in fourteen.
 *
 * They are grammatical. They are not what anyone says. This is the single
 * biggest reason the examples read oddly, and demoting them is worth more than
 * everything else in this file put together.
 *
 * See docs/SENTENCE-QUALITY.md for the measurements.
 */
const PLACEHOLDER_NAMES = ['トム', 'メアリー', 'メアリ', 'ジョン', 'ボブ'];

/** Sentences kept per word. */
const PER_WORD = 3;

/**
 * Length bounds, in characters.
 *
 * A four-character sentence gives no context to work the word out from; a
 * sixty-character one is a reading-comprehension exercise wearing a
 * vocabulary quiz's clothes, and on a phone it does not fit on screen with the
 * answer field.
 */
const MIN_LENGTH = 8;
const MAX_LENGTH = 44;

/** The longest vocabulary surface, so the substring scan knows where to stop. */
let maxWordLength = 8;

/** Usernames that declare Japanese at level 5, Tatoeba's "native". */
function readNativeSpeakers() {
  const native = new Set();
  if (!existsSync(LANGS)) return native;
  for (const line of readFileSync(LANGS, 'utf8').split('\n')) {
    const parts = line.split('\t');
    // lang, skill, username, details
    if (parts.length >= 3 && parts[0] === 'jpn' && parts[1] === '5') native.add(parts[2]);
  }
  return native;
}

async function ensureLanguages() {
  if (existsSync(LANGS)) return;
  mkdirSync(RAW_DIR, { recursive: true });
  console.log(`Downloading ${LANGS_SOURCE}`);
  const response = await fetch(LANGS_SOURCE);
  if (!response.ok) {
    // Not fatal: without it every sentence simply scores as non-native, and the
    // placeholder-name rule, which does the real work, is unaffected.
    console.warn(`  could not fetch user languages (${response.status}); skipping the native-speaker signal`);
    return;
  }
  await pipeline(response.body, createWriteStream(LANGS));
}

async function ensureCorpus() {
  if (existsSync(TSV)) return;

  mkdirSync(RAW_DIR, { recursive: true });

  if (!existsSync(ARCHIVE)) {
    console.log(`Downloading ${SOURCE}`);
    const response = await fetch(SOURCE);
    if (!response.ok) {
      throw new Error(`Tatoeba download failed: ${response.status} ${response.statusText}`);
    }
    await pipeline(response.body, createWriteStream(ARCHIVE));
  }

  console.log('Unpacking…');
  // bunzip2 rather than a JS decompressor: node has no bzip2 built in, and
  // adding a dependency for one build-time call is not worth it.
  const unpacked = spawnSync('bunzip2', ['-kf', ARCHIVE], { stdio: 'inherit' });
  if (unpacked.status !== 0 || !existsSync(TSV)) {
    throw new Error(
      'Could not unpack the Tatoeba archive. Install bzip2, or unpack ' +
        `${ARCHIVE} by hand and re-run.`,
    );
  }
}

function readDecks() {
  const files = readdirSync(DECK_DIR).filter((f) => f.startsWith('vocab-') && f.endsWith('.json'));
  if (files.length === 0) {
    throw new Error('No vocab decks found. Run `npm run decks` first.');
  }
  return files.map((f) => JSON.parse(readFileSync(resolve(DECK_DIR, f), 'utf8')));
}

/**
 * Every sentence that contains at least one wanted word, indexed by word.
 *
 * Scans each sentence for substrings that are words, rather than searching for
 * each word in each sentence. The naive way is 7,234 words times 249,000
 * sentences; this is one pass over the corpus with a bounded number of hash
 * lookups per character, which is the difference between minutes and seconds.
 */
function indexSentences(wanted, native) {
  const found = new Map();
  const lines = readFileSync(TSV, 'utf8').split('\n');

  let scanned = 0;

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const id = Number(parts[0]);
    const text = parts[2].trim();
    if (!text || text.length < MIN_LENGTH || text.length > MAX_LENGTH) continue;

    scanned += 1;

    const owner = parts[3] && parts[3] !== '\\N' ? parts[3] : null;
    const drill = PLACEHOLDER_NAMES.some((name) => text.includes(name)) ? 1 : 0;
    const foreign = owner && native.has(owner) ? 0 : 1;

    // Which wanted words this sentence contains, without duplicates.
    const hits = new Set();
    for (let i = 0; i < text.length; i += 1) {
      const limit = Math.min(maxWordLength, text.length - i);
      for (let length = 1; length <= limit; length += 1) {
        const candidate = text.slice(i, i + length);
        if (wanted.has(candidate)) hits.add(candidate);
      }
    }

    for (const word of hits) {
      const bucket = found.get(word);
      const entry = { id, text, hits: hits.size, drill, foreign };
      if (bucket) bucket.push(entry);
      else found.set(word, [entry]);
    }
  }

  return { found, scanned };
}

/**
 * Picks the sentences worth keeping for one word.
 *
 * This RANKS rather than filters, and the distinction is the whole design.
 * Filtering to native-written sentences was measured and rejected: it drops
 * words with at least one example from 90% to 80%, leaving 725 more words with
 * nothing, and it does not even buy quality — native-owned sentences carry the
 * placeholder names at 13.0% against 2.0% for the rest, because a native
 * translating an English drill sentence writes fluent artificial Japanese.
 * Ownership says who typed it, not what it is.
 *
 * Ranking keeps every sentence eligible and changes only what reaches the top
 * of each word's list, which is all a learner ever sees. In order:
 *
 * 1. NOT A DRILL SENTENCE. トム and company go last. This is the one that
 *    addresses what the examples actually read like.
 * 2. FEWER OTHER TARGET WORDS, so the blank cannot be filled by elimination.
 * 3. WRITTEN BY A NATIVE SPEAKER, as a weak tiebreak now that it is not being
 *    asked to carry weight it cannot bear.
 * 4. SHORTER, because the sentence exists to give just enough context.
 * 5. LOWEST ID, so the build is deterministic.
 */
function pick(entries) {
  return [...entries]
    .sort(
      (a, b) =>
        a.drill - b.drill ||
        a.hits - b.hits ||
        a.foreign - b.foreign ||
        a.text.length - b.text.length ||
        a.id - b.id,
    )
    .slice(0, PER_WORD)
    .map((entry) => ({ id: entry.id, text: entry.text }));
}

await ensureCorpus();
await ensureLanguages();

const native = readNativeSpeakers();
console.log(`${native.size} users declare Japanese as a native language`);

const decks = readDecks();
const wanted = new Set();
for (const deck of decks) {
  for (const item of deck.items) wanted.add(item.word);
}
maxWordLength = Math.max(...[...wanted].map((w) => w.length));

console.log(`Indexing ${wanted.size} words across the Tatoeba corpus…`);
const { found, scanned } = indexSentences(wanted, native);
console.log(`  scanned ${scanned} sentences within the length bounds`);

mkdirSync(OUT_DIR, { recursive: true });

let covered = 0;
let total = 0;
const report = [];

for (const deck of decks) {
  const pack = {};
  let deckCovered = 0;

  for (const item of deck.items) {
    total += 1;
    const entries = found.get(item.word);
    if (!entries) continue;

    // Keyed by surface rather than item id: two entries that differ only by
    // reading share the same written word and so the same sentences.
    if (!pack[item.word]) pack[item.word] = pick(entries);
    deckCovered += 1;
    covered += 1;
  }

  const file = `${deck.id}.json`;
  writeFileSync(
    resolve(OUT_DIR, file),
    `${JSON.stringify({
      id: deck.id,
      level: deck.level,
      source: 'Tatoeba (https://tatoeba.org)',
      licence: 'CC-BY 2.0 FR',
      sentences: pack,
    })}\n`,
  );

  report.push({ id: deck.id, items: deck.items.length, covered: deckCovered });
}

console.log('\n  deck        words  with sentences');
for (const row of report) {
  const percent = row.items === 0 ? 0 : Math.round((row.covered / row.items) * 100);
  console.log(
    `  ${row.id.padEnd(10)}  ${String(row.items).padStart(5)}  ${String(row.covered).padStart(7)} (${percent}%)`,
  );
}
console.log(`\n  ${covered} of ${total} words have at least one sentence (${Math.round((covered / total) * 100)}%).`);
console.log('  Words without one still work as fill-in questions — they fall back to the');
console.log('  reading-and-meaning prompt, exactly as the CLI did when Tatoeba returned nothing.');
