import { describe, expect, it } from 'vitest';
import { LEECH_FROM, gripOn, isSlipping, slipScore } from './leech';
import type { ItemReviewState } from './review';

const state = (lapses: number, totalReps: number): ItemReviewState => ({
  itemId: 'x',
  lapses,
  totalReps,
});

describe('losing your grip on an item', () => {
  it('says nothing about material with no history', () => {
    expect(gripOn(null)).toBe('firm');
    expect(gripOn(undefined)).toBe('firm');
    expect(gripOn(state(0, 0))).toBe('firm');
  });

  it('does not indict an item you have known for years', () => {
    // Anki's flat count of eight would call this a leech. Eight failures in
    // eighty is not a problem, it is a memory.
    expect(gripOn(state(8, 80))).toBe('firm');
  });

  it('flags failing often relative to how often it comes up', () => {
    expect(gripOn(state(8, 12))).toBe('slipping');
    expect(isSlipping(state(LEECH_FROM, 10))).toBe(true);
  });

  it('has a middle state, so the first bad week is not a verdict', () => {
    expect(gripOn(state(3, 5))).toBe('shaky');
    expect(gripOn(state(5, 8))).toBe('shaky');
  });

  it('survives a rep count that is missing or smaller than the lapses', () => {
    expect(gripOn({ itemId: 'x', lapses: 9 })).toBe('slipping');
    expect(gripOn(state(9, 2))).toBe('slipping');
  });

  it('ranks the worse one higher, without hiding the other', () => {
    expect(slipScore(state(9, 11))).toBeGreaterThan(slipScore(state(9, 30)));
    expect(slipScore(state(9, 30))).toBeGreaterThan(0);
    expect(slipScore(null)).toBe(0);
  });
});
