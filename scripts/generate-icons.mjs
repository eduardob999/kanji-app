/**
 * Builds the PWA icon set from `data/icon-source.png`.
 *
 * Run with `npm run icons`. Replaces an earlier version that drew 十 out of
 * rectangles because there was no artwork; there is now.
 *
 * ## No image library
 *
 * There is no `sharp`, no ImageMagick and no PIL here, and adding a native
 * dependency for four resizes that run once in a blue moon is a poor trade. So
 * this decodes the PNG, resamples it and encodes the results itself. Node
 * supplies the only hard part, zlib; the rest is scanline filtering and a box
 * filter.
 *
 * The source is 214x200 — not square, and icons must be. It is padded with its
 * own background colour, sampled from the corners rather than assumed, so the
 * padding is invisible.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'data/icon-source.png');
const OUT_DIR = resolve(ROOT, 'public/icons');

/* --- PNG decoding --------------------------------------------------------- */

/**
 * Decodes an 8-bit PNG to RGBA.
 *
 * Handles the five scanline filters, which is the whole of the format once the
 * IDAT chunks are inflated. Interlaced and 16-bit files are rejected rather
 * than half-supported — this reads one known file.
 */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG.');

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const depth = buffer[24];
  const colourType = buffer[25];
  const interlace = buffer[28];

  if (depth !== 8) throw new Error(`Only 8-bit PNGs are supported (got ${depth}).`);
  if (interlace !== 0) throw new Error('Interlaced PNGs are not supported.');

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error(`Unsupported colour type ${colourType}.`);

  const idat = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const tag = buffer.toString('ascii', offset + 4, offset + 8);
    if (tag === 'IDAT') idat.push(buffer.subarray(offset + 8, offset + 8 + length));
    if (tag === 'IEND') break;
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);

  let previous = Buffer.alloc(stride);
  let read = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    const line = Buffer.from(raw.subarray(read, read + stride));
    read += stride;

    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? line[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      let value = line[i];

      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        // Paeth: pick whichever neighbour the gradient predictor is closest to.
        const predicted = left + up - upLeft;
        const dLeft = Math.abs(predicted - left);
        const dUp = Math.abs(predicted - up);
        const dUpLeft = Math.abs(predicted - upLeft);
        value += dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
      }

      line[i] = value & 0xff;
    }

    previous = line;

    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      if (channels >= 3) {
        rgba[to] = line[from];
        rgba[to + 1] = line[from + 1];
        rgba[to + 2] = line[from + 2];
        rgba[to + 3] = channels === 4 ? line[from + 3] : 255;
      } else {
        rgba[to] = line[from];
        rgba[to + 1] = line[from];
        rgba[to + 2] = line[from];
        rgba[to + 3] = channels === 2 ? line[from + 1] : 255;
      }
    }
  }

  return { width, height, data: rgba };
}

/* --- PNG encoding --------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
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
  header[8] = 8;
  header[9] = 6;

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

/* --- Resampling ----------------------------------------------------------- */

/** The paper colour, taken from the corners rather than assumed. */
function backgroundOf(image) {
  const { width, height, data } = image;
  const corners = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3],
  ];

  const sum = [0, 0, 0];
  for (const [x, y] of corners) {
    const at = (y * width + x) * 4;
    sum[0] += data[at];
    sum[1] += data[at + 1];
    sum[2] += data[at + 2];
  }

  return sum.map((total) => Math.round(total / corners.length));
}

/** Pads to a square of `side`, centring the artwork on the paper colour. */
function pad(image, side, background) {
  const out = Buffer.alloc(side * side * 4);
  for (let i = 0; i < side * side; i += 1) {
    out[i * 4] = background[0];
    out[i * 4 + 1] = background[1];
    out[i * 4 + 2] = background[2];
    out[i * 4 + 3] = 255;
  }

  const offsetX = Math.round((side - image.width) / 2);
  const offsetY = Math.round((side - image.height) / 2);

  for (let y = 0; y < image.height; y += 1) {
    const targetY = y + offsetY;
    if (targetY < 0 || targetY >= side) continue;
    for (let x = 0; x < image.width; x += 1) {
      const targetX = x + offsetX;
      if (targetX < 0 || targetX >= side) continue;

      const from = (y * image.width + x) * 4;
      const to = (targetY * side + targetX) * 4;
      // Composite over the paper, so a source with transparency does not punch
      // holes in the icon.
      const alpha = image.data[from + 3] / 255;
      for (let c = 0; c < 3; c += 1) {
        out[to + c] = Math.round(image.data[from + c] * alpha + background[c] * (1 - alpha));
      }
      out[to + 3] = 255;
    }
  }

  return { width: side, height: side, data: out };
}

/**
 * Box-filter resample.
 *
 * Averaging every source pixel that falls inside a destination pixel, rather
 * than picking the nearest one. Brush strokes taper to a hair at the ends and
 * nearest-neighbour drops those entirely, which at 192px turns a brushed 漢
 * into a broken one.
 */
function resample(image, side) {
  const out = Buffer.alloc(side * side * 4);
  const scaleX = image.width / side;
  const scaleY = image.height / side;

  for (let y = 0; y < side; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scaleY));

    for (let x = 0; x < side; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scaleX));

      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;

      for (let sy = y0; sy < Math.min(y1, image.height); sy += 1) {
        for (let sx = x0; sx < Math.min(x1, image.width); sx += 1) {
          const at = (sy * image.width + sx) * 4;
          r += image.data[at];
          g += image.data[at + 1];
          b += image.data[at + 2];
          n += 1;
        }
      }

      const to = (y * side + x) * 4;
      out[to] = Math.round(r / n);
      out[to + 1] = Math.round(g / n);
      out[to + 2] = Math.round(b / n);
      out[to + 3] = 255;
    }
  }

  return { width: side, height: side, data: out };
}

/* --- Build ---------------------------------------------------------------- */

const source = decodePng(readFileSync(SOURCE));
const background = backgroundOf(source);
const hex = `#${background.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

// Square first, at the source's own resolution, then down to each target. The
// artwork already carries its own margin, so `any` icons use it as-is.
const square = pad(source, Math.max(source.width, source.height), background);

/**
 * Maskable icons are cropped to a circle inscribed in the middle 80%, and
 * anything in the corners is liable to be cut. The artwork is scaled into the
 * middle and the rest is paper.
 */
function maskable(side, contentScale) {
  const inner = resample(square, Math.round(side * contentScale));
  return pad(inner, side, background);
}

mkdirSync(OUT_DIR, { recursive: true });

console.log(`Source ${source.width}x${source.height}, paper ${hex}`);

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(resolve(OUT_DIR, name), encodePng(size, resample(square, size).data));
  console.log(`  ${name.padEnd(22)} ${size}x${size}`);
}

writeFileSync(resolve(OUT_DIR, 'maskable-512.png'), encodePng(512, maskable(512, 0.68).data));
console.log(`  ${'maskable-512.png'.padEnd(22)} 512x512  (inset for the safe zone)`);

console.log(`\nPaper colour ${hex} — keep the manifest and theme-color in step with it.`);
