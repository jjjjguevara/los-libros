/**
 * Disposable pattern implementation
 * @module api/disposable
 */

import type { Disposable } from './types';

/**
 * Create a disposable from a cleanup function
 */
export function createDisposable(dispose: () => void): Disposable {
  let disposed = false;
  return {
    dispose: () => {
      if (!disposed) {
        disposed = true;
        dispose();
      }
    }
  };
}

/**
 * Combine multiple disposables into one
 */
export function combineDisposables(...disposables: Disposable[]): Disposable {
  return createDisposable(() => {
    disposables.forEach(d => d.dispose());
  });
}

/**
 * A container that manages multiple disposables
 */
export class DisposableStore implements Disposable {
  private disposables: Set<Disposable> = new Set();
  private disposed = false;

  /**
   * Add a disposable to the store
   */
  add<T extends Disposable>(disposable: T): T {
    if (this.disposed) {
      disposable.dispose();
      return disposable;
    }
    this.disposables.add(disposable);
    return disposable;
  }

  /**
   * Remove a disposable from the store (does not dispose it)
   */
  remove(disposable: Disposable): void {
    this.disposables.delete(disposable);
  }

  /**
   * Dispose all stored disposables
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposables.forEach(d => d.dispose());
    this.disposables.clear();
  }

  /**
   * Clear all disposables without disposing them
   */
  clear(): void {
    this.disposables.clear();
  }

  /**
   * Check if the store has been disposed
   */
  get isDisposed(): boolean {
    return this.disposed;
  }
}
