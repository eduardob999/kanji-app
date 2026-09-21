import { useEffect, useState } from 'react';
import { pickVoice, stopSpeaking, subscribeVoices, whenVoicesReady } from '../audio/speech';

/**
 * The device's Japanese speech voice, if it has one.
 *
 * Shared by the listening quiz and by the practice screen, which needs the answer
 * for a different reason: it drops listening questions from the mix entirely
 * when there is no voice, rather than letting them come up and fail.
 *
 * `checking` matters — voices load asynchronously, and rendering "no voice"
 * on the first tick would be wrong on every device that has one.
 *
 * **The answer is not final until the screen is gone.** `whenVoicesReady`
 * stops waiting after three seconds so the listening quiz cannot sit on a
 * spinner, and a browser slower than that used to be told "no voice" with
 * nothing to ever correct it: practice then offered three question types
 * instead of four for the rest of the visit, on a phone that can speak. So the
 * `voiceschanged` subscription outlives that first answer, and picks up both a
 * late-arriving list and a voice installed while the app is open.
 *
 * A voice found is never taken away again, even if a later event reports an
 * empty list. Losing it would change which question types are in play, and the
 * only thing that can do to a sitting already under way is restart it.
 */
export interface JapaneseVoice {
  voice: SpeechSynthesisVoice | null;
  checking: boolean;
}

export function useJapaneseVoice(): JapaneseVoice {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let live = true;

    void whenVoicesReady().then((voices) => {
      if (!live) return;
      setVoice((current) => current ?? pickVoice(voices));
      setChecking(false);
    });

    const unsubscribe = subscribeVoices((voices) => {
      if (!live) return;
      const found = pickVoice(voices);
      if (found) setVoice((current) => current ?? found);
    });

    // Leaving the screen mid-sentence should stop the sentence.
    return () => {
      live = false;
      unsubscribe();
      stopSpeaking();
    };
  }, []);

  return { voice, checking };
}
