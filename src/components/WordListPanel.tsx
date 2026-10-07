import { useEffect, useMemo, useState } from 'react';
import { loadAllDecks } from '../domain/decks';
import type { VocabItem } from '../domain/items';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  MAX_ENTRIES,
  buildSubmission,
  countByStatus,
  knownVocab,
  parseWordList,
  toCsv,
  type KnownVocab,
} from '../domain/wordList';

/**
 * Send in a word list.
 *
 * Checks a list against what the decks already teach, then hands what is left
 * to the maintainer as a GitHub issue to be reviewed, and added if it passes.
 * Why an issue and not a database is argued in `domain/wordList.ts`; the short
 * version is that the Firestore rules are shared with another app and only ever
 * let someone touch their own data.
 *
 * Nothing is sent from here. The button is a link: the sender sees the issue,
 * with the list in it, on GitHub, and chooses whether to post it.
 */

const NOTHING_KNOWN: KnownVocab = { ids: new Set(), words: new Set() };
const SHOWN_PROBLEMS = 12;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function WordListPanel() {
  const online = useOnlineStatus();
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [known, setKnown] = useState<KnownVocab | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    loadAllDecks<VocabItem>('vocab').then(
      (decks) => live && setKnown(knownVocab(decks.flatMap((deck) => deck.items))),
      // Without the decks a list can still be sent; it just cannot be checked
      // against them, and the reviewer does that part.
      () => live && setKnown(NOTHING_KNOWN),
    );
    return () => {
      live = false;
    };
  }, []);

  const entries = useMemo(() => parseWordList(text, known ?? NOTHING_KNOWN), [text, known]);
  const counts = countByStatus(entries);
  const submission = useMemo(() => buildSubmission(entries, note), [entries, note]);
  const problems = entries.filter((entry) => entry.status !== 'new');
  const ready = counts.new > 0;

  const pick = async (file: File | null) => {
    if (!file) return;
    setFileError(null);

    if (file.size > 200_000) {
      setFileError('That file is larger than a word list should be.');
      return;
    }

    try {
      setText(await file.text());
    } catch {
      setFileError('That file could not be read. Paste the list instead.');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(submission.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setFileError('Copying is blocked here. Download the list instead.');
    }
  };

  return (
    <section className="card">
      <div className="card__header">
        <h1 className="card__title">Send a word list</h1>
      </div>

      <p className="card__body">
        Missing a word? Paste a list, or upload one, and it will be checked against what is
        already here. What is new goes to the maintainer to review, and is added if it fits.
      </p>

      <div className="field">
        <label className="field__label" htmlFor="wordlist-text">
          One word per line: <code>word</code>, <code>word,reading</code> or{' '}
          <code>word,reading,meaning</code>
        </label>
        <textarea
          id="wordlist-text"
          className="wordlist__text"
          rows={8}
          value={text}
          spellCheck={false}
          autoCapitalize="off"
          placeholder={'猫,ねこ,cat\n図書館,としょかん,library'}
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="wordlist-file">
          Or upload a .txt, .csv or .tsv file
        </label>
        <input
          id="wordlist-file"
          className="wordlist__file"
          type="file"
          accept=".txt,.csv,.tsv,text/plain,text/csv,text/tab-separated-values"
          onChange={(event) => {
            void pick(event.target.files?.[0] ?? null);
            event.target.value = '';
          }}
        />
      </div>

      {fileError && <p className="notice notice--error">{fileError}</p>}

      {entries.length > 0 && (
        <>
          <p className="notice notice--muted" role="status">
            {counts.new} new
            {counts.known > 0 && ` · ${counts.known} already here`}
            {counts.repeat > 0 && ` · ${counts.repeat} repeated`}
            {counts.invalid > 0 && ` · ${counts.invalid} to fix`}
            {known === null && ' · checking against the decks…'}
          </p>

          {problems.length > 0 && (
            <ul className="wordlist__problems">
              {problems.slice(0, SHOWN_PROBLEMS).map((entry) => (
                <li key={`${entry.line}-${entry.word}`}>
                  <span className="wordlist__line">line {entry.line}</span>{' '}
                  {entry.word && <strong lang="ja">{entry.word}</strong>} {entry.note}
                </li>
              ))}
              {problems.length > SHOWN_PROBLEMS && (
                <li>…and {problems.length - SHOWN_PROBLEMS} more.</li>
              )}
            </ul>
          )}
        </>
      )}

      <div className="field">
        <label className="field__label" htmlFor="wordlist-note">
          Anything the reviewer should know (optional)
        </label>
        <input
          id="wordlist-note"
          className="wordlist__note"
          type="text"
          maxLength={300}
          value={note}
          placeholder="Where the list is from, or what level you would put it at"
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <p className="notice notice--warn">
        Sending opens a public issue on this app&rsquo;s GitHub page, under your GitHub account, so
        anyone can read the list. Nothing else about you is included, and nothing is posted until
        you press the button on GitHub.
      </p>

      {ready && !submission.fits && (
        <p className="notice notice--muted">
          This list is too long for a link. Copy it, then paste it into the issue that opens.
          Lists over {MAX_ENTRIES} words are cut off; send those in parts.
        </p>
      )}

      <div className="wordlist__actions">
        {ready ? (
          <a
            className="button button--primary"
            href={submission.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            Review on GitHub
          </a>
        ) : (
          <button type="button" className="button button--primary" disabled>
            Review on GitHub
          </button>
        )}
        <button type="button" className="button button--ghost" disabled={!ready} onClick={copy}>
          {copied ? 'Copied' : 'Copy list'}
        </button>
        <button
          type="button"
          className="button button--ghost"
          disabled={!ready}
          onClick={() => download('kanjiba-word-list.csv', toCsv(entries))}
        >
          Download .csv
        </button>
      </div>

      {!online && (
        <p className="card__hint">
          You are offline. Your list stays on this screen; copy or download it now, or open GitHub
          when you are back online.
        </p>
      )}
    </section>
  );
}
