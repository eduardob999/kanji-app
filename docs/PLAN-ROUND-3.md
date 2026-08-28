# Round three: reachable actions, corrective typing, an honest ration

Four things. The first is a layout fault, the second is a change to what a miss
costs, the third is a control loop whose input is its own output, and the
fourth is a mode that should always have existed.

---

## 1. The action buttons go under the keyboard

### What happens now

`QuizFrame` renders a card that is a flex column: header, prompt, answer input,
then the primary button (**Check**, or **Next** once answered) and a quiet row
underneath it (**I don't know**, **Undo**). All of it is in normal flow, so the
buttons sit wherever the content above them ends.

With the IME open a 360×780 phone has roughly 440 px of usable height. Prompt
plus input already fills most of that, so the two things you press on every
single question are below the fold, and answering means scroll, tap, scroll
back.

### Why it is not a one-liner

Whether the *layout* viewport shrinks when the keyboard opens is the browser's
choice, not ours. Some shrink it, so `100dvh`, `position: fixed` and sticky all
follow the keyboard for free; others shrink only the *visual* viewport, and a
`bottom: 0` element stays pinned to the full-height layout viewport — which is
to say, behind the keyboard. The one primitive that reports the truth
everywhere is `window.visualViewport`.

### The work

**a. Ask the browser to do it.** `index.html`'s viewport meta gains
`interactive-widget=resizes-content`. Where it is honoured this solves the
problem outright and everything below reads zero.

**b. Measure it where it is not.** `src/hooks/useKeyboardInset.ts` publishes
`--keyboard-inset` and `data-keyboard="open"` on the root element from
`innerHeight - (visualViewport.height + visualViewport.offsetTop)`, floored at
zero and rAF-coalesced across the visual viewport's `resize` *and* `scroll`.
Insets under ~120 px are ignored: a collapsing URL bar and Safari's rubber-band
both produce small non-zero values that are not a keyboard.

The two compose rather than compete. Where (a) worked, (b) measures nothing and
changes nothing.

**c. A real action bar.** The primary button and the quiet row move into a
`.quiz__actions` footer, bled to the card's edges, with a solid card background
and a hairline top border:

```css
.quiz__actions {
  position: sticky;
  bottom: calc(var(--keyboard-inset, 0px) + 8px);
  z-index: 4;                 /* under the tab bar's 5 */
}
```

**Sticky, not fixed.** When the card fits the screen the bar is simply the
bottom of the card and overlaps nothing; it only begins to float once there is
something to scroll. A fixed bar would cover content on every short screen to
solve a problem that only exists on tall ones.

One thing to confirm while building: sticky is defeated by `overflow: hidden`
on any ancestor. `.card` and `.content:has(.quiz)` look clean, but this is the
failure mode that produces "it just doesn't stick" with no error.

**d. Hide the tab bar while typing.** With the keyboard up it is dead weight,
and on the platforms in (b) it is *behind* the keyboard. Under
`[data-keyboard='open']` it goes away and `--tabbar-clearance` drops to zero, so
the action bar sits directly on top of the keyboard.

### Verifying it

A headless browser cannot raise a soft keyboard, so the audit gets a *stated
simulation* rather than a pretend one: a new state family focuses the answer
field, sets `--keyboard-inset` to a measured value for that device (336 px at
360×780), and asserts the primary button's bottom edge is above
`viewportHeight − inset` without scrolling. That catches every regression in
the CSS above.

What it cannot catch is whether the real inset is measured correctly on real
hardware, which is one specific question for you: **with the keyboard open on
your phone, is "I don't know" reachable without scrolling?**

---

## 2. Typing the answer after a miss

The technique is copying: after a failed recall, reproducing the correct answer
before moving on. Cheap, well-evidenced, and it turns the dead moment after a
miss into the only rehearsal that miss was ever going to get.

### The shape

In the `verdict && !verdict.correct` branch, **Next** is not available until the
answer has been reproduced. The answer stays on screen throughout — this is
copying, not a second attempt at recall, and hiding it would just be asking the
same question twice.

**What counts as reproduced:** `definition.check(typed, item)` — the very
function that marked the question. It therefore cannot be stricter than the
question was, and items with several accepted readings need no second rule.

**Which input:** whatever the learner uses. Keyboard types it. Handwriting
draws it, which on a kanji-writing question *is* the drill. Multiple choice
re-presents the same four options and requires the right one — so no method
becomes a dead end for want of a Japanese IME.

**An escape hatch, but a quiet one.** "Skip this" appears after two failed
reproductions or twenty seconds. Required is not the same as trapped, and there
are honest ways to be stuck: a recogniser that will not produce the character,
or one of the 205 kanji with no reference pattern at all.

### What it deliberately does not touch

**The grade.** All three writes — state, log, fluency — already happened in
`resolve()` before the correction is shown. The correction is rehearsal, not
evidence. Grading it would mean every failure was immediately followed by a
success, and the model would stop being able to learn anything from failures.

**The review log.** No new field in v1. The entry is appended at resolve time,
so recording attempts would mean a second write per miss for data that nothing
reads yet.

"I don't know" leads to the correction too — it is a miss. Undo clears a
pending correction along with the verdict.

This is why part 1 comes first: the correction is the one place in the app
where a keyboard opens on a *verdict* screen, which previously had none.

---

## 3. Why every session is eight questions

### The diagnosis, exactly

With nothing due, a session is exactly `maxNew` questions. `pace()` clamps
`maxNew` to `BASE_NEW = 8`; `planSession` defaults `DEFAULT_MAX_NEW` to the
same 8. Every rule in the pacing model moves that number *down* — to zero when
you are behind or struggling. **There is no path upward.** A learner with an
empty backlog gets eight a day forever, however easy they are finding it.

### Why sizing it from throughput does not work

The obvious fix is to derive the ration from measured throughput. It fails, and
the reason is worth writing down: **throughput is measured from the reviews you
did, and the session decides how many you are offered.** Offer eight, they do
eight, throughput reads eight, the ceiling stays eight. The control loop's
input is its own output.

Random practice is the one escape — those reviews count too — so today the only
learner who ever grows is the one who taps Random. That is not a design.

### The appetite ratchet

The growth signal has to be evidence that exists *even when the offer is the
binding constraint*. Finishing everything offered, accurately, is exactly that.

One number on the profile, `kanjiba.appetite`, updated at the end of each
session:

| After a session | Change |
| --- | --- |
| Finished in full, accuracy ≥ 0.85 | +2 |
| Finished in full, accuracy ≥ 0.75 | 0 |
| Abandoned, or accuracy < 0.75 | −3 |

Clamped to [4, 30]. Asymmetric on purpose: earn growth on evidence, retreat
fast on strain.

It enters `pace()` as a new field on `Load`, replacing the `BASE_NEW` constant
in one clamp — so the headroom rule and the accuracy rule still bind exactly as
they do now. Appetite only decides how high the ration may go *when nothing
else is holding it down*.

**Finished or abandoned** is recorded without unmount hooks: write
`kanjiba.session = { startedAt, offered, finished: false }` when a session
starts, and set `finished: true` with the tally when `QuizFrame` empties its
queue. A record still unfinished when the *next* session starts was abandoned.
Survives closing the tab, which no `beforeunload` does reliably.

### A bug this would have walked into

`maxItems = clamp(due + maxNew, MIN_SESSION, ceiling)`, and `ceiling` is at
least `BASE_SESSION = 15`. With `due = 0` and an appetite of 20, that clamp
returns 15 and silently drops five of the new items the model just decided
were warranted. The ceiling must never truncate `due + maxNew`; only
`MAX_SESSION` may.

### The caveat that matters most

Once the CLI scores are imported — 6,328 items, still one tap away and only you
can make it — the backlog will be large, `pace()` will read *behind*, and
`maxNew` will go to zero regardless of appetite. That is correct, and it is the
entire point of the pacing model. **Eight-forever is a symptom of an empty
backlog.** This work is what makes the *other* side of the import behave, so
it is worth doing either way, but do not expect the number to jump the day
after an import.

### Tests

`pacing.test.ts` gains: appetite raises the ration when there is headroom;
appetite cannot override *behind* or *struggling*; the ceiling never truncates
`due + maxNew`; the ratchet's arithmetic and its bounds; an abandoned session
lowers it.

The single-mode panels keep their flat 15/8 and that is deliberate — they are
one kind of practice, chosen explicitly, and the schedule's opinion about
volume belongs to the screen that represents the schedule.

---

## 4. Random, silent

Random currently mixes all four question types and drops listening only when
the device turns out to have no Japanese voice at all. There is no way to say
*not right now* — on a bus, in a library, in a room with other people, with the
headphones in the other bag.

A separate leaf rather than a toggle:

```
study.random-silent — "Random (silent)"
  "The same, minus listening. For a bus, a library, or a shared room."
```

`RandomPanel` takes a `silent` prop and picks `WITHOUT_VOICE`; the node carries
no `needsSpeech`, so the shell's up-front "this device has no voice" warning
does not appear on the one screen that does not care.

**Why not a toggle in the quiz header.** A toggle is state, and state on this
screen has to be stored somewhere, restored, and reasoned about when it changes
mid-round — which would reset the tally, because changing which question types
are in play is a different sitting. Two menu entries cost one line of nav data
each and are decided before anything starts.

It also happens to be the right fallback for a device whose speech synthesis is
present but broken, which the voice check cannot detect.

---

## Order

0. **Random, silent** — independent of everything else and small enough to bank
   first.
1. **Keyboard reachability.** Everything else is easier to look at once the
   buttons are where the thumb is.
2. **The correction step**, which needs (1) to be usable at all.
3. **The ration**, which is pure domain work and touches no layout.

## Verification

`npm test` throughout, `npm run ui` after each of (1) and (2) — the count of
failing screen/viewport combinations is the number to drive down, and it is
currently zero, so any increase is this work's fault. Screenshots in `.ui/` for
the parts no rule can judge.
