import { useEffect, useState } from 'react';
import { loadDeck, loadDeckIndex } from '../domain/decks';
import type { Deck, DeckIndex, DeckType, Level, StudyItem } from '../domain/items';

export interface AsyncValue<T> {
  value: T | null;
  loading: boolean;
  error: string | null;
}

const PENDING = { value: null, loading: true, error: null } as const;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong loading the decks.';
}

export function useDeckIndex(): AsyncValue<DeckIndex> {
  const [state, setState] = useState<AsyncValue<DeckIndex>>(PENDING);

  useEffect(() => {
    let live = true;
    setState(PENDING);

    loadDeckIndex().then(
      (value) => live && setState({ value, loading: false, error: null }),
      (error: unknown) => live && setState({ value: null, loading: false, error: describe(error) }),
    );

    return () => {
      live = false;
    };
  }, []);

  return state;
}

/**
 * One deck, loaded on demand.
 *
 * The `live` flag is doing real work here rather than guarding against a
 * theoretical race: switching level twice quickly is one tap away in Browse,
 * and without it the slower fetch can land last and show the wrong deck.
 */
export function useDeck<T extends StudyItem = StudyItem>(
  type: DeckType,
  level: Level,
): AsyncValue<Deck<T>> {
  const [state, setState] = useState<AsyncValue<Deck<T>>>(PENDING);

  useEffect(() => {
    let live = true;
    setState(PENDING);

    loadDeck<T>(type, level).then(
      (value) => live && setState({ value, loading: false, error: null }),
      (error: unknown) => live && setState({ value: null, loading: false, error: describe(error) }),
    );

    return () => {
      live = false;
    };
  }, [type, level]);

  return state;
}
