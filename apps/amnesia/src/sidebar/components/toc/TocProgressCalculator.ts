/**
 * TOC Progress Calculator
 *
 * Core algorithm for mapping navigator Locator to enhanced TOC entries with progress data.
 * Handles href resolution, progress calculation, and ancestor marking.
 */

import type { TocEntry, SpineItem } from '../../../reader/renderer/types';
import type { Locator } from '../../../reader/navigator/navigator-interface';
import type { TocEntryWithProgress, BookProgress } from './types';

export class TocProgressCalculator {
  private spineItems: SpineItem[];
  private spineHrefToIndex: Map<string, number>;

  constructor(spineItems: SpineItem[]) {
    this.spineItems = spineItems;
    // Pre-compute href → index mapping for O(1) lookups
    this.spineHrefToIndex = new Map(
      spineItems.map((item, idx) => [this.normalizeHref(item.href), idx])
    );
  }

  /**
   * Enhance TOC entries with progress data from navigator Locator
   * @param toc - Base TOC entries from book metadata
   * @param locator - Current position from navigator's 'relocated' event
   * @returns Enhanced TOC with progress indicators
   */
  enhanceTocWithProgress(
    toc: TocEntry[],
    locator: Locator | null
  ): TocEntryWithProgress[] {
    if (!locator) {
      return this.enhanceTocWithoutProgress(toc);
    }

    const currentHref = locator.href;
    const currentSpineIndex = locator.locations.position ?? -1;
    const progression = locator.locations.progression ?? 0;

    // Recursive enhancement
    const enhanced = this.enhanceEntriesRecursive(
      toc,
      currentHref,
      currentSpineIndex,
      progression
    );

    // Mark ancestors of current entry (second pass)
    this.markAncestors(enhanced, currentHref);

    return enhanced;
  }

  /**
   * Calculate book-level progress statistics
   */
  calculateBookProgress(locator: Locator | null): BookProgress {
    if (!locator) {
      return {
        currentSpineIndex: 0,
        currentHref: '',
        currentChapterProgress: 0,
        totalProgression: 0,
        chaptersRead: 0,
        totalChapters: this.spineItems.length,
        percentComplete: 0,
      };
    }

    const currentSpineIndex = locator.locations.position ?? 0;
    const currentProgression = locator.locations.progression ?? 0;
    const totalProgression = locator.locations.totalProgression ?? 0;

    // Count chapters read (current + all previous if >95% complete)
    const chaptersRead = currentSpineIndex + (currentProgression > 0.95 ? 1 : 0);

    return {
      currentSpineIndex,
      currentHref: locator.href,
      currentChapterProgress: Math.round(currentProgression * 100),
      totalProgression: Math.round(totalProgression * 100),
      chaptersRead,
      totalChapters: this.spineItems.length,
      percentComplete: Math.round((chaptersRead / this.spineItems.length) * 100),
    };
  }

  /**
   * Find the TOC entry ID for the current position
   */
  findCurrentEntryId(
    toc: TocEntryWithProgress[],
    currentHref: string
  ): string | null {
    for (const entry of toc) {
      if (entry.isCurrent) {
        return entry.id;
      }
      if (entry.children.length > 0) {
        const childId = this.findCurrentEntryId(entry.children, currentHref);
        if (childId) return childId;
      }
    }
    return null;
  }

  private enhanceEntriesRecursive(
    entries: TocEntry[],
    currentHref: string,
    currentSpineIndex: number,
    currentProgression: number
  ): TocEntryWithProgress[] {
    return entries.map((entry) => {
      // Resolve spine index for this entry
      const spineIndex = this.resolveSpineIndex(entry.href);

      // Check if this is the current chapter
      const isCurrent = this.isCurrentEntry(entry.href, currentHref);

      // Calculate progress
      let progress = 0;
      if (spineIndex >= 0) {
        if (spineIndex < currentSpineIndex) {
          // Past chapters: 100% complete
          progress = 100;
        } else if (spineIndex === currentSpineIndex) {
          // Current chapter: use progression from locator
          progress = Math.round(currentProgression * 100);
        }
        // Future chapters: 0% (default)
      }

      // Recursively enhance children
      const enhancedChildren = this.enhanceEntriesRecursive(
        entry.children,
        currentHref,
        currentSpineIndex,
        currentProgression
      );

      return {
        ...entry,
        progress,
        isCurrent,
        isAncestorOfCurrent: false, // Computed in second pass
        spineIndex,
        children: enhancedChildren,
      };
    });
  }

  /**
   * Resolve TOC entry href to spine index
   * Handles both absolute and relative hrefs, with/without fragments
   */
  private resolveSpineIndex(href: string): number {
    const normalizedHref = this.normalizeHref(href);

    // Try exact match first
    if (this.spineHrefToIndex.has(normalizedHref)) {
      return this.spineHrefToIndex.get(normalizedHref)!;
    }

    // Try suffix match (handles different base paths)
    for (const [spineHref, index] of this.spineHrefToIndex.entries()) {
      if (spineHref.endsWith(normalizedHref) || normalizedHref.endsWith(spineHref)) {
        return index;
      }
    }

    // Try filename-only match
    const hrefFilename = this.getFilename(normalizedHref);
    for (const [spineHref, index] of this.spineHrefToIndex.entries()) {
      const spineFilename = this.getFilename(spineHref);
      if (spineFilename === hrefFilename) {
        return index;
      }
    }

    return -1; // Not found in spine
  }

  /**
   * Normalize href by stripping fragment identifier
   */
  private normalizeHref(href: string): string {
    return href.split('#')[0];
  }

  /**
   * Get filename from path
   */
  private getFilename(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1];
  }

  private isCurrentEntry(entryHref: string, currentHref: string): boolean {
    const entryNormalized = this.normalizeHref(entryHref);
    const currentNormalized = this.normalizeHref(currentHref);

    return (
      entryNormalized === currentNormalized ||
      entryNormalized.endsWith(currentNormalized) ||
      currentNormalized.endsWith(entryNormalized) ||
      this.getFilename(entryNormalized) === this.getFilename(currentNormalized)
    );
  }

  /**
   * Mark ancestors of current entry (second pass)
   * Returns true if this subtree contains the current entry
   */
  private markAncestors(
    entries: TocEntryWithProgress[],
    currentHref: string
  ): boolean {
    let foundCurrent = false;

    for (const entry of entries) {
      const childContainsCurrent = this.markAncestors(entry.children, currentHref);

      if (entry.isCurrent || childContainsCurrent) {
        // Mark as ancestor only if it has children containing current
        // (don't mark the current entry itself as ancestor)
        if (childContainsCurrent && !entry.isCurrent) {
          entry.isAncestorOfCurrent = true;
        }
        foundCurrent = true;
      }
    }

    return foundCurrent;
  }

  private enhanceTocWithoutProgress(toc: TocEntry[]): TocEntryWithProgress[] {
    return toc.map((entry) => ({
      ...entry,
      progress: 0,
      isCurrent: false,
      isAncestorOfCurrent: false,
      spineIndex: this.resolveSpineIndex(entry.href),
      children: this.enhanceTocWithoutProgress(entry.children),
    }));
  }
}
