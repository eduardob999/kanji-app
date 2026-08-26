import type { InputMethod } from '../domain/inputMethod';
import { KeyboardInput } from './KeyboardInput';
import type { AnswerInputProps } from './types';

/**
 * The one component quizzes use to collect an answer.
 *
 * Everything a quiz knows about input is the props in `./types.ts`; which
 * method is behind them is this switch and nothing else.
 *
 * Only the keyboard exists so far. The handwriting canvas and multiple choice
 * arrive in the next phase, and until they do, `Tools -> Input method` does not
 * offer them — so the fallback below is a safety net for a stale stored
 * preference, not a way of quietly shipping a method that does not work.
 */
export function AnswerInput({ method, ...props }: AnswerInputProps & { method: InputMethod }) {
  switch (method) {
    case 'keyboard':
    case 'handwriting':
    case 'choice':
      return <KeyboardInput {...props} />;
  }
}
