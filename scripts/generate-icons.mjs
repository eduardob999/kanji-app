/**
 * Generates the PWA icon set — no image tooling, no binary blobs in git.
 *
 * A 十 inside a writing frame, which is about as much kanji as can be drawn
 * with axis-aligned rectangles and still read at 48 pixels. Deliberately not a
 * glyph rendered from a font: that would mean shipping a CJK font or depending
 * on whatever the build machine happens to have installed, and the two produce
 * different icons.
 *
 * These are real, valid PNGs at the right sizes, so the manifest passes install
 * checks today. Replace public/icons/* with proper artwork when you have it,
 * keeping the same filenames and sizes, or edit the drawing below and re-run
 * `npm run icons`.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');

/** Rendering happens at 3x and is averaged down, which stands in for anti-aliasing. */
const SUPERSAMPLE = 3;

const COLOURS = {
  background: [18, 19, 31],
  /** The writing frame, as on genkou youshi manuscript paper. */
  frame: [58, 62, 96],
  stroke: [91, 110, 225],
};

// PNG encoding ---------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typeBytes = Buffer.from(type, 'ascii');

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));

  return Buffer.concat([length, typeBytes, data, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlacing

  // Each scanline is prefixed with filter type 0 (none).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Drawing --------------------------------------------------------------------

function createCanvas(size) {
  return { size, data: Buffer.alloc(size * size * 4) };
}

function setPixel(canvas, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const offset = (y * canvas.size + x) * 4;
  canvas.data[offset] = r;
  canvas.data[offset + 1] = g;
  canvas.data[offset + 2] = b;
  canvas.data[offset + 3] = 255;
}

function fillRect(canvas, x, y, width, height, colour) {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const x1 = Math.round(x + width);
  const y1 = Math.round(y + height);

  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      setPixel(canvas, px, py, colour);
    }
  }
}

/**
 * A writing frame with 十 in it.
 *
 * `contentScale` is the fraction of the canvas the frame occupies. Maskable
 * icons pass a smaller value so the drawing survives an aggressive circular
 * crop.
 */
function drawIcon(size, contentScale) {
  const canvas = createCanvas(size);
  fillRect(canvas, 0, 0, size, size, COLOURS.background);

  const box = size * contentScale;
  const x0 = (size - box) / 2;
  const y0 = (size - box) / 2;

  // The frame, drawn as four bars rather than a filled square over the
  // background, so the icon stays correct if the background ever goes
  // transparent.
  const rule = Math.max(1, size * 0.022);
  fillRect(canvas, x0, y0, box, rule, COLOURS.frame);
  fillRect(canvas, x0, y0 + box - rule, box, rule, COLOURS.frame);
  fillRect(canvas, x0, y0, rule, box, COLOURS.frame);
  fillRect(canvas, x0 + box - rule, y0, rule, box, COLOURS.frame);

  // 十. The horizontal sits above the midpoint and the vertical is the longer
  // of the two — centre the crossing and even the lengths up, and it stops
  // being a character and becomes a plus sign.
  const weight = box * 0.12;
  const horizontal = box * 0.72;
  const vertical = box * 0.74;
  const crossY = y0 + box * 0.45;

  fillRect(
    canvas,
    x0 + (box - horizontal) / 2,
    crossY - weight / 2,
    horizontal,
    weight,
    COLOURS.stroke,
  );
  fillRect(
    canvas,
    x0 + box / 2 - weight / 2,
    y0 + (box - vertical) / 2,
    weight,
    vertical,
    COLOURS.stroke,
  );

  return canvas;
}

function downsample(canvas, targetSize) {
  const factor = canvas.size / targetSize;
  const out = createCanvas(targetSize);

  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;

      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const offset = ((y * factor + sy) * canvas.size + (x * factor + sx)) * 4;
          r += canvas.data[offset];
          g += canvas.data[offset + 1];
          b += canvas.data[offset + 2];
        }
      }

      const samples = factor * factor;
      setPixel(out, x, y, [
        Math.round(r / samples),
        Math.round(g / samples),
        Math.round(b / samples),
      ]);
    }
  }

  return out;
}

function writeIcon(filename, size, contentScale) {
  const rendered = drawIcon(size * SUPERSAMPLE, contentScale);
  const final = downsample(rendered, size);
  const path = resolve(OUT_DIR, filename);

  writeFileSync(path, encodePng(size, final.data));
  console.log(`  ${filename}  (${size}x${size})`);
}

mkdirSync(OUT_DIR, { recursive: true });

console.log('Generating icons in public/icons:');
writeIcon('icon-192.png', 192, 0.78);
writeIcon('icon-512.png', 512, 0.78);
// Maskable icons get cropped to a circle inscribed in the middle 80%, so the
// drawing is pulled well inside that.
writeIcon('maskable-512.png', 512, 0.52);
writeIcon('apple-touch-icon.png', 180, 0.78);
console.log('Done. Replace these with real artwork when you have it.');
