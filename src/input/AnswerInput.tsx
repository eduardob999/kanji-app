import type { InputMethod } from '../domain/inputMethod';
import { ChoiceInput } from './ChoiceInput';
import { KeyboardInput } from './KeyboardInput';
import type { AnswerInputProps } from './types';

/**
 * The one component quizzes use to collect an answer.
 *
 * Everything a quiz knows about input is the props in `./types.ts`; which
 * method is behind them is this switch and nothing else.
 *
 * Handwriting is not built yet and falls back to the keyboard; until it is,
 * `Tools -> Input method` does not offer it, so that branch is a safety net for
 * a stale stored preference rather than a way of quietly shipping a method that
 * does not work.
 */
export function AnswerInput({ method, ...props }: AnswerInputProps & { method: InputMethod }) {
  switch (method) {
    case 'choice':
      return <ChoiceInput {...props} />;
    case 'keyboard':
    case 'handwriting':
      return <KeyboardInput {...props} />;
  }
}
