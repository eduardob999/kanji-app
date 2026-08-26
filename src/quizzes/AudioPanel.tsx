import { useCallback } from 'react';
import type { User } from 'firebase/auth';
import { useJapaneseVoice } from '../hooks/useJapaneseVoice';
import { NoVoiceNotice } from '../components/NoVoiceNotice';
import { QuizFrame } from './QuizFrame';
import { loadQuizSource } from './source';

/**
 * Hear it, then write it.
 *
 * Ported from `audio_quiz.py`, which used gTTS and `mpv` — a network call per
 * phrase and a binary to install. This uses the device's own Japanese voice,
 * which is offline and free and not always present, so the mode checks for one
 * up front rather than presenting a silent quiz.
 *
 * The prompt itself, including the announcement that brackets the example
 * sentence, is in `definitions.tsx`.
 */

const MODES = ['audio'] as const;

export function AudioPanel({ user }: { user: User }) {
  const { voice, checking } = useJapaneseVoice();

  // Keyed on the voice: once it arrives, the source is rebuilt so the prompt
  // has something to speak with.
  const loadQuiz = useCallback(() => loadQuizSource(MODES, voice), [voice]);

  if (checking) {
    return (
      <section className="card">
        <p className="card__body">Looking for a Japanese voice…</p>
      </section>
    );
  }

  if (!voice) return <NoVoiceNotice />;

  return <QuizFrame user={user} loadQuiz={loadQuiz} />;
}
