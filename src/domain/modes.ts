import type { DeckType, Level } from './items';

/**
 * Quiz modes, and the memory they each draw on.
 *
 * There are four question types but only **three** things being remembered, and
 * keeping those apart is the whole content of this file.
 *
 * A `QuizMode` is a kind of question — what you see, what you hear, what you
 * type. A `ReviewMode` is a memory being tested. Two quiz modes share one:
 * "fill in the blank" and "listening" both ask you to produce the written word
 * from its context, and differ only in whether that context arrives through
 * your eyes or your ears. Scheduling them separately would double the review
 * load for one piece of knowledge.
 *
 * This is also exactly how the CLI behaved - `filling_quiz.py` and
 * `audio_quiz.py` both wrote to the `FillingScore` column - which is what makes
 * the old scores importable without guessing.
 */

export type QuizMode = 'vocab-reading' | 'kanji-writing' | 'fill-in' | 'audio';

export type ReviewMode = 'kanji' | 'vocab-reading' | 'vocab-writing';

export const QUIZ_MODES: readonly QuizMode[] = [
  'vocab-reading',
  'kanji-writing',
  'fill-in',
  'audio',
];

export const REVIEW_MODES: readonly ReviewMode[] = ['kanji', 'vocab-reading', 'vocab-writing'];

export function reviewModeFor(quiz: QuizMode): ReviewMode {
  switch (quiz) {
    case 'vocab-reading':
      return 'vocab-reading';
    case 'kanji-writing':
      return 'kanji';
    case 'fill-in':
    case 'audio':
      return 'vocab-writing';
  }
}

/** Which deck a quiz mode draws its items from. */
export function deckTypeFor(quiz: QuizMode): DeckType {
  return quiz === 'kanji-writing' ? 'kanji' : 'vocab';
}

export function deckTypeForReviewMode(mode: ReviewMode): DeckType {
  return mode === 'kanji' ? 'kanji' : 'vocab';
}

export function quizModeLabel(quiz: QuizMode): string {
  switch (quiz) {
    case 'vocab-reading':
      return 'Vocab reading';
    case 'kanji-writing':
      return 'Kanji writing';
    case 'fill-in':
      return 'Fill in the blank';
    case 'audio':
      return 'Listening';
  }
}

export function reviewModeLabel(mode: ReviewMode): string {
  switch (mode) {
    case 'kanji':
      return 'Kanji writing';
    case 'vocab-reading':
      return 'Vocab reading';
    case 'vocab-writing':
      return 'Writing words in context';
  }
}

/**
 * The Firestore document one item's review state lives in.
 *
 * One document per review mode per level - 24 in all - rather than one per
 * item. See `src/storage/reviewState.ts` for why.
 */
export function bucketId(mode: ReviewMode, level: Level): string {
  return `${mode}:${level}`;
}

export function parseBucketId(id: string): { mode: ReviewMode; level: string } | null {
  const separator = id.lastIndexOf(':');
  if (separator < 0) return null;

  const mode = id.slice(0, separator);
  const level = id.slice(separator + 1);

  if (!(REVIEW_MODES as readonly string[]).includes(mode)) return null;
  return { mode: mode as ReviewMode, level };
}
