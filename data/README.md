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

## Known gaps

Eight vocabulary rows have no meaning: 急に, 番, お目に掛かる, 税, 密, 釣, 大,
小. None of them is unanswerable — seven have example sentences to give the
context, and お目に掛かる has no homophone, so its reading identifies it on its
own — but each shows "no meaning recorded" where a gloss should be, in the
prompt and again in the reveal.

Filling them in is an edit to `Vocab.csv` followed by `npm run decks`. It is
left alone here rather than guessed at, because a meaning invented to fill a
column is worse than a visible gap.

`src/domain/corpus.test.ts` guards the line that actually matters: no item may
have no meaning *and* no sentence *and* a homophone, which is the combination
that would leave a listening question with nothing to identify the answer by.
