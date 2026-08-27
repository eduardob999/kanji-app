import type { RefPattern } from './pipeline';

/**
 * The reference patterns, fetched when handwriting is first used.
 *
 * 1.46 MB for the kanji and kana together, which is why this is lazy and why
 * `vite.config.ts` deliberately leaves `strokes/` out of the precache list:
 * someone who never turns handwriting on never downloads it. The service
 * worker's ordinary asset handling caches it on first fetch, so it is
 * downloaded once and available offline afterwards.
 *
 * Both files load together. Splitting them by JLPT level was the original plan
 * and it does not work — a vocabulary word draws its characters from wherever
 * they come from, so writing 毎月 while studying N5 needs patterns that are not
 * in the N5 set.
 */

interface PatternFile {
  source: string;
  licence: string;
  count: number;
  patterns: RefPattern[];
}

function strokesUrl(name: string): string {
  return new URL(
    `strokes/${name}`,
    new URL(import.meta.env.BASE_URL, window.location.href),
  ).toString();
}

let pending: Promise<RefPattern[]> | null = null;

async function fetchFile(name: string): Promise<RefPattern[]> {
  const response = await fetch(strokesUrl(name));
  if (!response.ok) {
    throw new Error(`Could not load handwriting patterns (${response.status}).`);
  }
  const file = (await response.json()) as PatternFile;
  return file.patterns;
}

/**
 * Every pattern the recogniser matches against, kanji and kana.
 *
 * Cached for the lifetime of the page. A failure is not cached, so going from
 * offline to online can recover without a reload.
 */
export function loadPatterns(): Promise<RefPattern[]> {
  pending ??= Promise.all([fetchFile('kanji.json'), fetchFile('kana.json')])
    .then(([kanji, kana]) => [...kanji, ...kana])
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });

  return pending;
}
