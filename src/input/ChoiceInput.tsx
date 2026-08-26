import type { AnswerInputProps } from './types';

/**
 * Four options, tap one.
 *
 * Recognition rather than recall, and worth being honest that they are not the
 * same thing: seeing the right answer among three wrong ones is easier than
 * producing it, so `grading.ts` puts this on a much tighter clock and
 * `fluency.ts` tracks it in its own bucket. The schedule that comes out is a
 * schedule for recognising the word, which is what was tested.
 *
 * It earns its place anyway. It is the only method that works one-handed on a
 * phone, and the only one that works at all on a machine with no Japanese input
 * installed — which is most machines that are not yours.
 *
 * Submitting on tap rather than requiring a second confirming press: with four
 * large targets the press *is* the decision, and a confirm step would add a tap
 * to every question in the session for no error it actually prevents.
 */
export function ChoiceInput({ value, onChange, onSubmit, disabled, choices }: AnswerInputProps) {
  const options = choices ?? [];

  if (options.length === 0) {
    return (
      <p className="notice notice--warn">
        Not enough similar words in this deck to build a choice question. Switch to the keyboard
        for this one.
      </p>
    );
  }

  return (
    <div className="choices" role="group" aria-label="Answer options">
      {options.map((option) => {
        const chosen = value === option;
        return (
          <button
            key={option}
            type="button"
            className={`choices__option${chosen ? ' choices__option--chosen' : ''}`}
            lang="ja"
            disabled={disabled}
            aria-pressed={chosen}
            onClick={() => {
              onChange(option);
              // The frame reads the answer from its own state, which this call
              // has not updated yet, so hand the choice straight to it.
              onSubmit(option);
            }}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
