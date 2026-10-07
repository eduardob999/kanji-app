"""
PROTOTYPE for step 4 of docs/WORD-SELECTION.md: which top-tier JMdict words are
missing from the deck, and what level each would take.

    python3 scripts/build-bank.py <path-to-jamdict.db> [out.json]

The database comes from the jamdict-data package; see scripts/build-commonness.py
for how to fetch it. This only *reports* candidates (and writes them as JSON); it
does not touch data/. The intended next step is to turn the output into a
committed data/Vocab-extra.csv that build-decks loads after Vocab.csv.

Filters so far: tier 1 only, not already in the deck by written form, no proper
nouns, affixes, counters or pronouns, no archaic/slang/abbreviation/etc. first
sense, no specialist field (baseball, law, ...), every kanji already in
Kanji.csv, at most six characters, one entry per written form. Level is the
hardest level among the word's kanji. Still to decide: single-character words
(many are bound forms like 動), and the news-register skew of JMdict's nf bands.
"""
import sqlite3, csv, collections, re, json, sys

if len(sys.argv) < 2:
    sys.exit(__doc__)
c = sqlite3.connect(sys.argv[1])
from pathlib import Path
ROOT = str(Path(__file__).resolve().parent.parent) + '/'

kanji_forms, kana_forms = {}, {}
for i, idseq, t in c.execute('select ID,idseq,text from Kanji'): kanji_forms[i] = (idseq, t)
for i, idseq, t in c.execute('select ID,idseq,text from Kana'): kana_forms[i] = (idseq, t)
pri = collections.defaultdict(set)
for kid, t in c.execute('select kid,text from KJP'):
    if kid in kanji_forms: pri[kanji_forms[kid]].add(t)
for kid, t in c.execute('select kid,text from KNP'):
    if kid in kana_forms: pri[kana_forms[kid]].add(t)

sid_entry = {}
senses = collections.defaultdict(list)
for sid, idseq in c.execute('select ID,idseq from Sense order by ID'):
    sid_entry[sid] = idseq; senses[idseq].append(sid)
pos = collections.defaultdict(set); misc = collections.defaultdict(set); fields = collections.defaultdict(set)
for sid, t in c.execute('select sid,text from pos'): pos[sid].add(t)
for sid, t in c.execute('select sid,text from misc'): misc[sid].add(t)
for sid, t in c.execute('select sid,text from field'): fields[sid].add(t)
gloss = collections.defaultdict(list)
for sid, t in c.execute("select sid,text from SenseGloss"): gloss[sid].append(t)

entries = collections.defaultdict(lambda: {'kanji': [], 'kana': []})
for i, idseq, t in c.execute('select ID,idseq,text from Kanji'): entries[idseq]['kanji'].append(t)
for i, idseq, t in c.execute('select ID,idseq,text from Kana'): entries[idseq]['kana'].append(t)


def tier_of(tags):
    bands = [int(t[2:]) for t in tags if re.fullmatch(r'nf\d\d', t)]
    band = min(bands) if bands else None
    if (band is not None and band <= 12) or {'news1', 'ichi1'} <= tags: return 1
    if (band is not None and band <= 24) or tags & {'news1', 'ichi1', 'spec1', 'gai1'}: return 2
    return 3


# existing
rows = list(csv.DictReader(open(ROOT + 'data/Vocab.csv', encoding='utf8')))
have_words = {r['Kanji'] for r in rows}
kan = {r['Kanji']: r['Level'] for r in csv.DictReader(open(ROOT + 'data/Kanji.csv', encoding='utf8'))}
LV = ['5', '4', '3', '2', '1a', '1b', '1c', '1d']
EXCLUDE_POS = ('proper', 'prefix', 'suffix', 'counter', 'unclassified', 'pronoun')  # keep it conservative for now
BAD_MISC = {'archaism', 'obsolete term', 'vulgar expression or word', 'slang', 'derogatory', 'sensitive',
            'Internet slang', 'manga slang', 'children\'s language', 'rare', 'obscure term', 'poetical term',
            'historical term', 'abbreviation', 'yojijukugo', 'familiar language', 'female term or language', 'male term or language',
            'jocular, humorous term', 'dated term', 'idiomatic expression', 'proverb'}

cands = []
rej = collections.Counter()
for idseq, e in entries.items():
    if not e['kanji']: continue
    # choose the first kanji form flagged common if any
    forms = e['kanji']
    word = next((w for w in forms if pri.get((idseq, w))), forms[0])
    rd = e['kana'][0]
    tags = pri.get((idseq, word), set()) | pri.get((idseq, rd), set())
    if tier_of(tags) != 1: continue
    if word in have_words: continue
    ss = senses[idseq]
    if any(any(p.startswith(x) or x in p for x in ('proper',)) for s in ss for p in pos[s]):
        rej['proper'] += 1; continue
    first = ss[0]
    if fields[first]:
        rej['field:' + sorted(fields[first])[0]] += 1; continue
    if misc[first] & BAD_MISC:
        rej['misc:' + sorted(misc[first] & BAD_MISC)[0]] += 1; continue
    ps = pos[first]
    if any(('suffix' in p or 'prefix' in p or 'counter' in p or 'pronoun' in p) for p in ps):
        rej['affix/counter/pronoun'] += 1; continue
    if not all(re.match(r'^[぀-ヿ㐀-䶿一-鿿々〆ヶー]+$', w) for w in [word]):
        rej['odd chars'] += 1; continue
    if len(word) > 6:
        rej['long'] += 1; continue
    ks = re.findall(r'[一-鿿々]', word)
    if any(k not in kan for k in ks if k != '々'):
        rej['kanji outside deck'] += 1; continue
    lv = max((LV.index(kan[k]) for k in ks if k != '々'), default=0)
    glosses = [g for g in gloss[first] if len(g) < 60][:3]
    if not glosses: rej['no gloss'] += 1; continue
    cands.append({'word': word, 'reading': rd, 'meaning': ', '.join(glosses), 'level': LV[lv],
                  'band': min([int(t[2:]) for t in tags if re.fullmatch(r'nf\d\d', t)] or [99])})

seen = {}
for x in sorted(cands, key=lambda x: (x['band'], x['word'])):
    seen.setdefault(x['word'], x)
dups = len(cands) - len(seen)
cands = list(seen.values())
print('dup surfaces dropped', dups)
print('candidates', len(cands))
print(rej.most_common())
print(collections.Counter(x['level'] for x in cands))
json.dump(cands, open(sys.argv[2] if len(sys.argv) > 2 else 'bank-candidates.json', 'w'), ensure_ascii=False)
import random
random.seed(3)
for x in random.sample(cands, 30): print(x)
