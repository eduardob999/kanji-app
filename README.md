# Kanjiba

An offline-first PWA for drilling JLPT kanji and vocabulary, scheduled by an
adaptive [FSRS](src/domain/fsrs.ts) memory model rather than by "whatever you
got wrong last".

Successor to [`kanji-practice-app`](https://github.com/eduardob999/kanji-practice-app),
a Python CLI that did the same job in a terminal on one machine. Everything that
made it work is being carried across; everything that tied it to one machine is
not.

The architecture — offline-first Firestore, Google sign-in, the navigation
shell, and the FSRS scheduler itself — is lifted from
[GHAPP](https://github.com/eduardob999/GHAPP), where it was already doing this
job for guitar practice.

Live at **<https://eduardob999.github.io/kanji-app/>**.

> **Status: all four quiz modes work**, scheduled by an FSRS model that fits
> itself to you. Still to come: the handwriting canvas, the import of the old
> CLI's scores, and Today's Session. See [docs/ROADMAP.md](docs/ROADMAP.md).

## What it does

Four question types, all drawn from the same 2,211 kanji and 7,235 vocabulary
entries:

| Mode | Prompt | You answer |
| --- | --- | --- |
| Vocab reading | the word and its meaning | the reading |
| Kanji writing | readings and meaning | the character |
| Fill in the blank | a real sentence with the word removed | the character |
| Listening | the word spoken in context | the character |

Two ways to answer so far, because Japanese input is the one thing you cannot
assume about a device: the native IME keyboard, or multiple choice with
distractors chosen for confusability. A handwriting canvas is the third and is
not built yet — see the roadmap for why it is harder than it looks.

The scheduler fits itself to you. Response-time thresholds track your own
speed per question type and input method, and the FSRS weights are refitted per
review mode from your review log, held-out-validated so a bad fit is never
adopted. **Tools → Scheduler** shows the calibration curve and what has been
learnt.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Until Firebase is configured the app shows a setup card instead of the sign-in
screen — that is expected.

### Production preview

The only way to exercise the service worker, which is not registered in dev.

```bash
npm run build && npm run preview
```

## Firebase setup

This app **shares a Firebase project with [GHAPP](https://github.com/eduardob999/GHAPP)**,
on purpose. Both are served from `eduardob999.github.io`, which makes them the
same browser origin — so one project means Firebase Auth persistence is shared
and signing into one signs you into the other. Two projects would mean signing
in twice on one origin, two consoles, and two authorised-domain lists to keep in
step, for no isolation that matters between two apps belonging to one person.

The apps stay out of each other's way by convention, enforced in
[`src/storage/userState.ts`](src/storage/userState.ts):

| | GHAPP | Kanjiba |
| --- | --- | --- |
| Subcollection | `/users/{uid}/skills` | `/users/{uid}/reviews` |
| Profile fields | `handedness`, `practicePings` | everything under `kanjiba` |

Top-level profile fields are identity only — uid, name, email, photo, created,
last login — and mean the same thing to both. Neither app writes without
`merge`.

**If you are using GHAPP's project**, there is nothing to configure in the
console: Google sign-in is enabled, `eduardob999.github.io` is already an
authorised domain, and the published rules already cover `/reviews` through
their `/users/{uid}/{document=**}` wildcard. Copy the six `VITE_FIREBASE_*`
values from GHAPP's `.env.local` or its repository secrets, and put them in this
repo's `.env.local` and its Actions secrets.

**Standing up a fresh project instead**, if you ever want the two separated:

- Create a project, then add a **Web app** to it.
- **Authentication → Sign-in method →** enable **Google**.
- **Authentication → Settings → Authorized domains →** add
  `eduardob999.github.io`. Sign-in fails with `auth/unauthorized-domain`
  without this.
- **Firestore Database →** create a database (native mode).
- **Firestore Database → Rules →** paste [`firestore.rules`](firestore.rules)
  and publish. The console defaults either lock you out or leave your data
  world-readable.

Either way, supply the config values locally by copying `.env.example` to
`.env.local`, and for deployment as repository secrets under **Settings →
Secrets and variables → Actions**.

> The repository secrets are named `APIKEY`, `AUTHDOMAIN`, `PROJECTID`,
> `STORAGEBUCKET`, `MESSAGINGSENDERID` and `APPID` — the short forms.
> [`deploy.yml`](.github/workflows/deploy.yml) maps them onto the `VITE_`
> names the app reads. `.env.local` uses the `VITE_` names directly, since
> Vite only exposes variables with that prefix.

> These values are **not secrets** — Firebase web config ships in every client
> bundle by design. `firestore.rules` is what protects your data.

### GitHub Pages

Open **Settings → Pages**, set **Source** to **GitHub Actions**, and save. No
workflow can do this for you: `GITHUB_TOKEN` cannot administer Pages. Until it
is done the deploy job logs a 404 and publishes nothing, but CI stays green.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload. The service worker is *not* registered here. |
| `npm run build` | Typecheck, then build to `dist/`. Injects the precache manifest into the service worker. |
| `npm run preview` | Serve `dist/` locally — the only way to exercise the PWA behaviour. |
| `npm run typecheck` | TypeScript only. |
| `npm test` | Domain tests. |
| `npm run icons` | Regenerate the icons in `public/icons`. |

## Project layout

```
index.html                    App shell markup
vite.config.ts                Build config + the service worker precache plugin
firestore.rules               Security rules — publish these
public/
  manifest.webmanifest        PWA manifest
  service-worker.js           App-shell and data caching
  decks/                      Bundled kanji/vocab decks (not built yet)
  sentences/                  Bundled Tatoeba example sentences (not built yet)
src/
  main.tsx                    Entry point; mounts React, registers the worker
  App.tsx                     Auth-state routing: setup / splash / sign-in / shell
  firebase.ts                 SDK init, auth + Firestore instances, persistence
  auth.ts                     Google sign-in, sign-out, error messages
  types.ts                    UserProfile and snapshot shapes
  domain/                     Pure logic: no React, no Firestore
    fsrs.ts                   The memory model, with per-learner weight adaptation
    scheduler.ts              Thin adapter over FSRS; what storage actually calls
    review.ts                 What a review is, independent of what is reviewed
    navigation.ts             The navigation tree — the menu and the map
    inputMethod.ts            Keyboard / handwriting / multiple choice
  storage/                    The only modules that know the Firestore layout
  input/                      The only modules that know how a character is typed
  quizzes/                    One panel per question type
  components/                 AppShell, SignInScreen, AccountPanel, SyncBadge…
docs/ROADMAP.md               What is built and what is next
```

Four rules worth keeping, three of them inherited:

- **Components never import `db`.** All Firestore access goes through
  `src/storage/`, so a new collection lands in one file.
- **`src/domain/` is pure.** No React, no Firestore at runtime — which is what
  makes the scheduler and the answer checker testable on their own.
- **Nothing outside `src/input/` knows how a character was entered.** Swapping
  or adding an input method stays a one-directory change.
- **`now` is always a parameter.** Every scheduling decision is reproducible.

## Credits

Kanji and vocabulary data carried over from `kanji-practice-app`.

Example sentences from [Tatoeba](https://tatoeba.org), used under
[CC-BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/).

Handwriting recognition by [KanjiCanvas](https://github.com/asdfjkl/kanjicanvas)
(© Dominik Klein, MIT), whose reference patterns derive from
[KanjiVG](https://kanjivg.tagaini.net/) (© Ulrich Apel, CC BY-SA 3.0).

FSRS scheduler and app shell from
[GHAPP](https://github.com/eduardob999/GHAPP).

がんばって！
