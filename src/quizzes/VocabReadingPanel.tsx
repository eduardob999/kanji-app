import { useCallback } from 'react';
import type { User } from 'firebase/auth';
import { QuizFrame } from './QuizFrame';
import { loadQuizSource } from './source';

/**
 * The word and its meaning; you supply the reading.
 *
 * Ported from `vocab_quiz.py`. What the question looks like lives in
 * `definitions.tsx`, shared with the practice screen; this screen only
 * says which mode it wants.
 */

const MODES = ['vocab-reading'] as const;

export function VocabReadingPanel({ user }: { user: User }) {
  // Stable identity: QuizFrame replans whenever this changes, so an inline
  // arrow would restart the session on every render.
  const loadQuiz = useCallback(() => loadQuizSource(MODES, null), []);

  return <QuizFrame user={user} loadQuiz={loadQuiz} />;
}
