import { afterEach, describe, expect, it } from 'vitest';
import { pickVoice, subscribeVoices } from './speech';

/**
 * The half of `speech.ts` that decides *whether there is anything to listen
 * with*, which is the half the practice screen reads.
 *
 * Speaking itself is not tested here: it is `SpeechSynthesisUtterance` plus a
 * browser that may decline, and a fake of that tests the fake. Choosing a voice
 * and noticing that the list changed are decisions, and they are what went
 * wrong — a device with a Japanese voice was told it had none, and nothing ever
 * looked again.
 */

type Listener = () => void;

/** Just enough `speechSynthesis` to answer "which voices, and tell me when." */
function fakeSpeech(voices: SpeechSynthesisVoice[]) {
  const listeners = new Set<Listener>();

  return {
    speech: {
      getVoices: () => voices,
      addEventListener: (type: string, listener: Listener) => {
        if (type === 'voiceschanged') listeners.add(listener);
      },
      removeEventListener: (type: string, listener: Listener) => {
        if (type === 'voiceschanged') listeners.delete(listener);
      },
    },
    /** What a browser does when its engine finally binds, or a voice is installed. */
    announce(next: SpeechSynthesisVoice[]) {
      voices = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

function voice(lang: string, name: string, localService = true): SpeechSynthesisVoice {
  return { lang, name, localService, default: false, voiceURI: name } as SpeechSynthesisVoice;
}

/** No argument means a browser with no speech synthesis at all. */
function install(speech?: unknown): void {
  (globalThis as { window?: unknown }).window =
    speech === undefined ? {} : { speechSynthesis: speech };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('pickVoice', () => {
  it('prefers a voice that lives on the device', () => {
    const network = voice('ja-JP', 'Google 日本語', false);
    const local = voice('ja-JP', 'Kyoko');

    expect(pickVoice([network, local])).toBe(local);
  });

  it('takes a network voice rather than refusing', () => {
    const network = voice('ja-JP', 'Google 日本語', false);

    expect(pickVoice([network])).toBe(network);
  });

  it('has nothing to say when there is nothing installed', () => {
    expect(pickVoice([])).toBeNull();
  });
});

describe('subscribeVoices', () => {
  it('reports a Japanese voice that arrives after the screen gave up waiting', () => {
    /*
     * The bug this exists for. `whenVoicesReady` stops waiting after three
     * seconds so the listening quiz cannot sit on a spinner, and a phone still
     * waking its speech engine answers later than that. Nothing revisited the
     * answer, so practice offered three question types instead of four for the
     * rest of the visit on a device that speaks Japanese perfectly well.
     */
    const { speech, announce } = fakeSpeech([]);
    install(speech);

    const seen: SpeechSynthesisVoice[][] = [];
    const stop = subscribeVoices((voices) => seen.push(voices));

    const kyoko = voice('ja-JP', 'Kyoko');
    announce([voice('en-US', 'Samantha'), kyoko]);

    // Japanese only: the English voice on every device is not an answer.
    expect(seen).toEqual([[kyoko]]);
    stop();
  });

  it('stops reporting once the screen is gone', () => {
    const { speech, announce } = fakeSpeech([]);
    install(speech);

    let calls = 0;
    const stop = subscribeVoices(() => (calls += 1));
    stop();
    announce([voice('ja-JP', 'Kyoko')]);

    expect(calls).toBe(0);
  });

  it('unsubscribes harmlessly where there is no speech at all', () => {
    install();

    expect(() => subscribeVoices(() => undefined)()).not.toThrow();
  });
});
