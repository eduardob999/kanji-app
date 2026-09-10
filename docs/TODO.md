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

## 2. Theme colour and a background of his own

- [ ] **The learner can change the accent colour and set a background image,
      and the result still passes every contrast and layout rule.**

The palette is already tokens on `:root` (`--accent`, `--bg`, `--text`…), so the
mechanism is a stored preference writing custom properties. The work is in what
it must not break: WCAG AA on every surface, both themes, and a photograph
behind text that has to stay readable.

Done when: a colour and a background survive a reload and a second device;
`npm run ui` passes with a chosen accent and an uploaded background in place;
text over a background image is never below AA.

## 3. Sound, the way a game does it

- [ ] **Right, wrong, streak and round-end have sounds, they never talk over a
      listening question, and they can be turned off.**

Kanjiba already speaks Japanese; this is the other kind of sound — short cues
that make an answer feel resolved. The constraints are specific: the app has a
silent mode for a bus, a listening quiz that must not be interrupted, and an
offline promise, so the sounds ship with the build rather than stream.

Done when: cues exist for correct, wrong and round-end; a setting silences them
and defaults sensibly; nothing plays while speech is playing; total added weight
under 100 kB.

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
