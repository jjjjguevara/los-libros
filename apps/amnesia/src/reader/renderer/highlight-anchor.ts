/**
 * Highlight Anchor
 *
 * Unified anchoring system for both EPUB and PDF highlights.
 * Provides a common interface with explicit error reporting.
 *
 * EPUB: Re-anchors stored highlights to DOM Ranges for rendering.
 * Uses W3C Web Annotation selectors with fallback chain:
 * 1. CFI (most precise for unchanged content)
 * 2. TextQuote with context (handles content drift)
 * 3. TextPosition (last resort)
 *
 * PDF: Converts coordinate-based selectors to display rects.
 * Uses normalized coordinates (0-1) for resolution independence.
 */

import type {
  HighlightSelector,
  AnchorResult,
  EpubHighlightSelector,
  PdfHighlightSelector,
  PdfRect,
  PdfTextItem,
  PdfTextLayer,
  PdfCharPosition,
} from './types';
import { isEpubSelector, isPdfSelector } from './types';

/**
 * Text quote selector for anchoring (EPUB format)
 * Both EPUB and PDF fallback selectors share this structure
 */
interface TextQuoteSelector {
  type: 'TextQuoteSelector' | 'PdfTextQuoteSelector';
  exact: string;
  prefix?: string;
  suffix?: string;
}

/**
 * Unified anchor result - works for both EPUB and PDF
 */
export interface UnifiedAnchorResult {
  /** Whether anchoring succeeded */
  success: boolean;
  /** Format of the source selector */
  format: 'epub' | 'pdf';
  /** For EPUB: DOM Range for rendering */
  range?: Range | null;
  /** For PDF: Display rects in normalized coordinates */
  rects?: PdfRect[];
  /** Page number (for PDF) */
  page?: number;
  /** Anchor status */
  status: 'exact' | 'fuzzy' | 'orphaned';
  /** Confidence in the anchor (0-1) */
  confidence: number;
  /** Error details if anchoring failed */
  error?: AnchorError;
}

/**
 * Detailed error for anchor failures
 */
export interface AnchorError {
  code: AnchorErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Error codes for anchor failures
 */
export type AnchorErrorCode =
  | 'INVALID_SELECTOR'
  | 'SELECTOR_MISSING_DATA'
  | 'TEXT_NOT_FOUND'
  | 'POSITION_OUT_OF_RANGE'
  | 'INVALID_RECT'
  | 'PAGE_MISMATCH'
  | 'DOM_ERROR';

/**
 * Highlight re-anchoring engine
 * Converts stored selectors to DOM Ranges (EPUB) or rect arrays (PDF)
 */
export class HighlightAnchor {
  private doc: Document;
  private searchScope: Element | null = null;

  constructor(doc: Document) {
    this.doc = doc;
  }

  /**
   * Set the search scope to a specific element (e.g., chapter container)
   * This restricts text searches to within that element only
   */
  setSearchScope(element: Element | null): void {
    this.searchScope = element;
  }

  /**
   * Get the root element for searching (scope or body)
   */
  private getSearchRoot(): Element {
    return this.searchScope || this.doc.body;
  }

  /**
   * Unified anchor method - handles both EPUB and PDF selectors
   * Returns a unified result with explicit error reporting
   *
   * @param selector - The selector to anchor (EPUB or PDF)
   * @param options - Optional configuration
   */
  anchorUnified(
    selector: HighlightSelector,
    options?: {
      scopeElement?: Element;
      currentPage?: number; // For PDF: validate page matches
      textLayer?: PdfTextLayer; // For PDF: text layer for text-based re-anchoring
      pageWidth?: number; // For PDF: page width for normalizing rects
      pageHeight?: number; // For PDF: page height for normalizing rects
    }
  ): UnifiedAnchorResult {
    if (isEpubSelector(selector)) {
      return this.anchorEpubUnified(selector, options?.scopeElement);
    }

    if (isPdfSelector(selector)) {
      return this.anchorPdfUnified(selector, options?.currentPage, options?.textLayer, options?.pageWidth, options?.pageHeight);
    }

    // Unknown format
    console.error('[HighlightAnchor] Unknown selector format:', selector);
    return {
      success: false,
      format: 'epub', // Default
      status: 'orphaned',
      confidence: 0,
      error: {
        code: 'INVALID_SELECTOR',
        message: 'Unknown selector format',
        details: { selector },
      },
    };
  }

  /**
   * Anchor EPUB selector with unified result
   */
  private anchorEpubUnified(
    selector: EpubHighlightSelector,
    scopeElement?: Element
  ): UnifiedAnchorResult {
    const result = this.anchor(selector, scopeElement);

    if (result.range) {
      return {
        success: true,
        format: 'epub',
        range: result.range,
        status: result.status,
        confidence: result.confidence,
      };
    }

    // Determine specific error
    let error: AnchorError;
    if (!selector.fallback && !selector.position) {
      error = {
        code: 'SELECTOR_MISSING_DATA',
        message: 'EPUB selector has no fallback or position data',
        details: { cfi: selector.primary?.cfi },
      };
    } else {
      error = {
        code: 'TEXT_NOT_FOUND',
        message: 'Could not find text matching selector in document',
        details: {
          exact: selector.fallback?.exact?.slice(0, 50),
          hasPosition: !!selector.position,
        },
      };
    }

    console.warn('[HighlightAnchor] EPUB anchor failed:', error.message, error.details);

    return {
      success: false,
      format: 'epub',
      range: null,
      status: 'orphaned',
      confidence: 0,
      error,
    };
  }

  /**
   * Anchor PDF selector with unified result
   * Now supports text-based re-anchoring when textLayer is provided
   */
  private anchorPdfUnified(
    selector: PdfHighlightSelector,
    currentPage?: number,
    textLayer?: PdfTextLayer,
    pageWidth?: number,
    pageHeight?: number
  ): UnifiedAnchorResult {
    const page = selector.primary?.page;

    // Validate page
    if (page === undefined || page < 1) {
      const error: AnchorError = {
        code: 'INVALID_SELECTOR',
        message: 'PDF selector has invalid or missing page number',
        details: { page },
      };
      console.warn('[HighlightAnchor] PDF anchor failed:', error.message);
      return {
        success: false,
        format: 'pdf',
        status: 'orphaned',
        confidence: 0,
        error,
      };
    }

    // Check if page matches current view (optional validation)
    if (currentPage !== undefined && page !== currentPage) {
      return {
        success: true, // Not an error, just not visible
        format: 'pdf',
        page,
        rects: [],
        status: 'exact',
        confidence: 1.0,
        error: {
          code: 'PAGE_MISMATCH',
          message: `Highlight is on page ${page}, currently viewing page ${currentPage}`,
        },
      };
    }

    // Get rects from selector
    const rects: PdfRect[] = [];

    // Primary rects (multi-line selections)
    if (selector.rects && selector.rects.length > 0) {
      for (const rect of selector.rects) {
        if (this.isValidRect(rect)) {
          rects.push(rect);
        }
      }
    }

    // Fallback to region selector
    if (rects.length === 0 && selector.region) {
      const region = selector.region;
      const rect: PdfRect = {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
      };
      if (this.isValidRect(rect)) {
        rects.push(rect);
      } else {
        console.warn('[HighlightAnchor] Invalid region rect:', region);
      }
    }

    // If no rects yet, try text-based re-anchoring
    if (rects.length === 0 && selector.fallback && textLayer && pageWidth && pageHeight) {
      console.debug('[HighlightAnchor] Attempting PDF text-based re-anchoring');
      const textRects = this.anchorPdfByText(selector.fallback, textLayer, pageWidth, pageHeight);
      if (textRects.length > 0) {
        return {
          success: true,
          format: 'pdf',
          page,
          rects: textRects,
          status: 'fuzzy', // Text-based match is less precise
          confidence: 0.8,
        };
      }
    }

    if (rects.length === 0) {
      // All strategies failed
      if (selector.fallback) {
        const hasTextLayer = !!textLayer;
        console.debug('[HighlightAnchor] PDF text-based re-anchoring failed', {
          hasTextLayer,
          exact: selector.fallback.exact?.slice(0, 50),
        });
        return {
          success: false,
          format: 'pdf',
          page,
          status: 'orphaned',
          confidence: 0,
          error: {
            code: 'TEXT_NOT_FOUND',
            message: hasTextLayer
              ? 'Could not find text in PDF text layer'
              : 'PDF text re-anchoring requires textLayer option',
            details: {
              hasTextFallback: true,
              hasTextLayer,
              exact: selector.fallback.exact?.slice(0, 50),
            },
          },
        };
      }

      return {
        success: false,
        format: 'pdf',
        page,
        status: 'orphaned',
        confidence: 0,
        error: {
          code: 'SELECTOR_MISSING_DATA',
          message: 'PDF selector has no rect or charRects data',
        },
      };
    }

    return {
      success: true,
      format: 'pdf',
      page,
      rects,
      status: 'exact',
      confidence: 1.0,
    };
  }

  /**
   * Anchor PDF highlight using text search in the text layer
   * Similar strategy to EPUB TextQuote anchoring:
   * 1. Try exact text with prefix and suffix context
   * 2. Try with prefix only
   * 3. Try with suffix only
   * 4. Try exact text only
   */
  private anchorPdfByText(
    fallback: { exact?: string; prefix?: string; suffix?: string },
    textLayer: PdfTextLayer,
    pageWidth: number,
    pageHeight: number
  ): PdfRect[] {
    const { exact, prefix, suffix } = fallback;
    if (!exact) return [];

    // Build the full text content from all items
    const fullText = textLayer.items.map(item => item.text).join('');

    // Strategy 1: Match with full context (highest confidence)
    let matchStart = -1;
    let matchEnd = -1;

    if (prefix && suffix) {
      const pattern = prefix + exact + suffix;
      const index = fullText.indexOf(pattern);
      if (index !== -1) {
        matchStart = index + prefix.length;
        matchEnd = matchStart + exact.length;
      }
    }

    // Strategy 2: Match with prefix only
    if (matchStart === -1 && prefix) {
      const pattern = prefix + exact;
      const index = fullText.indexOf(pattern);
      if (index !== -1) {
        matchStart = index + prefix.length;
        matchEnd = matchStart + exact.length;
      }
    }

    // Strategy 3: Match with suffix only
    if (matchStart === -1 && suffix) {
      const pattern = exact + suffix;
      const index = fullText.indexOf(pattern);
      if (index !== -1) {
        matchStart = index;
        matchEnd = matchStart + exact.length;
      }
    }

    // Strategy 4: Match exact text only
    if (matchStart === -1) {
      const index = fullText.indexOf(exact);
      if (index !== -1) {
        matchStart = index;
        matchEnd = matchStart + exact.length;
      }
    }

    if (matchStart === -1) {
      return [];
    }

    // Convert character offsets to rects from the text layer
    return this.getRectsFromTextLayer(textLayer, matchStart, matchEnd, pageWidth, pageHeight);
  }

  /**
   * Get normalized rects from text layer for a character range
   */
  private getRectsFromTextLayer(
    textLayer: PdfTextLayer,
    startOffset: number,
    endOffset: number,
    pageWidth: number,
    pageHeight: number
  ): PdfRect[] {
    const rects: PdfRect[] = [];
    let currentOffset = 0;

    for (const item of textLayer.items) {
      const itemStart = currentOffset;
      const itemEnd = currentOffset + item.text.length;

      // Check if this item overlaps with our range
      if (itemEnd > startOffset && itemStart < endOffset) {
        // This item contains part of our selection
        if (item.charPositions && item.charPositions.length > 0) {
          // Use character-level positions for precise rects
          const charRects = this.getCharRectsInRange(
            item.charPositions,
            Math.max(0, startOffset - itemStart),
            Math.min(item.text.length, endOffset - itemStart),
            pageWidth,
            pageHeight
          );
          rects.push(...charRects);
        } else {
          // Fallback to item-level rect
          const normalizedRect: PdfRect = {
            x: item.x / pageWidth,
            y: item.y / pageHeight,
            width: item.width / pageWidth,
            height: item.height / pageHeight,
          };
          if (this.isValidRect(normalizedRect)) {
            rects.push(normalizedRect);
          }
        }
      }

      currentOffset = itemEnd;
      if (currentOffset >= endOffset) break;
    }

    return this.mergeAdjacentRects(rects);
  }

  /**
   * Get normalized rects for a character range within a text item
   */
  private getCharRectsInRange(
    chars: PdfCharPosition[],
    localStart: number,
    localEnd: number,
    pageWidth: number,
    pageHeight: number
  ): PdfRect[] {
    const rects: PdfRect[] = [];

    for (let i = localStart; i < localEnd && i < chars.length; i++) {
      const char = chars[i];
      if (char.char === ' ' || char.char === '\n') continue; // Skip whitespace

      const rect: PdfRect = {
        x: char.x / pageWidth,
        y: char.y / pageHeight,
        width: char.width / pageWidth,
        height: char.height / pageHeight,
      };

      if (this.isValidRect(rect)) {
        rects.push(rect);
      }
    }

    return rects;
  }

  /**
   * Merge adjacent character rects into line rects for cleaner rendering
   */
  private mergeAdjacentRects(rects: PdfRect[]): PdfRect[] {
    if (rects.length <= 1) return rects;

    const merged: PdfRect[] = [];
    let current = { ...rects[0] };
    const tolerance = 0.005; // 0.5% tolerance for "same line"

    for (let i = 1; i < rects.length; i++) {
      const rect = rects[i];

      // Check if on same line (similar y and height)
      const sameLine =
        Math.abs(rect.y - current.y) < tolerance &&
        Math.abs(rect.height - current.height) < tolerance;

      // Check if adjacent (next rect starts where current ends)
      const adjacent = Math.abs(rect.x - (current.x + current.width)) < tolerance * 2;

      if (sameLine && adjacent) {
        // Extend current rect
        current.width = rect.x + rect.width - current.x;
      } else {
        // Start new rect
        merged.push(current);
        current = { ...rect };
      }
    }
    merged.push(current);

    return merged;
  }

  /**
   * Validate a PDF rect has reasonable values
   */
  private isValidRect(rect: PdfRect): boolean {
    return (
      typeof rect.x === 'number' &&
      typeof rect.y === 'number' &&
      typeof rect.width === 'number' &&
      typeof rect.height === 'number' &&
      rect.x >= 0 &&
      rect.y >= 0 &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.x <= 1 &&
      rect.y <= 1 &&
      rect.width <= 1 &&
      rect.height <= 1
    );
  }

  /**
   * Anchor a selector to a DOM Range (EPUB only)
   * Strategy: CFI first → TextQuote fallback → Position last resort
   *
   * NOTE: For unified anchoring of both EPUB and PDF, use anchorUnified() instead.
   *
   * @param selector - The selector to anchor
   * @param scopeElement - Optional element to restrict search to (e.g., chapter)
   */
  anchor(selector: HighlightSelector, scopeElement?: Element): AnchorResult {
    // PDF selectors use a different rendering path (PdfAnnotationLayer with rect coords)
    // They shouldn't be anchored to DOM ranges - use anchorUnified() for PDF support
    if (!isEpubSelector(selector)) {
      console.warn('[HighlightAnchor] PDF selector passed to anchor() - use anchorUnified() instead');
      return { range: null, status: 'orphaned', confidence: 0 };
    }

    // From here, TypeScript knows selector is EpubHighlightSelector
    const epubSelector = selector;

    // Temporarily set scope if provided
    const previousScope = this.searchScope;
    if (scopeElement) {
      this.searchScope = scopeElement;
    }

    try {
      // 1. Try TextQuote first (most robust for reflow scenarios)
      // CFI can break if content changes, but TextQuote with context is resilient
      if (epubSelector.fallback) {
        const textResult = this.anchorByTextQuote(epubSelector.fallback);
        if (textResult.range) {
          return textResult;
        }
      }

      // 2. Try position fallback (character offsets) - only available on EPUB selectors
      if (epubSelector.position) {
        const posResult = this.anchorByPosition(
          epubSelector.position.start,
          epubSelector.position.end
        );
        if (posResult.range) {
          return posResult;
        }
      }

      // 3. Could not anchor
      return { range: null, status: 'orphaned', confidence: 0 };
    } finally {
      // Restore previous scope
      this.searchScope = previousScope;
    }
  }

  /**
   * Anchor using text quote with prefix/suffix context
   * This is the most robust method for surviving reflows
   */
  private anchorByTextQuote(selector: TextQuoteSelector): AnchorResult {
    const searchRoot = this.getSearchRoot();
    const textContent = searchRoot.textContent || '';
    const { exact, prefix, suffix } = selector;

    // Strategy 1: Match with full context (highest confidence)
    if (prefix && suffix) {
      const pattern = prefix + exact + suffix;
      const index = textContent.indexOf(pattern);
      if (index !== -1) {
        const start = index + prefix.length;
        const end = start + exact.length;
        return this.createRangeFromOffset(start, end, 'exact', 1.0);
      }
    }

    // Strategy 2: Match with prefix only
    if (prefix) {
      const pattern = prefix + exact;
      const index = textContent.indexOf(pattern);
      if (index !== -1) {
        const start = index + prefix.length;
        const end = start + exact.length;
        return this.createRangeFromOffset(start, end, 'exact', 0.9);
      }
    }

    // Strategy 3: Match with suffix only
    if (suffix) {
      const pattern = exact + suffix;
      const index = textContent.indexOf(pattern);
      if (index !== -1) {
        return this.createRangeFromOffset(index, index + exact.length, 'exact', 0.9);
      }
    }

    // Strategy 4: Match exact text only (lowest confidence, may hit wrong instance)
    const exactIndex = textContent.indexOf(exact);
    if (exactIndex !== -1) {
      return this.createRangeFromOffset(
        exactIndex,
        exactIndex + exact.length,
        'fuzzy',
        0.5
      );
    }

    return { range: null, status: 'orphaned', confidence: 0 };
  }

  /**
   * Anchor using character position offsets
   */
  private anchorByPosition(start: number, end: number): AnchorResult {
    const range = this.createRangeFromCharOffset(start, end);
    if (range) {
      return { range, status: 'fuzzy', confidence: 0.3 };
    }
    return { range: null, status: 'orphaned', confidence: 0 };
  }

  /**
   * Create a Range from character offsets in the document
   */
  private createRangeFromOffset(
    start: number,
    end: number,
    status: 'exact' | 'fuzzy' | 'orphaned',
    confidence: number
  ): AnchorResult {
    const range = this.createRangeFromCharOffset(start, end);
    if (range) {
      return { range, status, confidence };
    }
    return { range: null, status: 'orphaned', confidence: 0 };
  }

  /**
   * Create a DOM Range from character offsets
   * Walks the text nodes to find the correct positions
   */
  private createRangeFromCharOffset(start: number, end: number): Range | null {
    const range = this.doc.createRange();
    const searchRoot = this.getSearchRoot();
    const walker = this.doc.createTreeWalker(
      searchRoot,
      NodeFilter.SHOW_TEXT,
      null
    );

    let charCount = 0;
    let foundStart = false;
    let foundEnd = false;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const nodeLength = node.textContent?.length || 0;
      const nodeEnd = charCount + nodeLength;

      // Find start position
      if (!foundStart && start >= charCount && start < nodeEnd) {
        try {
          range.setStart(node, start - charCount);
          foundStart = true;
        } catch (e) {
          console.warn('[HighlightAnchor] Failed to set range start:', e);
          return null;
        }
      }

      // Find end position
      if (!foundEnd && end >= charCount && end <= nodeEnd) {
        try {
          range.setEnd(node, end - charCount);
          foundEnd = true;
          break;
        } catch (e) {
          console.warn('[HighlightAnchor] Failed to set range end:', e);
          return null;
        }
      }

      charCount = nodeEnd;
    }

    if (foundStart && foundEnd) {
      return range;
    }

    return null;
  }

  /**
   * Get viewport-relative rects from a Range
   * CRITICAL: Uses getClientRects() for multi-column support
   *
   * @param range - The DOM Range to get rects for
   * @param iframeRect - Bounding rect of the iframe element
   * @param containerRect - Bounding rect of the container element
   * @returns Array of DOMRects in container-relative coordinates
   */
  static getViewportRects(
    range: Range,
    iframeRect: DOMRect,
    containerRect: DOMRect
  ): DOMRect[] {
    // CRITICAL: Use getClientRects() not getBoundingClientRect()
    // getClientRects() returns individual rects for each line/column fragment
    // getBoundingClientRect() returns one bounding box (wrong for multi-column)
    const rects = Array.from(range.getClientRects());

    // Calculate offset from iframe to container coordinates
    const offsetX = iframeRect.left - containerRect.left;
    const offsetY = iframeRect.top - containerRect.top;

    // Transform rects to container-relative coordinates
    // Filter out empty/tiny rects that can occur at line breaks
    return rects
      .filter(r => r.width > 1 && r.height > 1)
      .map(r => new DOMRect(
        r.x + offsetX,
        r.y + offsetY,
        r.width,
        r.height
      ));
  }

  /**
   * Filter rects to only those visible in the container viewport
   *
   * @param rects - Array of rects to filter
   * @param containerWidth - Width of the visible container
   * @param containerHeight - Height of the visible container
   * @returns Array of visible rects
   */
  static filterVisibleRects(
    rects: DOMRect[],
    containerWidth: number,
    containerHeight: number
  ): DOMRect[] {
    return rects.filter(rect =>
      rect.right > 0 &&
      rect.left < containerWidth &&
      rect.bottom > 0 &&
      rect.top < containerHeight
    );
  }

  /**
   * Merge overlapping rects to reduce rendering load
   * Adjacent rects on the same line are merged into one
   */
  static mergeRects(rects: DOMRect[]): DOMRect[] {
    if (rects.length <= 1) return rects;

    // Sort by y position, then x position
    const sorted = [...rects].sort((a, b) => {
      const yDiff = a.y - b.y;
      if (Math.abs(yDiff) < 2) return a.x - b.x; // Same line
      return yDiff;
    });

    const merged: DOMRect[] = [];
    let current = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];

      // Check if on same line (y within 2px) and adjacent/overlapping
      const sameLine = Math.abs(current.y - next.y) < 2;
      const adjacent = next.x <= current.right + 2;

      if (sameLine && adjacent) {
        // Merge: extend current rect to include next
        current = new DOMRect(
          current.x,
          Math.min(current.y, next.y),
          Math.max(current.right, next.right) - current.x,
          Math.max(current.height, next.height)
        );
      } else {
        // Not mergeable, save current and start new
        merged.push(current);
        current = next;
      }
    }

    merged.push(current);
    return merged;
  }
}
