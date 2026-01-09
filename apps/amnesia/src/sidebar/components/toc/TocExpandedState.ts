/**
 * TOC Expanded State Manager
 *
 * Manages TOC expanded/collapsed state with persistence.
 * Stores expanded entry IDs and provides methods for toggling, expanding all,
 * collapsing all, and auto-expanding to current chapter.
 */

import type { TocEntryWithProgress, TocExpandedState } from './types';

export class TocExpandedStateManager {
  private expandedIds: Set<string>;
  private saveCallback: (expandedIds: TocExpandedState) => void;

  constructor(
    initialExpandedIds: TocExpandedState,
    saveCallback: (expandedIds: TocExpandedState) => void
  ) {
    this.expandedIds = new Set(initialExpandedIds);
    this.saveCallback = saveCallback;
  }

  /**
   * Toggle expansion state for a single entry
   */
  toggle(id: string): void {
    if (this.expandedIds.has(id)) {
      this.expandedIds.delete(id);
    } else {
      this.expandedIds.add(id);
    }
    this.persist();
  }

  /**
   * Expand a single entry
   */
  expand(id: string): void {
    if (!this.expandedIds.has(id)) {
      this.expandedIds.add(id);
      this.persist();
    }
  }

  /**
   * Collapse a single entry
   */
  collapse(id: string): void {
    if (this.expandedIds.has(id)) {
      this.expandedIds.delete(id);
      this.persist();
    }
  }

  /**
   * Expand all entries that have children
   */
  expandAll(toc: TocEntryWithProgress[]): void {
    this.collectAllIdsWithChildren(toc, this.expandedIds);
    this.persist();
  }

  /**
   * Collapse all entries
   */
  collapseAll(): void {
    this.expandedIds.clear();
    this.persist();
  }

  /**
   * Auto-expand the path to the current chapter
   * This ensures the current reading position is always visible
   */
  expandToCurrent(toc: TocEntryWithProgress[]): void {
    const pathToCurrentIds = this.findPathToCurrent(toc);
    let changed = false;
    for (const id of pathToCurrentIds) {
      if (!this.expandedIds.has(id)) {
        this.expandedIds.add(id);
        changed = true;
      }
    }
    if (changed) {
      this.persist();
    }
  }

  /**
   * Check if an entry is expanded
   */
  isExpanded(id: string): boolean {
    return this.expandedIds.has(id);
  }

  /**
   * Get all expanded entry IDs for persistence
   */
  getExpandedIds(): TocExpandedState {
    return Array.from(this.expandedIds);
  }

  /**
   * Reset state with new expanded IDs (e.g., when switching books)
   */
  reset(expandedIds: TocExpandedState): void {
    this.expandedIds = new Set(expandedIds);
  }

  /**
   * Collect all entry IDs that have children (for expandAll)
   */
  private collectAllIdsWithChildren(
    entries: TocEntryWithProgress[],
    set: Set<string>
  ): void {
    for (const entry of entries) {
      if (entry.children.length > 0) {
        set.add(entry.id);
        this.collectAllIdsWithChildren(entry.children, set);
      }
    }
  }

  /**
   * Find the path of entry IDs from root to current chapter
   * Returns array of IDs representing ancestors that should be expanded
   */
  private findPathToCurrent(entries: TocEntryWithProgress[]): string[] {
    for (const entry of entries) {
      // If this entry is current, no ancestors needed (we're at the leaf)
      if (entry.isCurrent) {
        return [];
      }

      // Check if any child contains current
      if (entry.children.length > 0) {
        const childPath = this.findPathToCurrent(entry.children);
        // If child path found a current entry
        if (
          childPath.length > 0 ||
          entry.children.some((c) => c.isCurrent)
        ) {
          // Include this entry ID in the path
          return [entry.id, ...childPath];
        }
      }
    }
    return [];
  }

  private persist(): void {
    this.saveCallback(this.getExpandedIds());
  }
}
