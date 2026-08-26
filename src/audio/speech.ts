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
 *   a user-initiated event. The listening quiz therefore never autoplays; the
 *   first sound always follows a tap.
 */

export const JAPANESE = 'ja-JP';

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

  speech.cancel();

  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = JAPANESE;
    utterance.rate = options.rate ?? 0.85;
    if (options.voice) utterance.voice = options.voice;

    // Resolve on error as well as end: a rejected promise here would surface as
    // an unhandled rejection for something as ordinary as the user navigating
    // away mid-sentence.
    utterance.addEventListener('end', () => resolve());
    utterance.addEventListener('error', () => resolve());

    speech.speak(utterance);
  });
}

export function stopSpeaking(): void {
  synth()?.cancel();
}
