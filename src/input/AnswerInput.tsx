import type { InputMethod } from '../domain/inputMethod';
import { ChoiceInput } from './ChoiceInput';
import { HandwritingInput } from './HandwritingInput';
import { KeyboardInput } from './KeyboardInput';
import type { AnswerInputProps } from './types';

/**
 * The one component quizzes use to collect an answer.
 *
 * Everything a quiz knows about input is the props in `./types.ts`; which
 * method is behind them is this switch and nothing else.
 *
 * All three exist now. Nothing else in the app knows which one is in use.
 */
export function AnswerInput({ method, ...props }: AnswerInputProps & { method: InputMethod }) {
  switch (method) {
    case 'choice':
      return <ChoiceInput {...props} />;
    case 'handwriting':
      return <HandwritingInput {...props} />;
    case 'keyboard':
      return <KeyboardInput {...props} />;
  }
}
