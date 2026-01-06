/**
 * PDF Highlight Service
 *
 * Bridges the existing HighlightService with PDF-specific operations.
 * Handles PDF-specific selector creation, page-based filtering, and
 * coordinate normalization.
 */

import { HighlightService } from './highlight-service';
import type {
  Highlight,
  HighlightColor,
  PdfHighlightSelector,
  PdfHighlightRect,
} from '../library/types';
import type { PdfHighlight } from '../reader/renderer/pdf/pdf-annotation-layer';

/**
 * Options for creating a PDF highlight
 */
export interface CreatePdfHighlightOptions {
  /** Book/PDF document ID */
  bookId: string;
  /** Page number (1-based) */
  page: number;
  /** Selected text */
  text: string;
  /** Highlight color */
  color?: HighlightColor;
  /** User annotation */
  annotation?: string;
  /** Normalized rects (0-1 coordinates) for the highlight */
  rects: PdfHighlightRect[];
  /** Text before selection for context */
  prefix?: string;
  /** Text after selection for context */
  suffix?: string;
}

/**
 * PDF-specific highlight service
 */
export class PdfHighlightService {
  constructor(private highlightService: HighlightService) {}

  /**
   * Create a highlight from PDF text selection
   */
  async createHighlight(options: CreatePdfHighlightOptions): Promise<Highlight> {
    const {
      bookId,
      page,
      text,
      color = 'yellow',
      annotation,
      rects,
      prefix,
      suffix,
    } = options;

    // Calculate the bounding box from all rects
    const boundingRect = this.calculateBoundingRect(rects);

    // Build PDF-specific selector
    const selector: PdfHighlightSelector = {
      format: 'pdf',
      primary: {
        type: 'PdfPageSelector',
        page,
        position: boundingRect ? { x: boundingRect.x, y: boundingRect.y } : undefined,
      },
      fallback: {
        type: 'PdfTextQuoteSelector',
        page,
        exact: text,
        prefix,
        suffix,
      },
      region: boundingRect
        ? {
            type: 'PdfRegionSelector',
            page,
            x: boundingRect.x,
            y: boundingRect.y,
            width: boundingRect.width,
            height: boundingRect.height,
          }
        : undefined,
      rects,
    };

    // Create the highlight using the base service
    // Use page-based locator format for the cfi field (legacy compatibility)
    const highlight = await this.highlightService.createHighlight(
      bookId,
      text,
      `page:${page}`, // PDF locator format
      color,
      {
        chapter: `Page ${page}`,
        pagePercent: 0, // Will be calculated based on total pages
        annotation,
        spineIndex: page - 1, // Use page as spine index for PDFs
        textQuote: {
          exact: text,
          prefix,
          suffix,
        },
      }
    );

    // Update the highlight with PDF-specific selector
    // The base service creates an EPUB selector, so we need to override it
    const updatedHighlight: Highlight = {
      ...highlight,
      selector,
    };

    // Save the updated highlight
    const indexHighlights = this.highlightService.getHighlights(bookId);
    const idx = indexHighlights.findIndex((h) => h.id === highlight.id);
    if (idx >= 0) {
      indexHighlights[idx] = updatedHighlight;
    }

    return updatedHighlight;
  }

  /**
   * Get highlights for a specific page
   */
  getPageHighlights(bookId: string, page: number): Highlight[] {
    const allHighlights = this.highlightService.getHighlights(bookId);
    return allHighlights.filter((h) => {
      // Check if this is a PDF highlight
      if (h.selector && 'format' in h.selector && h.selector.format === 'pdf') {
        const pdfSelector = h.selector as PdfHighlightSelector;
        return pdfSelector.primary.page === page;
      }
      // Legacy: check cfi for page locator
      if (h.cfi?.startsWith('page:')) {
        const highlightPage = parseInt(h.cfi.replace('page:', ''), 10);
        return highlightPage === page;
      }
      return false;
    });
  }

  /**
   * Get all PDF highlights for a document
   */
  getPdfHighlights(bookId: string): Highlight[] {
    const allHighlights = this.highlightService.getHighlights(bookId);
    return allHighlights.filter((h) => {
      // Check for PDF selector
      if (h.selector && 'format' in h.selector && h.selector.format === 'pdf') {
        return true;
      }
      // Legacy: check cfi for page locator
      return h.cfi?.startsWith('page:');
    });
  }

  /**
   * Convert Highlight to PdfHighlight for rendering
   */
  toPdfHighlight(highlight: Highlight): PdfHighlight | null {
    if (!highlight.selector || !('format' in highlight.selector)) {
      return null;
    }

    if (highlight.selector.format !== 'pdf') {
      return null;
    }

    const pdfSelector = highlight.selector as PdfHighlightSelector;

    return {
      id: highlight.id,
      annotationId: highlight.id,
      color: highlight.color,
      page: pdfSelector.primary.page,
      rects: pdfSelector.rects || (pdfSelector.region
        ? [
            {
              x: pdfSelector.region.x,
              y: pdfSelector.region.y,
              width: pdfSelector.region.width,
              height: pdfSelector.region.height,
            },
          ]
        : []),
    };
  }

  /**
   * Convert multiple highlights to PdfHighlights for rendering
   */
  toPdfHighlights(highlights: Highlight[]): PdfHighlight[] {
    return highlights
      .map((h) => this.toPdfHighlight(h))
      .filter((h): h is PdfHighlight => h !== null);
  }

  /**
   * Get PdfHighlights ready for rendering on a specific page
   */
  getPagePdfHighlights(bookId: string, page: number): PdfHighlight[] {
    const highlights = this.getPageHighlights(bookId, page);
    return this.toPdfHighlights(highlights);
  }

  /**
   * Update a highlight's color
   */
  async updateHighlightColor(
    bookId: string,
    highlightId: string,
    color: HighlightColor
  ): Promise<Highlight | undefined> {
    return this.highlightService.updateHighlight(bookId, highlightId, { color });
  }

  /**
   * Update a highlight's annotation
   */
  async updateHighlightAnnotation(
    bookId: string,
    highlightId: string,
    annotation: string
  ): Promise<Highlight | undefined> {
    return this.highlightService.updateHighlight(bookId, highlightId, { annotation });
  }

  /**
   * Delete a highlight
   */
  async deleteHighlight(bookId: string, highlightId: string): Promise<boolean> {
    return this.highlightService.deleteHighlight(bookId, highlightId);
  }

  /**
   * Get highlight by ID
   */
  getHighlight(bookId: string, highlightId: string): Highlight | undefined {
    const highlights = this.highlightService.getHighlights(bookId);
    return highlights.find((h) => h.id === highlightId);
  }

  /**
   * Calculate page progress percentage
   */
  calculatePagePercent(page: number, totalPages: number): number {
    if (totalPages <= 0) return 0;
    return Math.round((page / totalPages) * 100);
  }

  /**
   * Calculate bounding rect from multiple rects
   */
  private calculateBoundingRect(rects: PdfHighlightRect[]): PdfHighlightRect | null {
    if (rects.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const rect of rects) {
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.width);
      maxY = Math.max(maxY, rect.y + rect.height);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  /**
   * Get context text around a position
   * Used for building robust selectors
   */
  static getContextText(
    fullText: string,
    startOffset: number,
    endOffset: number,
    contextLength: number = 32
  ): { prefix: string; suffix: string } {
    const prefix = fullText.slice(Math.max(0, startOffset - contextLength), startOffset);
    const suffix = fullText.slice(endOffset, endOffset + contextLength);
    return { prefix, suffix };
  }
}
