# Working in this repo

Kanjiba is an offline-first PWA for drilling JLPT kanji and vocabulary, with an
FSRS memory model choosing what is due. One person uses it, and the repo is
public, so the audience is him on a phone plus anyone reading the source. The
shell, the offline-first Firestore layer and the scheduler are lifted from
[GHAPP](https://github.com/eduardob999/GHAPP), which matters more than it
sounds: the two repos share a Firebase project. See the rules section below.

## Read before you act

| Before you | Read |
|---|---|
| edit `firestore.rules`, or publish rules | "The rules are shared with GHAPP" below |
| add or change an item, a meaning or a sentence | [data/README.md](data/README.md) |
| change a screen's layout | [docs/UI-PLAN.md](docs/UI-PLAN.md), then run `npm run ui` |
| touch `public/service-worker.js`, the precache list in `vite.config.ts`, or anything about updates | run `npm run offline` |
| change a scheduler constant or the weight optimiser | "What must not change" below |
| decide what to build next | [docs/ROADMAP.md](docs/ROADMAP.md) |

## Checks, and what each already covers

Run these instead of checking by eye.

```bash
npm run dev        # generates src/firebaseConfig.ts and public/decks/ first
npm test           # vitest: 20 files, 296 tests, about 3 seconds
npm run typecheck  # tsc --noEmit under strict + noUncheckedIndexedAccess
npm run build      # typecheck, then vite build, then the service worker manifest
npm run ui         # needs `npm run dev` running in another shell
npm run offline    # needs `npm run build` first; starts and stops its own server
```

`npm test` is fast enough that there is no reason to run a subset. It covers the
whole of `src/domain/`: FSRS, grading, the session planner, pacing, fluency,
distractors, the legacy import, and corpus integrity.

`npm run ui` renders every screen at four viewports through
[src/preview/](src/preview/PreviewApp.tsx) and reports horizontal overflow, tap
targets under 44 px, text under 12 px, contrast below WCAG AA, and console
errors. That preview harness exists only because the app is behind a Google
sign-in, so a headless browser otherwise sees the splash screen. Screenshots
land in `.ui/`, which is gitignored.

`npm run offline` is the only thing that proves the two jobs of the service
worker: booting with no network, and handing a running client a new version.
It stops its own server rather than using Playwright's offline flag, because
that flag does not apply to fetches the worker itself makes. The reasoning is in
the file header; do not "simplify" it back.

## Layout, where it is not obvious

- `src/domain/` is pure. No React, no Firebase, `now` passed in as a parameter.
  Every file has a `.test.ts` beside it, and that is the pattern to keep.
- `src/preview/` is compiled out of production builds. It is the audit harness,
  not a feature.
- `src/firebaseConfig.ts` is generated from the example by `scripts/setup-config.mjs`
  on first `dev` or `build`, and is gitignored.
- `public/decks/` is generated and gitignored. `public/sentences/` and
  `data/frequency.json` are generated and **committed on purpose**. The reason
  is in [data/README.md](data/README.md) and it is not size.

## The rules are shared with GHAPP

`firestore.rules` here and in GHAPP are character-for-character identical in
their rule bodies, and both apps point at the same Firebase project. Two
consequences:

- **A rules change is a security change for two apps, not one.** Publishing with
  `firebase deploy --only firestore:rules` from either repo overwrites what the
  other one relies on.
- **An edit here that is not mirrored in GHAPP starts a silent drift.** The file
  is kept in both repos precisely so the two cannot disagree about what the
  published rules are. Change both in the same piece of work, or change neither.

Before publishing anything, run `/security-review`. The current rule is "you may
touch your own document and nothing else", with a `{document=**}` wildcard that
already covers `/users/{uid}/reviews` and `/users/{uid}/sessions`. A new
subcollection needs no rules change.

Firebase web config is not a secret and ships in the bundle by design. The rules
are what protect the data. Do not treat `.env.local` as a credential store and
do not "fix" the config values into a secret.

## Deploys can go green without publishing

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) carries
`continue-on-error: true` on both `configure-pages` and `deploy-pages`. That
keeps CI green while GitHub Pages is not enabled, and it also swallows genuine
deploy failures. **A green Actions run does not mean the site published.** The
final "Show deployed URL" step says which happened; read it.

## What must not change without asking

- **The committed sentence packs and `data/frequency.json`.** Tatoeba updates
  weekly, so rebuilding them changes which sentences the quizzes ask and the
  order material is introduced in, for someone part-way through a level. Run
  `npm run sentences` or `npm run frequency` only as a deliberate act.
- **`TARGET_RETENTION`, `MAX_INTERVAL_DAYS` and `DEFAULT_WEIGHTS` in
  [src/domain/fsrs.ts](src/domain/fsrs.ts).** The 365-day cap is a deliberate
  divergence from GHAPP's 90, argued in the file header. Do not resync them.
- **The three guards in [src/domain/optimiser.ts](src/domain/optimiser.ts):**
  held-out items split by item rather than by time, a margin the fit must beat,
  and bounds around each published weight. Each one prevents a specific way of
  fitting nineteen parameters to a few hundred reviews and getting something
  worse than the population average.
- **The eight vocabulary rows with no meaning.** Leave the gap visible rather
  than inventing a gloss. `src/domain/corpus.test.ts` guards the line that
  actually matters: no item may have no meaning, no sentence and a homophone all
  at once.
- **The `Score` columns in `data/*.csv`.** Ignored by the build on purpose. They
  are the old CLI's scheduler state, not progress.

`public/` is the web root, so anything put there is served. Exported scores are
personal study data and belong in `data/`, which is why `public/*.txt` is
gitignored.
