/**
 * Speaking Japanese, via whatever voice the device has.
 *
 * The CLI used gTTS and piped the result to `mpv`: a network call per phrase
 * and a binary that has to be installed. Neither ships to a browser, so this
 * uses the Web Speech API, which is on-device, free, offline, and of wildly
 * varying quality — a recent iPhone reads Japanese well, a stripped-down
 * Android may have no Japanese voice at all.
 *
 * That variability is the whole design problem here, and the answer is to find
 * out *before* offering the quiz rather than failing silently in the middle of
 * it. `hasJapaneseVoice` is what the listening mode checks.
 *
 * Two browser quirks worth knowing:
 *
 * - **Voices load asynchronously.** `getVoices()` returns an empty array on
 *   first call in most browsers and fills in later, announced by
 *   `voiceschanged`. Code that checks once at startup concludes there are no
 *   voices at all.
 * - **iOS needs a gesture.** Safari refuses to speak unless the call is inside
 *   a user-initiated event, and says nothing when it declines — the utterance
 *   just never starts. The listening prompt plays each question by itself and
 *   uses `onStart` to find out whether that worked, so a browser that refused
 *   still has its Play button and still counts the first tap as the question
 *   rather than as a replay.
 */

export const JAPANESE = 'ja-JP';

/**
 * Which playing is the current one.
 *
 * `speechSynthesis.cancel()` stops the utterance that is speaking and empties
 * the queue, and that is all it does — it knows nothing about a *sequence*, and
 * `speakSequence` is a loop that queues the next phrase once the last one ends.
 * Cancelling therefore ended one phrase and let the loop carry straight on to
 * the next, so the word being read over the top of a new question was never
 * actually stopped; it was interrupted three times and finished anyway.
 *
 * A counter, bumped by anything that takes over the speaker. A loop whose
 * number is no longer current gives up rather than queueing its next phrase.
 */
let generation = 0;

/** Claims the speaker, and returns the claim to check later. */
function claim(): number {
  generation += 1;
  return generation;
}

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : null;
}

export function isSpeechSupported(): boolean {
  return synth() !== null;
}

function japaneseVoices(): SpeechSynthesisVoice[] {
  return (synth()?.getVoices() ?? []).filter((voice) => voice.lang.toLowerCase().startsWith('ja'));
}

/**
 * Resolves once the voice list is populated, or gives up.
 *
 * The timeout is not paranoia: some browsers never fire `voiceschanged` when
 * the list was already populated, and some never populate it at all. Waiting
 * forever would leave the listening quiz on a spinner.
 */
export function whenVoicesReady(timeoutMs = 3_000): Promise<SpeechSynthesisVoice[]> {
  const speech = synth();
  if (!speech) return Promise.resolve([]);

  const existing = japaneseVoices();
  if (existing.length > 0) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      speech.removeEventListener('voiceschanged', finish);
      window.clearTimeout(timer);
      resolve(japaneseVoices());
    };

    const timer = window.setTimeout(finish, timeoutMs);
    speech.addEventListener('voiceschanged', finish);
  });
}

/** The voice to use, preferring a local one — network voices lag and need a connection. */
export function pickVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return voices.find((voice) => voice.localService) ?? voices[0] ?? null;
}

export interface SpeakOptions {
  /**
   * Slower than conversational by default. The point is to be understood by
   * someone still learning the word, not to sound natural.
   */
  rate?: number;
  voice?: SpeechSynthesisVoice | null;
  /**
   * Called once, when sound actually begins.
   *
   * The only honest answer to "did it play?". A browser that declines to speak
   * — iOS outside a user gesture, a device with the voice uninstalled mid-life
   * — throws nothing and reports nothing; the utterance simply never starts.
   * The listening prompt needs to know, because an autoplay that was refused
   * must leave the first tap free and one that worked must not.
   */
  onStart?: () => void;
}

/**
 * Speaks one phrase, resolving when it finishes.
 *
 * Cancels anything already speaking. Tapping "play again" while the previous
 * reading is still going should replace it, not queue behind it — the queue is
 * how you end up with the sentence read four times after four impatient taps.
 */
export function speak(text: string, options: SpeakOptions = {}): Promise<void> {
  const speech = synth();
  if (!speech || !text.trim()) return Promise.resolve();

  claim();
  speech.cancel();

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = JAPANESE;
    utterance.rate = options.rate ?? 0.85;
    if (options.voice) utterance.voice = options.voice;
    if (options.onStart) utterance.addEventListener('start', options.onStart, { once: true });

    // Resolve on error as well as end: a rejected promise here would surface as
    // an unhandled rejection for something as ordinary as the user navigating
    // away mid-sentence.
    utterance.addEventListener('end', () => resolve());
    utterance.addEventListener('error', () => resolve());

    speech.speak(utterance);
  });
}

/**
 * Speaks several phrases in order, as one utterance would be.
 *
 * **Not a loop over `speak`.** `speak` cancels whatever is speaking before it
 * starts, which is right for a replay button and exactly wrong for a sequence:
 * three chained calls would cancel each other and only the last would be heard.
 * This cancels once, then queues.
 *
 * Resolves when the last phrase finishes, or as soon as something else claims
 * the speaker — `stopSpeaking`, a replay, or the next question autoplaying. The
 * caller sees a completed promise either way, because there is nothing useful
 * for a UI to do about "the user navigated away mid-sentence".
 *
 * Giving up is checked between phrases rather than being left to `cancel()`,
 * which cannot do it: see `generation`.
 */
export async function speakSequence(
  phrases: readonly string[],
  options: SpeakOptions = {},
): Promise<void> {
  const speech = synth();
  if (!speech) return;

  const mine = claim();
  speech.cancel();

  // Announced once for the sequence, on the first phrase that speaks.
  let started = false;
  const announceStart = () => {
    if (started) return;
    started = true;
    options.onStart?.();
  };

  for (const phrase of phrases) {
    if (!phrase.trim()) continue;
    // Someone else has the speaker: a new question, or a replay of this one.
    if (generation !== mine) return;

    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(phrase);
      utterance.lang = JAPANESE;
      utterance.rate = options.rate ?? 0.85;
      if (options.voice) utterance.voice = options.voice;

      utterance.addEventListener('start', announceStart, { once: true });
      utterance.addEventListener('end', () => resolve());
      utterance.addEventListener('error', () => resolve());

      speech.speak(utterance);
    });
  }
}

/**
 * The CLI's framing, kept: announce the word, read the example, announce it
 * again.
 *
 * Without this a listening question plays a whole sentence and leaves you to
 * guess which word in it is being asked, which is not a question about the
 * word at all.
 *
 * **The announcement uses the reading, not the written form.** `audio_quiz.py`
 * announced 問題の言葉は{kanji}です and let the engine decide how to pronounce
 * it — which for a word like 毎月, whose two entries differ only by reading,
 * means the app can announce the wrong answer to its own question. Kana leaves
 * the engine nothing to decide.
 */
export function announcedSequence(reading: string, sentence: string | null): string[] {
  const announcement = `問題の言葉は${reading}です`;
  return sentence ? [announcement, sentence, announcement] : [announcement];
}

/**
 * Whether something is being read aloud right now.
 *
 * Asked by the answer cues, which must not land on top of a listening
 * question. `speechSynthesis.speaking` is true from the moment an utterance is
 * queued until the last one ends, which is exactly the window a cue must stay
 * out of.
 */
export function isSpeaking(): boolean {
  const speech = synth();
  return Boolean(speech && (speech.speaking || speech.pending));
}

export function stopSpeaking(): void {
  claim();
  synth()?.cancel();
}
