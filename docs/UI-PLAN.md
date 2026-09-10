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
× 4 viewport/theme combinations, plus 7 interactive states, three of which are
keyboard states added on 2026-09-03 and one of which is the practice fall-through
added on 2026-09-04.

**That "0 problems" was true and still missed a bug he hit every day**, and the
reason is worth keeping. The audit's old `openKeyboard` set `--keyboard-inset`
and `data-keyboard` BY HAND before measuring. So it checked every CSS rule that
depends on those, and never checked the code that decides whether to set them.
On Chrome for Android that code measured zero and set nothing, so on his phone
none of the keyboard CSS ever applied.

A harness that stages the state it is testing can only confirm the styling of a
state it has assumed. The keyboard states now shrink the real viewport and let
`src/viewport.ts` do its own detection, and reverting the fix makes the audit
report 15 failing combinations rather than passing.

What is worth keeping from this is not the CSS. It is that the app now has a
way to be looked at: `src/preview/` renders any screen without a sign-in, and
`npm run ui` says which of them are broken. Four of the ten items above were
bugs that had been shipped and unnoticed, and two of those — a missing
`box-sizing` reset and a session screen that could hang for ever — were
invisible from reading the code.

## The screens the audit walks

Study is one practice screen plus a silent variant, and four single-mode drills
under it. **Today's Session is gone.** It and Random were the same sitting
described from two ends: the session stopped as soon as the schedule was clear,
which on a real backlog meant it offered eight items and finished, and Random
kept going while paying the schedule no attention. They are one leaf now,
`study.practice`, and it is where the app opens.

The merge added one thing the audit has to be able to see. A round is what the
schedule asked for, and then, once that runs out, practice on words already met,
marked with an `extra practice` pill in the quiz header. That state cannot be
reached from the lived-in fixture, because a headless browser is not going to
clear a five thousand item backlog by answering questions, so the harness has a
third account state: `practice-ahead`, everything met and nothing due. Its check
is not a layout rule. It presses Start and fails if the screen stops instead of
asking something, which is the bug the merge exists to remove and which no
measurement of boxes would ever have caught.

## Verification

`npm run ui` after each change; the count of failing combinations is the number
to drive down. Screenshots in `.ui/` for anything the audit cannot judge, like
whether a screen looks balanced.

The audit is the check, not the goal — a layout that satisfies every rule and
looks wrong is still wrong, which is why the screenshots stay in the loop.

## Standing item: everything fits, nothing scrolls

*Opened 2026-09-09, at the owner's request, after a run of phone-layout fixes
that each solved the screen in front of them and left the general case open.*

- [x] **The UI is nothing but small elements that fit easily on any screen —
      the smallest phones included — and it is easy to use, interactive, and
      asks for little or no scrolling.**
      *Measured green on 2026-09-09: `npm run ui` reports zero failing
      combinations across six viewports (320, 360, 390, 412, 768, 1280), with
      the fold rule on every screen that is operated rather than read, both
      keyboard behaviours at 55%, and the longest question in the corpus in
      place of the fixture's. What it took is listed at the bottom of this
      section.*

An item worded that way is a feeling, and a feeling cannot be finished. These
are the measurements standing in for it, all of them in `npm run ui` so the
answer is a number rather than an opinion:

1. **Every screen fits its viewport with nothing below the fold**, at 320, 360,
   390 and 412px wide. 320 is a phone the audit has never looked at; it is in
   the list because "even the smallest phones" is the ask.
2. **Every screen still fits with the keyboard up**, in both of the ways a
   browser reacts to one, at keyboard heights up to 55% of the window.
3. **Nothing overflows sideways**, which has held since the first audit and
   stays a rule so it keeps holding.
4. **Everything you press is at least 44px**, and nothing to read is under
   12px — the floor the fitting must not cross in the name of fitting.
5. **The worst content in the corpus is what gets measured**, not a comfortable
   fixture: the longest question, the longest meaning, the most readings.

Exceptions are allowed only where they are stated, argued and measured — the
after-miss card at a 62% keyboard on a 320px phone is not a layout that exists,
and saying so beats pretending otherwise. Anything exempt gets written down
here with the number that makes it impossible.

Done means `npm run ui` reports zero failing combinations with all of the above
switched on, and the screenshots in `.ui/` show screens that look composed
rather than merely compliant.

### What it took

Twenty-three failing combinations at the start, all but five of them at 320px.
In the order they were paid off:

1. **The harness was wrong about sign-in.** It wrapped a screen that renders its
   own `<main class="screen">` in the shell — a 100dvh screen nested inside
   another one, 173px over at every width, on a screen that has no problem. A
   harness harder on a layout than the app is not testing the app.
2. **Two explanations were taller than the things they explained.** The legacy
   import was 120 words and a second primary button under Start, 367px of a
   640px phone; the input-method screen carried three paragraphs about
   downloads and speed tracking. Both are folded into `<details>` now: worth
   reading once, not worth a screenful every visit.
3. **A quiz is a screen, not a document.** The keyboard rules already fixed the
   card's height and let the prompt and the reveal give way; with the keyboard
   down none of it applied, so the verdict state scrolled. `:has(.quiz)` says
   the same thing whether or not anyone is typing. That one change closed seven
   of the nine remaining failures.
4. **Chrome stands down while you type.** The tab bar already did. The top bar
   did not, and at 320px with a 55% keyboard it was 61px of a 288px window,
   which left the question itself 45px. Hiding it is what let the longest kanji
   in the corpus — eleven readings and a 121-character meaning — fit above the
   keyboard on the smallest phone, at 18px rather than at the floor.
5. **Small things that were only small on a small screen.** A duplicate `h1` on
   the practice card that the top bar directly above it already said; a licence
   line under the drawing pad on every question, when `About` and `LICENSES.md`
   already carry it; `1fr` grid tracks that could not shrink below their own
   nowrap labels and pushed the handwriting card 5px sideways.

The keyboard simulation moved from 45% to 55% of the window as part of this.
45% is the comfortable case, and it was passing while the owner — whose
keyboard is taller — was scrolling to reach the field he was being asked to
type into.

### Where it stops, measured

The 40 longest questions in the corpus — 代 and its neighbours, eleven readings
and a 121-character meaning — rendered at three phone widths against keyboards
of increasing height, counting how many fit above the keyboard with nothing
hidden:

| keyboard | 320px | 360px | 390px |
|---|---|---|---|
| 45% | 40/40 | 40/40 | 40/40 |
| 55% | 40/40 | 40/40 | 40/40 |
| 62% | 10/40 | 40/40 | 40/40 |
| 70% | 0/40  | 0/40  | 0/40  |

55% is the bar the audit holds, and it is met everywhere. Past that the numbers
say where the layout gives out rather than pretending it does not:

- **At 62% on a 320px phone**, the longest questions scroll inside the prompt.
  The window is 243px, the dock is ~136px of it — a field and two buttons, all
  at the 44px floor — and what is left will not hold eleven readings and ten
  senses at a size worth reading.
- **At 70% anywhere**, nothing fits, because the window is barely larger than
  the dock. A keyboard that tall is a keyboard covering the app.

Both are arithmetic rather than styling: the fixed parts of the screen have a
floor, and below some window height the remainder is smaller than the content
however it is set. The prompt scrolls there, which is the honest failure — it
was the *only* behaviour before any of this work, at every size.


## The harness was measuring tofu

*2026-09-10.* Every Japanese measurement in this document, and every number the
fit routine was tuned against, was taken in a container with **no CJK font
installed**. Kana and kanji rendered as tofu — uniform boxes that are not the
width of the characters they stand for — so the layouts were checked against
squares.

Installing Noto Sans JP changed the answers. The worst forty questions at 320px
under a 55% keyboard went from 40/40 fitting to 34/40, because real Japanese
needs more room than the placeholder did, and the fit routine's multiplier floor
of 0.6 — chosen against those tofu numbers — was stopping the search before the
per-size floors it exists to protect. Lowering it to 0.45 restores 40/40, and
also carries 360 and 390 through a 62% keyboard, which they did not manage
before.

`npm run ui` now says so out loud when the font is missing, by measuring 漢字
against U+FFFF: no font has a glyph for U+FFFF, so equal widths mean everything
is being drawn as notdef boxes. It warns rather than failing, because a machine
without the font can still check colour, tap targets and overflow — it just
cannot be trusted about a Japanese layout.
