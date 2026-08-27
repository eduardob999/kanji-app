/**
 * Builds the handwriting reference patterns.
 *
 * Run with `npm run strokes`. Clones Kanji Canvas into `data/kanjicanvas/` if
 * it is not already there, then writes `public/strokes/kanji.json` and
 * `public/strokes/kana.json`.
 *
 * ## The size problem, and the one-line fix
 *
 * Kanji Canvas publishes its reference patterns as 6.37 MB of JavaScript. That
 * is five times everything else this app ships, and it is what made handwriting
 * look impractical the first time round.
 *
 * Almost all of it is noise. The coordinates sit on a 0-255 grid and are stored
 * with fourteen decimal places — `130.8810284025758` for what is a pixel
 * position. Rounding to integers loses nothing a distance matcher can see and
 * takes the file to 1.56 MB, or 1.41 MB restricted to this corpus, which is
 * 454 kB over the wire. Smaller than the sentence packs.
 *
 * ## Two files, not sixteen
 *
 * The plan said split per JLPT level, and that turned out to be wrong: a
 * vocabulary word draws its characters from wherever they happen to come from,
 * so writing 毎月 at N5 needs patterns that are not in the N5 set. One kanji
 * file it is, fetched once when handwriting is first used and cached by the
 * service worker from then on. It is deliberately **not** precached — someone
 * who never turns handwriting on never downloads it.
 *
 * ## Kana
 *
 * `ref-patterns.js` contains no kana at all, which the vocabulary modes need
 * for okurigana. The repository does ship hiragana and katakana as raw stroke
 * XML, so those are converted here through the same
 * `momentNormalize` → `extractFeatures` pipeline the app uses at recognition
 * time — imported from `src/input/handwriting/pipeline.js` rather than
 * reimplemented, so the two cannot drift.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { extractFeatures, momentNormalize } from '../src/input/handwriting/pipeline.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = resolve(ROOT, 'data/kanjicanvas');
const DECK_DIR = resolve(ROOT, 'public/decks');
const OUT_DIR = resolve(ROOT, 'public/strokes');
const REPO = 'https://github.com/asdfjkl/kanjicanvas.git';

/** The resampling interval the published patterns were generated with. */
const FEATURE_INTERVAL = 20.0;

function ensureSource() {
  if (existsSync(resolve(SOURCE_DIR, 'docs/resources/javascript/ref-patterns.js'))) return;

  console.log(`Cloning ${REPO}…`);
  mkdirSync(dirname(SOURCE_DIR), { recursive: true });
  const cloned = spawnSync('git', ['clone', '--depth', '1', REPO, SOURCE_DIR], {
    stdio: 'inherit',
  });
  if (cloned.status !== 0) {
    throw new Error(`Could not clone ${REPO}. Clone it to ${SOURCE_DIR} by hand and re-run.`);
  }
}

/** Loads the published patterns, which are already feature-extracted. */
function loadRefPatterns() {
  const source = readFileSync(
    resolve(SOURCE_DIR, 'docs/resources/javascript/ref-patterns.js'),
    'utf8',
  );
  // The file assigns onto a namespace object and is 6 MB of array literal, so
  // it is evaluated rather than parsed.
  const context = { KanjiCanvas: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { timeout: 180_000 });

  const patterns = context.KanjiCanvas.refPatterns;
  if (!Array.isArray(patterns)) {
    throw new Error('ref-patterns.js did not define KanjiCanvas.refPatterns.');
  }
  return patterns;
}

/** The `<stroke><point x= y=/></stroke>` format the kana are stored in. */
function parseStrokeXml(text) {
  const strokes = [];
  for (const block of text.split('<stroke>').slice(1)) {
    const body = block.split('</stroke>')[0];
    const points = [...body.matchAll(/<point\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    if (points.length > 0) strokes.push(points);
  }
  return strokes;
}

/** Integer coordinates. This is the whole size saving. */
function quantise(pattern) {
  return pattern.map((stroke) => stroke.map(([x, y]) => [Math.round(x), Math.round(y)]));
}

function loadKana() {
  const out = [];

  for (const folder of ['hiragana', 'katakana']) {
    const dir = resolve(SOURCE_DIR, folder);
    if (!existsSync(dir)) {
      console.warn(`  ! ${folder}/ is missing from the source repository; skipped`);
      continue;
    }

    for (const file of readdirSync(dir).filter((f) => f.endsWith('.xml'))) {
      // Filenames are the codepoint in hex: 3042.xml is あ.
      const character = String.fromCodePoint(parseInt(file.slice(0, -4), 16));
      const raw = parseStrokeXml(readFileSync(resolve(dir, file), 'utf8'));
      if (raw.length === 0) continue;

      const features = extractFeatures(momentNormalize(raw), FEATURE_INTERVAL);
      out.push([character, raw.length, quantise(features)]);
    }
  }

  return out;
}

/** Every kanji this app can ask about. */
function corpusKanji() {
  const wanted = new Set();
  for (const file of readdirSync(DECK_DIR).filter((f) => f.startsWith('kanji-'))) {
    const deck = JSON.parse(readFileSync(resolve(DECK_DIR, file), 'utf8'));
    for (const item of deck.items) wanted.add(item.kanji);
  }
  return wanted;
}

ensureSource();

if (!existsSync(DECK_DIR)) {
  console.error('No decks found. Run `npm run decks` first.');
  process.exit(1);
}

console.log('Loading published reference patterns…');
const published = loadRefPatterns();
const wanted = corpusKanji();

const kanji = [];
const covered = new Set();
for (const [character, strokes, pattern] of published) {
  if (!wanted.has(character)) continue;
  kanji.push([character, strokes, quantise(pattern)]);
  covered.add(character);
}

const missing = [...wanted].filter((k) => !covered.has(k));

console.log('Converting kana…');
const kana = loadKana();

mkdirSync(OUT_DIR, { recursive: true });

const licence = {
  source: 'Kanji Canvas (https://github.com/asdfjkl/kanjicanvas)',
  copyright: '(c) 2019-2024 Dominik Klein; (c) 2020 Seth Clydesdale',
  licence: 'MIT',
  derivedFrom: 'KanjiVG (c) Ulrich Apel, CC BY-SA 3.0',
};

writeFileSync(
  resolve(OUT_DIR, 'kanji.json'),
  `${JSON.stringify({ ...licence, count: kanji.length, patterns: kanji })}\n`,
);
writeFileSync(
  resolve(OUT_DIR, 'kana.json'),
  `${JSON.stringify({ ...licence, count: kana.length, patterns: kana })}\n`,
);

// The app needs to know which characters it cannot check a drawing against, so
// it can fall back to the keyboard for them rather than accepting a drawing
// nobody can score.
writeFileSync(
  resolve(OUT_DIR, 'unsupported.json'),
  `${JSON.stringify({
    note: 'Kanji in this corpus with no reference pattern; handwriting falls back to the keyboard.',
    characters: missing.sort(),
  })}\n`,
);

const raw = published.reduce((n, p) => n + JSON.stringify(p).length, 0);
const built = JSON.stringify(kanji).length + JSON.stringify(kana).length;

console.log(`\n  published patterns   ${(raw / 1e6).toFixed(2)} MB`);
console.log(`  written              ${(built / 1e6).toFixed(2)} MB`);
console.log(`\n  kanji covered        ${kanji.length} of ${wanted.size}`);
console.log(`  kana                 ${kana.length}`);
console.log(`  without a pattern    ${missing.length}`);
if (missing.length > 0) {
  console.log(`    ${missing.slice(0, 12).join(' ')}${missing.length > 12 ? ' …' : ''}`);
}
