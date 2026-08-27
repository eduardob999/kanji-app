import { useCallback, useEffect, useRef, useState } from 'react';
import {
  coarseClassification,
  extractFeatures,
  fineClassification,
  momentNormalize,
  type Pattern,
  type RefPattern,
} from './handwriting/pipeline';
import { loadPatterns } from './handwriting/patterns';
import type { AnswerInputProps } from './types';

/**
 * Draw the character.
 *
 * The method the CLI's whole workflow was built around — its README said it was
 * "intended to be used along a handwriting japanese input system" — and the only
 * one where writing a kanji from memory stays honest. With the keyboard, typing
 * the reading hands you the character in the IME's candidate list before you
 * have recalled anything.
 *
 * ## How it behaves
 *
 * One character at a time, appended, the way a handwriting IME works — so
 * multi-character words with okurigana can be written. Recognition runs a short
 * moment after the pen lifts rather than on a button, because a button is a tap
 * per character on top of the drawing.
 *
 * ## The escape hatch, and why it is not automatic
 *
 * 205 of this app's 2,211 kanji have no reference pattern — mostly jinmeiyō
 * like 哉 and 麟 — and drawing one produces no useful candidate.
 *
 * The tempting fix is for the quiz to notice the answer is unsupported and
 * switch to the keyboard automatically. That would leak the answer: the input
 * would be behaving differently depending on what the answer is, which is
 * information the learner can read. So instead there is always a plain "type it
 * instead" control, which reveals nothing because it is always there.
 */

/** How long after the pen lifts before the drawing is read. */
const RECOGNISE_DELAY_MS = 450;

/** The canvas is square; this is its internal resolution, not its CSS size. */
const CANVAS_SIZE = 320;

const LINE_WIDTH = 7;

export function HandwritingInput({ value, onChange, onSubmit, disabled }: AnswerInputProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Pattern>([]);
  const drawing = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const [patterns, setPatterns] = useState<RefPattern[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    let live = true;
    loadPatterns().then(
      (loaded) => live && setPatterns(loaded),
      (error: unknown) =>
        live && setLoadError(error instanceof Error ? error.message : 'Could not load patterns.'),
    );
    return () => {
      live = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  const context = () => canvasRef.current?.getContext('2d') ?? null;

  const repaint = useCallback(() => {
    const ctx = context();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // The writing frame: centre lines, as on genkou youshi. Faint enough not to
    // be mistaken for part of what you drew.
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 155, 184, 0.35)';
    ctx.setLineDash([6, 8]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = '#f2f4ff';
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const stroke of strokes.current) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0]![0], stroke[0]![1]);
      for (const [x, y] of stroke.slice(1)) ctx.lineTo(x, y);
      // A single tap is a dot, which lineTo alone would not draw.
      if (stroke.length === 1) ctx.lineTo(stroke[0]![0] + 0.1, stroke[0]![1]);
      ctx.stroke();
    }
  }, []);

  useEffect(repaint, [repaint]);

  const recognise = useCallback(() => {
    if (!patterns || strokes.current.length === 0) {
      setCandidates([]);
      return;
    }

    const features = extractFeatures(momentNormalize(strokes.current), 20.0);
    const coarse = coarseClassification(features, patterns);
    setCandidates(fineClassification(features, coarse, patterns).slice(0, 8));
  }, [patterns]);

  /** Canvas coordinates from a pointer event, accounting for CSS scaling. */
  function pointFrom(event: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * canvas.width,
      ((event.clientY - rect.top) / rect.height) * canvas.height,
    ];
  }

  function startStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    // Capture, so a stroke that leaves the canvas still ends properly rather
    // than staying down for ever.
    event.currentTarget.setPointerCapture(event.pointerId);
    window.clearTimeout(timer.current);
    drawing.current = true;
    strokes.current = [...strokes.current, [pointFrom(event)]];
    repaint();
  }

  function extendStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const current = strokes.current[strokes.current.length - 1];
    if (!current) return;
    current.push(pointFrom(event));
    repaint();
  }

  function endStroke() {
    if (!drawing.current) return;
    drawing.current = false;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(recognise, RECOGNISE_DELAY_MS);
  }

  function clear() {
    strokes.current = [];
    setCandidates([]);
    repaint();
  }

  function undoStroke() {
    strokes.current = strokes.current.slice(0, -1);
    setCandidates([]);
    repaint();
    if (strokes.current.length > 0) window.setTimeout(recognise, 0);
  }

  function accept(character: string) {
    onChange(value + character);
    clear();
  }

  if (typing) {
    return (
      <div className="handwriting">
        <input
          type="text"
          className="textinput textinput--answer"
          lang="ja"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSubmit();
            }
          }}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => setTyping(false)}
        >
          Back to drawing
        </button>
      </div>
    );
  }

  return (
    <div className="handwriting">
      <div className="handwriting__answer" aria-live="polite">
        <span className="handwriting__text" lang="ja">
          {value || <span className="handwriting__placeholder">Draw the characters</span>}
        </span>
        {value ? (
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => onChange(value.slice(0, -1))}
            disabled={disabled}
            aria-label="Delete the last character"
          >
            ⌫
          </button>
        ) : null}
      </div>

      {loadError ? (
        <p className="notice notice--error" role="alert">
          {loadError}
        </p>
      ) : null}

      <canvas
        ref={canvasRef}
        className="handwriting__canvas"
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        onPointerDown={startStroke}
        onPointerMove={extendStroke}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        aria-label="Handwriting canvas"
      />

      <div className="handwriting__candidates" aria-label="Suggestions">
        {patterns === null && !loadError ? (
          <span className="handwriting__hint">Loading characters…</span>
        ) : candidates.length > 0 ? (
          candidates.map((character) => (
            <button
              key={character}
              type="button"
              className="handwriting__candidate"
              lang="ja"
              onClick={() => accept(character)}
              disabled={disabled}
            >
              {character}
            </button>
          ))
        ) : (
          <span className="handwriting__hint">
            {strokes.current.length > 0 ? 'No match — try again, or type it' : 'One character at a time'}
          </span>
        )}
      </div>

      <div className="handwriting__actions">
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={undoStroke}
          disabled={disabled}
        >
          Undo stroke
        </button>
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={clear}
          disabled={disabled}
        >
          Clear
        </button>
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => setTyping(true)}
        >
          Type it instead
        </button>
      </div>

      {/* Required by the MIT terms these patterns ship under. */}
      <p className="handwriting__credit">
        Recognition by <a href="https://github.com/asdfjkl/kanjicanvas">Kanji Canvas</a> (MIT), from{' '}
        <a href="https://kanjivg.tagaini.net/">KanjiVG</a> (CC BY-SA 3.0).
      </p>
    </div>
  );
}
