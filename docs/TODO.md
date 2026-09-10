# Standing list

Opened 2026-09-10 at the owner's request. Five items, each with the measurement
that decides it is finished — a feeling cannot be finished, and "looks better"
without a number attached is how the last three of these get argued about
forever.

Two earlier items live in their own documents and are done:
`docs/UI-PLAN.md` (everything fits, nothing scrolls) and
`docs/SENTENCE-QUALITY.md` (no invalid questions).

---

## 1. Small screens, again

- [ ] **The app is comfortable on a small phone in real conditions, not only in
      the harness.**

`npm run ui` reports zero failures at 320-1280px with a 55% keyboard, and he
still says small screens are troublesome. So the harness is modelling something
narrower than reality. What it does not model, in the order I would bet on:

1. **Text scaling.** Android's font-size setting and Chrome's minimum font size
   multiply every `rem` in the app. At 1.3× a layout tuned to the pixel stops
   fitting. Nothing in the audit has ever run at anything but 1.0.
2. **Browser chrome.** The audit's viewport is the whole window; a real Chrome
   has a URL bar that takes ~60px until you scroll.
3. **Keyboards taller than 55%**, which the measurements in `UI-PLAN.md` show
   the layout gives out at.

Done when: the audit runs each phone width at 1.0, 1.15 and 1.3 text scale and
at a 62% keyboard, all of it green, **and** he says it is comfortable. The
second half is not optional — the first half was green last time.

### What the first run found

The bet was right: at 1.3 on a 320px phone, **34 of 35 screens failed**, and the
tab bar was in every one of them.

1. **The bar ran off the edge.** Four labels in `1fr` columns, and a grid
   track's automatic minimum is its content, so "Progress" and "Tools" at 1.3
   pushed the bar 10px past the window — on every screen at once, since the bar
   is on every screen. `minmax(0, 1fr)` and labels that may wrap.
2. **The space reserved for the bar was a constant.** 72px, while the bar at
   1.3 is 110px — so the quiz's dock sat 4px *under* it, which is unreachable
   rather than tight. It is measured now: a ResizeObserver publishes
   `--tabbar-height` and the clearance follows it. See `watchTabBar` in
   `src/viewport.ts`.
3. **The breakpoints were in pixels.** A phone with the text turned up is a
   small screen for its owner, and `px` cannot see that. They are `em` now,
   which in a media query means the browser's default font size — the thing the
   platform's text-size setting actually changes. A 390px phone at 1.3 measures
   18.6em and gets the density of a 320px one.
4. **The drawing pad asked for 30% of a window that no longer had it.**
   Everything around it is `rem` and grows; the pad was `vh` and did not. It is
   bounded by `calc(100dvh - 26rem)` as well now — the same quantity from the
   other end.

And the harness was measuring the wrong thing itself: it scaled text by
overriding `html { font-size }`, which moves `rem` but not `em` media queries.
Android moves both, because it raises the browser's *default* font size. The
audit uses CDP's `Page.setFontSizes` now, so a stylesheet that adapts on a real
phone adapts in the harness.

### The standard at 1.3, stated

At the default text size every operated screen fits its window, and that rule
stands. At 1.3 the window has not grown while everything in it has — the tab bar
alone is 110px of 640 — so demanding a whole card still fit would mean shrinking
text its owner deliberately enlarged. The rule there is that **the thing you
came to press is on screen without scrolling for it**, and the audit checks that
at every viewport, scaled or not: Start, Check, Another round.

## 2. Theme colour and a background of his own

- [x] **The learner can change the accent colour and set a background image,
      and the result still passes every contrast and layout rule.**
      *Done 2026-09-10. `Tools → Appearance`.*

The palette is already tokens on `:root` (`--accent`, `--bg`, `--text`…), so the
mechanism is a stored preference writing custom properties. The work is in what
it must not break: WCAG AA on every surface, both themes, and a photograph
behind text that has to stay readable.

Done when: a colour and a background survive a reload and a second device;
`npm run ui` passes with a chosen accent and an uploaded background in place;
text over a background image is never below AA.

### How each half is made safe

**The colour is a hue and nothing else.** Lightness and chroma stay the app's,
in OKLCH, whose lightness is perceptual — so equally light for every hue means
equally readable against the same background. `theme.test.ts` checks all 360 in
both themes against the real backgrounds: button label 4.5, accent text on page
and card 4.5, the filled button as a shape 3.0. That is what lets it be a
slider instead of a menu of six safe choices.

**The picture never sits behind text.** Cards are opaque, and the header,
breadcrumb and tab bar take a 92% ground of their own the moment a background
exists — so every piece of writing in the app is on a surface the contrast rules
were already checked against, whatever the photograph is. The dimming is
therefore a taste control (25-96%, default 62) rather than a safety one.

The first version had the scrim carrying both jobs with a floor at 70%. It was
safe and it was pointless: at 85% the picture someone had just chosen was a
rumour. Making legibility structural is what let the dimming come down far
enough to see it.

**The image is resized before it goes anywhere.** A phone photo is 8 MB and
4000px wide; Firestore's ceiling is 1 MB per document. `domain/image.ts` caps
the long edge at 1440 and then chooses a JPEG quality by measuring rather than
hoping — encode, check, drop, encode — with a 600 kB budget that leaves room for
base64's third on top. It lives in its own document, not on the profile, so the
accent colour does not arrive behind half a megabyte of photograph.

The audit drives the whole path — a generated JPEG through the real file input —
and then runs every rule with the picture in place, at all eight viewports.

## 3. Sound, the way a game does it

- [x] **Right, wrong, streak and round-end have sounds, they never talk over a
      listening question, and they can be turned off.**
      *Done 2026-09-10.*

Kanjiba already speaks Japanese; this is the other kind of sound — short cues
that make an answer feel resolved. The constraints are specific: the app has a
silent mode for a bus, a listening quiz that must not be interrupted, and an
offline promise, so the sounds ship with the build rather than stream.

Done when: cues exist for correct, wrong and round-end; a setting silences them
and defaults sensibly; nothing plays while speech is playing; total added weight
under 100 kB.

### What was built

**Synthesised, not downloaded.** Three oscillators and an envelope in
`src/audio/cues.ts` — about 2 kB of code once the comments come off, against a
100 kB budget and zero audio files. Nothing to fetch means nothing to be missing
on a train, which is the same argument the sentences ship in the build under.

- **correct** — two notes up a major third, 180ms. The interval carries it:
  rising reads as *yes* in a way a single beep does not.
- **wrong** — one note, lower, softer, and deliberately not dissonant. A buzzer
  punishes; this is information, and the item is coming back in two hours.
- **finish** — a three-note arpeggio, once a round.

Each note has an 8ms attack and an exponential tail, because a bare oscillator
switched on and off clicks — the waveform steps from silence to full amplitude
in one sample and you hear it.

Three rules decide whether a cue plays, and they are a pure function
(`shouldPlayCue`) with tests rather than conditions buried in a component:
the learner's setting; **never over speech**, since a cue landing on a listening
question is the app making its own question harder; and **nothing at all in
Practice (silent)**, because that screen exists for a room where sound is not
allowed and a chime is still a sound.

The setting lives under `Tools → Sound`, defaults to on, and the screen can play
each cue — a setting for a sound you cannot hear from the settings screen is one
you have to go and get a question wrong to test.

## 4. Better sentences, and more of them, without a slower app

- [x] **More entries have an example, the examples read like Japanese, and the
      app starts no slower.**
      *Done 2026-09-10 — and the third clause turned out to be the one worth
      the most.*

Today: 5,975 of 7,234 entries (83%) have a verified example, and everything
shipped is checked twice (see `SENTENCE-QUALITY.md`). The gap is 1,259 entries
with nothing, and the quality bar is still "not a translated drill sentence".

Done when: coverage is meaningfully above 83% with the verification unchanged
and zero invalid questions; the sentence packs do not grow the initial load
(measured — they are fetched per level, so this is about pack size and when
they are fetched); and a measured before/after of time-to-first-question.

### Quantity: 83% → 84%, and that is the ceiling

Two last-resort tiers, both reached only by a word that would otherwise have no
example at all: look further down its ranking (400 candidates instead of 40),
and then outside the 8-44 character window (6-60). Coverage went from 5,975
entries to **6,045**, still with every sentence verified twice and
`npm run sentences:check` at zero.

That is a small number and it is close to all there is. Of the 1,189 entries
still without an example:

| | entries | |
|---|---|---|
| the surface appears nowhere in the corpus, at any length | 645 | 54% |
| it appears, but never as that word with that reading | 480 | 40% |
| only in sentences outside even the widened window | 26 | 2% |
| verified but blocked by the ambiguous-word confirmation rule | 35 | 3% |
| still reachable — the deep search's own cap | 3 | 0.3% |

**1,151 of 1,189 are not reachable from Tatoeba at all**, whatever this
pipeline does. The remaining 35 are a correctness trade worth keeping: they are
words the corpus reads two ways, where an unconfirmed guess is how 「バス［しろ］」
happened. Going meaningfully past 85% means a second corpus, not a better
filter — which is a real option (JMdict's own examples, Wikipedia extracts) and
a much larger piece of work.

### Quality: examples where the word stands on its own

株主総会 contains 総会, read exactly as 総会 is read, so 株主［そうかい］が開かれた is a
*fair* question — the answer is right and the reading is right. It is still a
worse question than one where the word stands alone, because what the learner
sees is half a compound with a hole in it. The ranking now prefers the
standing-alone sentence where one exists, as a preference rather than a filter:
filtering would take examples away from the one-character entries that mostly
appear inside compounds, and a slightly odd question beats none.

**4.1% of entries now show a glued example first**, and those are the words for
which no other kind exists.

### Speed: the part that actually mattered

The app fetched **all eight sentence packs — 1.3 MB — before it could ask its
first question**, on every screen that uses sentences, for a round that reads
fifteen examples from two or three levels. Planning needs every deck, because
what is due is scattered across levels; it needs no sentences whatsoever.

So the source hands the frame an empty, mutable index and an `ensureSentences`,
and the frame fills it for the levels its *planned queue* landed on — filtered
to the questions that will actually read a sentence. Measured, first question
from a cold start:

| screen | sentence bytes before | after |
|---|---|---|
| Practice | 1,304 kB | 934 kB |
| Fill in the blank | 1,304 kB | 808 kB |
| Vocab reading | 1,304 kB | **0** |
| Kanji writing | 1,304 kB | **0** |

Two of the four drills never needed a single sentence and were waiting for all
of them.

**The next lever, unpulled:** the decks are now the load — 1,110 kB of them,
because the planner reads every item in the corpus to find what is due. A
compact index of id, level and rank would be about 200 kB and would let the full
decks be fetched only for the questions chosen. That is a larger change than
this item needed, and it is where the remaining second goes.

## 5. A UI worth showing someone

- [x] **The app looks like something you would download on purpose.**
      *Done 2026-09-10.*

It is legible, it fits, and it is plain. Marketable means the things a stranger
notices in ten seconds: a first impression, motion that explains what just
happened, a progress screen that rewards looking at it, an icon and a share
image.

Done when: the answer transition, the streak and the round summary have
deliberate motion (respecting `prefers-reduced-motion`); the empty and first-run
states are designed rather than default; every screen still passes the audit;
and there is a screenshot set that would sit on a store page without
embarrassment.

### What was done

**Motion, as the app replying rather than as decoration.** A verdict rises 6px
over 140ms; a miss shakes three pixels twice; a hit breathes to 1.02 and back;
the dock crossfades when it becomes the verdict; the progress bars fill,
staggered down the levels; the round summary arrives a line at a time. Three
rules: nothing moves that you are reading, nothing lasts long enough to wait for
(320ms at the outside), and everything ends at rest — which is what makes the
existing `prefers-reduced-motion` block sufficient rather than approximate.
Verified at both motion settings: every element settles at opacity 1 and an
identity transform. All CSS; nothing added to the bundle.

**The quiz card fills its screen.** It was as tall as its contents and sat at
the top, which put the question in the top third and left two thirds of nothing
— the "crammed then empty" this document opens with, still true on the screen
the app is mostly used on. The prompt now sits at the optical centre and Check
is where the thumb already is. Resting state only: with the keyboard up every
pixel is already spoken for, and growing the card there cost the longest
question in the corpus two pixels at 320px, which the audit reported the moment
the rule went in unscoped.

**A new account is invited rather than judged.** The Progress screen met a first
visit with 0 day streak, 0 today, 0 all time, an empty eight-week strip and 0%
across eight levels — not one number of which is information, since all of them
follow from "you have not started". It now says what the screen will hold and
offers the way to make it true. An imported account still gets the real report:
it has no review *log* but thousands of review states.

**And the screenshots exist**, at `?bare=1` on the preview harness so the
harness's own status chip stays out of them, captured at 390x844 and 3x.
