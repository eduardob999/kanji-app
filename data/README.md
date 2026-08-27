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

## `frequency.json`

How often each kanji and word appears in the Tatoeba corpus, built by
`npm run frequency` from the export `npm run sentences` downloads. `build-decks`
turns it into each item's `rank` — its place in its level's introduction queue.

Committed rather than generated at build time, for the same reason as the
sentence packs: Tatoeba updates weekly, and the order material is introduced in
should not shift under someone part-way through a level.

Counts are per sentence and by substring, so a word is credited once however
many times a sentence uses it, and short words are credited inside longer ones.
That is a ranking signal, not a statistic to quote.
