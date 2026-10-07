# Word selection: common first, obscure rare, random with a purpose

The goal: the app should be full of words worth knowing, rare and obscure words
should turn up rarely, and the unscheduled practice that fills a round should be
random in the way that helps (variety, a lean towards what is useful and what is
shaky) rather than uniform over all 7,000 words.

## What was measured, 2026-10-07

Commonness taken from JMdict's priority tags (`nf01`–`nf48`, the word-frequency
bands of 500 words each, plus `news1/2`, `ichi1/2`, `spec1/2`, `gai1/2`):

| tier | meaning | rule |
|---|---|---|
| 1 | core | `nf01`–`nf12` (the commonest 6,000), or both `news1` and `ichi1` |
| 2 | common | `nf13`–`nf24`, or any `*1` tag |
| 3 | uncommon | any other priority tag |
| 4 | unlisted | no priority tag |

Where the current 7,530 words fall (re-measured after the bank grew and the tail
was trimmed, 2026-10-07):

| level | words | tier 1 | tier 2 | tier 3 | tier 4 |
|---|---|---|---|---|---|
| N5 | 534 | 378 | 152 | 1 | 3 |
| N4 | 539 | 417 | 118 | 1 | 3 |
| N3 | 1,709 | 1,373 | 316 | 0 | 20 |
| N2 | 1,524 | 882 | 583 | 32 | 27 |
| N1 (each quarter) | ~806 | ~417 | ~276 | ~43 | ~69 |
| all | 7,530 | 4,719 | 2,275 | 206 | 330 |

So the existing deck is mostly common already; the obscure tail is about 3% of
N3 and about 15% of each N1 quarter. The bigger gap is the other direction:
JMdict has **3,498 tier-1 entries whose written form is not in the deck at all**
(洋食, 恐竜, 雑草, 閉店…), and about 11,000 more at tier 2.

Two cautions on reading tier 4. JMdict leaves prefixed forms (お酒, お風呂)
unmarked although they are everyday words, so tier 4 alone is not "rare"; it is
combined with the Tatoeba count already in `data/frequency.json`. And the
priority tags say nothing about JLPT level.

## The plan, in the order it is built

Each step ships on its own: tests, build, UI audit, PR, merge, deploy log read.

1. **A commonness signal.** `data/commonness.json`, committed, built by
   `scripts/build-commonness.py` from JMdict. Carried into each vocabulary item
   as `tier`. No behaviour changes yet.
2. **Introduction order.** Within a level, new words come tier first, then by
   Tatoeba rank, so a level's first weeks are its most useful words. Today the
   order is Tatoeba count alone.
3. **A weighted draw for practice.** Replace `buildRandomQueue`'s uniform
   sampling with a seeded weighted draw: weight by tier (obscure words rare, not
   absent), lean towards weaker memories, and keep variety by spreading levels
   and question types so a round is not fifteen of one thing.
4. **Grow the bank.** Add vetted tier-1 words not yet in the deck, with JMdict
   glosses, levels derived from the hardest kanji they contain, and proper nouns
   and jargon filtered out. Needs a JMdict/EDRDG attribution first (CC BY-SA 4.0),
   which the repo does not carry today.
5. **Trim the tail.** Review the tier-4 and tier-3 words already in the deck;
   anything that is neither common by tier nor by Tatoeba count is a candidate for
   `data/archaic.csv`-style exclusion, judged by hand.

## Constraints from CLAUDE.md that shape this

- `data/frequency.json` and the sentence packs are not rebuilt. The new signal is
  a separate file. Words added in step 4 therefore have no example sentence, which
  the quizzes already handle; `corpus.test.ts` is the guard on the combination
  that would leave a question unanswerable.
- `TARGET_RETENTION`, `MAX_INTERVAL_DAYS`, `DEFAULT_WEIGHTS` and the optimiser's
  three guards are untouched. Selection decides *what* is asked, never how the
  schedule responds to the answer.
- The planner's rule that unseen material enters only through the pacer's ration
  stays: the weighted draw only ever picks from words already met.

## Status, 2026-10-07

Shipped (PR #3, deployed, deploy log read): steps 1 to 3, the commonness tier,
the common-before-obscure introduction order, and the weighted practice draw.

Built after that, in one set of changes:

- **Step 4, the bank grew by 338 words** in `data/Vocab-extra.csv` (N5 28, N4 47,
  N3 161, N2 32, N1 a to d 19, 12, 13, 26). 323 of them have an example sentence.
  The chosen first release was nf01 to nf08 (1,072 candidates); reading every one
  showed that most of it was newspaper vocabulary, so it was cut by hand to
  these 338. See "Growing the bank" below for the evidence.
- **Step 5, the tail was trimmed by 26** words in `data/archaic.csv`, each with a
  reason (see below).
- A missing credit for the JLPT word list was added to `LICENSES.md` and About.

Open, and needing a decision:

- **Kana-only JLPT words.** The JLPT list the deck came from has 1,196 words the
  deck lacks, all written in kana (あっさり, ドラマ, ずっと). The vocabulary
  reading question shows the word and asks for its reading, which for these is
  the answer itself, so they cannot be added without a change to the quizzes
  (skipping that question for them, or asking for meaning instead). A further
  34 missing rows with a kanji are damage in the source CSV (truncated okurigana
  such as 素晴らし, wrong matches such as 硬 for かたい), and 13 have no JMdict
  meaning, so they were not added either.
- **Wider bank.** Everything below the 338 is reachable by loosening the rule in
  `scripts/build-bank.py`, but each loosening needs the same by-eye review; the
  automatic evidence was not enough on its own.

## Survey of other word banks (2026-10-07)

Measured against the 6,981 distinct written forms in `Vocab.csv`, using the
JMdict tier in `data/commonness.json`. "Rank" is a position in the other list,
lower is commoner. Scripts were run from a scratch directory; none of the
downloaded lists is committed.

### TUBELEX (YouTube subtitles) — use as a cross-check

- **What:** word counts from about 120,000 Japanese YouTube subtitle files
  ([naist-nlp/tubelex](https://github.com/naist-nlp/tubelex)), 409,504 UniDic
  tokens, with video and channel dispersion counts. Spoken, everyday register.
- **Licence:** the repository is BSD-3-Clause. The README says the frequency
  lists are provided, but the licence file does not say whether the lists are
  covered. **Unclear, so nothing from it is committed.** It is used here only to
  measure and to decide what to leave out.
- **Agreement with JMdict tiers:** 96% of tier 1 deck words are found, median
  rank 5,745; tier 2 median 19,126; tier 3 median 33,826; tier 4 median 40,182
  (77% found). Spearman correlation of tier with rank is 0.48. So the tiers
  order the deck in the same direction, loosely. It disagrees where it should:
  202 tier-1 words sit beyond rank 30,000 (蔵相, 売行き, 引分け, all newspaper
  or dated forms), and 46 tier-3/4 words sit inside the top 5,000 (良い, 個, 機,
  長, 社 — bound forms and single characters that UniDic counts as words).
- **Limit:** UniDic splits compounds, so 領収書 and 委員会 are "missing" though
  common. An absent compound proves nothing.

### Japanese Wikipedia lemmas (Wiktionary frequency lists) — skip

- **What:** top 20,000 lemmas of the 2022 Japanese Wikipedia dump, run through
  kagome; CC BY-SA, as is all of Wiktionary.
- **Agreement:** only 84% of tier 1 and 33% of tier 2 are found; Spearman 0.18.
  Encyclopaedic register (tier-4 words have a *lower* median rank than tier 3),
  compounds split, only 20,000 entries. It adds nothing TUBELEX does not.

### Jiten frequency dictionaries — not measured

- **What:** frequency lists from 3.4 billion characters across 16,924 anime,
  drama, novel, game and other titles; stated as CC BY-SA 4.0 at
  [jiten.moe](https://jiten.moe/frequency-dictionaries).
- **Not fetched:** the CSV links are built by the page's JavaScript and are not
  in its HTML, and I did not want to guess at endpoints. Worth a manual download
  if a media-register signal is wanted later. Its licence would need attribution
  and share-alike, which this repo already carries for JMdict.

### BCCWJ frequency list (NINJAL) — skip

- **What:** short- and long-unit word counts from the Balanced Corpus of
  Contemporary Written Japanese (books, magazines, newspapers, Yahoo! Answers,
  blogs); the best-balanced written corpus there is.
- **Licence:** [the NINJAL page](https://clrd.ninjal.ac.jp/bccwj/en/freq-list.html)
  says only "free for use for research or educational purposes". Redistribution
  and derived data are not addressed, so by the rule for this survey it is out.
  Not downloaded.

### JLPT lists by Jonathan Waller (tanos.co.uk) — already in the deck

- **What:** about 8,100 words in five levels. The deck's `Vocab.csv` *is* this
  list: 6,968 of its 6,981 written forms appear in it, and 6,966 of those have
  the same level (N5 432/432, N4 436/436, N3 1,465/1,466, N2 1,451/1,451, N1
  3,182/3,183).
- **Licence:** CC BY, as stated by the projects that republish the lists
  ([example](https://github.com/Bluskyo/JLPT_Vocabulary)). **The original site no
  longer resolves, and an archived copy carries no licence text, so this is not
  verified at the source.** The repo credited nobody for it; `LICENSES.md` and
  About now do.
- **Gap it leaves:** 1,170 Tanos words are not in the deck. Their levels are
  already assigned by the list, which makes them a lower-risk addition than
  anything derived from JMdict. Not yet examined.
- **Agreement with JMdict tiers on N5–N3:** tier 1 is 70% of N5, 74% of N4, 82%
  of N3; tier 3–4 is under 1% of each. At N1 it is 52% tier 1, 35% tier 2, 5%
  tier 3, 8% tier 4.

### OpenJLPT — skip

CC BY-SA 4.0 repackaging of the same Waller lists with added fields. It would add
a share-alike obligation to data the repo already has under a simpler licence.

### wordfreq and other aggregated lists — not examined

Not looked at; they blend sources (often including Wikipedia and subtitles)
whose individual licences would each need checking.

## Growing the bank: what the evidence says

`scripts/build-bank.py` yields 3,114 candidates (JMdict tier 1, not in the deck,
every kanji already in `Kanji.csv`). Adding a Tatoeba substring count (the same
method as `data/frequency.json`, read-only) to TUBELEX gives two independent
signals, one of which copes with compounds:

| group | words | in TUBELEX top 5k | in top 20k | not found in TUBELEX |
|---|---|---|---|---|
| single character | 108 | 17% | 89% | 0% |
| multi-character | 3,006 | 8% | 50% | 23% |
| multi, nf01–04 | 468 | 17% | 60% | 26% |
| multi, nf05–08 | 808 | 9% | 52% | 25% |
| multi, nf09–12 | 1,053 | 6% | 45% | 24% |

- **Single characters:** drop. TUBELEX finds all of them because the characters
  occur as parts of other words, which says nothing about the word. By hand they
  are names and bound forms (泰 Thailand, 京, 江, 仁, 兼, 動 "motion"), and every
  one of their kanji is already taught in the kanji deck.
- **News skew is real.** JMdict's nf bands rank 経済企画庁 (an agency abolished in
  2001), 通産省, 民社党, 皇民党, 公定歩合, 食管法 and 三十八度線 among the
  commonest 6,000 words. None has more than 4 Tatoeba hits or a TUBELEX entry,
  while 被害者, 委員会, 裁判所, 一週間 and 考え方 do (or have 13+ Tatoeba hits).
- **Keep rule:** multi-character, and (Tatoeba count ≥ 3 *or* TUBELEX rank ≤
  30,000). This keeps 2,449 of 3,006 (nf01–04: 410 of 468, nf05–08: 662 of 808,
  nf09–12: 801 of 1,053). A 60-word sample of the rejected nf01–12 words is
  almost all newspaper vocabulary (遊説, 固定資産, 社会党, 環境庁, 政治犯,
  総辞職), with a few false rejections (相次ぐ, 見込む, 冷ややか, 大詰め). The
  rule errs towards leaving out.
- **Top bands only?** Kept counts by band: nf01–08 1,072; nf01–12 1,873; all
  2,449. Levels of the nf01–08 set: N5 62, N4 141, N3 399, N2 188, N1 282.

### What the evidence did not settle, and what was done about it

The keep rule (multi-character, and at least 10 Tatoeba sentences or a TUBELEX
rank of 15,000 or better, a stricter setting than the first trial above) takes
the 1,072 nf01 to nf08 multi-character candidates to 726. Reading all 726 showed
that the signals separate everyday words from newspaper words only loosely:
当局, 議席, 辞任, 原告, 終値 and 談合 all pass, while 利用者, 不安定 and 老人ホーム
fail on the compound problem. So the rest was a hand review, kept as the
`HAND_EXCLUDED` set in `scripts/build-bank.py` (388 words), by group:

| group | examples |
|---|---|
| politics, government, party and ministry vocabulary | 議席, 辞任, 外務, 国務, 公約, 省庁 |
| finance, markets, tax and companies | 終値, 配当, 利回り, 消費税, 上場, 円高 |
| sport reporting | 投球, 連敗, 球場, 首位, 主将 |
| law and crime reporting | 原告, 被告, 犯行, 現行犯, 有罪 |
| military and history | 戦車, 海軍, 将軍, 戦線 |
| surnames and place names sharing a spelling with a word | 金子, 上田, 青山, 大野 |
| spellings whose first JMdict gloss misleads | 一年生 (annual plant), 本書 (text, script) |
| N1 words not judged everyday | everything except 70 reviewed in |

Place names, eras, parties and ministries were removed automatically when the
first gloss starts with a capital (about 40 words), apart from a short list of
nationality, language and religion words.

Result: 338 words, all multi-character, all tier 1. By level the new words are
only 5% of N5 and 9% of N4, so the early levels stay the Tatoeba-ordered core.
The JMdict bands themselves are the limit: they were built from a news corpus, so
a bank taken from them is news-shaped however it is filtered. A bank taken from
a spoken or media corpus (Jiten, or TUBELEX with a tokeniser that keeps compounds)
would be a better source; neither could be used here (see the survey).

### Sentences for the new words

Built additively with `SENTENCES_ADDITIVE=1 node scripts/build-sentences.mjs`,
which looks up only the items in `data/Vocab-extra.csv` and merges them into the
existing packs. Proof that nothing else moved, against a copy taken before: 6,045
existing entries, **0 changed**; 323 added; `data/frequency.json` byte-identical.
One existing entry was removed because the item itself was trimmed (欲深い/よくふかい).

### The tail, step 5

562 tier-3 and tier-4 items were reviewed. Three findings shaped it:

- Tier 3 (206 items) is real JLPT vocabulary: 勘弁, 片付け, 上回る, 転校, 昼飯.
  Almost none is archaic, and JMdict's `archaism` and `obsolete` tags flag only
  two of the 562 items (the earlier archaic filter had already taken the rest).
  Nothing in tier 3 was removed.
- Tier 4 (356 items) is mostly rare *readings* of common kanji (機/はた, 前/せん).
  61 of them are readings JMdict does not list for that word at all.
- **Removed, 26 items** in `data/archaic.csv`: 17 such readings where the word's
  ordinary reading stays in the deck (幕/とばり, 日付/かづけ, 途中/つちゅう,
  灰皿/はいさら, 平均/ならし…), 頃/けい (JMdict: obscure term), and 8 rows where
  the word and reading do not belong together (副/とりわけ, 藍褸/ぼろ, 愛憎/あいにく,
  一筋/ひとすき, 欲深い/よくふかい…).

**Left alone: judgement calls for the owner.**

- Single-kanji bound readings, kept because they came with the JLPT list and the
  kanji deck does not teach them as words: 割/かつ, 伐/ばつ, 依/い, 哉/や, 佐/さ,
  巨/こ, 倣/ほう, 僅/きん, 仮/か, 天/あまつ, 著/ちゃく, 於/お, 共/きょう, 供/きょう,
  傾/けい, 働/どう, 兆/きざし.
- Readings JMdict does not list that may still be heard: 何卒/どうぞ, 唯/たった,
  叔父/おじさん, 叔父/おじい, 徐々/そろそろ, 修行/しゅうぎょう, 塵芥/ごみ,
  中腹/ちゅうっぱら, 伝言/つてごと, 音色/おんいろ (the last two are
  nonstandard but are the deck's only entry for the word).
- 溝/こう: the only entry for 溝, and its meaning is the number 10^38. The common
  reading みぞ is missing from the deck.
- Literary tier-3 words that are not archaic outright: 召す, 請う, 報ずる, 案じる,
  興じる, 填まる, 捻子, 然しながら, 飽くまで, 隔たる.
- Items whose gloss looks wrong for their reading: 立方 (dancing (geisha)),
  気品 (aroma), 熱量 (temperature), 利根 (intelligence).
