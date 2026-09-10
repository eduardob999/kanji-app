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

- [ ] **More entries have an example, the examples read like Japanese, and the
      app starts no slower.**

Today: 5,975 of 7,234 entries (83%) have a verified example, and everything
shipped is checked twice (see `SENTENCE-QUALITY.md`). The gap is 1,259 entries
with nothing, and the quality bar is still "not a translated drill sentence".

Done when: coverage is meaningfully above 83% with the verification unchanged
and zero invalid questions; the sentence packs do not grow the initial load
(measured — they are fetched per level, so this is about pack size and when
they are fetched); and a measured before/after of time-to-first-question.

## 5. A UI worth showing someone

- [ ] **The app looks like something you would download on purpose.**

It is legible, it fits, and it is plain. Marketable means the things a stranger
notices in ten seconds: a first impression, motion that explains what just
happened, a progress screen that rewards looking at it, an icon and a share
image.

Done when: the answer transition, the streak and the round summary have
deliberate motion (respecting `prefers-reduced-motion`); the empty and first-run
states are designed rather than default; every screen still passes the audit;
and there is a screenshot set that would sit on a store page without
embarrassment.
