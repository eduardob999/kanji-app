import { useState, type ReactNode } from 'react';
import { isAnyReadingCorrect, isReadingCorrect, isWritingCorrect } from '../domain/answerCheck';
import type { KanjiItem, StudyItem, VocabItem } from '../domain/items';
import type { QuizMode } from '../domain/modes';
import { blankOut, chooseSentence, type Sentence } from '../domain/sentences';
import type { PlannedQuestion } from '../domain/sessionPlanner';
import { announcedSequence, speakSequence } from '../audio/speech';

/**
 * What each of the four question types looks like, in one place.
 *
 * Previously each of these lived inside its own panel, which was fine while
 * every screen asked one kind of question. The practice screen asks all four in
 * a single sitting, and a second copy of "what a fill-in prompt looks like" is a
 * second copy that drifts.
 *
 * So a definition is just data plus two renderers, and the panels become thin.
 * `QuizFrame` picks the definition from `question.quiz`, which the planner has
 * already put there.
 */

export interface PromptHelpers {
  /**
   * The prompt gave something away — a replay, a revealed hint. Caps the grade
   * at `hard`, because an answer you had to be told is not recall whatever the
   * clock says.
   */
  markHelped: () => void;
}

export interface QuizDefinition {
  placeholder: string;
  /** Marks the answer. */
  check: (input: string, item: StudyItem) => boolean;
  /** What the answer was, shown on a miss. */
  answerOf: (item: StudyItem) => string;
  renderPrompt: (question: PlannedQuestion, helpers: PromptHelpers) => ReactNode;
  renderReveal: (item: StudyItem) => ReactNode;
}

/**
 * What the definitions need from the screen around them.
 *
 * Sentences and the speech voice are loaded by the panel — asynchronously, and
 * once for the whole session — while a prompt renders synchronously and many
 * times. So they arrive here rather than being fetched per question.
 */
export interface QuizContext {
  /** Word surface to its example sentences. Empty until the packs load. */
  sentences: Map<string, Sentence[]>;
  /** Null when the device has no Japanese voice; listening is hidden then. */
  voice: SpeechSynthesisVoice | null;
}

const asVocab = (item: StudyItem): VocabItem => item as VocabItem;
const asKanji = (item: StudyItem): KanjiItem => item as KanjiItem;

function VocabReveal({ item }: { item: VocabItem }) {
  return (
    <dl className="datalist">
      <div className="datalist__row">
        <dt>Word</dt>
        <dd className="datalist__surface" lang="ja">
          {item.word}
        </dd>
      </div>
      <div className="datalist__row">
        <dt>Reading</dt>
        <dd lang="ja">{item.reading}</dd>
      </div>
      <div className="datalist__row">
        <dt>Meaning</dt>
        <dd>{item.meaning || '—'}</dd>
      </div>
    </dl>
  );
}

export function quizDefinitions(context: QuizContext): Record<QuizMode, QuizDefinition> {
  const sentenceFor = (item: VocabItem, reps: number): Sentence | null =>
    chooseSentence(context.sentences.get(item.word) ?? [], reps, item.word);

  return {
    'vocab-reading': {
      placeholder: 'Reading in kana',
      check: (input, item) => {
        const vocab = asVocab(item);
        // A prompt the source data leaves ambiguous accepts either reading.
        return vocab.accepts
          ? isAnyReadingCorrect(input, vocab.accepts)
          : isReadingCorrect(input, vocab.reading);
      },
      answerOf: (item) => asVocab(item).accepts?.join(' / ') ?? asVocab(item).reading,
      renderPrompt: ({ item }) => (
        <>
          <p className="quiz__surface" lang="ja">
            {asVocab(item).word}
          </p>
          <p className="quiz__gloss">{asVocab(item).meaning || 'no meaning recorded'}</p>
        </>
      ),
      renderReveal: (item) => <VocabReveal item={asVocab(item)} />,
    },

    'kanji-writing': {
      placeholder: 'The character',
      check: (input, item) => isWritingCorrect(input, asKanji(item).kanji),
      answerOf: (item) => asKanji(item).kanji,
      renderPrompt: ({ item }) => (
        <>
          <p className="quiz__readings" lang="ja">
            {asKanji(item).readings.join('・')}
          </p>
          <p className="quiz__gloss">{asKanji(item).meaning || 'no meaning recorded'}</p>
        </>
      ),
      renderReveal: (item) => (
        <dl className="datalist">
          <div className="datalist__row">
            <dt>Character</dt>
            <dd className="datalist__surface" lang="ja">
              {asKanji(item).kanji}
            </dd>
          </div>
          <div className="datalist__row">
            <dt>Readings</dt>
            <dd lang="ja">{asKanji(item).readings.join('・')}</dd>
          </div>
          <div className="datalist__row">
            <dt>Meaning</dt>
            <dd>{asKanji(item).meaning || '—'}</dd>
          </div>
        </dl>
      ),
    },

    'fill-in': {
      placeholder: 'Kanji, with any okurigana',
      check: (input, item) => isWritingCorrect(input, asVocab(item).word),
      answerOf: (item) => asVocab(item).word,
      renderPrompt: ({ item, state }) => {
        const vocab = asVocab(item);
        const sentence = sentenceFor(vocab, state?.totalReps ?? 0);

        if (!sentence) {
          return (
            <>
              <p className="quiz__readings" lang="ja">
                {vocab.reading}
              </p>
              <p className="quiz__gloss">{vocab.meaning || 'no meaning recorded'}</p>
              <p className="quiz__note">No example sentence for this word.</p>
            </>
          );
        }

        return (
          <>
            <p className="quiz__sentence" lang="ja">
              {blankOut(sentence.text, vocab.word, vocab.reading)}
            </p>
            <p className="quiz__gloss">{vocab.meaning || 'no meaning recorded'}</p>
          </>
        );
      },
      renderReveal: (item) => {
        const vocab = asVocab(item);
        const available = context.sentences.get(vocab.word) ?? [];

        return (
          <>
            <VocabReveal item={vocab} />
            {available.length > 0 ? (
              <p className="quiz__note">
                Sentence from{' '}
                <a href={`https://tatoeba.org/en/sentences/show/${available[0]!.id}`}>Tatoeba</a>,
                CC-BY 2.0 FR.
              </p>
            ) : null}
          </>
        );
      },
    },

    audio: {
      placeholder: 'Kanji, with any okurigana',
      check: (input, item) => isWritingCorrect(input, asVocab(item).word),
      answerOf: (item) => asVocab(item).word,
      renderPrompt: ({ item, state }, helpers) => {
        const vocab = asVocab(item);
        return (
          <AudioPrompt
            item={vocab}
            sentence={sentenceFor(vocab, state?.totalReps ?? 0)}
            voice={context.voice}
            helpers={helpers}
          />
        );
      },
      renderReveal: (item) => <VocabReveal item={asVocab(item)} />,
    },
  };
}

interface AudioPromptProps {
  item: VocabItem;
  sentence: Sentence | null;
  voice: SpeechSynthesisVoice | null;
  helpers: PromptHelpers;
}

/**
 * The listening prompt.
 *
 * Plays the word, then the example, then the word again — the framing
 * `audio_quiz.py` used and the port originally dropped. Without it a sentence
 * plays and there is no way to tell which of its words is being asked, which
 * makes it a question about the sentence rather than about the word.
 *
 * Nothing autoplays: iOS Safari refuses to speak outside a user gesture and
 * gives no way to detect that it declined, so every sound follows a tap.
 */
function AudioPrompt({ item, sentence, voice, helpers }: AudioPromptProps) {
  const [plays, setPlays] = useState(0);
  const [speaking, setSpeaking] = useState(false);

  const play = () => {
    if (plays > 0) helpers.markHelped();
    setPlays((n) => n + 1);
    setSpeaking(true);
    void speakSequence(announcedSequence(item.reading, sentence?.text ?? null), {
      ...(voice ? { voice } : {}),
    }).finally(() => setSpeaking(false));
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
        <p className="quiz__note">Replays count as a hint — this one is graded as a struggle.</p>
      ) : null}
      {!sentence ? (
        <p className="quiz__note">No example sentence; the word is announced alone.</p>
      ) : null}
    </>
  );
}
