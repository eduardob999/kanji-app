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
 *
 * ## The 205
 *
 * Kanji Canvas covers 2,006 characters and this corpus wants 2,211. The rest
 * are mostly jinmeiyō — 哉, 舜, 慧, 麟 — and handwriting fell back to the
 * keyboard for every one of them. They are generated here from KanjiVG, which
 * Kanji Canvas itself derives from; see `lib/kanjivg.mjs` for why SVG paths
 * are as good as the digitised points the published patterns came from, and
 * the self-check below for the evidence rather than the argument.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';
import {
  coarseClassification,
  extractFeatures,
  fineClassification,
  momentNormalize,
} from '../src/input/handwriting/pipeline.js';
import { readKanjiVG } from './lib/kanjivg.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = resolve(ROOT, 'data/kanjicanvas');
const DECK_DIR = resolve(ROOT, 'public/decks');
const OUT_DIR = resolve(ROOT, 'public/strokes');
const REPO = 'https://github.com/asdfjkl/kanjicanvas.git';
const KANJIVG = resolve(ROOT, 'data/kanjivg.xml.gz');
const KANJIVG_URL =
  'https://github.com/KanjiVG/kanjivg/releases/download/r20250816/kanjivg-20250816.xml.gz';

/**
 * How well a regenerated pattern has to do before the generated ones are
 * trusted.
 *
 * Measured against characters Kanji Canvas already covers: rebuild them from
 * KanjiVG, hand each back to the recogniser, and see whether the published
 * pattern for that same character still comes first. It is the closest thing
 * to a ground truth available without a person drawing 205 kanji, and it fails
 * the build rather than warning, because a pattern nobody can be recognised by
 * is worse than an honest fallback to the keyboard.
 */
const SELF_CHECK_SAMPLE = 120;
const SELF_CHECK_FLOOR = 0.9;

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

function ensureKanjiVG() {
  if (existsSync(KANJIVG)) return;

  console.log(`Downloading ${KANJIVG_URL}…`);
  const fetched = spawnSync('curl', ['-sL', '--fail', '-o', KANJIVG, KANJIVG_URL], {
    stdio: 'inherit',
  });
  if (fetched.status !== 0) {
    console.error('Could not download KanjiVG; the 205 uncovered kanji will stay uncovered.');
  }
}

/**
 * Rebuild characters that are already covered, and see whether the recogniser
 * still knows them.
 *
 * The point is not that the numbers match — they will not, these are different
 * digitisations of the same strokes — but that a KanjiVG-derived pattern is
 * *interchangeable with* a published one as far as the classifier is
 * concerned. If it is, the generated 205 belong in the same file.
 */
function selfCheck(xml, refPatterns) {
  const sample = refPatterns
    .filter((entry) => entry[1] >= 2)
    .filter((_, i) => i % 23 === 0)
    .slice(0, SELF_CHECK_SAMPLE);

  const rebuilt = readKanjiVG(xml, new Set(sample.map((entry) => entry[0])));

  let checked = 0;
  let first = 0;
  const misses = [];

  for (const [character] of sample) {
    const strokes = rebuilt.get(character);
    if (!strokes) continue;
    checked += 1;

    const features = extractFeatures(momentNormalize(strokes), FEATURE_INTERVAL);
    const ranked = fineClassification(
      features,
      coarseClassification(features, refPatterns),
      refPatterns,
    );

    if (ranked[0] === character) first += 1;
    else misses.push(`${character}→${ranked.slice(0, 3).join('')}`);
  }

  return { checked, first, misses };
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

let missing = [...wanted].filter((k) => !covered.has(k));
let generated = 0;

if (missing.length > 0) {
  ensureKanjiVG();
}

if (missing.length > 0 && existsSync(KANJIVG)) {
  console.log(`Filling ${missing.length} gaps from KanjiVG…`);
  const xml = gunzipSync(readFileSync(KANJIVG)).toString('utf8');

  const check = selfCheck(xml, kanji);
  const rate = check.checked > 0 ? check.first / check.checked : 0;
  console.log(
    `  self-check           ${check.first}/${check.checked} rebuilt characters still rank first`,
  );
  if (check.misses.length > 0) {
    console.log(`    ${check.misses.slice(0, 8).join(' ')}`);
  }

  if (check.checked === 0 || rate < SELF_CHECK_FLOOR) {
    console.error(
      `\nKanjiVG-derived patterns only reach ${(rate * 100).toFixed(0)}%, under the ` +
        `${SELF_CHECK_FLOOR * 100}% floor. Not generating any: a pattern nothing can be ` +
        'recognised by is worse than falling back to the keyboard.',
    );
    process.exit(1);
  }

  const filled = readKanjiVG(xml, new Set(missing));
  for (const [character, strokes] of filled) {
    const features = extractFeatures(momentNormalize(strokes), FEATURE_INTERVAL);
    kanji.push([character, strokes.length, quantise(features)]);
    covered.add(character);
    generated += 1;
  }

  missing = missing.filter((k) => !covered.has(k));
}

console.log('Converting kana…');
const kana = loadKana();

mkdirSync(OUT_DIR, { recursive: true });

const licence = {
  source: 'Kanji Canvas (https://github.com/asdfjkl/kanjicanvas)',
  copyright: '(c) 2019-2024 Dominik Klein; (c) 2020 Seth Clydesdale',
  licence: 'MIT',
  derivedFrom: 'KanjiVG (c) Ulrich Apel, CC BY-SA 3.0 — https://kanjivg.tagaini.net',
  note:
    'Patterns Kanji Canvas does not publish are generated here directly from KanjiVG, ' +
    'through the same normalisation the recogniser uses.',
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
