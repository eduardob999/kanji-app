# Roadmap

## Working

**The four question types** — vocab reading, kanji writing, fill in the blank,
listening — over a shared `QuizFrame`. A definition per type lives in
`src/quizzes/definitions.tsx`, so a screen can mix them.

**Two ways to study.** Today's Session is what the schedule says is due,
interleaved and finite, opening on a count rather than a question. Random is
endless and ignores due dates, for once the session is cleared.

**Three input methods**, behind one interface that hands the quiz a string and
tells it nothing about how the string was made: keyboard, handwriting, and
multiple choice with distractors scored for confusability.

**Adaptive scheduling.** FSRS with per-review-mode weights fitted from a review
log, held-out-validated so a bad fit is never adopted, and response-time
thresholds learnt per question type and input method. `Tools → Scheduler` shows
the calibration curve.

**The old CLI's scores**, imported once from `scores.txt` — 1,117 real streaks
out of 16,769 stored numbers, with nothing invented for the rest.

**Offline.** ~3.4 MB precached: the bundle, the decks and the sentence packs.
Handwriting's 1.5 MB of patterns is deliberately *not* precached and is cached
on first use instead.

## Next

### The icon

Waiting on `data/icon-source.png`. Everything else is in place:
`scripts/generate-icons.mjs` currently draws 十 out of rectangles.

### Progress

Per-level completion bars — the CLI's startup dashboard — plus streaks and how
much of each level is actually held. `Tools → Scheduler` already covers how well
aimed the schedule is; this is the other half.

### About & credits

`LICENSES.md` covers the legal obligation, but the app itself should say where
its sentences and stroke data come from somewhere other than the handwriting
panel's footer.

### Leeches

Items failed over and over currently cycle forever. They should be flagged and
handled differently — a mnemonic prompt, or suspension until asked for.

### Handwriting coverage

205 of 2,211 kanji have no reference pattern (mostly jinmeiyō: 哉, 舜, 慧, 麟).
There is a "type it instead" button, deliberately always present rather than
appearing only for those characters — showing it conditionally would leak the
answer. Closing the gap properly means generating patterns from KanjiVG for the
missing characters.

### Retire the CLI

Archive `kanji-practice-app` with a README pointing here.
