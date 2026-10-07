"""
PROTOTYPE for step 4 of docs/WORD-SELECTION.md: which top-tier JMdict words are
missing from the deck, and what level each would take.

    python3 scripts/build-bank.py <path-to-jamdict.db> [out.json]
        [--tubelex tubelex-ja.tsv] [--max-band 8] [--csv data/Vocab-extra.csv]

The database comes from the jamdict-data package; see scripts/build-commonness.py
for how to fetch it. This only *reports* candidates (and writes them as JSON); it
does not touch data/ unless --csv is given, which writes the committed
data/Vocab-extra.csv that build-decks loads after Vocab.csv.

With --csv the candidates are narrowed by the evidence in docs/WORD-SELECTION.md:
single characters are dropped (names and bound forms, and their kanji are taught
already), only words in nf01..--max-band are kept, and a word must show up in
real use: at least 10 Tatoeba sentences (substring count, as data/frequency.json
counts) or, with --tubelex, a rank of 15,000 or better in TUBELEX. That removes
the news-only vocabulary JMdict's bands rank high (経済企画庁, 民社党, 公定歩合).
TUBELEX is read here but never copied into the repo; its licence for the lists is
unclear (see the survey).

Filters so far: tier 1 only, not already in the deck by written form, no proper
nouns, affixes, counters or pronouns, no archaic/slang/abbreviation/etc. first
sense, no specialist field (baseball, law, ...), every kanji already in
Kanji.csv, at most six characters, one entry per written form. Level is the
hardest level among the word's kanji. Still to decide: single-character words
(many are bound forms like 動), and the news-register skew of JMdict's nf bands.
"""
import sqlite3, csv, collections, re, json, sys

import argparse
ap = argparse.ArgumentParser(description='Candidate words for data/Vocab-extra.csv')
ap.add_argument('db'); ap.add_argument('out', nargs='?', default='bank-candidates.json')
ap.add_argument('--tubelex'); ap.add_argument('--max-band', type=int, default=8)
ap.add_argument('--csv')
args = ap.parse_args()
c = sqlite3.connect(args.db)
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

# Words whose gloss is capitalised only because it names a language, a nationality
# or a religion, which is ordinary vocabulary.
CAPITAL_OK = {'日本人', '日本語', '中国人', '仏教', '正月', '元日', '皇室', '五輪', '邦人'}

# Hand-reviewed out (2026-10-07). Even with the evidence rule, JMdict's bands leave
# a great deal of newspaper vocabulary (politics, finance, sport, ministries),
# surnames that share a spelling with a word, and spellings whose first gloss
# misleads. Every candidate was read; at N1 only words judged everyday are kept.
# Reasons by group are in docs/WORD-SELECTION.md.
HAND_EXCLUDED = set('''
一員 一本 一枚 一段 一発 一線 一行 一角 上場 上映 上田 上院 下落 不全 不動 不法 両国 両面 中島 中期 中盤 中絶 中部 主力 主将 主流 主義者 予選 事例 二次 二重 五輪 人事 今季 他国 他社 代々 代替 代理店 代行 仲介 任意 任期 伸び 低迷 体質 併用 侵害 侵攻 保全 保安 保有 信託 債券 債務 債権 優遇 先制 先発 全米 全額 公明 公民 公約 共産主義 内定 円安 円高 冬季 冷戦 凍結 出力 出場 出席者 出荷 出資 出馬 初代 初戦 利回り 前向き 前線 創業 創設 加盟 助成 労働組合 包括 北側 北方 十一 十二 十五 十八 十四 厚生 原告 参入 参拝 参謀 取締役 受信 受注 受講 受賞 合戦 同年 同日 同期 同社 同行 向い 含み 告発 周年 和平 和解 品目 商工 四半期 回線 団長 国債 国務 地雷 執行 基調 増殖 増税 売り上げ 売り物 売却 外務 多額 大和 大国 大手 大物 大規模 大賞 大野 失点 好機 委員長 学園 学院 官房 定数 実務 家電 宿舎 対局 将軍 小島 局面 左派 左翼 左腕 巨人 帰還 年々 年内 幹事 庁舎 広がり 広報 序盤 店頭 引き上げ 当事者 当地 当局 後期 後継 心境 念頭 思惑 急増 感性 慰安 懲役 懸命 戦前 戦時 戦略 戦線 戦車 手当 打率 打球 抑え 投球 担保 拠点 指名 指標 指針 排出 提言 援護 撤去 撤回 撤退 擁護 支障 攻防 放射性 政界 敗北 教徒 数量 新生 新設 施策 日報 日産 昇格 暫定 有罪 朝日 木造 本国 本店 本拠 本書 本社 条例 東北 東南 東海 枠組み 株主 株価 核兵器 検定 検察 業界 業種 構築 機動 機器 機種 次期 歴代 死者 殺害 汚職 派閥 流出 流動 海域 海軍 消費税 減税 減速 滑走 潜在 爆撃 犯行 献金 現行犯 球団 球場 理事 生息 生産性 番手 異例 療法 発注 発電所 白人 皇后 皇室 目玉 省庁 県内 県民 県立 祖国 移植 税制 税収 種目 空白 空軍 立ち入り 立候補 筆頭 答弁 策定 管理職 米国 系列 納税 終値 終盤 終結 絡み 総務 総括 総裁 総長 総額 締結 編成 自国 自社 自粛 艦隊 葬儀 虐殺 行使 表彰 表明 被告 被災 被爆 補佐 西側 親方 解禁 解雇 証券 証書 調達 議席 譲渡 財団 買い 買収 賃上げ 賃貸 走者 起用 起訴 足元 路線 軍人 辞任 辞表 送り 通報 通算 速報 連勝 連敗 連覇 連載 週刊 週明け 選定 選手権 選抜 遺憾 部隊 都内 都民 配当 金子 銘柄 鑑定 開き 開幕 開示 開設 闘争 防御 院長 陣営 陸上 陸軍 隊員 離脱 電鉄 青山 順位 順次 顧問 飲食 首位 駆使 骨格 高まり 高値 高騰 麻薬 黒人
'''.split())

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
json.dump(cands, open(args.out, 'w'), ensure_ascii=False)
import random
random.seed(3)
for x in random.sample(cands, 30): print(x)

if args.csv:
    tub = {}
    if args.tubelex:
        for i, line in enumerate(open(args.tubelex, encoding='utf8')):
            if i: tub.setdefault(line.split('\t')[0], i)
    tat = '\n'.join(l.rstrip('\n').split('\t')[-1]
                    for l in open(ROOT + 'data/tatoeba/jpn_sentences.tsv', encoding='utf8'))
    keep = []
    for x in cands:
        if len(x['word']) < 2 or x['band'] > args.max_band: continue
        # Place names, eras, parties and ministries: JMdict does not always mark
        # them as proper nouns, but its gloss for them starts with a capital.
        if x['word'] in HAND_EXCLUDED: continue
        if re.match(r'[A-Z]', x['meaning']) and x['word'] not in CAPITAL_OK: continue
        if tat.count(x['word']) < 10 and tub.get(x['word'], 10**9) > 15000: continue
        keep.append(x)
    keep.sort(key=lambda x: (LV.index(x['level']), x['band'], x['word']))
    with open(args.csv, 'w', encoding='utf8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Kanji', 'Reading', 'Meaning', 'Level'])
        for x in keep: w.writerow([x['word'], x['reading'], x['meaning'], x['level']])
    print('wrote', len(keep), 'rows to', args.csv, dict(collections.Counter(x['level'] for x in keep)))
