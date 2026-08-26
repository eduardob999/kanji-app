# Source data

`Kanji.csv` and `Vocab.csv` are carried over unchanged from
[kanji-practice-app](https://github.com/eduardob999/kanji-practice-app), the
Python CLI this app replaces.

They are the editable source of truth. `npm run decks` compiles them into the
per-level JSON in `public/decks/`, which is what the app actually loads — do not
edit those by hand.

The `Score` columns are ignored by the build. They were the CLI's scheduler
state, and they are not progress: `reset_scores` set every item to a baseline
derived from its JLPT level and only ~1,100 of ~9,500 ever moved above it. What
can be salvaged is salvaged by `scripts/migrate-scores.mjs`, which reads the
CLI's `scores.txt` rather than these columns.

`tatoeba/` (gitignored) holds the raw Tatoeba export downloaded by
`npm run sentences`.
