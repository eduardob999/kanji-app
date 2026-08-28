import { describe, expect, it } from 'vitest';
import { describeFailure } from './failure';

const FALLBACK = 'The word lists could not be loaded.';

describe('describing a failure', () => {
  it('never shows the exception the library threw', () => {
    // The three that were actually reaching the screen.
    for (const message of ['Failed to fetch', 'Missing or insufficient permissions.', 'TypeError']) {
      expect(describeFailure(new Error(message), FALLBACK)).not.toContain(message);
    }
  });

  it('names a signed-out session, because that one is fixable', () => {
    const denied = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    });
    expect(describeFailure(denied, FALLBACK)).toMatch(/sign(ing)? in again/i);
  });

  it('says work is safe when the network is the problem', () => {
    const offline = Object.assign(new Error('Failed to get document because the client is offline.'), {
      code: 'unavailable',
    });
    expect(describeFailure(offline, FALLBACK)).toMatch(/kept on this device/i);

    // And by message, for the browser errors that carry no code at all.
    expect(describeFailure(new TypeError('Failed to fetch'), FALLBACK)).toMatch(/kept on this device/i);
  });

  it('falls back to what was being attempted', () => {
    expect(describeFailure(new Error('index required'), FALLBACK)).toBe(FALLBACK);
    expect(describeFailure(null, FALLBACK)).toBe(FALLBACK);
    expect(describeFailure('a string', FALLBACK)).toBe(FALLBACK);
  });
});
