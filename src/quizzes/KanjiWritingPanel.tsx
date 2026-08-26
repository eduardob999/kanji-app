import { useCallback } from 'react';
import type { User } from 'firebase/auth';
import { QuizFrame } from './QuizFrame';
import { loadQuizSource } from './source';

/**
 * Readings and meaning; you supply the character.
 *
 * Ported from `kanji_quiz.py`. This is the mode the handwriting question hangs
 * off: with the keyboard, typing the reading hands you the character in the
 * IME's candidate list before you have recalled anything.
 */

const MODES = ['kanji-writing'] as const;

export function KanjiWritingPanel({ user }: { user: User }) {
  // Stable identity: QuizFrame replans whenever this changes, so an inline
  // arrow would restart the session on every render.
  const loadQuiz = useCallback(() => loadQuizSource(MODES, null), []);

  return <QuizFrame user={user} loadQuiz={loadQuiz} />;
}
