# Making the UI work on a phone

## Context

The app was reported as "crammed and unresponsive" on a phone. It is behind a
Google sign-in, so nobody could look at a screen without holding a device — the
first thing built here is a way to look.

`src/preview/` renders every screen against fixtures at any viewport, dev builds
only. `npm run ui` drives it through a headless browser at four widths and
reports overflow, tap targets under 44 px, text under 12 px, and console errors,
leaving screenshots in `.ui/`.

The first run found **52 screen/viewport combinations with problems** — and
disproved the most obvious theory. There is no horizontal overflow anywhere; an
earlier screenshot suggesting otherwise was an artifact of `--window-size`
rather than a real viewport. The app is not unresponsive in the layout sense.

What it actually is:

- **Too small to hit.** Nearly every button is under the 44 px minimum: "I don't
  know" is 116×33, every `segmented__option` is 37 px tall, the tab bar's labels
  are 11.5 px.
- **Too small to read.** `levels__seen` is 9.9 px, `credit__licence` 11.2 px,
  tab labels 11.5 px, inline `code` 11.6 px.
- **Crammed then empty.** The quiz card occupies the top third of a phone screen
  and the remaining two thirds are blank. Everything is bunched under the status
  bar, at the far end of the screen from the thumb.

## The work

### 1. Tap targets

Every interactive element to 44 px minimum in both directions. Affects
`.button--small`, `.segmented__option`, `.tabbar__tab`, `.choices__option`,
`.handwriting__candidate`, and the inline links in About.

Where an element is genuinely small by design — an inline licence link — the
target is enlarged with padding rather than the text with font size.

### 2. Legible text

A floor of 12 px on anything meant to be read, and 13 px on anything read
often. `levels__seen` at 9.9 px is the worst; the tab bar is the most used.

### 3. Vertical rhythm on the quiz screens

The screen that matters most is the one with the worst use of space. The prompt
should sit in the optical centre, the answer and its action should sit low
enough to reach, and the card should stop being a small box at the top of a
large empty page.

`.content` already has `flex: 1` available from `.screen`; the quiz needs to
claim the height rather than hug its content.

### 4. Focus rings that are not clipped

`:focus-visible` draws at `outline-offset: 2px`, and a full-width input inside a
card with 20 px of padding puts that ring on the card's border. Inputs need to
sit inside enough padding to show their own focus state.

### 5. A Japanese font stack

Nothing declares one. On a device without a CJK font the prompts render as tofu
— which is exactly what the headless browser shows, and is a real state for a
stripped-down Android. Declaring the common system faces costs nothing.

## Done so far

1. **Tap targets** — everything interactive at 44 px minimum. Inline links in
   prose are exempt, which is WCAG 2.5.8's own exception and now the audit's.
2. **Legible text** — 12 px floor, 13 px on the tab bar.
3. **Two rules that had been missing since the stylesheet was first assembled**,
   both found by measuring rather than reading:
   - `* { box-sizing: border-box }`. Every element with `width: 100%` and
     padding was that much too wide — the quiz answer field measured 350 px
     inside a 316 px card. This is most of what "crammed" meant.
   - `.content { padding-bottom }`. The tab bar is `position: fixed`, so
     nothing reserved space for it and the last 80 px of every screen sat
     underneath it. Now a `--tabbar-clearance` token, so the bar's height and
     the space reserved for it cannot drift apart.

   A property-level diff against the stylesheet these were extracted from
   confirms those two were the only casualties.
4. **Vertical rhythm** — the quiz claims the height between header and tab bar,
   the prompt centres in the slack, the answer and its buttons sit at the
   bottom where a thumb reaches. 296 px of dead space became none.

`npm run ui`: 52 failing screen/viewport combinations → 0.

5. **Interactive states.** The harness only loaded screens, so it never saw a
   verdict. Teaching it to answer a question and press Start found two faults
   behind one symptom: the review log was read in the same `Promise.all` as the
   decks, so an unreadable log killed the screen and blamed the decks; and the
   read did not fail but *retried indefinitely*, so the `.catch` never ran and
   the screen sat on "Working out what is due…" for ever. Log reads now time
   out and carry on without the history.
6. **The quiz card's rhythm.** A flex column whose spacing came from whatever
   margin each piece happened to bring, which is why the grade line sat flush
   against the Next button. One gap on the card, margins reset on its children.
7. **Handwriting at 360 px.** The densest screen in the app overflowed and put
   Check underneath the tab bar. The canvas is now bounded by viewport height
   as well as width, and the three controls fit one row.

8. **Both themes at phone width.** The audit ran phones dark and wide viewports
   light, so no phone-sized light screenshot existed. 360 is light now and 390
   dark, which covers the gap without doubling every run.
9. **The home screen stopped waiting for something it does not need.** Counts
   come from the decks; only the pacing note needs the review log, and both
   were awaited together — so opening the app showed a title and one line of
   text until the slowest read finished. Time to useful content went from up to
   eight seconds to **316 ms**.
10. **Two things the rules could not see**, found by looking at screenshots:
    the two figures on Today's Session sat on different baselines because the
    muted one used a smaller number, which read as a mistake; and the
    three-option skill picker on Progress wrapped 2 + 1 at 360 px, leaving the
    third alone at double height.

## Done

Every item above is complete. `npm run ui` reports 0 problems across 15 screens
× 4 viewport/theme combinations, plus 3 interactive states.

What is worth keeping from this is not the CSS. It is that the app now has a
way to be looked at: `src/preview/` renders any screen without a sign-in, and
`npm run ui` says which of them are broken. Four of the ten items above were
bugs that had been shipped and unnoticed, and two of those — a missing
`box-sizing` reset and a session screen that could hang for ever — were
invisible from reading the code.

## Verification

`npm run ui` after each change; the count of failing combinations is the number
to drive down. Screenshots in `.ui/` for anything the audit cannot judge, like
whether a screen looks balanced.

The audit is the check, not the goal — a layout that satisfies every rule and
looks wrong is still wrong, which is why the screenshots stay in the loop.
