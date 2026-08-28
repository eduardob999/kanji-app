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

**Progress.** Per-level bars — the CLI's startup dashboard — measured by
stability rather than by a count of correct answers, so a full bar means "you
would still know this next month" rather than "you have answered this a lot".
Plus streaks and an eight-week activity strip.

**About & credits**, carrying the attribution the licences require to the
people actually using the app, plus a plain statement of what is stored where.

**Its own look.** The palette is measured from the icon — washi paper
`#faf4ea`, sumi ink `#121f2e`, a vermilion seal `#d74030` — and checked for
contrast in both themes.

**Reachable on a phone.** The answer field, the primary button and "I don't
know" travel together in one dock that clears the on-screen keyboard, measured
from `visualViewport` for the browsers that do not resize their layout viewport
when an IME opens.

**A miss costs a rehearsal.** The answer has to be written out once before the
question is left behind — marked by the same function that marked the question,
so it can never be stricter, and recorded nowhere, because it is rehearsal
rather than evidence.

**A session that grows.** The new-item ration is earned from finishing sessions
accurately rather than measured from throughput, which cannot work: throughput
is measured from the reviews you did and the session decides how many you were
offered, so the loop's input was its own output and eight was a fixed point.

**Offline.** ~3.4 MB precached: the bundle, the decks and the sentence packs.
Handwriting's 1.5 MB of patterns is deliberately *not* precached and is cached
on first use instead.

## Next

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
