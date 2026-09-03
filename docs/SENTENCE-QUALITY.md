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
3. **Prefer sentences with recorded audio.** Someone read it aloud, which is a
   human vetting the sentence, and the listening quiz wants exactly these.
4. **Keep the existing length and few-other-target-words criteria**, unchanged.

Ranking rather than filtering keeps the 90% coverage while changing what appears
at the top of every word's list, which is all the learner ever sees.

## What has not been checked yet

- **Audio coverage for Japanese.** `sentences_with_audio.csv` is 68 MB and has
  not been fetched; the count of Japanese sentences in it is unknown.
- **Whether `users_sentences.csv` ratings are worth their 94 MB.** Tatoeba lets
  users mark a sentence OK or not OK; whether enough Japanese sentences carry
  one to matter has not been measured.
- **Any judgement of naturalness beyond the name heuristic.** Nothing here
  detects stilted-but-nameless translationese. That would need either a model
  pass over the corpus or a different source.
