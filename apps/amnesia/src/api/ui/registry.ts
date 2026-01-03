/**
 * Component Registry
 * Generic registry for UI extension points
 * @module api/ui/registry
 */

import { writable, type Readable, type Writable } from 'svelte/store';
import type { Disposable } from '../types';
import { createDisposable } from '../disposable';

/**
 * Generic component registry that can hold any type of UI component
 * Implements Svelte store contract for reactive updates
 */
export class ComponentRegistry<T extends { id: string }> {
  private items: Map<string, T> = new Map();
  private store: Writable<T[]>;

  constructor() {
    this.store = writable([]);
  }

  /**
   * Register a component
   * @param item - The component to register
   * @returns Disposable to unregister
   */
  register(item: T): Disposable {
    if (this.items.has(item.id)) {
      console.warn(`[Amnesia] Component with id '${item.id}' already registered, replacing`);
    }

    this.items.set(item.id, item);
    this.notifySubscribers();

    return createDisposable(() => {
      this.unregister(item.id);
    });
  }

  /**
   * Unregister a component by ID
   * @param id - Component ID
   */
  unregister(id: string): void {
    if (this.items.delete(id)) {
      this.notifySubscribers();
    }
  }

  /**
   * Get a component by ID
   * @param id - Component ID
   * @returns The component or undefined
   */
  get(id: string): T | undefined {
    return this.items.get(id);
  }

  /**
   * Get all registered components
   * @returns Array of all components
   */
  getAll(): T[] {
    return Array.from(this.items.values());
  }

  /**
   * Check if a component is registered
   * @param id - Component ID
   * @returns True if registered
   */
  has(id: string): boolean {
    return this.items.has(id);
  }

  /**
   * Get the count of registered components
   */
  get count(): number {
    return this.items.size;
  }

  /**
   * Subscribe to registry changes (Svelte store contract)
   * @param run - Subscriber function
   * @returns Unsubscribe function
   */
  subscribe(run: (value: T[]) => void): () => void {
    return this.store.subscribe(run);
  }

  /**
   * Get as a Svelte readable store
   */
  asReadable(): Readable<T[]> {
    return {
      subscribe: this.subscribe.bind(this)
    };
  }

  /**
   * Clear all registered components
   */
  clear(): void {
    this.items.clear();
    this.notifySubscribers();
  }

  private notifySubscribers(): void {
    this.store.set(this.getAll());
  }
}

/**
 * Create a sorted component registry
 * Components are sorted by a priority field (lower = earlier)
 */
export class SortedComponentRegistry<T extends { id: string; priority?: number }> extends ComponentRegistry<T> {
  getAll(): T[] {
    return super.getAll().sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }
}
