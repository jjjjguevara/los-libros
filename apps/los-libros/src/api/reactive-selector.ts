/**
 * Redux-Svelte Bridge Utility
 * Converts Redux-like store selectors into Svelte readable stores
 * @module api/reactive-selector
 */

import { readable, type Readable } from 'svelte/store';
import type { Store } from '../helpers/store';

/**
 * Create a Svelte readable store from a Redux-like store with a selector
 *
 * @param store - The Redux-like store to subscribe to
 * @param selector - Function to extract the desired state slice
 * @returns A Svelte readable store that updates when the selected state changes
 *
 * @example
 * ```typescript
 * const booksStore = createReactiveSelector(
 *   libraryStore,
 *   state => state.books
 * );
 *
 * // Use in Svelte component
 * $: books = $booksStore;
 * ```
 */
export function createReactiveSelector<TState, TAction, TSelected>(
  store: Store<TState, TAction>,
  selector: (state: TState) => TSelected
): Readable<TSelected> {
  return readable<TSelected>(selector(store.getValue()), (set) => {
    let previousValue = selector(store.getValue());

    const unsubscribe = store.subscribe((state) => {
      const newValue = selector(state);
      // Only update if the selected value has changed (shallow comparison)
      if (newValue !== previousValue) {
        previousValue = newValue;
        set(newValue);
      }
    });

    return unsubscribe;
  });
}

/**
 * Create a Svelte readable store from an entire Redux-like store
 *
 * @param store - The Redux-like store to wrap
 * @returns A Svelte readable store
 */
export function createReactiveStore<TState, TAction>(
  store: Store<TState, TAction>
): Readable<TState> {
  return createReactiveSelector(store, state => state);
}

/**
 * Create a memoized selector that caches derived values
 *
 * @param store - The Redux-like store to subscribe to
 * @param selector - Function to extract the desired state slice
 * @param equalityFn - Optional custom equality function
 * @returns A Svelte readable store with memoization
 */
export function createMemoizedSelector<TState, TAction, TSelected>(
  store: Store<TState, TAction>,
  selector: (state: TState) => TSelected,
  equalityFn: (a: TSelected, b: TSelected) => boolean = Object.is
): Readable<TSelected> {
  return readable<TSelected>(selector(store.getValue()), (set) => {
    let previousValue = selector(store.getValue());

    const unsubscribe = store.subscribe((state) => {
      const newValue = selector(state);
      if (!equalityFn(newValue, previousValue)) {
        previousValue = newValue;
        set(newValue);
      }
    });

    return unsubscribe;
  });
}

/**
 * Create a selector for array values with shallow array comparison
 * Useful for lists that may be recreated with same values
 */
export function createArraySelector<TState, TAction, TItem>(
  store: Store<TState, TAction>,
  selector: (state: TState) => TItem[]
): Readable<TItem[]> {
  const shallowArrayEqual = (a: TItem[], b: TItem[]): boolean => {
    if (a.length !== b.length) return false;
    return a.every((item, index) => item === b[index]);
  };

  return createMemoizedSelector(store, selector, shallowArrayEqual);
}

/**
 * Combine multiple selectors into a single store
 *
 * @param selectors - Object of selector stores
 * @returns A combined readable store
 */
export function combineSelectors<T extends Record<string, Readable<unknown>>>(
  selectors: T
): Readable<{ [K in keyof T]: T[K] extends Readable<infer U> ? U : never }> {
  const keys = Object.keys(selectors) as (keyof T)[];

  return readable(
    // Initial value
    keys.reduce((acc, key) => {
      let value: unknown;
      selectors[key].subscribe(v => { value = v; })();
      return { ...acc, [key]: value };
    }, {} as { [K in keyof T]: T[K] extends Readable<infer U> ? U : never }),

    // Set function
    (set) => {
      const values: Record<keyof T, unknown> = {} as Record<keyof T, unknown>;
      const unsubscribes: (() => void)[] = [];

      keys.forEach(key => {
        const unsub = selectors[key].subscribe(value => {
          values[key] = value;
          set({ ...values } as { [K in keyof T]: T[K] extends Readable<infer U> ? U : never });
        });
        unsubscribes.push(unsub);
      });

      return () => {
        unsubscribes.forEach(unsub => unsub());
      };
    }
  );
}
