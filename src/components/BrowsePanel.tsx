import { useMemo, useState } from 'react';
import { useDeck } from '../hooks/useDeck';
import {
  LEVELS,
  isKanjiItem,
  levelLabel,
  type DeckType,
  type StudyItem,
} from '../domain/items';

/**
 * Every kanji and word, by level.
 *
 * The first screen that shows real data, and it earns its place beyond that:
 * "what is actually in N3?" is a question worth being able to answer, and
 * looking a word up without starting a quiz is something people do.
 *
 * A deck runs to 1,548 entries, so the list is filtered and capped rather than
 * rendered whole. Virtualising it would be the next step if this ever became a
 * screen people scrolled rather than searched.
 */

const RENDER_LIMIT = 300;

function matches(item: StudyItem, needle: string): boolean {
  if (!needle) return true;

  const haystack = isKanjiItem(item)
    ? [item.kanji, item.readings.join(' '), item.meaning]
    : [item.word, item.reading, item.meaning];

  return haystack.some((field) => field.toLowerCase().includes(needle));
}

export function BrowsePanel() {
  const [type, setType] = useState<DeckType>('kanji');
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('5');
  const [query, setQuery] = useState('');

  const { value: deck, loading, error } = useDeck(type, level);

  const filtered = useMemo(() => {
    if (!deck) return [];
    const needle = query.trim().toLowerCase();
    return deck.items.filter((item) => matches(item, needle));
  }, [deck, query]);

  return (
    <section className="card">
      <fieldset className="field">
        <legend className="field__label">What</legend>
        <div className="segmented segmented--wrap">
          {(['kanji', 'vocab'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`segmented__option${type === option ? ' segmented__option--active' : ''}`}
              aria-pressed={type === option}
              onClick={() => setType(option)}
            >
              {option === 'kanji' ? 'Kanji' : 'Vocabulary'}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend className="field__label">Level</legend>
        <div className="segmented segmented--levels">
          {LEVELS.map((option) => (
            <button
              key={option}
              type="button"
              className={`segmented__option${level === option ? ' segmented__option--active' : ''}`}
              aria-pressed={level === option}
              onClick={() => setLevel(option)}
            >
              {levelLabel(option)}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span className="field__label">Search</span>
        <input
          type="search"
          className="textinput"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Character, reading or meaning"
          autoComplete="off"
        />
      </label>

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : loading ? (
        <p className="card__body">Loading {levelLabel(level)}…</p>
      ) : deck ? (
        <>
          <p className="card__hint" data-testid="browse-count">
            {filtered.length === deck.count
              ? `${deck.count} entries`
              : `${filtered.length} of ${deck.count} entries`}
            {filtered.length > RENDER_LIMIT ? `, showing the first ${RENDER_LIMIT}` : ''}
          </p>

          <ul className="itemlist">
            {filtered.slice(0, RENDER_LIMIT).map((item) => (
              <li key={item.id} className="itemlist__row">
                <span className="itemlist__surface" lang="ja">
                  {isKanjiItem(item) ? item.kanji : item.word}
                </span>
                <span className="itemlist__detail">
                  <span className="itemlist__reading" lang="ja">
                    {isKanjiItem(item) ? item.readings.join('・') : item.reading}
                  </span>
                  <span className="itemlist__meaning">{item.meaning || '—'}</span>
                </span>
              </li>
            ))}
          </ul>

          {filtered.length === 0 ? (
            <p className="notice notice--muted">Nothing in {levelLabel(level)} matches that.</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
