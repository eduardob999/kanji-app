import { useEffect, useRef } from 'react';
import type { AnswerInputProps } from './types';

/**
 * A text field, driven by whatever Japanese IME the device has.
 *
 * The whole of the Japanese input problem is solved by the platform here, which
 * is why this is the default and the fallback. What it costs is honesty on
 * writing questions: type "まいげつ" and the IME's candidate list offers 毎月
 * before you have recalled anything. That is what the handwriting canvas is
 * for, and why the choice is the learner's.
 *
 * Notes on the details that are not obvious:
 *
 * - **`autoCapitalize`, `autoCorrect` and `spellCheck` are off.** iOS applies
 *   all three to a text field regardless of the script being typed, and
 *   autocorrect on romaji mid-conversion is actively destructive.
 * - **Composition is respected.** An IME fires `keydown` for Enter while it is
 *   still choosing between candidates; submitting there would send the romaji.
 *   `isComposing` is the documented way to tell the two Enters apart.
 */
export function KeyboardInput({ value, onChange, onSubmit, disabled, placeholder }: AnswerInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus follows the question. Without this every answer costs a tap, which
  // over a fifteen-question session is fifteen taps that teach nothing.
  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled, placeholder]);

  return (
    <input
      ref={inputRef}
      type="text"
      className="textinput textinput--answer"
      lang="ja"
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        // `nativeEvent.isComposing` is true while the IME is still converting;
        // Enter then means "accept this candidate", not "submit my answer".
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onSubmit();
        }
      }}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="done"
    />
  );
}
