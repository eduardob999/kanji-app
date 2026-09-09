/**
 * Tatoeba's own reading of its Japanese sentences, where it has one.
 *
 * `jpn_indices.csv` is the Tanaka corpus's B-lines: for 148,609 sentences, a
 * human-maintained list of the dictionary words used, with the reading given
 * wherever the writing is ambiguous — `代(だい)`, `角(かど)`. It is the closest
 * thing to ground truth this data has.
 *
 * It is a *veto*, not the primary check, and the difference is deliberate. It
 * covers 60% of the corpus, all of it the older Tanaka half — the translated
 * drill sentences `docs/SENTENCE-QUALITY.md` measures as the reason the
 * examples read oddly. Selecting only from it would trade one complaint for an
 * older one, and it does not even contain the sentence in the screenshot. So a
 * morphological analyser decides which sentences are usable, and this overrules
 * it where it happens to know better.
 *
 * It does know better. Cross-checked against 9,219 shipped pairs it has an
 * opinion on, kuromoji and the annotators agreed on 84%, differed on
 * segmentation for another 15% — 株主総会 is one word to them and 株主 plus 総会
 * to a tokeniser, which changes nothing about how 総会 is read — and genuinely
 * contradicted each other on 0.67%: 62 sentences where kuromoji read 何時 as
 * いつ in a sentence asking what time it is, or 摘む as つまむ where the tea is
 * being picked. Sixty-two invalid questions is sixty-two too many.
 */
import { existsSync, mkdirSync, readFileSync, createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RAW_DIR = resolve(ROOT, 'data/tatoeba');
const ARCHIVE = resolve(RAW_DIR, 'jpn_indices.tar.bz2');
const CSV = resolve(RAW_DIR, 'jpn_indices.csv');
const SOURCE = 'https://downloads.tatoeba.org/exports/jpn_indices.tar.bz2';

export async function ensureIndices() {
  if (existsSync(CSV)) return;

  mkdirSync(RAW_DIR, { recursive: true });

  if (!existsSync(ARCHIVE)) {
    console.log(`Downloading ${SOURCE}`);
    const response = await fetch(SOURCE);
    if (!response.ok) {
      throw new Error(`Tatoeba index download failed: ${response.status} ${response.statusText}`);
    }
    await pipeline(response.body, createWriteStream(ARCHIVE));
  }

  console.log('Unpacking the word index…');
  const unpacked = spawnSync('tar', ['xjf', ARCHIVE, '-C', RAW_DIR], { stdio: 'inherit' });
  if (unpacked.status !== 0 || !existsSync(CSV)) {
    throw new Error(`Could not unpack ${ARCHIVE}. Install bzip2 and tar, or unpack it by hand.`);
  }
}

/**
 * One B-line token: `headword(reading)[sense]{as written}~`.
 *
 * Everything after the headword is optional and any of it may be absent, so the
 * reading is read as "what the annotator thought needed saying" rather than as
 * a field that is always there.
 */
function parseToken(token) {
  const match = /^([^({[|~]+)(?:\(([^)]*)\))?/.exec(token);
  return match ? { head: match[1], reading: match[2] ?? null } : null;
}

/** Sentence id to the words the annotators say it uses. */
export function readIndices() {
  const index = new Map();

  for (const line of readFileSync(CSV, 'utf8').split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const body = line.slice(line.indexOf('\t', tab + 1) + 1).trim();
    if (!body) continue;

    const words = [];
    for (const token of body.split(/\s+/)) {
      const parsed = parseToken(token);
      if (parsed) words.push(parsed);
    }

    index.set(Number(line.slice(0, tab)), words);
  }

  return index;
}

/**
 * Whether the annotators say this word is read some other way here.
 *
 * Only ever answers yes on a direct contradiction: they name *this* headword,
 * they state a reading for it, and it is not ours. Their not mentioning the
 * word is not a contradiction — they segment more coarsely, so 総会 inside
 * 株主総会 goes unmentioned while being read exactly as we say it is.
 */
export function contradicts(index, sentenceId, word, reading) {
  const words = index.get(sentenceId);
  if (!words) return false;

  const named = words.filter((entry) => entry.head === word && entry.reading);
  if (named.length === 0) return false;

  return !named.some((entry) => entry.reading === reading);
}

/**
 * Headwords this corpus itself reads more than one way.
 *
 * 301 of them: 何時 as いつ and as なんじ, 角 as かど and as かく, 摘む as つむ and
 * as つまむ. On a word like these the analyser is guessing from context and its
 * guess was measurably wrong 0.67% of the time, so guessing is not good enough:
 * these are the words where being wrong produces exactly the question that
 * started all this, a prompt naming a reading the sentence does not use.
 *
 * Derived from the annotations rather than listed by hand, so it grows with the
 * corpus and cannot go stale.
 */
export function ambiguousHeadwords(index) {
  const readings = new Map();

  for (const words of index.values()) {
    for (const entry of words) {
      if (!entry.reading) continue;
      let seen = readings.get(entry.head);
      if (!seen) readings.set(entry.head, (seen = new Set()));
      seen.add(entry.reading);
    }
  }

  const ambiguous = new Set();
  for (const [head, seen] of readings) if (seen.size > 1) ambiguous.add(head);
  return ambiguous;
}

/** Whether the annotators positively say this word is read this way here. */
export function confirms(index, sentenceId, word, reading) {
  const words = index.get(sentenceId);
  if (!words) return false;
  return words.some((entry) => entry.head === word && entry.reading === reading);
}
