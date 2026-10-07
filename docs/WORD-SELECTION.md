# Word selection: common first, obscure rare, random with a purpose

The goal: the app should be full of words worth knowing, rare and obscure words
should turn up rarely, and the unscheduled practice that fills a round should be
random in the way that helps (variety, a lean towards what is useful and what is
shaky) rather than uniform over all 7,000 words.

## What was measured, 2026-10-07

Commonness taken from JMdict's priority tags (`nf01`–`nf48`, the word-frequency
bands of 500 words each, plus `news1/2`, `ichi1/2`, `spec1/2`, `gai1/2`):

| tier | meaning | rule |
|---|---|---|
| 1 | core | `nf01`–`nf12` (the commonest 6,000), or both `news1` and `ichi1` |
| 2 | common | `nf13`–`nf24`, or any `*1` tag |
| 3 | uncommon | any other priority tag |
| 4 | unlisted | no priority tag |

Where the current 7,219 words fall:

| level | words | tier 1 | tier 2 | tier 3 | tier 4 |
|---|---|---|---|---|---|
| N5 | 507 | 347 | 152 | 1 | 4 |
| N4 | 493 | 369 | 118 | 1 | 4 |
| N3 | 1,586 | 1,248 | 317 | 0 | 20 |
| N2 | 1,497 | 852 | 583 | 32 | 26 |
| N1 (each quarter) | 799 | ~400 | ~275 | ~43 | ~66 |

So the existing deck is mostly common already; the obscure tail is about 3% of
N3 and about 15% of each N1 quarter. The bigger gap is the other direction:
JMdict has **3,498 tier-1 entries whose written form is not in the deck at all**
(洋食, 恐竜, 雑草, 閉店…), and about 11,000 more at tier 2.

Two cautions on reading tier 4. JMdict leaves prefixed forms (お酒, お風呂)
unmarked although they are everyday words, so tier 4 alone is not "rare"; it is
combined with the Tatoeba count already in `data/frequency.json`. And the
priority tags say nothing about JLPT level.

## The plan, in the order it is built

Each step ships on its own: tests, build, UI audit, PR, merge, deploy log read.

1. **A commonness signal.** `data/commonness.json`, committed, built by
   `scripts/build-commonness.py` from JMdict. Carried into each vocabulary item
   as `tier`. No behaviour changes yet.
2. **Introduction order.** Within a level, new words come tier first, then by
   Tatoeba rank, so a level's first weeks are its most useful words. Today the
   order is Tatoeba count alone.
3. **A weighted draw for practice.** Replace `buildRandomQueue`'s uniform
   sampling with a seeded weighted draw: weight by tier (obscure words rare, not
   absent), lean towards weaker memories, and keep variety by spreading levels
   and question types so a round is not fifteen of one thing.
4. **Grow the bank.** Add vetted tier-1 words not yet in the deck, with JMdict
   glosses, levels derived from the hardest kanji they contain, and proper nouns
   and jargon filtered out. Needs a JMdict/EDRDG attribution first (CC BY-SA 4.0),
   which the repo does not carry today.
5. **Trim the tail.** Review the tier-4 and tier-3 words already in the deck;
   anything that is neither common by tier nor by Tatoeba count is a candidate for
   `data/archaic.csv`-style exclusion, judged by hand.

## Constraints from CLAUDE.md that shape this

- `data/frequency.json` and the sentence packs are not rebuilt. The new signal is
  a separate file. Words added in step 4 therefore have no example sentence, which
  the quizzes already handle; `corpus.test.ts` is the guard on the combination
  that would leave a question unanswerable.
- `TARGET_RETENTION`, `MAX_INTERVAL_DAYS`, `DEFAULT_WEIGHTS` and the optimiser's
  three guards are untouched. Selection decides *what* is asked, never how the
  schedule responds to the answer.
- The planner's rule that unseen material enters only through the pacer's ration
  stays: the weighted draw only ever picks from words already met.
