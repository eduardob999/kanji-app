import { describe, expect, it } from 'vitest';
import { downgrade, gradeAnswer, isRecall, timingProfile } from './grading';

const KEYBOARD_READING = timingProfile('vocab-reading', 'keyboard');

describe('gradeAnswer', () => {
  it('fails a wrong answer however fast it was', () => {
    expect(gradeAnswer({ correct: false, elapsedMs: 200 }, KEYBOARD_READING)).toBe('fail');
  });

  it('grades a fast correct answer easy', () => {
    expect(gradeAnswer({ correct: true, elapsedMs: 1_500 }, KEYBOARD_READING)).toBe('easy');
  });

  it('grades an unhurried correct answer good', () => {
    expect(gradeAnswer({ correct: true, elapsedMs: 7_000 }, KEYBOARD_READING)).toBe('good');
  });

  it('grades a slow correct answer hard', () => {
    expect(gradeAnswer({ correct: true, elapsedMs: 15_000 }, KEYBOARD_READING)).toBe('hard');
  });

  it('treats the thresholds as inclusive', () => {
    expect(gradeAnswer({ correct: true, elapsedMs: KEYBOARD_READING.fastMs }, KEYBOARD_READING)).toBe(
      'easy',
    );
    expect(gradeAnswer({ correct: true, elapsedMs: KEYBOARD_READING.slowMs }, KEYBOARD_READING)).toBe(
      'hard',
    );
  });

  it('never grades a hinted answer better than hard', () => {
    expect(gradeAnswer({ correct: true, elapsedMs: 100, usedHint: true }, KEYBOARD_READING)).toBe(
      'hard',
    );
  });

  it('treats a replay like a hint', () => {
    const profile = timingProfile('audio', 'keyboard');
    expect(gradeAnswer({ correct: true, elapsedMs: 100, replayed: true }, profile)).toBe('hard');
  });

  it('still fails a wrong answer that used a hint', () => {
    expect(gradeAnswer({ correct: false, elapsedMs: 100, usedHint: true }, KEYBOARD_READING)).toBe(
      'fail',
    );
  });
});

describe('timingProfile', () => {
  it('gives handwriting far longer than typing', () => {
    // Twelve strokes cannot be drawn in the time four kana are typed, and the
    // difference is not memory.
    expect(timingProfile('kanji-writing', 'handwriting').fastMs).toBeGreaterThan(
      timingProfile('kanji-writing', 'keyboard').fastMs,
    );
  });

  it('gives multiple choice the tightest clock of all', () => {
    // Recognition, not recall: four options can be scanned in a couple of
    // seconds, so the same thresholds would mark almost everything easy.
    const choice = timingProfile('kanji-writing', 'choice');
    expect(choice.fastMs).toBeLessThan(timingProfile('kanji-writing', 'keyboard').fastMs);
  });

  it('lets sentence-based questions run longer than a bare reading', () => {
    expect(timingProfile('fill-in', 'keyboard').fastMs).toBeGreaterThan(
      timingProfile('vocab-reading', 'keyboard').fastMs,
    );
  });

  it('always leaves room between fast and slow', () => {
    for (const quiz of ['vocab-reading', 'kanji-writing', 'fill-in', 'audio'] as const) {
      for (const input of ['keyboard', 'handwriting', 'choice'] as const) {
        const profile = timingProfile(quiz, input);
        expect(profile.fastMs).toBeLessThan(profile.slowMs);
      }
    }
  });
});

describe('downgrade', () => {
  it('steps down by one', () => {
    expect(downgrade('easy')).toBe('good');
    expect(downgrade('good')).toBe('hard');
  });

  it('stops at hard, so a pass cannot become a failure', () => {
    expect(downgrade('hard')).toBe('hard');
  });

  it('cannot rescue a failure', () => {
    // Otherwise anyone could dismantle their own schedule one embarrassing
    // item at a time.
    expect(downgrade('fail')).toBe('fail');
  });
});

describe('isRecall', () => {
  it('counts everything but a failure as remembering', () => {
    expect(isRecall('easy')).toBe(true);
    expect(isRecall('good')).toBe(true);
    expect(isRecall('hard')).toBe(true);
    expect(isRecall('fail')).toBe(false);
  });
});
