/**
 * Deciding whether an answer is right.
 *
 * Ported from `_normalize_reading` and `_expand_readings` in the CLI's
 * `vocab_quiz.py`, which had absorbed the corpus's quirks over a long time and
 * is not worth rediscovering by hand. The rules it encodes:
 *
 * - A reading field can hold several readings, separated by any of `;/、・,`.
 * - A reading may be wrapped in parentheses, half or full width, which are
 *   annotation rather than part of the answer.
 * - U+3000, the ideographic space, is a space.
 *
 * Two rules are new here, both because a browser is not a terminal:
 *
 * - **Katakana is accepted for a hiragana answer, and vice versa.** A software
 *   IME will happily leave you in katakana mode, and "you were in the wrong
 *   input mode" is not a memory failure — which is exactly what marking it
 *   wrong would tell the scheduler it was.
 * - **The okurigana dot is stripped.** KANJIDIC writes kun readings with a dot
 *   marking where the character ends, and nobody types that.
 *
 * Pure, and the only module that decides right from wrong.
 */

/** The separators the corpus uses between alternative readings. */
const READING_SEPARATORS = /[;/、・,]/;

/** Half- and full-width parentheses wrapped around a whole reading. */
const WRAPPING_PARENS = /^[([（]\s*(.+?)\s*[)\]）]$/;

const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const KANA_OFFSET = 0x60;

/**
 * Katakana to hiragana, leaving everything else alone.
 *
 * Stops at U+30F6; the marks above it (ー, ・, ヽ) have no hiragana counterpart
 * and shifting them would produce nonsense. The long vowel mark in particular
 * has to survive, since it is meaningful in the katakana it appears in.
 */
export function toHiragana(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    out +=
      code >= KATAKANA_START && code <= KATAKANA_END
        ? String.fromCodePoint(code - KANA_OFFSET)
        : char;
  }
  return out;
}

/**
 * Trims, collapses whitespace, and treats the ideographic space as a space.
 *
 * Applied to both sides of every comparison, so it must never change meaning —
 * only presentation.
 */
export function normalise(raw: string): string {
  return raw.replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
}

/** What a stored reading and a typed reading are compared as. */
function comparable(raw: string): string {
  return toHiragana(normalise(raw)).replace(/\./g, '');
}

/**
 * Every reading a single field offers, in order, without duplicates.
 *
 * Order is preserved because the first one is what gets shown as "the answer"
 * when someone gets it wrong.
 *
 * Worth knowing, having measured it: **no field in the current corpus offers
 * more than one.** The vocabulary and the kanji readings are all single values,
 * so the splitting here never fires on shipped data. It stays because the decks
 * are built from hand-edited CSVs where a `A・B` field is one keystroke away,
 * and because it costs nothing — but nobody should conclude from its existence
 * that multi-reading fields are a thing this corpus has.
 */
export function expandReadings(field: string): string[] {
  const seen = new Set<string>();
  const readings: string[] = [];

  for (const part of (field ?? '').split(READING_SEPARATORS)) {
    const trimmed = normalise(part);
    if (!trimmed) continue;

    const unwrapped = normalise(trimmed.replace(WRAPPING_PARENS, '$1'));
    if (!unwrapped || seen.has(unwrapped)) continue;

    seen.add(unwrapped);
    readings.push(unwrapped);
  }

  return readings;
}

/**
 * Is this the right reading?
 *
 * Any of the field's alternatives counts. The corpus already splits genuinely
 * different readings into separate entries with separate meanings, so a field
 * carrying several is offering spellings of one answer, not a choice.
 */
export function isReadingCorrect(input: string, readingField: string): boolean {
  const answer = comparable(input);
  if (!answer) return false;

  return expandReadings(readingField).some((reading) => comparable(reading) === answer);
}

/**
 * Is this any of several acceptable readings?
 *
 * For the handful of prompts the source data leaves ambiguous — see `accepts`
 * on `VocabItem`. Each entry is still expanded, so an alternative that itself
 * carries several spellings behaves as it would on its own.
 */
export function isAnyReadingCorrect(input: string, readings: readonly string[]): boolean {
  return readings.some((reading) => isReadingCorrect(input, reading));
}

/**
 * Is this the right written form?
 *
 * Used wherever the answer is the characters themselves — the kanji quiz, and
 * both of the write-the-word-from-context quizzes. Deliberately strict about
 * the characters and forgiving only about whitespace: writing 見る when the
 * answer is 見 is wrong, and telling someone otherwise teaches them the wrong
 * okurigana.
 */
export function isWritingCorrect(input: string, expected: string): boolean {
  const answer = normalise(input);
  return answer !== '' && answer === normalise(expected);
}
