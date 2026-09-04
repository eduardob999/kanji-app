# Roadmap

## Working

**The four question types** — vocab reading, kanji writing, fill in the blank,
listening — over a shared `QuizFrame`. A definition per type lives in
`src/quizzes/definitions.tsx`, so a screen can mix them.

**One way to study.** Practice is the front door and the app opens on it. A
round is what the schedule says is due, most overdue first, then new material at
the ration the pacer has set, then, once both run out, words already met rather
than a screen saying there is nothing to do. The question type alternates
throughout, and each question arrives exactly as it would have in its own mode,
with the same scheduling behind it and the same interval after it. It opens on a
count rather than a question, and ends on what the round did to the ration. A
silent variant drops listening, for a bus or a shared room.

Unseen material only ever enters through the ration. The tail of a round is
drilling, not introduction, and letting it introduce words would make the ration
decorative. `src/domain/practiceQueue.ts` is where that is enforced and argued.

This replaced Today's Session, which stopped dead when the schedule was clear
and so offered eight items a day against a real backlog, and Random, which kept
going but ignored the schedule. They were one screen described from two ends.

**Three input methods**, behind one interface that hands the quiz a string and
tells it nothing about how the string was made: keyboard, handwriting, and
multiple choice with distractors scored for confusability.

**Adaptive scheduling.** FSRS with per-review-mode weights fitted from a review
log, held-out-validated so a bad fit is never adopted, and response-time
thresholds learnt per question type and input method. `Tools → Scheduler` shows
the calibration curve. A year of studying is simulated in the test suite
against a learner who forgets on a curve FSRS does not assume — because the
scheduler's real job is a feedback loop, and a loop can be wrong in ways no
single call is.

**The old CLI's scores**, imported once from `scores.txt` — 6,328 real streaks
out of 16,769 stored numbers (37.7%), with nothing invented for the rest. The
figure here used to say 1,117, which was measured from a stale export before
the real one turned up; regenerating the seed and counting says 6,328.

**Progress.** Per-level bars — the CLI's startup dashboard — measured by
stability rather than by a count of correct answers, so a full bar means "you
would still know this next month" rather than "you have answered this a lot".
Plus streaks and an eight-week activity strip.

**Browse, with the schedule on it.** Every kanji and word by level, each row
carrying when it is next coming round — the soonest of the memories an item
has, since a word is scheduled separately for reading and for producing it.

**About & credits**, carrying the attribution the licences require to the
people actually using the app, plus a plain statement of what is stored where.

**Its own look.** The palette is measured from the icon — washi paper
`#faf4ea`, sumi ink `#121f2e`, a vermilion seal `#d74030` — and every piece of
text on every screen is checked against WCAG AA by `npm run ui`, in both
themes, rather than by eye.

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

**Rationed sticking points.** Items failed often relative to how often they
have come up are capped at three a session, so the tail of things you cannot
learn stops crowding out the things you can, and Progress names them. Not
suspended: this corpus is the JLPT lists, and burying a word would be burying
the syllabus.

**Handwriting for every character in the corpus.** 2,211 of 2,211. Kanji
Canvas publishes 2,006; the rest are generated from KanjiVG at build time, and
41 of the published ones are corrected from it where their stroke count was
wrong. Measured over the whole corpus against ideal strokes: the right
character comes first 96.7% of the time and is offered at all 99.9% — 乙 and 肉
are the two it cannot find, and the "type it instead" button is there for
them.

**Updates that arrive.** A new build installs and waits rather than taking
control mid-quiz; the page offers it and "Later" means later. `npm run offline`
drives that hand-off end to end — offered, waiting, applied, old cache dropped
— because a worker that deliberately does not take over on its own leaves
someone on a stale bundle indefinitely if the offer is broken, and nothing says
so.

**Offline, checked.** 3.65 MB precached: the bundle (0.93), the decks (1.14),
the sentence packs (1.35) and the icons. Handwriting's 1.61 MB of patterns is
deliberately *not* precached and is cached on first use instead. `npm run offline` proves it by starting a server,
priming the cache, **stopping the server** and reloading — Playwright's own
offline emulation does not apply to service-worker fetches, so a check built on
it passes while proving nothing.

**The CLI retired.** `kanji-practice-app`'s README now opens with a notice
pointing here; `pip install pjapp` still works and the repository stays up.

## Next

Nothing outstanding. The list above is what has been built and, where a claim
here is checkable, checked — the numbers in it were re-measured rather than
remembered, which is how the score count turned out to be wrong by a factor of
five and the precache size out of date.

Worth doing when there is reason to:

- **Virtualise Browse** if it ever becomes a screen people scroll rather than
  search. It renders the first 300 matches today.
- **Fewer bytes on first load.** 897 kB is @firebase/firestore, @firebase/auth
  and react-dom, plus re2js which firestore hard-depends on; the app's own code
  is under 150 kB of it. Splitting would defer parse rather than bytes, and the
  service worker precaches everything anyway.
