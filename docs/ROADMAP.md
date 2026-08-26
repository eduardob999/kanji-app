# Roadmap

## Done

**1. Skeleton.** Vite/React/TS, Firebase, Google sign-in, the navigation shell,
PWA offline caching, Pages workflow.

**2. Data.** `build-decks.mjs` compiles the two CSVs from the CLI into 16
per-level decks — 9,445 items, 1.1 MB. Vocabulary is keyed by word *and*
reading; 45 cross-level duplicates are collapsed; the kana disambiguator
convention in the source (`every month (げ)`) is protected by a build guard, and
four prompts it does not cover accept either reading.

**3. Domain.** Grading, answer checking ported from `vocab_quiz.py`, the
interleaving session planner, and review state bucketed one document per mode
per level rather than one per item — ~19,000 cold-start reads avoided.

**4–6. All four quiz modes.** Vocab reading, kanji writing, fill-in and
listening, over a shared `QuizFrame`. Sentences come from a build-time Tatoeba
pack (90% coverage) rather than a live API call; listening uses the device's own
Japanese voice and says so when there is none.

**Adaptive scheduling.** A review log, an FSRS optimiser fitted per review mode
with held-out validation, and response-time thresholds learnt per question type
and input method.

**Multiple choice**, with distractors scored for confusability.

## Next

### 7. Handwriting

The one input method still missing, and the one the CLI's workflow was built
around. It is harder than the plan assumed:

- The only viable open recogniser, [KanjiCanvas](https://github.com/asdfjkl/kanjicanvas)
  (MIT), ships reference patterns as **raw stroke coordinates**: 5.75 MB for
  this corpus, against 1.1 MB for every deck combined.
- It is **missing 205 of our 2,211 kanji** — mostly jinmeiyō like 哉, 舜, 慧,
  麟 — so roughly 9% of the kanji deck could not be checked.
- It contains **no kana at all**, which the vocabulary modes need for okurigana.
  The repository has separate hiragana and katakana sets that would have to be
  merged in.

The shape of the answer: split the patterns per JLPT level so a session loads
only what it needs, let the service worker cache them on use rather than
precaching 5.75 MB, port the recognition pipeline away from its DOM coupling,
and fall back to the keyboard for characters with no reference pattern.

### 8. Importing the CLI's scores

`migrate-scores.mjs` and the one-time import at first sign-in. The old
`scores.txt` joins to the CSVs exactly (0 key mismatches across 2,211 kanji and
7,279 vocab rows), but most of that score is not progress: only ~1,100 items
ever moved above the baseline `reset_scores` set from their JLPT level. Those
get seeded FSRS state; the rest get none, and their level decides introduction
order instead.

### 9. Today's Session and Progress

The planner already interleaves; this is the screen that uses it across all four
modes at once, plus per-level completion bars and streaks.

### 10. Retire the CLI

Archive `kanji-practice-app` with a README pointing here.
