import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { isWritingCorrect } from '../domain/answerCheck';
import { loadAllDecks } from '../domain/decks';
import { LEVELS, type StudyItem, type VocabItem } from '../domain/items';
import {
  chooseSentence,
  loadSentencePack,
  type Sentence,
} from '../domain/sentences';
import type { Candidate } from '../domain/sessionPlanner';
import { isSpeechSupported, pickVoice, speak, stopSpeaking, whenVoicesReady } from '../audio/speech';
import { QuizFrame, type PromptHelpers } from './QuizFrame';

/**
 * Hear it, then write it.
 *
 * Ported from `audio_quiz.py`, which used gTTS and `mpv` — a network call per
 * phrase and a binary to install. This uses the device's own Japanese voice
 * instead, which is offline and free and not always present, so the mode checks
 * for one up front and explains itself when there is none rather than
 * presenting a silent quiz.
 *
 * **Nothing plays on its own.** iOS Safari refuses to speak outside a
 * user-initiated event, so an autoplaying prompt would be silent there and
 * there is no way to detect it. Every sound follows a tap, which also happens
 * to be the correct design for anyone opening the app in a quiet carriage.
 *
 * Replaying counts as help: needing to hear it twice is the audio equivalent of
 * needing to be told, and caps the grade at `hard`.
 */

function asVocab(item: StudyItem): VocabItem {
  return item as VocabItem;
}

export function AudioPanel({ user }: { user: User }) {
  const sentences = useRef<Map<string, Sentence[]>>(new Map());
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let live = true;

    whenVoicesReady().then((voices) => {
      if (!live) return;
      setVoice(pickVoice(voices));
      setChecking(false);
    });

    // Leaving the screen mid-sentence should stop the sentence.
    return () => {
      live = false;
      stopSpeaking();
    };
  }, []);

  const loadCandidates = useCallback(async (): Promise<Candidate[]> => {
    const [decks, packs] = await Promise.all([
      loadAllDecks<VocabItem>('vocab'),
      Promise.all(LEVELS.map((level) => loadSentencePack(level))),
    ]);

    const index = new Map<string, Sentence[]>();
    for (const pack of packs) {
      for (const [word, entries] of Object.entries(pack.sentences)) {
        index.set(word, entries);
      }
    }
    sentences.current = index;

    return decks.flatMap((deck) =>
      deck.items.map((item) => ({ quiz: 'audio' as const, item, level: deck.level })),
    );
  }, []);

  if (checking) {
    return (
      <section className="card">
        <p className="card__body">Looking for a Japanese voice…</p>
      </section>
    );
  }

  if (!isSpeechSupported() || !voice) {
    return (
      <section className="card">
        <h1 className="card__title">No Japanese voice</h1>
        <p className="card__body">
          This device has no Japanese speech voice installed, so there is nothing to listen to.
          Every other mode works normally.
        </p>
        <p className="card__hint">
          On Android, Japanese can usually be added under Settings → System → Languages → Text-to-speech.
          On iOS it arrives with the Japanese keyboard or under Accessibility → Spoken Content →
          Voices.
        </p>
      </section>
    );
  }

  return (
    <QuizFrame
      user={user}
      quiz="audio"
      loadCandidates={loadCandidates}
      placeholder="Kanji, with any okurigana"
      check={(input, item) => isWritingCorrect(input, asVocab(item).word)}
      answerOf={(item) => asVocab(item).word}
      renderPrompt={({ item, state }, helpers) => (
        <AudioPrompt
          item={asVocab(item)}
          sentence={chooseSentence(
            sentences.current.get(asVocab(item).word) ?? [],
            state?.totalReps ?? 0,
          )}
          voice={voice}
          helpers={helpers}
        />
      )}
      renderReveal={(item) => (
        <dl className="datalist">
          <div className="datalist__row">
            <dt>Word</dt>
            <dd className="datalist__surface" lang="ja">
              {asVocab(item).word}
            </dd>
          </div>
          <div className="datalist__row">
            <dt>Reading</dt>
            <dd lang="ja">{asVocab(item).reading}</dd>
          </div>
          <div className="datalist__row">
            <dt>Meaning</dt>
            <dd>{asVocab(item).meaning || '—'}</dd>
          </div>
        </dl>
      )}
    />
  );
}

interface AudioPromptProps {
  item: VocabItem;
  sentence: Sentence | null;
  voice: SpeechSynthesisVoice;
  helpers: PromptHelpers;
}

function AudioPrompt({ item, sentence, voice, helpers }: AudioPromptProps) {
  const [plays, setPlays] = useState(0);
  const [speaking, setSpeaking] = useState(false);

  // A word with no example sentence is spoken on its own. Less context, but
  // still a listening question, which is better than dropping the word.
  const phrase = sentence?.text ?? item.reading;

  const play = () => {
    if (plays > 0) helpers.markHelped();
    setPlays((n) => n + 1);
    setSpeaking(true);
    void speak(phrase, { voice }).finally(() => setSpeaking(false));
  };

  return (
    <>
      <button
        type="button"
        className="button button--primary button--block quiz__play"
        onClick={play}
        disabled={speaking}
      >
        {speaking ? 'Playing…' : plays === 0 ? 'Play' : 'Play again'}
      </button>

      <p className="quiz__gloss">{item.meaning || 'no meaning recorded'}</p>

      {plays > 1 ? (
        <p className="quiz__note">Replays count as a hint — this one will be graded as a struggle.</p>
      ) : null}
      {!sentence ? <p className="quiz__note">No example sentence; the word is read alone.</p> : null}
    </>
  );
}
