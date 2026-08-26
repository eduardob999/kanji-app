# Roadmap

Nine phases. Phases 1–4 are the risky ones; after 4 it is the same pattern
repeated three more times.

## 1. Skeleton ✅

Vite/React/TS, Firebase, Google sign-in, the navigation shell, PWA offline
caching, Pages workflow. Deploys and installs on a phone; every study screen is
a placeholder.

## 2. Data

`scripts/build-decks.mjs` reads the two CSVs from `kanji-practice-app` and emits
one JSON per deck into `public/decks/`. Item ids are stable: kanji use the
character, vocab use `kanji|reading` — the CSV has genuine duplicate words that
only their reading tells apart (毎月/まいげつ vs 毎月/まいつき), which the old
`scores.txt` could not represent at all.

Deliverable: the Browse screen, showing real data.

## 3. Domain

`grading.ts` (objective correct/incorrect → FSRS grade), `answerCheck.ts`
(reading normalisation, ported from `vocab_quiz.py`), `sessionPlanner.ts`,
and `storage/reviewState.ts` — review state bucketed one document per deck
rather than one per item. ~9,500 items would otherwise mean ~9,500 document
reads on every cold start.

Deliverable: tests, no UI.

## 4. First quiz

`QuizFrame` (prompt → answer → verdict → grade → next) plus the vocab reading
mode and the keyboard input method. End to end: prompt, grade, write, sync,
survive going offline.

## 5. Input methods

The handwriting canvas (KanjiCanvas) and multiple choice, behind the same
`AnswerInput` interface.

## 6. The remaining three modes

Kanji writing, then `build-sentences.mjs` → fill in the blank, then listening
via the Web Speech API.

## 7. Migration

`scripts/migrate-scores.mjs`, and the one-time import offered at first sign-in.

The old `scores.txt` is a row-ordered dump of both CSVs; the index join is exact
(0 key mismatches across 2,211 kanji and 7,279 vocab rows). But most of that
score is not progress: `reset_scores` set a baseline per JLPT level and only
~1,100 items ever moved above it. Those get seeded FSRS state; the rest get
none, and their level decides introduction order instead. Fabricating a memory
state for 15,000 unseen items would poison `adaptWeights` from the first
session.

## 8. Today's Session and Progress

The interleaved planner, per-level completion bars, and retention
actual-vs-predicted.

## 9. Retire the CLI

Archive `kanji-practice-app` with a README pointing here.
