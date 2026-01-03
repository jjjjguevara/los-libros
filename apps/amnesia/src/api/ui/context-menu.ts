/**
 * Context Menu Extension API
 * @module api/ui/context-menu
 */

import type { Disposable, ContextMenuItem, ContextMenuAPI, SelectionContext } from '../types';
import { ComponentRegistry } from './registry';

/**
 * Context menu registry implementation
 */
export class ContextMenuRegistry implements ContextMenuAPI {
  private registry = new ComponentRegistry<ContextMenuItem>();

  /**
   * Register a context menu item
   * @param item - Context menu item configuration
   * @returns Disposable to unregister
   */
  register(item: ContextMenuItem): Disposable {
    return this.registry.register(item);
  }

  /**
   * Unregister a context menu item
   * @param id - Item ID
   */
  unregister(id: string): void {
    this.registry.unregister(id);
  }

  /**
   * Get all context menu items
   * @returns Array of context menu items
   */
  getItems(): ContextMenuItem[] {
    return this.registry.getAll();
  }

  /**
   * Get visible items for the current context
   * Filters items based on their condition functions
   * @param context - Current selection context
   * @returns Visible items
   */
  getVisibleItems(context: SelectionContext): ContextMenuItem[] {
    return this.registry.getAll().filter(item => {
      // If no condition, always show
      if (!item.condition) return true;

      try {
        return item.condition(context);
      } catch (error) {
        console.error(`[Amnesia] Error evaluating condition for menu item '${item.id}':`, error);
        return false;
      }
    });
  }

  /**
   * Execute an item's action
   * @param id - Item ID
   * @param context - Selection context
   * @returns True if action executed
   */
  executeAction(id: string, context: SelectionContext): boolean {
    const item = this.registry.get(id);
    if (!item) {
      console.warn(`[Amnesia] Context menu item '${id}' not found`);
      return false;
    }

    try {
      item.action(context);
      return true;
    } catch (error) {
      console.error(`[Amnesia] Error executing action for menu item '${id}':`, error);
      return false;
    }
  }

  /**
   * Subscribe to context menu changes (Svelte store contract)
   */
  subscribe(run: (value: ContextMenuItem[]) => void): () => void {
    return this.registry.subscribe(run);
  }

  /**
   * Check if an item is registered
   */
  has(id: string): boolean {
    return this.registry.has(id);
  }

  /**
   * Clear all context menu items
   */
  clear(): void {
    this.registry.clear();
  }
}

/**
 * Helper to create a selection context from a Range
 */
export function createSelectionContext(
  range: Range | null,
  cfi: string = ''
): SelectionContext {
  if (!range || range.collapsed) {
    return {
      text: '',
      cfi: '',
      range: range ?? document.createRange(),
      hasSelection: false
    };
  }

  return {
    text: range.toString(),
    cfi,
    range,
    hasSelection: true
  };
}
