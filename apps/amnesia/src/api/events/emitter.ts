/**
 * Typed Event Emitter
 * @module api/events/emitter
 */

import type { Disposable, ReaderEventMap } from '../types';
import { createDisposable } from '../disposable';

type EventHandler<T> = (data: T) => void;

/**
 * Typed event emitter for the Amnesia API
 */
export class TypedEventEmitter {
  private handlers: Map<keyof ReaderEventMap, Set<EventHandler<unknown>>> = new Map();
  private onceHandlers: Map<keyof ReaderEventMap, Set<EventHandler<unknown>>> = new Map();

  /**
   * Subscribe to an event
   * @param event - Event name
   * @param handler - Event handler
   * @returns Disposable to unsubscribe
   */
  on<K extends keyof ReaderEventMap>(
    event: K,
    handler: EventHandler<ReaderEventMap[K]>
  ): Disposable {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);

    return createDisposable(() => {
      this.off(event, handler);
    });
  }

  /**
   * Unsubscribe from an event
   * @param event - Event name
   * @param handler - Event handler to remove
   */
  off<K extends keyof ReaderEventMap>(
    event: K,
    handler: EventHandler<ReaderEventMap[K]>
  ): void {
    const eventHandlers = this.handlers.get(event);
    if (eventHandlers) {
      eventHandlers.delete(handler as EventHandler<unknown>);
      if (eventHandlers.size === 0) {
        this.handlers.delete(event);
      }
    }
  }

  /**
   * Subscribe to an event once
   * @param event - Event name
   * @param handler - Event handler
   * @returns Disposable to unsubscribe
   */
  once<K extends keyof ReaderEventMap>(
    event: K,
    handler: EventHandler<ReaderEventMap[K]>
  ): Disposable {
    if (!this.onceHandlers.has(event)) {
      this.onceHandlers.set(event, new Set());
    }
    this.onceHandlers.get(event)!.add(handler as EventHandler<unknown>);

    return createDisposable(() => {
      const onceEventHandlers = this.onceHandlers.get(event);
      if (onceEventHandlers) {
        onceEventHandlers.delete(handler as EventHandler<unknown>);
      }
    });
  }

  /**
   * Emit an event
   * @param event - Event name
   * @param data - Event data
   */
  emit<K extends keyof ReaderEventMap>(event: K, data: ReaderEventMap[K]): void {
    // Call regular handlers
    const eventHandlers = this.handlers.get(event);
    if (eventHandlers) {
      eventHandlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`[Amnesia] Error in event handler for '${String(event)}':`, error);
        }
      });
    }

    // Call once handlers and remove them
    const onceEventHandlers = this.onceHandlers.get(event);
    if (onceEventHandlers) {
      onceEventHandlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`[Amnesia] Error in once handler for '${String(event)}':`, error);
        }
      });
      this.onceHandlers.delete(event);
    }
  }

  /**
   * Check if there are any handlers for an event
   * @param event - Event name
   * @returns True if there are handlers
   */
  hasListeners<K extends keyof ReaderEventMap>(event: K): boolean {
    const regularHandlers = this.handlers.get(event);
    const onceHandlers = this.onceHandlers.get(event);
    return (regularHandlers?.size ?? 0) > 0 || (onceHandlers?.size ?? 0) > 0;
  }

  /**
   * Get the number of handlers for an event
   * @param event - Event name
   * @returns Number of handlers
   */
  listenerCount<K extends keyof ReaderEventMap>(event: K): number {
    const regularHandlers = this.handlers.get(event);
    const onceHandlers = this.onceHandlers.get(event);
    return (regularHandlers?.size ?? 0) + (onceHandlers?.size ?? 0);
  }

  /**
   * Remove all handlers for an event, or all handlers if no event specified
   * @param event - Optional event name
   */
  removeAllListeners<K extends keyof ReaderEventMap>(event?: K): void {
    if (event) {
      this.handlers.delete(event);
      this.onceHandlers.delete(event);
    } else {
      this.handlers.clear();
      this.onceHandlers.clear();
    }
  }

  /**
   * Dispose the emitter, removing all handlers
   */
  dispose(): void {
    this.removeAllListeners();
  }
}

/**
 * Create a throttled event emitter for high-frequency events
 * @param emitter - The underlying event emitter
 * @param event - Event to throttle
 * @param delay - Throttle delay in milliseconds
 */
export function createThrottledEmitter<K extends keyof ReaderEventMap>(
  emitter: TypedEventEmitter,
  event: K,
  delay: number
): (data: ReaderEventMap[K]) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastData: ReaderEventMap[K] | null = null;

  return (data: ReaderEventMap[K]) => {
    lastData = data;

    if (timeout === null) {
      emitter.emit(event, data);
      timeout = setTimeout(() => {
        timeout = null;
        if (lastData !== null && lastData !== data) {
          emitter.emit(event, lastData);
        }
      }, delay);
    }
  };
}

/**
 * Create a debounced event emitter for bursty events
 * @param emitter - The underlying event emitter
 * @param event - Event to debounce
 * @param delay - Debounce delay in milliseconds
 */
export function createDebouncedEmitter<K extends keyof ReaderEventMap>(
  emitter: TypedEventEmitter,
  event: K,
  delay: number
): (data: ReaderEventMap[K]) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (data: ReaderEventMap[K]) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      emitter.emit(event, data);
      timeout = null;
    }, delay);
  };
}

/**
 * Create an RAF-throttled emitter for animation-related events
 * @param emitter - The underlying event emitter
 * @param event - Event to throttle
 */
export function createRAFEmitter<K extends keyof ReaderEventMap>(
  emitter: TypedEventEmitter,
  event: K
): (data: ReaderEventMap[K]) => void {
  let pending = false;
  let lastData: ReaderEventMap[K] | undefined = undefined;

  return (data: ReaderEventMap[K]) => {
    lastData = data;

    if (!pending) {
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        if (lastData !== undefined) {
          emitter.emit(event, lastData);
        }
      });
    }
  };
}
