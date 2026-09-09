/**
 * Does this sentence use this word with this reading?
 *
 * The question the sentence pipeline never asked. Sentences were filed by
 * surface — every sentence containing the characters 代 was filed under 代 —
 * and the quiz then printed the *entry's* reading beside the blank. So
 * 「バス代はいくら？」, where 代 is the だい of バス代, was served as a question
 * asking for 代 read しろ: a prompt contradicting its own answer.
 *
 * Two things have to be true, and only a morphological analyser can say either:
 *
 *   1. The characters are the word, not the tail of a longer one. バス代 is one
 *      word; the 代 inside it is not the word 代 any more than the "read" in
 *      "already" is the verb.
 *   2. The word is read the way the question says. 237 of the 6,982 vocabulary
 *      surfaces carry more than one reading in the decks, and nothing in the
 *      pipeline ever established which one a given sentence used.
 *
 * kuromoji, with IPADIC, answers both. It is a build-time dependency only —
 * nothing here ships to the browser, which gets a list of sentences already
 * checked.
 *
 * **Every occurrence has to check out, not just one.** `blankOut` in
 * `src/domain/sentences.ts` hides *all* occurrences of the surface and labels
 * them with one reading, so a sentence using 代 twice with two readings would
 * produce a question that is half wrong. Rejecting the whole sentence is the
 * only answer that stays true to what the quiz will do with it.
 */
import kuromoji from 'kuromoji';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DICT = resolve(ROOT, 'node_modules/kuromoji/dict');

/** Katakana to hiragana, so a dictionary reading and a deck reading compare. */
export function toHiragana(text) {
  return text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/**
 * Readings that differ only in ways nobody would call a different reading.
 *
 * The long vowel mark, which IPADIC writes in katakana readings of loanwords
 * and the decks sometimes spell out; and the small tsu, which is a consonant
 * length rather than a sound.
 */
function normalise(reading) {
  return toHiragana(reading).replace(/[ー・\s]/g, '');
}

export function createTokenizer() {
  return new Promise((resolve_, reject) => {
    kuromoji.builder({ dicPath: DICT }).build((error, tokenizer) => {
      if (error) reject(error);
      else resolve_(tokenizer);
    });
  });
}

/**
 * Every way this text can be read as this surface, with the reading given.
 *
 * Returns the character offsets at which a run of whole tokens spells the
 * surface *and* is read the way the caller expects. Whole tokens, because half
 * a token is not a word: 代わり is one token read カワリ, and the 代 at its front
 * is not the noun 代.
 */
function verifiedOffsets(tokens, word, reading) {
  const wanted = normalise(reading);
  const offsets = new Set();

  for (let start = 0; start < tokens.length; start += 1) {
    let surface = '';
    let sound = '';
    let missing = false;

    for (let end = start; end < tokens.length; end += 1) {
      const token = tokens[end];
      surface += token.surface_form;
      // An unknown word has no reading in the dictionary, so nothing can be
      // confirmed about it. Silence is not agreement.
      if (!token.reading) missing = true;
      else sound += token.reading;

      if (surface.length > word.length) break;
      if (surface !== word) continue;
      if (!missing && normalise(sound) === wanted) {
        // kuromoji's offsets are 1-based over the input string.
        offsets.add(tokens[start].word_position - 1);
      }
      break;
    }
  }

  return offsets;
}

/** Where the surface appears at all, however it is read. */
function allOffsets(text, word) {
  const offsets = [];
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + word.length)) {
    offsets.push(at);
  }
  return offsets;
}

/**
 * Whether this sentence may be asked as a question about this word.
 *
 * True only when every place the surface appears is the word itself, read as
 * the question will say it is read.
 */
export function usesWord(tokenizer, text, word, reading) {
  const appearances = allOffsets(text, word);
  if (appearances.length === 0) return false;

  const verified = verifiedOffsets(tokenizer.tokenize(text), word, reading);
  return appearances.every((at) => verified.has(at));
}
