/**
 * How an answer gets typed.
 *
 * Japanese input is the one part of this app that cannot assume anything about
 * the device. A desktop has a real IME; a phone has a software one that may or
 * may not include handwriting; a borrowed machine may have no Japanese input
 * installed at all. So the method is a choice rather than a guess, and
 * `src/input/` is the only place that knows the difference.
 */
export type InputMethod = 'keyboard' | 'handwriting' | 'choice';

export const DEFAULT_INPUT_METHOD: InputMethod = 'keyboard';

export const INPUT_METHODS: readonly InputMethod[] = ['keyboard', 'handwriting', 'choice'];

export function isInputMethod(value: unknown): value is InputMethod {
  return value === 'keyboard' || value === 'handwriting' || value === 'choice';
}

export function describeInputMethod(method: InputMethod): string {
  switch (method) {
    case 'keyboard':
      return 'Your device’s own Japanese keyboard. Works everywhere, but on writing questions the conversion candidates can hand you the answer.';
    case 'handwriting':
      return 'Draw the character. Recognised on-device, and the only method where writing a kanji from memory stays honest.';
    case 'choice':
      return 'Pick from four. Fast one-handed, and the fallback when a device has no Japanese input at all.';
  }
}

export function inputMethodLabel(method: InputMethod): string {
  switch (method) {
    case 'keyboard':
      return 'Keyboard';
    case 'handwriting':
      return 'Handwriting';
    case 'choice':
      return 'Multiple choice';
  }
}
