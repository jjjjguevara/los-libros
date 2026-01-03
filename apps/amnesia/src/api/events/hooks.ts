/**
 * Hook System Implementation
 * Allows intercepting and cancelling operations
 * @module api/events/hooks
 */

import type { Disposable, HookContexts, HookMap } from '../types';
import { createDisposable } from '../disposable';

type HookHandler<K extends keyof HookContexts> = (context: HookContexts[K]) => Promise<boolean>;

/**
 * Hook registry for the Amnesia API
 * Hooks execute sequentially; if any returns false, the operation is cancelled
 */
export class HookRegistry {
  private hooks: Map<keyof HookContexts, HookHandler<keyof HookContexts>[]> = new Map();

  /**
   * Register a hook handler
   * @param hook - Hook name
   * @param handler - Hook handler that returns true to continue, false to cancel
   * @returns Disposable to unregister
   */
  register<K extends keyof HookMap>(
    hook: K,
    handler: HookMap[K]
  ): Disposable {
    if (!this.hooks.has(hook)) {
      this.hooks.set(hook, []);
    }
    this.hooks.get(hook)!.push(handler as HookHandler<keyof HookContexts>);

    return createDisposable(() => {
      this.unregister(hook, handler);
    });
  }

  /**
   * Unregister a hook handler
   * @param hook - Hook name
   * @param handler - Hook handler to remove
   */
  unregister<K extends keyof HookMap>(
    hook: K,
    handler: HookMap[K]
  ): void {
    const handlers = this.hooks.get(hook);
    if (handlers) {
      const index = handlers.indexOf(handler as HookHandler<keyof HookContexts>);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
      if (handlers.length === 0) {
        this.hooks.delete(hook);
      }
    }
  }

  /**
   * Execute all handlers for a hook sequentially
   * @param hook - Hook name
   * @param context - Hook context
   * @returns True if all handlers allowed the operation, false if any cancelled
   */
  async execute<K extends keyof HookContexts>(
    hook: K,
    context: HookContexts[K]
  ): Promise<boolean> {
    const handlers = this.hooks.get(hook);
    if (!handlers || handlers.length === 0) {
      return true; // No handlers, operation allowed
    }

    for (const handler of handlers) {
      try {
        const result = await (handler as HookHandler<K>)(context);
        if (result === false) {
          console.log(`[Amnesia] Hook '${String(hook)}' cancelled operation`);
          return false;
        }
      } catch (error) {
        console.error(`[Amnesia] Error in hook handler for '${String(hook)}':`, error);
        // Continue to next handler on error (don't cancel)
      }
    }

    return true;
  }

  /**
   * Check if there are any handlers for a hook
   * @param hook - Hook name
   * @returns True if there are handlers
   */
  hasHandlers<K extends keyof HookContexts>(hook: K): boolean {
    const handlers = this.hooks.get(hook);
    return (handlers?.length ?? 0) > 0;
  }

  /**
   * Get the number of handlers for a hook
   * @param hook - Hook name
   * @returns Number of handlers
   */
  handlerCount<K extends keyof HookContexts>(hook: K): number {
    return this.hooks.get(hook)?.length ?? 0;
  }

  /**
   * Remove all handlers for a hook, or all handlers if no hook specified
   * @param hook - Optional hook name
   */
  removeAllHandlers<K extends keyof HookContexts>(hook?: K): void {
    if (hook) {
      this.hooks.delete(hook);
    } else {
      this.hooks.clear();
    }
  }

  /**
   * Dispose the registry, removing all handlers
   */
  dispose(): void {
    this.removeAllHandlers();
  }
}

/**
 * Create a hook wrapper for a function
 * The function will only execute if all hooks allow it
 *
 * @example
 * ```typescript
 * const turnPage = createHookedFunction(
 *   hookRegistry,
 *   'onBeforePageTurn',
 *   async (direction: 'forward' | 'backward') => {
 *     // Actual page turn logic
 *   },
 *   (direction) => ({
 *     currentPage: 1,
 *     nextPage: direction === 'forward' ? 2 : 0,
 *     direction
 *   })
 * );
 *
 * // Will check hooks before executing
 * await turnPage('forward');
 * ```
 */
export function createHookedFunction<
  K extends keyof HookContexts,
  TArgs extends unknown[],
  TResult
>(
  registry: HookRegistry,
  hook: K,
  fn: (...args: TArgs) => Promise<TResult>,
  contextBuilder: (...args: TArgs) => HookContexts[K]
): (...args: TArgs) => Promise<TResult | null> {
  return async (...args: TArgs): Promise<TResult | null> => {
    const context = contextBuilder(...args);
    const allowed = await registry.execute(hook, context);

    if (!allowed) {
      return null;
    }

    return fn(...args);
  };
}

/**
 * Synchronous version of createHookedFunction for sync operations
 * Note: Hooks are still async, so this returns a Promise
 */
export function createSyncHookedFunction<
  K extends keyof HookContexts,
  TArgs extends unknown[],
  TResult
>(
  registry: HookRegistry,
  hook: K,
  fn: (...args: TArgs) => TResult,
  contextBuilder: (...args: TArgs) => HookContexts[K]
): (...args: TArgs) => Promise<TResult | null> {
  return async (...args: TArgs): Promise<TResult | null> => {
    const context = contextBuilder(...args);
    const allowed = await registry.execute(hook, context);

    if (!allowed) {
      return null;
    }

    return fn(...args);
  };
}
