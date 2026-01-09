/**
 * TOC Types
 *
 * Type definitions for enhanced TOC with progress tracking.
 */

import type { TocEntry } from '../../../reader/renderer/types';

/**
 * Enhanced TOC entry with progress tracking
 * Extends base TocEntry with computed progress fields
 */
export interface TocEntryWithProgress extends TocEntry {
  /** Chapter completion percentage (0-100) */
  progress: number;

  /** True if this is the active reading chapter */
  isCurrent: boolean;

  /** True if contains current chapter in children */
  isAncestorOfCurrent: boolean;

  /** Resolved spine index for this entry (-1 if not found) */
  spineIndex: number;

  /** Override children type for recursive structure */
  children: TocEntryWithProgress[];
}

/**
 * Per-spine-item progress data
 * Maps spine index to completion percentage
 */
export interface SpineProgress {
  spineIndex: number;
  href: string;
  /** Progress 0-1 from Locator */
  progression: number;
  /** Progress 0-100 percentage */
  progress: number;
}

/**
 * Book-level progress aggregation
 */
export interface BookProgress {
  currentSpineIndex: number;
  currentHref: string;
  /** Current chapter progress 0-100 */
  currentChapterProgress: number;
  /** Total book progress 0-100 (from Locator.locations.totalProgression) */
  totalProgression: number;

  /** Count of chapters with progress > 95% */
  chaptersRead: number;
  /** Total spine items */
  totalChapters: number;
  /** chaptersRead / totalChapters * 100 */
  percentComplete: number;
}

/**
 * Expanded state storage format
 * Stored in BookSettingsRecord.tocExpandedState
 */
export type TocExpandedState = string[];
