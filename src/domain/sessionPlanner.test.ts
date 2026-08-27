import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import type { Level, VocabItem } from './items';
import type { QuizMode, ReviewMode } from './modes';
import type { ItemReviewState } from './review';
import { countDue, planSession, type Candidate } from './sessionPlanner';

const NOW = new Date('2026-08-26T09:00:00Z');
const DAY = 86_400_000;

function vocab(id: string, rank?: number): VocabItem {
  return { id, word: id, reading: 'よみ', meaning: 'meaning', ...(rank ? { rank } : {}) };
}

function candidate(id: string, level: Level, quiz: QuizMode = 'vocab-reading'): Candidate {
  return { quiz, item: vocab(id), level };
}

/** A state due `overdueDays` ago. Negative means it is not due yet. */
function state(id: string, overdueDays: number): ItemReviewState {
  return {
    itemId: id,
    stability: 3,
    difficulty: 5,
    totalReps: 2,
    lapses: 0,
    dueAt: Timestamp.fromMillis(NOW.getTime() - overdueDays * DAY),
    lastReviewedAt: Timestamp.fromMillis(NOW.getTime() - (overdueDays + 3) * DAY),
  };
}

function lookupFrom(states: Record<string, ItemReviewState>) {
  return (_mode: ReviewMode, itemId: string) => states[itemId] ?? null;
}

const NONE = () => null;

describe('planSession', () => {
  it('puts the most overdue item first', () => {
    const candidates = [candidate('a', '5'), candidate('b', '5'), candidate('c', '5')];
    const lookup = lookupFrom({ a: state('a', 1), b: state('b', 9), c: state('c', 4) });

    const plan = planSession(candidates, lookup, NOW, { maxPerGroup: 10 });

    expect(plan.map((q) => q.item.id)).toEqual(['b', 'c', 'a']);
  });

  it('leaves out anything not yet due', () => {
    const candidates = [candidate('a', '5'), candidate('b', '5')];
    const lookup = lookupFrom({ a: state('a', -2), b: state('b', 1) });

    const plan = planSession(candidates, lookup, NOW);

    expect(plan.map((q) => q.item.id)).toEqual(['b']);
  });

  it('includes an item due exactly now', () => {
    const lookup = lookupFrom({ a: state('a', 0) });
    expect(planSession([candidate('a', '5')], lookup, NOW)).toHaveLength(1);
  });

  it('introduces the most useful material in a level first', () => {
    // Within a level the tie-break used to be the source CSV's order, which was
    // arbitrary — and at eight new items a day it decided what a learner spent
    // most of a year on.
    const candidates: Candidate[] = [
      { quiz: 'vocab-reading', item: vocab('rare', 900), level: '5' },
      { quiz: 'vocab-reading', item: vocab('common', 1), level: '5' },
      { quiz: 'vocab-reading', item: vocab('middling', 50), level: '5' },
    ];

    const plan = planSession(candidates, NONE, NOW, { maxPerGroup: 10 });

    expect(plan.map((q) => q.item.id)).toEqual(['common', 'middling', 'rare']);
  });

  it('still puts an easier level ahead of a more useful item in a harder one', () => {
    // Frequency orders *within* a level; it does not reorder the levels.
    const candidates: Candidate[] = [
      { quiz: 'vocab-reading', item: vocab('commonN1', 1), level: '1a' },
      { quiz: 'vocab-reading', item: vocab('rareN5', 900), level: '5' },
    ];

    const plan = planSession(candidates, NONE, NOW, { maxPerGroup: 10 });

    expect(plan.map((q) => q.item.id)).toEqual(['rareN5', 'commonN1']);
  });

  it('falls back to deck order when the decks carry no frequency data', () => {
    const candidates: Candidate[] = [
      { quiz: 'vocab-reading', item: vocab('first'), level: '5' },
      { quiz: 'vocab-reading', item: vocab('second'), level: '5' },
    ];

    const plan = planSession(candidates, NONE, NOW, { maxPerGroup: 10 });

    expect(plan.map((q) => q.item.id)).toEqual(['first', 'second']);
  });

  it('introduces unseen material easiest level first', () => {
    const candidates = [candidate('hard', '1a'), candidate('easy', '5'), candidate('mid', '3')];

    const plan = planSession(candidates, NONE, NOW, { maxPerGroup: 10 });

    expect(plan.map((q) => q.item.id)).toEqual(['easy', 'mid', 'hard']);
  });

  it('rations new material', () => {
    const candidates = Array.from({ length: 50 }, (_, i) => candidate(`n${i}`, '5'));

    const plan = planSession(candidates, NONE, NOW, { maxNew: 3, maxPerGroup: 50 });

    expect(plan).toHaveLength(3);
  });

  it('prefers due material over new material', () => {
    const candidates = [candidate('new', '5'), candidate('due', '5')];
    const lookup = lookupFrom({ due: state('due', 5) });

    const plan = planSession(candidates, lookup, NOW, { maxItems: 1, maxPerGroup: 10 });

    expect(plan.map((q) => q.item.id)).toEqual(['due']);
  });

  it('caps how much of one mode and level a session may hold', () => {
    const candidates = Array.from({ length: 20 }, (_, i) => candidate(`n${i}`, '5'));

    const plan = planSession(candidates, NONE, NOW, { maxNew: 20, maxPerGroup: 4 });

    expect(plan).toHaveLength(4);
  });

  it('does not let a split level claim four times the allowance', () => {
    // N1 is stored as four sub-levels, so a cap keyed on the stored level lets
    // N1 supply 4 x maxPerGroup in one sitting while every other level supplies
    // maxPerGroup. The cap exists to stop blocked practice, and splitting a
    // level quietly turned it off for the largest level in the corpus.
    const candidates = [
      ...Array.from({ length: 10 }, (_, i) => candidate(`a${i}`, '1a')),
      ...Array.from({ length: 10 }, (_, i) => candidate(`b${i}`, '1b')),
      ...Array.from({ length: 10 }, (_, i) => candidate(`c${i}`, '1c')),
      ...Array.from({ length: 10 }, (_, i) => candidate(`d${i}`, '1d')),
    ];

    const plan = planSession(candidates, NONE, NOW, { maxNew: 40, maxItems: 40, maxPerGroup: 5 });

    expect(plan).toHaveLength(5);
  });

  it('still caps unsplit levels independently of each other', () => {
    const candidates = [
      ...Array.from({ length: 10 }, (_, i) => candidate(`five${i}`, '5')),
      ...Array.from({ length: 10 }, (_, i) => candidate(`three${i}`, '3')),
    ];

    const plan = planSession(candidates, NONE, NOW, { maxNew: 40, maxItems: 40, maxPerGroup: 5 });

    expect(plan).toHaveLength(10);
  });

  it('interleaves groups rather than blocking them', () => {
    // Blocked practice — five N5 then five N3 — feels productive and transfers
    // poorly. This is the rule the whole planner exists for.
    const candidates = [
      ...Array.from({ length: 3 }, (_, i) => candidate(`five${i}`, '5')),
      ...Array.from({ length: 3 }, (_, i) => candidate(`three${i}`, '3')),
    ];

    const plan = planSession(candidates, NONE, NOW, { maxNew: 6, maxPerGroup: 6 });
    const levels = plan.map((q) => q.level);

    expect(plan).toHaveLength(6);
    expect(levels).toEqual(['5', '3', '5', '3', '5', '3']);
  });

  it('asks one memory once, however many question types could test it', () => {
    // Fill-in and listening share a review state. Without the claim, the same
    // word arrives twice in one session wearing different clothes.
    const item = vocab('word');
    const candidates: Candidate[] = [
      { quiz: 'fill-in', item, level: '5' },
      { quiz: 'audio', item, level: '5' },
    ];

    const plan = planSession(candidates, NONE, NOW, { maxNew: 5 });

    expect(plan).toHaveLength(1);
    expect(plan[0]!.mode).toBe('vocab-writing');
  });

  it('does ask the same item in two modes that are genuinely different memories', () => {
    const item = vocab('word');
    const candidates: Candidate[] = [
      { quiz: 'vocab-reading', item, level: '5' },
      { quiz: 'fill-in', item, level: '5' },
    ];

    const plan = planSession(candidates, NONE, NOW, { maxNew: 5 });

    expect(plan).toHaveLength(2);
    expect(new Set(plan.map((q) => q.mode))).toEqual(new Set(['vocab-reading', 'vocab-writing']));
  });

  it('schedules a reviewed item that somehow has no due date', () => {
    // Should not happen, but dropping it would exclude it from every future
    // session, which is worse than asking it.
    const lookup = lookupFrom({
      a: { itemId: 'a', stability: 1, difficulty: 5, totalReps: 1, lapses: 0 },
    });

    expect(planSession([candidate('a', '5')], lookup, NOW)).toHaveLength(1);
  });

  it('is deterministic', () => {
    const candidates = Array.from({ length: 30 }, (_, i) => candidate(`n${i}`, i > 15 ? '3' : '5'));

    const first = planSession(candidates, NONE, NOW);
    const second = planSession(candidates, NONE, NOW);

    expect(first.map((q) => q.item.id)).toEqual(second.map((q) => q.item.id));
  });

  it('returns nothing when there is nothing to ask', () => {
    expect(planSession([], NONE, NOW)).toEqual([]);
  });
});

describe('countDue', () => {
  it('counts memories, not question types', () => {
    const item = vocab('word');
    const candidates: Candidate[] = [
      { quiz: 'fill-in', item, level: '5' },
      { quiz: 'audio', item, level: '5' },
    ];

    expect(countDue(candidates, NONE, NOW)).toEqual({ due: 0, unseen: 1 });
  });

  it('separates what is due from what has never been seen', () => {
    const candidates = [candidate('a', '5'), candidate('b', '5'), candidate('c', '5')];
    const lookup = lookupFrom({ a: state('a', 2), b: state('b', -2) });

    expect(countDue(candidates, lookup, NOW)).toEqual({ due: 1, unseen: 1 });
  });
});
