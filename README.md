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

> **Status: phase 1 of 9.** The shell, sign-in, offline caching and deploy
> pipeline work. The quizzes do not exist yet — every study screen currently
> renders a placeholder. See [docs/ROADMAP.md](docs/ROADMAP.md).

## What it will do

Four question types, all drawn from the same 2,211 kanji and 7,279 vocabulary
entries:

| Mode | Prompt | You answer |
| --- | --- | --- |
| Vocab reading | the word and its meaning | the reading |
| Kanji writing | readings and meaning | the character |
| Fill in the blank | a real sentence with the word removed | the character |
| Listening | the word spoken in context | the character |

Three ways to answer, because Japanese input is the one thing you cannot assume
about a device: the native IME keyboard, an on-device handwriting canvas, or
multiple choice.

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

In the [Firebase console](https://console.firebase.google.com):

- Create a project, then add a **Web app** to it.
- **Authentication → Sign-in method →** enable **Google**.
- **Authentication → Settings → Authorized domains →** add
  `eduardob999.github.io`. Sign-in fails with `auth/unauthorized-domain`
  without this.
- **Firestore Database →** create a database (native mode).
- **Firestore Database → Rules →** paste [`firestore.rules`](firestore.rules)
  and publish. The console defaults either lock you out or leave your data
  world-readable.

Then supply the config values. Locally, copy `.env.example` to `.env.local` and
fill it in. For deployment, add the same six names as repository secrets under
**Settings → Secrets and variables → Actions**.

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
