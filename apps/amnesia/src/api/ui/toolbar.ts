/**
 * Toolbar Extension API
 * @module api/ui/toolbar
 */

import type { Disposable, ToolbarItem, ToolbarAPI } from '../types';
import { SortedComponentRegistry } from './registry';

/**
 * Internal toolbar item with defaults applied
 */
interface InternalToolbarItem extends ToolbarItem {
  position: 'left' | 'right';
  priority: number;
}

/**
 * Toolbar registry implementation
 */
export class ToolbarRegistry implements ToolbarAPI {
  private registry = new SortedComponentRegistry<InternalToolbarItem>();

  /**
   * Register a toolbar item
   * @param item - Toolbar item configuration
   * @returns Disposable to unregister
   */
  register(item: ToolbarItem): Disposable {
    const internalItem: InternalToolbarItem = {
      ...item,
      position: item.position ?? 'right',
      priority: item.priority ?? 100
    };

    return this.registry.register(internalItem);
  }

  /**
   * Unregister a toolbar item
   * @param id - Item ID
   */
  unregister(id: string): void {
    this.registry.unregister(id);
  }

  /**
   * Get all toolbar items
   * @returns Array of toolbar items
   */
  getItems(): ToolbarItem[] {
    return this.registry.getAll();
  }

  /**
   * Get toolbar items by position
   * @param position - 'left' or 'right'
   * @returns Filtered toolbar items
   */
  getItemsByPosition(position: 'left' | 'right'): ToolbarItem[] {
    return this.registry.getAll().filter(item => item.position === position);
  }

  /**
   * Subscribe to toolbar changes (Svelte store contract)
   */
  subscribe(run: (value: ToolbarItem[]) => void): () => void {
    return this.registry.subscribe(run);
  }

  /**
   * Check if an item is registered
   */
  has(id: string): boolean {
    return this.registry.has(id);
  }

  /**
   * Clear all toolbar items
   */
  clear(): void {
    this.registry.clear();
  }
}
