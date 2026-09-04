import { useEffect, useState } from 'react';
import { pickVoice, stopSpeaking, whenVoicesReady } from '../audio/speech';

/**
 * The device's Japanese speech voice, if it has one.
 *
 * Shared by the listening quiz and by the practice screen, which needs the answer
 * for a different reason: it drops listening questions from the mix entirely
 * when there is no voice, rather than letting them come up and fail.
 *
 * `checking` matters — voices load asynchronously, and rendering "no voice"
 * on the first tick would be wrong on every device that has one.
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
      setVoice(pickVoice(voices));
      setChecking(false);
    });

    // Leaving the screen mid-sentence should stop the sentence.
    return () => {
      live = false;
      stopSpeaking();
    };
  }, []);

  return { voice, checking };
}
