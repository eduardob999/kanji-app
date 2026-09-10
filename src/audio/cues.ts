/**
 * The small sounds an answer makes.
 *
 * A game gives you a sound when you get something right, and it is not
 * decoration: it closes the loop faster than reading a word does, and it is
 * what makes ten minutes of drilling feel like ten minutes of playing. Kanjiba
 * had none.
 *
 * **Synthesised rather than shipped.** Three oscillators and an envelope are a
 * few hundred bytes of code against tens of kilobytes of audio files that would
 * have to be fetched, decoded, cached by the service worker and kept in sync
 * with it. Nothing to download means nothing to be missing on a train, which is
 * the same reason the sentences ship in the build.
 *
 * The palette is deliberately small and deliberately quiet:
 *
 *   correct  two notes up a major third, short. The interval is the point —
 *            rising reads as "yes" in a way a single beep does not.
 *   wrong    one note, lower, softer, and *not* dissonant. A harsh buzzer
 *            punishes; this is meant to be information, and the item is coming
 *            back in two hours either way.
 *   finish   a three-note arpeggio, the only cue allowed to be pleased with
 *            itself, and it happens once a round rather than once a question.
 *
 * Everything is a sine with a fast attack and a short decay, which is what
 * keeps them from sounding like a 1980s alarm clock. Total added weight: none.
 */
import { isSpeaking } from './speech';

/** What a cue is for. */
export type Cue = 'correct' | 'wrong' | 'finish';

interface Note {
  /** Hertz. */
  hz: number;
  /** Seconds from the start of the cue. */
  at: number;
  /** Seconds. */
  hold: number;
  /** Peak gain, 0-1. Cues are quiet: the loudest is 0.14. */
  gain: number;
}

/**
 * The cues, as notes.
 *
 * C6 and E6 for correct, an octave-and-a-bit down for wrong, and a C major
 * arpeggio to finish. Written as data because a tuning argument should be a
 * diff to a table rather than a rewrite of a function.
 */
const SCORE: Record<Cue, Note[]> = {
  correct: [
    { hz: 1046.5, at: 0, hold: 0.075, gain: 0.12 },
    { hz: 1318.5, at: 0.07, hold: 0.11, gain: 0.12 },
  ],
  wrong: [
    { hz: 349.2, at: 0, hold: 0.1, gain: 0.1 },
    { hz: 293.7, at: 0.09, hold: 0.16, gain: 0.09 },
  ],
  finish: [
    { hz: 523.3, at: 0, hold: 0.09, gain: 0.11 },
    { hz: 659.3, at: 0.09, hold: 0.09, gain: 0.11 },
    { hz: 784.0, at: 0.18, hold: 0.22, gain: 0.14 },
  ],
};

export interface CueConditions {
  /** The learner's setting. */
  enabled: boolean;
  /** A silent screen: the bus, the library, the shared room. */
  silent: boolean;
  /** Something is being read aloud right now. */
  speaking: boolean;
}

/**
 * Whether a cue may be played, as a decision separate from playing it.
 *
 * Pure so the rules can be argued about in a test rather than in a browser.
 * Two of the three are easy to get wrong:
 *
 * - **Silent mode means silent.** It exists for a room where sound is not
 *   allowed, and a learner who chose it did not choose "no Japanese, but
 *   chimes". Cues follow speech out of the room.
 * - **Never over speech.** A listening question is a sound; a cue landing on
 *   top of it is a question made harder by the app's own decoration. Speech
 *   wins, and the cue is dropped rather than queued — a "correct" that arrives
 *   two seconds late is worse than none.
 */
export function shouldPlayCue({ enabled, silent, speaking }: CueConditions): boolean {
  return enabled && !silent && !speaking;
}

/*
 * One context for the app, created on first use.
 *
 * Browsers refuse to start an AudioContext outside a user gesture, and the
 * first cue always follows one — an answer is a tap or a keypress. A context
 * created eagerly at import time would be born `suspended` and stay that way
 * on some browsers, so it is created late and resumed if it needs it.
 */
let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  if (!context) {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch {
      // A browser that refuses to make one is a browser that gets no cues.
      return null;
    }
  }

  if (context.state === 'suspended') void context.resume().catch(() => {});
  return context;
}

/**
 * Plays one cue, if the conditions allow it.
 *
 * Never throws and never awaits: this is called from the middle of grading an
 * answer, and nothing about a sound may delay the next question or take the
 * screen down with it.
 */
export function playCue(cue: Cue, conditions: Omit<CueConditions, 'speaking'>): void {
  if (!shouldPlayCue({ ...conditions, speaking: isSpeaking() })) return;

  const ctx = audio();
  if (!ctx) return;

  const start = ctx.currentTime;

  for (const note of SCORE[cue]) {
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = note.hz;

    /*
     * An envelope, because a bare oscillator switched on and off clicks: the
     * waveform jumps from silence to full amplitude in one sample and the step
     * is audible. 8ms in and an exponential tail out is the shortest shape that
     * does not.
     */
    const from = start + note.at;
    envelope.gain.setValueAtTime(0.0001, from);
    envelope.gain.exponentialRampToValueAtTime(note.gain, from + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, from + note.hold);

    oscillator.connect(envelope).connect(ctx.destination);
    oscillator.start(from);
    oscillator.stop(from + note.hold + 0.02);
  }
}
