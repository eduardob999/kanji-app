/**
 * Stroke point sequences for characters Kanji Canvas does not cover.
 *
 * Kanji Canvas ships 2,006 reference patterns and this corpus wants 2,211; the
 * 205 it lacks are mostly jinmeiyō — 哉, 舜, 慧, 麟 — the characters that turn up
 * in names. Handwriting fell back to the keyboard for every one of them.
 *
 * The patterns were generated from a digitised point dataset the project does
 * not publish (`read_all.py` reads `<stroke><point x= y=>` XML from a directory
 * that is not in the repository), so there is no way to add characters through
 * the same door. KanjiVG — which Kanji Canvas itself derives from — publishes
 * the same strokes as SVG paths, in stroke order and stroke direction, which is
 * the whole point of the project.
 *
 * **Why paths are as good as points.** `extractFeatures` resamples a stroke at
 * fixed arc-length intervals, so what it produces depends on the *shape* of the
 * stroke and not on how densely the shape was sampled to begin with. Flatten a
 * Bézier finely enough and the features are the ones the digitised points would
 * have given. `build-strokes.mjs` checks that claim rather than assuming it: it
 * regenerates characters Kanji Canvas *does* cover and confirms the recogniser
 * still ranks them first.
 *
 * KanjiVG draws on a 109x109 canvas. Nothing here rescales, because
 * `momentNormalize` centres by moments and scales by variance — it maps any
 * input box onto 256 regardless.
 */

/** Fine enough that arc-length resampling cannot tell it from a curve. */
const SAMPLE_EVERY = 0.8;

function tokenise(d) {
  const tokens = [];
  const pattern = /([MmCcSs])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let match;
  while ((match = pattern.exec(d)) !== null) {
    tokens.push(match[1] ?? Number(match[2]));
  }
  return tokens;
}

function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * One `d` attribute to a dense point sequence.
 *
 * KanjiVG uses only M, C and S, in both cases — verified across the whole file
 * rather than assumed — so this handles those and throws on anything else
 * rather than silently dropping part of a stroke.
 */
export function flattenPath(d) {
  const tokens = tokenise(d);
  const points = [];

  let x = 0;
  let y = 0;
  // The reflected control point that makes S a shorthand for C.
  let lastControlX = null;
  let lastControlY = null;
  let command = null;
  let i = 0;

  const emit = (px, py) => {
    const last = points[points.length - 1];
    if (!last || Math.abs(last[0] - px) > 1e-9 || Math.abs(last[1] - py) > 1e-9) {
      points.push([px, py]);
    }
  };

  const curveTo = (x1, y1, x2, y2, x3, y3) => {
    // Steps from the control polygon's length: an upper bound on the arc, which
    // is the safe direction to be wrong in.
    const span =
      Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
    const steps = Math.max(4, Math.ceil(span / SAMPLE_EVERY));

    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      emit(cubicAt(x, x1, x2, x3, t), cubicAt(y, y1, y2, y3, t));
    }

    lastControlX = x2;
    lastControlY = y2;
    x = x3;
    y = y3;
  };

  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') {
      command = tokens[i];
      i += 1;
    }

    switch (command) {
      case 'M':
      case 'm': {
        const [dx, dy] = [tokens[i], tokens[i + 1]];
        i += 2;
        x = command === 'M' ? dx : x + dx;
        y = command === 'M' ? dy : y + dy;
        lastControlX = null;
        lastControlY = null;
        emit(x, y);
        // A second coordinate pair after M is an implicit lineto, which
        // KanjiVG does not use; treating it as one keeps this honest anyway.
        command = command === 'M' ? 'L' : 'l';
        break;
      }
      case 'L':
      case 'l': {
        const [dx, dy] = [tokens[i], tokens[i + 1]];
        i += 2;
        x = command === 'L' ? dx : x + dx;
        y = command === 'L' ? dy : y + dy;
        emit(x, y);
        break;
      }
      case 'C':
      case 'c': {
        const rel = command === 'c';
        const [a, b, c, e, f, g] = tokens.slice(i, i + 6);
        i += 6;
        curveTo(
          rel ? x + a : a,
          rel ? y + b : b,
          rel ? x + c : c,
          rel ? y + e : e,
          rel ? x + f : f,
          rel ? y + g : g,
        );
        break;
      }
      case 'S':
      case 's': {
        const rel = command === 's';
        const [c, e, f, g] = tokens.slice(i, i + 4);
        i += 4;
        // S reflects the previous curve's second control point about the
        // current point; with no previous curve the control point is the
        // current point itself.
        const x1 = lastControlX === null ? x : 2 * x - lastControlX;
        const y1 = lastControlY === null ? y : 2 * y - lastControlY;
        curveTo(x1, y1, rel ? x + c : c, rel ? y + e : e, rel ? x + f : f, rel ? y + g : g);
        break;
      }
      default:
        throw new Error(`Unsupported path command "${command}" in: ${d.slice(0, 60)}`);
    }
  }

  return points;
}

/**
 * Every character in the KanjiVG dump, as ordered stroke point sequences.
 *
 * Streamed by regex rather than parsed as a DOM: the file is 30 MB of XML and
 * the only structure that matters is "a kanji block, and the `d` attributes
 * inside it in document order", which is exactly what KanjiVG guarantees is
 * stroke order.
 */
export function readKanjiVG(xml, wanted) {
  const out = new Map();
  const blocks = xml.split('<kanji id="kvg:kanji_');

  for (const block of blocks.slice(1)) {
    const code = block.slice(0, block.indexOf('"'));
    // Variant forms are suffixed (04e1e-Kaisho, and the like); this app wants
    // the standard glyph only.
    if (!/^[0-9a-f]+$/i.test(code)) continue;

    const character = String.fromCodePoint(Number.parseInt(code, 16));
    if (wanted && !wanted.has(character)) continue;

    const strokes = [];
    for (const match of block.matchAll(/<path[^>]* d="([^"]+)"/g)) {
      const points = flattenPath(match[1]);
      if (points.length > 1) strokes.push(points);
    }

    if (strokes.length > 0) out.set(character, strokes);
  }

  return out;
}
