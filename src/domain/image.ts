/**
 * Turning a photograph from someone's camera roll into something an app can
 * carry around.
 *
 * A modern phone photo is 3-8 MB and 4000px wide. What this app needs is a
 * backdrop behind a card on a screen 400 CSS pixels across, which is two orders
 * of magnitude less data — and the difference matters more here than it usually
 * would, because the image is stored in Firestore (a 1 MB ceiling per document,
 * synced to every device, and cached offline) rather than in a bucket somewhere.
 *
 * So it is resized and re-encoded before it goes anywhere near the network, and
 * the quality is chosen by measurement rather than by hope: encode, look at the
 * size, drop the quality, encode again. Three or four passes at most, all of it
 * in the browser and none of it on the main thread's critical path.
 */

/** The long edge, in device pixels. Enough for a phone at 3x and a laptop. */
export const MAX_EDGE = 1440;

/**
 * What a stored background may weigh, encoded.
 *
 * Firestore's limit is 1 MB per document and a data URL is base64, which costs
 * a third on top — so 600 kB of JPEG is 800 kB of field and the document has
 * room for its own metadata. It is also, on a phone, about a second of a bad
 * connection: this syncs to every device the learner signs in on.
 */
export const MAX_BYTES = 600_000;

const QUALITIES = [0.82, 0.7, 0.58, 0.45, 0.35];

/** Roughly how many bytes a data URL's base64 payload decodes to. */
export function decodedSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

/** The size to draw at: the long edge capped, the aspect ratio kept. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): {
  width: number;
  height: number;
} {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };

  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * A file from the camera roll, as a JPEG data URL inside the budget.
 *
 * JPEG rather than WebP for one unglamorous reason: `canvas.toDataURL` falls
 * back to PNG when it does not know a format, silently, and a PNG of a
 * photograph is several megabytes. Asking for something every browser has
 * encoded since 2010 avoids finding that out from a failed write.
 *
 * Throws when even the lowest quality is too large, which for a 1440px JPEG
 * means an image of pure noise. The caller says so rather than storing
 * something that will not fit.
 */
export async function toStoredImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot resize images.');

  // `high` matters at this ratio: the default filtering of a 4000px photo down
  // to 1440 aliases visibly on anything with fine texture, which a background
  // photograph usually is.
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  for (const quality of QUALITIES) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (decodedSize(dataUrl) <= MAX_BYTES) return dataUrl;
  }

  throw new Error('That image is too detailed to store, even compressed. Try another.');
}
