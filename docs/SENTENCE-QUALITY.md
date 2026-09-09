# Why the example sentences read oddly, measured

He said it plainly on 2026-09-03: "a lot of the sentences shown aren't very
natural, I need natural and real sentences." This is what is actually wrong,
measured against the corpus rather than guessed at.

Every number below comes from the Tatoeba Japanese export of 2026-09-03,
248,888 sentences, of which **239,494** fall inside the 8 to 44 character window
`scripts/build-sentences.mjs` already applies.

## What the current model selects on

Two things, and neither is about the sentence being good Japanese:

- **Length**, 8 to 44 characters.
- **Fewest other target words**, so the blank cannot be filled by elimination.

Both are sound and neither should go. They are simply silent on whether the
sentence is something a person would say.

## Finding 1: seven percent of the corpus is a translation exercise

**17,042 in-window sentences contain トム, メアリー, ジョン or ボブ.** That is
7.1% of everything the picker can choose from.

These are not Japanese sentences that happen to mention someone. They are the
Japanese halves of translated English drill sentences, and they carry the
register of the English original. A learner meeting トム in one sentence out of
fourteen is meeting the Tanaka Corpus rather than Japanese.

This is almost certainly the bulk of what he is noticing.

## Finding 2: preferring native speakers does not fix it, and makes this worse

The obvious move is to prefer sentences owned by a self-declared native speaker.
Tatoeba publishes what is needed: `user_languages.csv` gives 661 users who
declare Japanese at level 5, and `jpn_sentences_detailed.tsv` gives each
sentence's owner. 111,392 in-window sentences are owned by one of them.

**It does not work on its own, and the reason is worth keeping:**

| | sentences | contain トム / メアリー / ジョン / ボブ |
|---|---|---|
| Native-owned | 111,392 | **14,500 (13.0%)** |
| Not native-owned | 128,102 | 2,542 (2.0%) |

**Native-owned sentences carry the placeholder names six times more often.**
Nativeness and naturalness are not the same axis here: a Japanese native
translating an English drill sentence produces grammatical, fluent, and
completely artificial Japanese. Ownership tells you who typed it, not what it is.

## Finding 3: a hard native-only filter costs real coverage

Over the 6,982 vocabulary surfaces in the decks:

| Pool | words with at least one sentence | words with three |
|---|---|---|
| All sentences | 6,290 (90%) | 5,530 (79%) |
| Native-owned only | 5,565 (80%) | 4,328 (62%) |

Filtering hard would leave **725 more words with no example at all**. That is a
bad trade for a signal that finding 2 shows is not measuring the right thing.

## What the model should be

Ranking, not filtering. Keep every sentence eligible, and order the candidates
for each word by:

1. **Heavily penalise placeholder-name sentences.** This is the one change that
   addresses what he actually complained about, and it is worth more than
   everything else here combined.
2. **Prefer native ownership**, as a weak tiebreak rather than a gate, now that
   it is not carrying weight it cannot bear.
3. **Keep the existing length and few-other-target-words criteria**, unchanged.

Ranking rather than filtering keeps the 90% coverage while changing what appears
at the top of every word's list, which is all the learner ever sees.

## What it actually did

Built on 2026-09-03, comparing the shipped packs before and after:

| | words | sentences shipped | containing a placeholder name |
|---|---|---|---|
| Before | 6,486 | 18,266 | **1,286 (7.0%)** |
| After | 6,486 | 18,266 | **61 (0.3%)** |

**Identical coverage, and 95% of the drill sentences gone.** The word count and
the sentence count are the same to the digit, which is the ranking working as
designed: nothing was dropped, the order changed.

The 61 that remain are words where a drill sentence is the only thing in the
corpus, and keeping them is the correct behaviour. A word with トム is better
than a word with nothing.

What it looks like in practice:

| word | before | after |
|---|---|---|
| 目標 | トムはそれをすることを目標にしている。 | しっかりとした目標を持っていれば、うまくいくでしょう。 |
| 量 | トムは30kg減量した。 | たばこの量を減らしなさい。 |
| 向ける | トムはカメラを向けるといつも変顔をする。 | 銃を私に向けるな。 |
| 事務 | トムはドアを開けて、事務室に入りました。 | 事務所にいます。 |

## Measured and rejected: audio

The plan above originally had a third signal, preferring sentences with recorded
audio on the grounds that someone reading a sentence aloud is a human vetting it.

**It is not worth having.** `sentences_with_audio.csv` was fetched, all 68 MB of
it, and intersected with the Japanese ids: **6,332 of 248,888 sentences have
audio, which is 2.5%.** A signal that touches one sentence in forty cannot
reorder a three-item list, and it would put a 68 MB download in a build that is
otherwise 4 MB.

Recorded here so the idea is not had again as though it were free.

## What has not been checked

- **Whether `users_sentences.csv` ratings are worth their 94 MB.** Tatoeba lets
  users mark a sentence OK or not OK; whether enough Japanese sentences carry
  one to matter has not been measured.
- **Any judgement of naturalness beyond the name heuristic.** Nothing here
  detects stilted-but-nameless translationese. That would need either a model
  pass over the corpus or a different source.

## Standing item: no invalid questions

*Opened 2026-09-09. He photographed one: 「バス［しろ］はいくら？」 — the blank is
the 代 of バス代, which is read だい, and the question was asking for 代 read しろ.
A question whose own prompt contradicts its answer is worse than no question.*

- [x] **A fill-in or listening question always blanks the word being asked, used
      with the reading being asked, in a sentence that genuinely contains it.**
      *Done 2026-09-09. `npm run sentences:check` verifies all 16,656 shipped
      word/sentence pairs and reports zero, and it runs in `prebuild`, so an
      invalid question cannot reach a deploy. What it cost is below.*

The cause is one line in `scripts/build-sentences.mjs`, and it is honest about
itself: *"Keyed by surface rather than item id: two entries that differ only by
reading share the same written word and so the same sentences."* Two failures
come out of it:

1. **A surface matched inside a longer word.** バス代 contains 代, so the scan
   files that sentence under 代 — a word that is not in it. 237 of the 6,982
   vocabulary surfaces also carry more than one reading in the decks, and each
   of those shares one pool between meanings that are not the same word.
2. **A reading asserted rather than checked.** Nothing in the pipeline ever
   establishes how the surface is read in the sentence it was filed under. The
   prompt then prints the entry's reading beside a blank the sentence reads
   differently.

Done means all of:

1. **Every sentence in every pack is confirmed against Tatoeba's own word index
   for that sentence** (`jpn_indices.csv`, the Tanaka B-lines): the headword is
   the item's surface, and where the index records a reading, it is the item's
   reading.
2. **A checker that fails loudly** — `npm run sentences:check` — reporting zero
   unverified pairs, run alongside the tests rather than by hand.
3. **The loss is measured and stated**: how many words keep an example, before
   and after. A word with no verified sentence falls back to the reading-only
   prompt the quiz already has, which is a smaller question, not a wrong one.
4. **The photographed case is a test**: 代/しろ never receives バス代's sentence.

### How wrong it was, and what fixing it cost

Measured on the packs that were live this morning, with kuromoji reading every
sentence the way the app would have asked it:

| | before | after |
|---|---|---|
| word/sentence pairs shipped | 18,408 | 16,656 |
| pairs where the sentence does **not** use that word with that reading | **3,030 (16.5%)** | **0** |
| entries with at least one example | 6,534 | 6,000 |
| entries whose examples were *all* wrong | **730** | 0 |
| entries with at least one **correct** example | 5,804 | **6,000** |

So one fill-in question in six was invalid, and 730 words could only ever ask an
invalid one. The headline coverage figure falls — 90% to 83% — and the number
that matters rises: verified against a sentence that is actually about the word,
coverage went **up** by 196 entries, because the builder now keeps looking down
a word's ranking instead of stopping at three sentences that happened to contain
the characters.

Two words, 密 and 釣, came out of this with no example and no meaning, which
`corpus.test.ts` already refuses to allow — a question with a shared reading, no
meaning and no sentence has nothing to identify its answer by. They had meanings
missing in `data/Vocab.csv`; both now have one. That test existed before this
work and caught the consequence on the first run, which is the whole argument
for invariants over inspection.

### What "genuinely uses" means

`scripts/lib/reading-check.mjs`, shared by the builder and the checker:

- **Whole tokens only.** The 代 inside バス代 is not the word 代, any more than
  the "read" in "already" is the verb. A run of complete tokens must spell the
  surface exactly.
- **The reading must match**, after katakana is folded to hiragana. 弾く read
  はじく does not get a sentence about playing the guitar, where it is ひく.
- **Every occurrence, not one.** `blankOut` hides *all* occurrences of the
  surface and labels them with a single reading, so a sentence using the word
  twice with two readings would be half a wrong question. The whole sentence is
  rejected.
- **An unknown word is not agreement.** Where the dictionary has no reading for
  a token, nothing is confirmed, so the sentence is not used.

kuromoji is a build-time dependency. Nothing ships to the browser but a list of
sentences that have already been checked.
