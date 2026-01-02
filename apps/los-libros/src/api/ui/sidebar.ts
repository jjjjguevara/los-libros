/**
 * Sidebar Extension API
 * @module api/ui/sidebar
 */

import type { Disposable, SidebarView, SidebarAPI } from '../types';
import { ComponentRegistry } from './registry';

/**
 * Sidebar registry implementation
 */
export class SidebarRegistry implements SidebarAPI {
  private registry = new ComponentRegistry<SidebarView>();
  private mountedViews: Map<string, () => void> = new Map();

  /**
   * Register a sidebar view
   * @param view - Sidebar view configuration
   * @returns Disposable to unregister
   */
  register(view: SidebarView): Disposable {
    return this.registry.register(view);
  }

  /**
   * Unregister a sidebar view
   * @param id - View ID
   */
  unregister(id: string): void {
    // Clean up mounted view if any
    this.unmountView(id);
    this.registry.unregister(id);
  }

  /**
   * Get all sidebar views
   * @returns Array of sidebar views
   */
  getViews(): SidebarView[] {
    return this.registry.getAll();
  }

  /**
   * Get a specific view by ID
   * @param id - View ID
   * @returns The view or undefined
   */
  getView(id: string): SidebarView | undefined {
    return this.registry.get(id);
  }

  /**
   * Mount a view into a container
   * @param id - View ID
   * @param container - Container element
   * @returns True if mounted successfully
   */
  mountView(id: string, container: HTMLElement): boolean {
    const view = this.registry.get(id);
    if (!view) {
      console.warn(`[Los Libros] Sidebar view '${id}' not found`);
      return false;
    }

    // Unmount existing if any
    this.unmountView(id);

    try {
      const cleanup = view.mount(container);
      this.mountedViews.set(id, cleanup);
      return true;
    } catch (error) {
      console.error(`[Los Libros] Error mounting sidebar view '${id}':`, error);
      return false;
    }
  }

  /**
   * Unmount a view
   * @param id - View ID
   */
  unmountView(id: string): void {
    const cleanup = this.mountedViews.get(id);
    if (cleanup) {
      try {
        cleanup();
      } catch (error) {
        console.error(`[Los Libros] Error unmounting sidebar view '${id}':`, error);
      }
      this.mountedViews.delete(id);
    }
  }

  /**
   * Check if a view is mounted
   * @param id - View ID
   */
  isMounted(id: string): boolean {
    return this.mountedViews.has(id);
  }

  /**
   * Subscribe to sidebar changes (Svelte store contract)
   */
  subscribe(run: (value: SidebarView[]) => void): () => void {
    return this.registry.subscribe(run);
  }

  /**
   * Check if a view is registered
   */
  has(id: string): boolean {
    return this.registry.has(id);
  }

  /**
   * Clear all sidebar views
   */
  clear(): void {
    // Unmount all views
    for (const id of this.mountedViews.keys()) {
      this.unmountView(id);
    }
    this.registry.clear();
  }
}
