"""
Builds data/commonness.json: how common each vocabulary item is, as a tier.

    pip download jamdict-data --no-deps --no-binary :all: -d /tmp/jmdl
    mkdir /tmp/jmx && tar xzf /tmp/jmdl/jamdict_data-*.tar.gz -C /tmp/jmx
    xz -dk /tmp/jmx/jamdict_data-*/jamdict_data/jamdict.db.xz
    python3 scripts/build-commonness.py /tmp/jmx/jamdict_data-1.5/jamdict_data/jamdict.db

Why a second signal beside data/frequency.json. That file counts substrings in
Tatoeba sentences, which is a fine ranking inside a level and a poor judge of
whether a word is worth knowing: it credits short words inside longer ones, and
it knows nothing of how common a word is in print. JMdict's priority tags are
curated from corpus counts (nfNN is the word's place in a frequency list, in
bands of 500) and from the sources lexicographers trust (news, ichi, spec, gai).

The tiers, and the reasoning for each cut:

  1  core      nf01-nf12 (the commonest 6,000), or both news1 and ichi1.
  2  common    nf13-nf24, or any of news1, ichi1, spec1, gai1.
  3  uncommon  any other priority tag.
  4  unlisted  no priority tag at all.

Tier 4 is not the same as rare. JMdict leaves prefixed forms (お酒, お風呂) and a
number of everyday compounds unmarked, so a consumer has to read tier 4 together
with the Tatoeba count, which is what src/domain/commonness.ts does.

A word is matched on written form *and* reading, because the same characters are
different words by reading (金/かね and 金/きん) and only one of them may be
common. A word absent from JMdict entirely is tier 4.

The output is committed rather than built on every `npm run decks`, for the same
reason as the sentence packs and frequency.json: it comes from a large download,
and the order material is introduced in must not move under someone part-way
through a level because an upstream file changed.

JMdict is the property of the Electronic Dictionary Research and Development
Group and is used under CC BY-SA 4.0. This file is derived from it; see
LICENSES.md.
"""
import collections
import csv
import json
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

if len(sys.argv) != 2:
    sys.exit(__doc__)

db = sqlite3.connect(sys.argv[1])

kanji_forms = {}
kana_forms = {}
for form_id, idseq, text in db.execute('select ID, idseq, text from Kanji'):
    kanji_forms[form_id] = (idseq, text)
for form_id, idseq, text in db.execute('select ID, idseq, text from Kana'):
    kana_forms[form_id] = (idseq, text)

priority = collections.defaultdict(set)
for form_id, tag in db.execute('select kid, text from KJP'):
    if form_id in kanji_forms:
        priority[kanji_forms[form_id]].add(tag)
for form_id, tag in db.execute('select kid, text from KNP'):
    if form_id in kana_forms:
        priority[kana_forms[form_id]].add(tag)

by_kanji = collections.defaultdict(set)
by_kana = collections.defaultdict(set)
for idseq, text in kanji_forms.values():
    by_kanji[text].add(idseq)
for idseq, text in kana_forms.values():
    by_kana[text].add(idseq)

STRONG = {'news1', 'ichi1', 'spec1', 'gai1'}
WEAK = {'news2', 'ichi2', 'spec2', 'gai2'}


def tier_of(tags):
    bands = [int(t[2:]) for t in tags if re.fullmatch(r'nf\d\d', t)]
    band = min(bands) if bands else None
    if (band is not None and band <= 12) or {'news1', 'ichi1'} <= tags:
        return 1
    if (band is not None and band <= 24) or tags & STRONG:
        return 2
    if band is not None or tags & WEAK:
        return 3
    return 4


def lookup(word, reading):
    entries = (by_kanji.get(word, set()) & by_kana.get(reading, set())) or (
        by_kana.get(word, set()) & by_kana.get(reading, set())
    )
    tags = set()
    for idseq in entries:
        tags |= priority.get((idseq, word), set())
        tags |= priority.get((idseq, reading), set())
    return tags


def tier_for(word, reading):
    tier = tier_of(lookup(word, reading))
    if tier < 4:
        return tier

    # JMdict leaves the polite prefix forms untagged although they are everyday
    # words: お酒 and お風呂 are tier 4, 酒 and 風呂 are tier 1. A prefixed word is
    # as common as the word it is built on.
    for prefix in ('お', 'ご', '御'):
        if word.startswith(prefix) and len(word) > 1 and reading[:1] in ('お', 'ご'):
            base = tier_of(lookup(word[len(prefix):], reading[1:]))
            if base < 4:
                return base
    return 4


tiers = {}
with open(ROOT / 'data/Vocab.csv', encoding='utf8', newline='') as handle:
    for row in csv.DictReader(handle):
        word, reading = row['Kanji'].strip(), row['Reading'].strip()
        if not word:
            continue
        # The best tier a duplicated row earned: two CSV rows for one word and
        # reading are one item after build-decks merges them.
        key = f'{word}|{reading}'
        tiers[key] = min(tiers.get(key, 4), tier_for(word, reading))

out = {
    'source': 'JMdict via jamdict-data 1.5 (EDRDG, CC BY-SA 4.0)',
    'note': '1 core, 2 common, 3 uncommon, 4 unlisted. Rules in scripts/build-commonness.py.',
    'tiers': dict(sorted(tiers.items())),
}

path = ROOT / 'data/commonness.json'
path.write_text(json.dumps(out, ensure_ascii=False, indent=0) + '\n', encoding='utf8')

counts = collections.Counter(tiers.values())
print(f'{len(tiers)} items -> {path.relative_to(ROOT)}')
for tier in (1, 2, 3, 4):
    print(f'  tier {tier}: {counts[tier]}')
