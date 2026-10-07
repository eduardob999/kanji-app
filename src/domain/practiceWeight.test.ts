import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import type { Tier, VocabItem } from './items';
import {
  lapseWeight,
  practiceWeight,
  slippingWeight,
  tierWeight,
  varietyDiscount,
} from './practiceWeight';
import type { ItemReviewState } from './review';

const NOW = new Date('2026-10-07T09:00:00Z');
const DAY = 86_400_000;

const word = (tier?: Tier): VocabItem => ({
  id: 'w',
  word: 'w',
  reading: 'よみ',
  meaning: 'm',
  ...(tier ? { tier } : {}),
});

function reviewed(daysAgo: number, stability: number, lapses = 0): ItemReviewState {
  return {
    itemId: 'w',
    stability,
    lapses,
    totalReps: 3,
    lastReviewedAt: Timestamp.fromMillis(NOW.getTime() - daysAgo * DAY),
  };
}

describe('tierWeight', () => {
  it('falls with the tier, and keeps obscure words possible', () => {
    const weights = ([1, 2, 3, 4] as Tier[]).map((tier) => tierWeight(word(tier)));
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    expect(Math.min(...weights)).toBeGreaterThan(0);
  });

  it('makes a core word at least ten times as likely as an unlisted one', () => {
    expect(tierWeight(word(1)) / tierWeight(word(4))).toBeGreaterThanOrEqual(10);
  });
});

describe('slippingWeight', () => {
  it('is 1 for a word with no review state, or none that can be measured', () => {
    expect(slippingWeight(null, NOW)).toBe(1);
    expect(slippingWeight({ itemId: 'w' }, NOW)).toBe(1);
  });

  it('is close to 1 just after a review and larger as the memory fades', () => {
    const fresh = slippingWeight(reviewed(0, 10), NOW);
    const fading = slippingWeight(reviewed(20, 10), NOW);
    const gone = slippingWeight(reviewed(200, 10), NOW);
    expect(fresh).toBeCloseTo(1, 1);
    expect(fading).toBeGreaterThan(fresh);
    expect(gone).toBeGreaterThan(fading);
    expect(gone).toBeLessThanOrEqual(3);
  });

  it('does not misbehave for a review dated in the future', () => {
    expect(slippingWeight(reviewed(-5, 10), NOW)).toBeCloseTo(1, 5);
  });
});

describe('lapseWeight', () => {
  it('raises a word that has been missed, with a ceiling', () => {
    expect(lapseWeight(null)).toBe(1);
    expect(lapseWeight(reviewed(1, 5, 2))).toBeGreaterThan(1);
    expect(lapseWeight(reviewed(1, 5, 50))).toBe(lapseWeight(reviewed(1, 5, 5)));
  });
});

describe('practiceWeight', () => {
  it('prefers a common word to an obscure one when both are equally fresh', () => {
    const state = reviewed(5, 10);
    expect(practiceWeight(word(1), state, NOW)).toBeGreaterThan(practiceWeight(word(4), state, NOW));
  });

  it('lets a badly slipping obscure word outweigh a fresh common one only a little', () => {
    // A guard on the balance: slipping can lift a word, it cannot make the
    // obscure tail dominate.
    const slippingRare = practiceWeight(word(4), reviewed(300, 5, 5), NOW);
    const freshCore = practiceWeight(word(1), reviewed(0, 30), NOW);
    expect(slippingRare).toBeLessThan(freshCore);
  });
});

describe('varietyDiscount', () => {
  it('is 1 for a round with nothing in it, and falls as a kind repeats', () => {
    expect(varietyDiscount(0, 0)).toBe(1);
    expect(varietyDiscount(1, 0)).toBeLessThan(1);
    expect(varietyDiscount(3, 0)).toBeLessThan(varietyDiscount(1, 0));
    expect(varietyDiscount(0, 3)).toBeLessThan(varietyDiscount(0, 1));
  });

  it('never reaches zero, so a thin pool can still be drawn from', () => {
    expect(varietyDiscount(100, 100)).toBeGreaterThan(0);
  });
});
