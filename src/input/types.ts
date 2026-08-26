/**
 * The contract every input method meets.
 *
 * Deliberately tiny, and deliberately a *string*. A quiz asks for an answer and
 * gets text back; it never learns whether that text was typed, drawn or picked
 * from four options. That is the rule that lets a handwriting canvas be added
 * without touching a single quiz, and the reason `src/input/` is its own
 * directory rather than a component folder.
 *
 * The one thing that does leak, by necessity, is *how long it took* — but that
 * is measured by the quiz frame around the input, not reported by the input,
 * and `grading.ts` corrects for the method's own speed.
 */
export interface AnswerInputProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * The learner is done. The frame decides whether an empty answer counts.
   *
   * The optional argument is for methods where choosing *is* submitting, in one
   * gesture: `onChange` has not reached the frame's state by the time
   * `onSubmit` runs, so the answer travels with the call instead.
   */
  onSubmit: (value?: string) => void;
  /** True once the answer has been marked; the input becomes read-only. */
  disabled: boolean;
  placeholder: string;
  /**
   * Candidate answers, for methods that need them.
   *
   * Multiple choice cannot invent plausible distractors on its own, and the
   * quiz is the only thing that knows what the rest of the deck looks like.
   * Every other method ignores it.
   */
  choices?: readonly string[];
}
