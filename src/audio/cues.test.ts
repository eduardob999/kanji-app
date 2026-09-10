import { describe, expect, it } from 'vitest';
import { shouldPlayCue } from './cues';

/**
 * The rules about when a sound is allowed, which are easier to get wrong than
 * the sound itself.
 */
describe('answer cues', () => {
  it('plays when the learner wants them and nothing else is making noise', () => {
    expect(shouldPlayCue({ enabled: true, silent: false, speaking: false })).toBe(true);
  });

  it('stays out of the way of a listening question', () => {
    // A cue over speech is the app decorating its own question into a harder
    // one. Dropped rather than queued: a late "correct" is worse than none.
    expect(shouldPlayCue({ enabled: true, silent: false, speaking: true })).toBe(false);
  });

  it('makes no sound at all on the silent screen', () => {
    // That screen is for a room where sound is not allowed. A chime is a sound.
    expect(shouldPlayCue({ enabled: true, silent: true, speaking: false })).toBe(false);
  });

  it('obeys the setting', () => {
    expect(shouldPlayCue({ enabled: false, silent: false, speaking: false })).toBe(false);
  });
});
