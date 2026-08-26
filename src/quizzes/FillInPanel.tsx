import { useCallback } from 'react';
import type { User } from 'firebase/auth';
import { QuizFrame } from './QuizFrame';
import { loadQuizSource } from './source';

/**
 * A real sentence with the word taken out; you supply the characters.
 *
 * Ported from `filling_quiz.py`, including its fallback: 10% of the corpus has
 * no Tatoeba sentence, and those words are asked from their reading and meaning
 * rather than being dropped from the mode.
 */

const MODES = ['fill-in'] as const;

export function FillInPanel({ user }: { user: User }) {
  // Stable identity: QuizFrame replans whenever this changes, so an inline
  // arrow would restart the session on every render.
  const loadQuiz = useCallback(() => loadQuizSource(MODES, null), []);

  return <QuizFrame user={user} loadQuiz={loadQuiz} />;
}
