import type { InputMethod } from './inputMethod';
import type { QuizMode } from './modes';
import type { PracticeResult } from './review';

/**
 * Turning a marked answer into an FSRS grade.
 *
 * GHAPP hands the player four buttons and asks them to rate the rep, which is
 * the right design when "did that barre chord ring out" is a judgement call.
 * Here the answer is either the right reading or it is not, so asking the
 * learner to also grade themselves would be asking them to do the machine's
 * job — and would make the schedule a function of mood.
 *
 * So the grade is derived. `fail` and `good` come straight from the mark; the
 * other two come from how long it took, because FSRS's four grades carry
 * information the mark alone does not: an answer produced instantly is evidence
 * of stronger memory than the same answer dragged out over twenty seconds, and
 * scheduling them identically wastes the distinction.
 *
 * The learner can still override on the verdict screen — see
 * `downgrade` — because there is one thing they know that the timer does not:
 * whether a wrong answer was a memory failure or a slipped finger.
 *
 * Pure. Every threshold is a parameter of the profile, and the profile is
 * chosen by quiz mode *and* input method, since handwriting a character takes
 * an order of magnitude longer than typing its reading.
 */

export interface TimingProfile {
  /** At or under this, a correct answer counts as `easy`. */
  fastMs: number;
  /** At or over this, a correct answer counts as `hard`. */
  slowMs: number;
}

/**
 * How long answering *should* take, by what is being asked and how.
 *
 * These are deliberately generous. Grading someone `hard` because they were
 * interrupted is a small error; grading them `easy` because they guessed fast
 * is a larger one, so the fast threshold is the tighter of the two.
 */
export function timingProfile(quiz: QuizMode, input: InputMethod): TimingProfile {
  // Multiple choice is a different task: recognition rather than recall, and
  // four options can be scanned in a couple of seconds. Judging it on the same
  // clock as typing would mark almost everything `easy`.
  if (input === 'choice') {
    return { fastMs: 2_500, slowMs: 9_000 };
  }

  // Drawing a character is slow even when you know it perfectly. Someone who
  // needs twelve strokes cannot beat someone typing four kana, and should not
  // be scored as if the difference were memory.
  if (input === 'handwriting') {
    return { fastMs: 9_000, slowMs: 30_000 };
  }

  switch (quiz) {
    // Reading a word you know is close to instant.
    case 'vocab-reading':
      return { fastMs: 3_500, slowMs: 12_000 };
    // Producing a character takes longer, even by keyboard: you have to type
    // the reading and then pick from the IME's candidates.
    case 'kanji-writing':
      return { fastMs: 6_000, slowMs: 20_000 };
    // Both of these make you read or hear a whole sentence first.
    case 'fill-in':
      return { fastMs: 8_000, slowMs: 25_000 };
    case 'audio':
      return { fastMs: 9_000, slowMs: 28_000 };
  }
}

export interface AnswerAttempt {
  correct: boolean;
  /** Prompt on screen to answer submitted. */
  elapsedMs: number;
  /**
   * Whether the answer was revealed, or a hint taken, before answering.
   *
   * Never `easy`, and never better than `hard` when correct: an answer you had
   * to be shown is not recall, whatever the clock says.
   */
  usedHint?: boolean;
  /**
   * Whether the prompt was replayed. Listening only.
   *
   * Treated exactly like a hint. Needing to hear it twice is the audio
   * equivalent of needing to be told.
   */
  replayed?: boolean;
}

export function gradeAnswer(attempt: AnswerAttempt, profile: TimingProfile): PracticeResult {
  if (!attempt.correct) return 'fail';

  if (attempt.usedHint || attempt.replayed) return 'hard';

  if (attempt.elapsedMs <= profile.fastMs) return 'easy';
  if (attempt.elapsedMs >= profile.slowMs) return 'hard';

  return 'good';
}

/**
 * The learner's override, offered on the verdict screen.
 *
 * Only ever downwards, and only by one step. The case it exists for is the
 * typo — you knew 憂鬱, you fumbled the input, and the schedule should not now
 * believe you have forgotten it. The case it deliberately does *not* support is
 * promoting a `fail` to a pass, which would let anyone dismantle their own
 * schedule one embarrassing item at a time.
 */
export function downgrade(result: PracticeResult): PracticeResult {
  switch (result) {
    case 'easy':
      return 'good';
    case 'good':
      return 'hard';
    case 'hard':
    case 'fail':
      return result;
  }
}

/** Whether a grade counts as remembering, for `adaptWeights` and for stats. */
export function isRecall(result: PracticeResult): boolean {
  return result !== 'fail';
}

export function gradeLabel(result: PracticeResult): string {
  switch (result) {
    case 'easy':
      return 'Straight away';
    case 'good':
      return 'Got it';
    case 'hard':
      return 'Took a while';
    case 'fail':
      return 'Missed';
  }
}
