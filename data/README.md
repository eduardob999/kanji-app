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

## `archaic.csv`

Vocabulary the decks leave out because nobody needs it for the JLPT or for
reading today. `npm run decks` drops each `Word,Reading` pair listed here before
anything else, and says how many it dropped and warns about any line that matched
nothing. `Vocab.csv` itself is untouched, so reversing a call is deleting a line.

It is keyed on word *and* reading because what is archaic is usually one reading
of a word the learner does need: 弟/おと goes, 弟/おとうと stays.

The first nine lines are the words whose primary sense JMdict tags `archaism` or
`obsolete term`. The rest are archaic readings of common kanji (少女/おとめ,
地方/じかた and so on) judged by hand. Words that merely *carry* an archaic sense
among modern ones (写真, 朝, 敵) are deliberately kept: about 175 do, and cutting
them would remove most of the N5 to N3 vocabulary. A wrong or archaic *reading*
is the thing to cut. `corpus.test.ts` checks that nothing listed is in the built
decks.

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
