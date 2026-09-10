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
import { createTokenizer, usesWord } from './lib/reading-check.mjs';
import {
  ambiguousHeadwords,
  confirms,
  contradicts,
  ensureIndices,
  readIndices,
} from './lib/tatoeba-index.mjs';

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
 * The wider window, used only for words the ordinary one leaves with nothing.
 *
 * Six characters is about the shortest thing that is still a sentence — 「山だ。」
 * teaches nobody anything — and sixty is where a fill-in question stops being
 * about a word and starts being reading comprehension. Between 44 and 60 the
 * question is worse; against no question at all it is better.
 */
const FALLBACK_MIN_LENGTH = 6;
const FALLBACK_MAX_LENGTH = 60;

/** How many fallback candidates to hold per word while indexing. */
const FALLBACK_POOL = 40;

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
  /*
   * A second pool, for words the first one leaves empty.
   *
   * The 8-44 character window is a judgement about what makes a good question,
   * and it is a good judgement — but it is applied to a corpus, not to a word,
   * and 55 words in these decks appear *only* in sentences outside it. For them
   * the choice is not between a good example and a better one; it is between a
   * six-character example and none at all, and none at all means the question
   * falls back to a bare reading and meaning.
   *
   * Kept apart rather than widening the window, so nothing in the ordinary case
   * changes: this pool is consulted only when the first is exhausted.
   */
  const wide = new Map();
  const lines = readFileSync(TSV, 'utf8').split('\n');

  let scanned = 0;

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const id = Number(parts[0]);
    const text = parts[2].trim();
    if (!text) continue;

    const inWindow = text.length >= MIN_LENGTH && text.length <= MAX_LENGTH;
    const inFallback = text.length >= FALLBACK_MIN_LENGTH && text.length <= FALLBACK_MAX_LENGTH;
    if (!inWindow && !inFallback) continue;

    if (inWindow) scanned += 1;

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

    const into = inWindow ? found : wide;

    for (const word of hits) {
      const bucket = into.get(word);
      const entry = { id, text, hits: hits.size, drill, foreign };
      if (bucket) {
        // The fallback pool is only ever read a few entries deep, and holding
        // every long sentence containing 人 costs a lot of memory to no end.
        if (into === found || bucket.length < FALLBACK_POOL) bucket.push(entry);
      } else {
        into.set(word, [entry]);
      }
    }
  }

  return { found, wide, scanned };
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
 *
 * Ranking, not choosing: what comes back is the whole list in order, because
 * the caller has one more question to ask of each candidate — whether the
 * sentence uses the word at all — and it can only ask that of a sentence it is
 * still holding. See `keepVerified`.
 */
function rank(entries, word) {
  /*
   * Whether the word is glued to a kanji on either side.
   *
   * 株主総会 contains 総会, read exactly as 総会 is read, so 株主［そうかい］が開かれた
   * is a fair question — the answer is right and the reading is right. It is
   * still a worse question than one where the word stands on its own, because
   * what the learner sees is half a compound with a hole in it. Where both
   * exist, the standing-alone one should be the example.
   *
   * A rank rather than a filter, deliberately. Filtering would take examples
   * away from words that mostly appear inside compounds — which is most of the
   * one-character entries in these decks — and a slightly odd question is worth
   * more than none.
   */
  const kanji = /[\u4e00-\u9fff]/;
  const glued = (text) => {
    const at = text.indexOf(word);
    if (at < 0) return 1;
    const before = at > 0 ? text[at - 1] : '';
    const after = text[at + word.length] ?? '';
    return kanji.test(before) || kanji.test(after) ? 1 : 0;
  };

  return [...entries]
    .map((entry) => ({ ...entry, glued: glued(entry.text) }))
    .sort(
      (a, b) =>
        a.drill - b.drill ||
        a.glued - b.glued ||
        a.hits - b.hits ||
        a.foreign - b.foreign ||
        a.text.length - b.text.length ||
        a.id - b.id,
    );
}

/**
 * How far down a word's ranking to keep looking for a usable sentence.
 *
 * Verification costs a morphological parse per sentence, so this is a budget
 * rather than a rule about language. A word whose forty best candidates all
 * turn out to use some other word that merely contains it does not have a
 * fortieth-best sentence worth showing; measured over the whole corpus, raising
 * this to 200 changed the number of words with an example by four.
 */
const MAX_EXAMINED = 40;

/**
 * And how far to look for a word that would otherwise have nothing.
 *
 * Only reached when the first forty produced no usable example, which is the
 * rarest 17% of the corpus, so the cost is a few thousand extra parses on a
 * build that already does 90,000.
 */
const DEEP_EXAMINED = 400;

/**
 * The best few sentences that genuinely use this word, read this way.
 *
 * The check that was missing. Sentences were filed by surface — every sentence
 * containing the characters 代 was filed under 代 — and the quiz then printed
 * the entry's reading beside the blank, so 「バス代はいくら？」 became a question
 * asking for 代 read しろ. 16.5% of the pairs this script used to ship were
 * wrong that way, and 730 words had nothing but wrong ones.
 *
 * See `scripts/lib/reading-check.mjs` for what "genuinely uses" means and why
 * every occurrence in the sentence has to check out rather than one.
 */
function keepVerified(tokenizer, indices, ambiguous, wide, entries, word, reading) {
  const kept = [];
  /*
   * On a word the corpus reads two ways, the analyser's guess is not enough.
   *
   * For 何時, 角, 摘む and 298 others, a sentence is kept only if the annotators
   * say in so many words that this is the reading used here — silence is not
   * agreement on a word where being wrong produces the exact question that
   * started this. Everywhere else silence is fine and only a contradiction
   * disqualifies, which is what keeps the modern half of the corpus usable.
   */
  const mustBeConfirmed = ambiguous.has(word);

  /*
   * The index is consulted first because it is a map lookup, and the analyser
   * second because it is a parse.
   *
   * Which matters most for exactly the words that need it most. 大 appears in
   * thousands of sentences and is read だい, おお and たい, so it needs
   * confirmation — and if the budget is spent parsing the forty best-ranked
   * sentences before asking whether any of them is confirmed, a word that
   * common can come away with nothing while a confirmed sentence sat at rank
   * 41. Filtering on the cheap test lets the whole ranking be searched.
   */
  const allowed = (entry) =>
    mustBeConfirmed
      ? confirms(indices, entry.id, word, reading)
      : !contradicts(indices, entry.id, word, reading);

  const take = (pool, budget) => {
    for (const entry of rank(pool, word).filter(allowed).slice(0, budget)) {
      if (kept.length === PER_WORD) return;
      if (!usesWord(tokenizer, entry.text, word, reading)) continue;
      kept.push({ id: entry.id, text: entry.text });
    }
  };

  take(entries, MAX_EXAMINED);

  /*
   * Nothing in the ordinary window? Then look further down it, and then outside
   * it.
   *
   * Both are last resorts and both are cheap, because they only ever run for a
   * word that would otherwise have no example at all — about 1,250 of 7,234,
   * and by definition the rarest ones. A deeper search finds words whose forty
   * best-ranked candidates all turned out to use some other word that merely
   * contains them; the wider window finds the 55 that appear only in sentences
   * too short or too long for the ordinary rule.
   */
  if (kept.length === 0) take(entries, DEEP_EXAMINED);
  if (kept.length === 0) take(wide.get(word) ?? [], DEEP_EXAMINED);

  return kept;
}

await ensureCorpus();
await ensureLanguages();

const native = readNativeSpeakers();
console.log(`${native.size} users declare Japanese as a native language`);

await ensureIndices();

console.log('Loading the morphological dictionary…');
const tokenizer = await createTokenizer();
const indices = readIndices();
const ambiguous = ambiguousHeadwords(indices);
console.log(
  `${indices.size} sentences carry Tatoeba's own word index, ` +
    `which reads ${ambiguous.size} headwords more than one way`,
);

const decks = readDecks();
const wanted = new Set();
for (const deck of decks) {
  for (const item of deck.items) wanted.add(item.word);
}
maxWordLength = Math.max(...[...wanted].map((w) => w.length));

console.log(`Indexing ${wanted.size} words across the Tatoeba corpus…`);
const { found, wide, scanned } = indexSentences(wanted, native);
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
    // No `continue` on an empty pool any more: the fallback tiers inside
    // `keepVerified` are exactly for words the ordinary window has nothing for.
    if (!entries && !wide.has(item.word)) continue;

    /*
     * Keyed by item id — surface *and* reading — because that is what a
     * question is about.
     *
     * It used to be keyed by surface, with a comment saying two entries
     * differing only by reading "share the same written word and so the same
     * sentences". They share the written word. They do not share the sentences:
     * 弾く read はじく is not 弾く read ひく, and a sentence about playing the
     * guitar is a wrong question for the first and a right one for the second.
     * 237 of the 6,982 surfaces in the decks carry more than one reading.
     */
    const kept = keepVerified(
      tokenizer,
      indices,
      ambiguous,
      wide,
      entries ?? [],
      item.word,
      item.reading,
    );
    if (kept.length === 0) continue;

    pack[item.id] = kept;
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
