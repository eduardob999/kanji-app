import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { describeDue, nextDue } from './schedulePreview';
import type { ReviewMode } from './modes';
import type { ItemReviewState } from './review';

const NOW = new Date('2026-08-28T09:00:00Z');
const DAY = 86_400_000;

const at = (days: number): ItemReviewState => ({
  itemId: 'x',
  dueAt: Timestamp.fromMillis(NOW.getTime() + days * DAY),
});

function lookupFrom(states: Partial<Record<ReviewMode, ItemReviewState>>) {
  return (mode: ReviewMode) => states[mode] ?? null;
}

describe('when an item next comes round', () => {
  it('reports the soonest of the memories an item has', () => {
    // A vocabulary entry is scheduled twice — reading it, and producing it in
    // context — and they fall due on different days. The one that matters is
    // the day it next appears.
    const found = nextDue('x', 'vocab', lookupFrom({
      'vocab-reading': at(9),
      'vocab-writing': at(2),
    }));

    expect(found.at?.getTime()).toBe(NOW.getTime() + 2 * DAY);
    expect(found.started).toBe(2);
    expect(found.total).toBe(2);
  });

  it('counts how much of an item has been started', () => {
    const found = nextDue('x', 'vocab', lookupFrom({ 'vocab-reading': at(3) }));
    expect(found.started).toBe(1);
    expect(found.total).toBe(2);
  });

  it('says nothing has been scheduled when nothing has', () => {
    expect(nextDue('x', 'kanji', () => null)).toEqual({ at: null, started: 0, total: 1 });
  });

  it('counts a kanji once, because it is only asked one way', () => {
    expect(nextDue('x', 'kanji', lookupFrom({ kanji: at(5) })).total).toBe(1);
  });
});

describe('saying when', () => {
  const from = (days: number) => describeDue(new Date(NOW.getTime() + days * DAY), NOW);

  it('rounds to the unit a person would say out loud', () => {
    expect(from(-3)).toBe('due now');
    expect(from(0)).toBe('due now');
    expect(from(0.4)).toBe('later today');
    expect(from(1.2)).toBe('tomorrow');
    expect(from(5)).toBe('in 5 days');
    expect(from(21)).toBe('in 3 weeks');
    expect(from(90)).toBe('in 3 months');
    expect(from(500)).toBe('in over a year');
  });

  it('says nothing loudly for an item never studied', () => {
    // Every row on a new account is this one, so the word would repeat down
    // the whole list. The dash is the app's existing "nothing here".
    expect(describeDue(null, NOW)).toBe('—');
  });
});
