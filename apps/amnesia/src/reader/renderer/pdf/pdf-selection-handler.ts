/**
 * PDF Selection Handler
 *
 * Handles text selection events in PDF documents and coordinates
 * with the highlight system to create highlights from selections.
 */

import type { PdfHighlightRect, HighlightColor } from '../../../library/types';
import { PdfHighlightService, CreatePdfHighlightOptions } from '../../../highlights/pdf-highlight-service';

/**
 * Selection data from PDF text selection
 */
export interface PdfSelectionData {
  /** Page number (1-based) */
  page: number;
  /** Selected text */
  text: string;
  /** Selection rects in normalized coordinates (0-1) */
  rects: PdfHighlightRect[];
  /** Position for popup display */
  popupPosition: { x: number; y: number };
  /** Text before selection for context */
  prefix?: string;
  /** Text after selection for context */
  suffix?: string;
}

/**
 * Selection event callback
 */
export type SelectionCallback = (selection: PdfSelectionData | null) => void;

/**
 * Configuration for the selection handler
 */
export interface PdfSelectionHandlerConfig {
  /** Context characters to capture before/after selection */
  contextChars?: number;
  /** Minimum selection length to trigger popup */
  minSelectionLength?: number;
  /** Debounce time for selection events (ms) */
  debounceMs?: number;
}

/**
 * PDF Selection Handler
 *
 * Manages text selection in PDF pages and coordinates with
 * the highlight system.
 */
export class PdfSelectionHandler {
  private container: HTMLElement;
  private currentPage: number = 1;
  private displayWidth: number = 0;
  private displayHeight: number = 0;
  private config: Required<PdfSelectionHandlerConfig>;

  private selectionCallback: SelectionCallback | null = null;
  private currentSelection: PdfSelectionData | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Bound handlers for cleanup
  private boundMouseUp: (e: MouseEvent) => void;
  private boundTouchEnd: (e: TouchEvent) => void;
  private boundSelectionChange: () => void;

  constructor(container: HTMLElement, config?: PdfSelectionHandlerConfig) {
    this.container = container;
    this.config = {
      contextChars: config?.contextChars ?? 32,
      minSelectionLength: config?.minSelectionLength ?? 3,
      debounceMs: config?.debounceMs ?? 100,
    };

    // Bind handlers
    this.boundMouseUp = this.handleMouseUp.bind(this);
    this.boundTouchEnd = this.handleTouchEnd.bind(this);
    this.boundSelectionChange = this.handleSelectionChange.bind(this);

    this.setupEventListeners();
  }

  /**
   * Set up event listeners for selection
   */
  private setupEventListeners(): void {
    this.container.addEventListener('mouseup', this.boundMouseUp);
    this.container.addEventListener('touchend', this.boundTouchEnd);
    document.addEventListener('selectionchange', this.boundSelectionChange);
  }

  /**
   * Update current page
   */
  setPage(page: number): void {
    this.currentPage = page;
    this.clearSelection();
  }

  /**
   * Update display dimensions for coordinate normalization
   */
  setDimensions(width: number, height: number): void {
    this.displayWidth = width;
    this.displayHeight = height;
  }

  /**
   * Set selection callback
   */
  onSelection(callback: SelectionCallback): void {
    this.selectionCallback = callback;
  }

  /**
   * Get current selection data
   */
  getCurrentSelection(): PdfSelectionData | null {
    return this.currentSelection;
  }

  /**
   * Clear current selection
   */
  clearSelection(): void {
    this.currentSelection = null;
    window.getSelection()?.removeAllRanges();
    this.notifyCallback(null);
  }

  /**
   * Handle mouse up event
   */
  private handleMouseUp(e: MouseEvent): void {
    // Small delay to ensure selection is complete
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.processSelection();
    }, this.config.debounceMs);
  }

  /**
   * Handle touch end event
   */
  private handleTouchEnd(e: TouchEvent): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.processSelection();
    }, this.config.debounceMs);
  }

  /**
   * Handle selection change event
   */
  private handleSelectionChange(): void {
    // Only process if selection is within our container
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!this.container.contains(range.commonAncestorContainer)) {
      return;
    }

    // Debounce to avoid excessive processing
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.processSelection();
    }, this.config.debounceMs);
  }

  /**
   * Process the current text selection
   */
  private processSelection(): void {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      if (this.currentSelection) {
        this.currentSelection = null;
        this.notifyCallback(null);
      }
      return;
    }

    const text = selection.toString().trim();
    if (text.length < this.config.minSelectionLength) {
      if (this.currentSelection) {
        this.currentSelection = null;
        this.notifyCallback(null);
      }
      return;
    }

    const range = selection.getRangeAt(0);

    // Check if selection is within our container
    if (!this.container.contains(range.commonAncestorContainer)) {
      return;
    }

    // Get normalized rects
    const rects = this.getNormalizedRects(range);
    if (rects.length === 0) {
      return;
    }

    // Get context text
    const { prefix, suffix } = this.getContextText(range);

    // Calculate popup position (center-top of first rect)
    const containerRect = this.container.getBoundingClientRect();
    const firstClientRect = range.getClientRects()[0];
    const popupPosition = {
      x: firstClientRect
        ? firstClientRect.left + firstClientRect.width / 2
        : containerRect.left + containerRect.width / 2,
      y: firstClientRect
        ? firstClientRect.top - 10
        : containerRect.top,
    };

    this.currentSelection = {
      page: this.currentPage,
      text,
      rects,
      popupPosition,
      prefix,
      suffix,
    };

    this.notifyCallback(this.currentSelection);
  }

  /**
   * Get normalized rects (0-1 coordinates) from a Range
   */
  private getNormalizedRects(range: Range): PdfHighlightRect[] {
    if (!this.displayWidth || !this.displayHeight) {
      return [];
    }

    const containerRect = this.container.getBoundingClientRect();
    const clientRects = range.getClientRects();
    const normalizedRects: PdfHighlightRect[] = [];

    for (let i = 0; i < clientRects.length; i++) {
      const rect = clientRects[i];

      // Skip very small rects (likely formatting artifacts)
      if (rect.width < 2 || rect.height < 2) {
        continue;
      }

      // Calculate relative position within container
      const relativeLeft = rect.left - containerRect.left;
      const relativeTop = rect.top - containerRect.top;

      // Normalize to 0-1 range
      normalizedRects.push({
        x: Math.max(0, Math.min(1, relativeLeft / this.displayWidth)),
        y: Math.max(0, Math.min(1, relativeTop / this.displayHeight)),
        width: Math.max(0, Math.min(1, rect.width / this.displayWidth)),
        height: Math.max(0, Math.min(1, rect.height / this.displayHeight)),
      });
    }

    // Merge overlapping rects to reduce noise
    return this.mergeOverlappingRects(normalizedRects);
  }

  /**
   * Merge overlapping or adjacent rects
   */
  private mergeOverlappingRects(rects: PdfHighlightRect[]): PdfHighlightRect[] {
    if (rects.length <= 1) return rects;

    // Sort by y then x
    const sorted = [...rects].sort((a, b) => {
      const yDiff = a.y - b.y;
      return Math.abs(yDiff) < 0.01 ? a.x - b.x : yDiff;
    });

    const merged: PdfHighlightRect[] = [];
    let current = { ...sorted[0] };

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];

      // Check if rects are on same line (similar y) and adjacent/overlapping
      const sameLine = Math.abs(current.y - next.y) < 0.02;
      const adjacent = sameLine && (current.x + current.width + 0.01) >= next.x;

      if (adjacent) {
        // Merge: extend current rect to include next
        const newRight = Math.max(current.x + current.width, next.x + next.width);
        const newBottom = Math.max(current.y + current.height, next.y + next.height);
        current.width = newRight - current.x;
        current.height = newBottom - current.y;
      } else {
        merged.push(current);
        current = { ...next };
      }
    }

    merged.push(current);
    return merged;
  }

  /**
   * Get context text before and after selection
   */
  private getContextText(range: Range): { prefix: string; suffix: string } {
    let prefix = '';
    let suffix = '';

    try {
      // Get text content of the container or parent element
      const textContent = this.container.textContent || '';

      // Try to find the selection text in the full text
      const selectionText = range.toString();
      const selectionStart = textContent.indexOf(selectionText);

      if (selectionStart >= 0) {
        prefix = textContent.slice(
          Math.max(0, selectionStart - this.config.contextChars),
          selectionStart
        );
        suffix = textContent.slice(
          selectionStart + selectionText.length,
          selectionStart + selectionText.length + this.config.contextChars
        );
      }
    } catch {
      // Ignore errors in context extraction
    }

    return { prefix, suffix };
  }

  /**
   * Notify callback of selection change
   */
  private notifyCallback(selection: PdfSelectionData | null): void {
    if (this.selectionCallback) {
      this.selectionCallback(selection);
    }
  }

  /**
   * Create highlight from current selection
   */
  async createHighlight(
    highlightService: PdfHighlightService,
    bookId: string,
    color: HighlightColor = 'yellow',
    annotation?: string
  ): Promise<void> {
    if (!this.currentSelection) {
      console.warn('[PdfSelectionHandler] No selection to highlight');
      return;
    }

    const options: CreatePdfHighlightOptions = {
      bookId,
      page: this.currentSelection.page,
      text: this.currentSelection.text,
      color,
      annotation,
      rects: this.currentSelection.rects,
      prefix: this.currentSelection.prefix,
      suffix: this.currentSelection.suffix,
    };

    await highlightService.createHighlight(options);
    this.clearSelection();
  }

  /**
   * Destroy the handler and clean up
   */
  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.container.removeEventListener('mouseup', this.boundMouseUp);
    this.container.removeEventListener('touchend', this.boundTouchEnd);
    document.removeEventListener('selectionchange', this.boundSelectionChange);

    this.selectionCallback = null;
    this.currentSelection = null;
  }
}
