/**
 * PDF Layout Calculator
 *
 * Calculates optimal page layout based on container size and settings.
 * Determines how many pages fit horizontally and their display dimensions.
 */

export type LayoutMode = 'single' | 'dual' | 'auto';

export interface LayoutConfig {
  /** Container width in pixels */
  containerWidth: number;
  /** Container height in pixels */
  containerHeight: number;
  /** Native PDF page width (at 72 DPI) */
  pageWidth: number;
  /** Native PDF page height (at 72 DPI) */
  pageHeight: number;
  /** Gap between pages in pixels. Default: 20 */
  gap?: number;
  /** Minimum zoom scale. Default: 0.5 */
  minScale?: number;
  /** Maximum zoom scale. Default: 3.0 */
  maxScale?: number;
  /** Container padding in pixels. Default: 20 */
  padding?: number;
  /** Layout mode. Default: 'auto' */
  layoutMode?: LayoutMode;
  /** User-specified scale (overrides auto-fit). Default: undefined */
  userScale?: number;
}

export interface LayoutResult {
  /** Number of pages that fit horizontally */
  pagesPerRow: number;
  /** Display width per page in pixels */
  pageDisplayWidth: number;
  /** Display height per page in pixels */
  pageDisplayHeight: number;
  /** Effective scale factor */
  scale: number;
  /** Total content width (all pages + gaps) */
  totalWidth: number;
  /** Whether single page should be centered */
  shouldCenter: boolean;
  /** Row height including gap */
  rowHeight: number;
}

const DEFAULT_GAP = 20;
const DEFAULT_PADDING = 20;
const DEFAULT_MIN_SCALE = 0.25;
const DEFAULT_MAX_SCALE = 3.0;

/**
 * Calculate optimal page layout for given container and page dimensions
 */
export function calculateOptimalLayout(config: LayoutConfig): LayoutResult {
  const gap = config.gap ?? DEFAULT_GAP;
  const padding = config.padding ?? DEFAULT_PADDING;
  const minScale = config.minScale ?? DEFAULT_MIN_SCALE;
  const maxScale = config.maxScale ?? DEFAULT_MAX_SCALE;
  const layoutMode = config.layoutMode ?? 'auto';

  const availableWidth = config.containerWidth - padding * 2;
  const availableHeight = config.containerHeight - padding * 2;

  // Page aspect ratio
  const pageAspect = config.pageWidth / config.pageHeight;

  // If user specified a scale, use it directly
  if (config.userScale !== undefined) {
    const scale = Math.max(minScale, Math.min(maxScale, config.userScale));
    const pageDisplayWidth = config.pageWidth * scale;
    const pageDisplayHeight = config.pageHeight * scale;

    // Calculate how many pages fit with this scale
    let pagesPerRow = 1;
    if (layoutMode === 'auto') {
      pagesPerRow = Math.max(1, Math.floor((availableWidth + gap) / (pageDisplayWidth + gap)));
    } else if (layoutMode === 'dual') {
      pagesPerRow = 2;
    }

    const totalWidth = pagesPerRow * pageDisplayWidth + (pagesPerRow - 1) * gap;

    return {
      pagesPerRow,
      pageDisplayWidth,
      pageDisplayHeight,
      scale,
      totalWidth,
      shouldCenter: pagesPerRow === 1 || totalWidth < availableWidth,
      rowHeight: pageDisplayHeight + gap,
    };
  }

  // Auto-fit logic based on layout mode
  if (layoutMode === 'single') {
    return calculateSinglePageLayout(
      availableWidth,
      availableHeight,
      config.pageWidth,
      config.pageHeight,
      minScale,
      maxScale,
      gap
    );
  }

  if (layoutMode === 'dual') {
    return calculateDualPageLayout(
      availableWidth,
      availableHeight,
      config.pageWidth,
      config.pageHeight,
      minScale,
      maxScale,
      gap
    );
  }

  // Auto mode: find the best fit
  return calculateAutoLayout(
    availableWidth,
    availableHeight,
    config.pageWidth,
    config.pageHeight,
    pageAspect,
    minScale,
    maxScale,
    gap
  );
}

/**
 * Calculate layout for single page mode (fit to container)
 */
function calculateSinglePageLayout(
  availableWidth: number,
  availableHeight: number,
  pageWidth: number,
  pageHeight: number,
  minScale: number,
  maxScale: number,
  gap: number
): LayoutResult {
  // Fit page to container while respecting scale limits
  const widthScale = availableWidth / pageWidth;
  const heightScale = availableHeight / pageHeight;
  const fitScale = Math.min(widthScale, heightScale);
  const scale = Math.max(minScale, Math.min(maxScale, fitScale));

  const pageDisplayWidth = pageWidth * scale;
  const pageDisplayHeight = pageHeight * scale;

  return {
    pagesPerRow: 1,
    pageDisplayWidth,
    pageDisplayHeight,
    scale,
    totalWidth: pageDisplayWidth,
    shouldCenter: true,
    rowHeight: pageDisplayHeight + gap,
  };
}

/**
 * Calculate layout for dual page mode (two pages side by side)
 */
function calculateDualPageLayout(
  availableWidth: number,
  availableHeight: number,
  pageWidth: number,
  pageHeight: number,
  minScale: number,
  maxScale: number,
  gap: number
): LayoutResult {
  // Fit two pages with gap
  const totalPageWidth = pageWidth * 2 + gap;
  const widthScale = availableWidth / totalPageWidth;
  const heightScale = availableHeight / pageHeight;
  const fitScale = Math.min(widthScale, heightScale);
  const scale = Math.max(minScale, Math.min(maxScale, fitScale));

  const pageDisplayWidth = pageWidth * scale;
  const pageDisplayHeight = pageHeight * scale;
  const totalWidth = pageDisplayWidth * 2 + gap;

  return {
    pagesPerRow: 2,
    pageDisplayWidth,
    pageDisplayHeight,
    scale,
    totalWidth,
    shouldCenter: totalWidth < availableWidth,
    rowHeight: pageDisplayHeight + gap,
  };
}

/**
 * Calculate auto layout (fit to vertical height, maximize horizontal pages)
 *
 * Strategy:
 * 1. Scale pages to exactly fit the available vertical height
 * 2. Calculate how many pages fit horizontally at that scale
 * 3. This ensures pages always fill the vertical space and shows as many as fit
 */
function calculateAutoLayout(
  availableWidth: number,
  availableHeight: number,
  pageWidth: number,
  pageHeight: number,
  pageAspect: number,
  minScale: number,
  maxScale: number,
  gap: number
): LayoutResult {
  // Step 1: Calculate scale to fit page height exactly to available vertical space
  const heightScale = availableHeight / pageHeight;
  const scale = Math.max(minScale, Math.min(maxScale, heightScale));

  // Step 2: Calculate page dimensions at this scale
  const pageDisplayHeight = pageHeight * scale;
  const pageDisplayWidth = pageWidth * scale;

  // Step 3: Calculate how many pages fit horizontally
  // Formula: availableWidth >= N * pageWidth + (N-1) * gap
  // Solving for N: N <= (availableWidth + gap) / (pageWidth + gap)
  const pagesPerRow = Math.max(1, Math.floor((availableWidth + gap) / (pageDisplayWidth + gap)));

  // Step 4: Calculate total width
  const totalWidth = pagesPerRow * pageDisplayWidth + (pagesPerRow - 1) * gap;

  return {
    pagesPerRow,
    pageDisplayWidth,
    pageDisplayHeight,
    scale,
    totalWidth,
    shouldCenter: totalWidth < availableWidth,
    rowHeight: pageDisplayHeight + gap,
  };
}

/**
 * Calculate total content height for scrolled mode
 */
export function calculateTotalContentHeight(
  pageCount: number,
  pagesPerRow: number,
  rowHeight: number,
  gap: number
): number {
  const totalRows = Math.ceil(pageCount / pagesPerRow);
  return totalRows * rowHeight - gap; // Remove last gap
}

/**
 * Calculate which page is visible at a given scroll position
 */
export function calculateVisiblePage(
  scrollTop: number,
  rowHeight: number,
  pagesPerRow: number
): number {
  const row = Math.floor(scrollTop / rowHeight);
  return row * pagesPerRow + 1;
}

/**
 * Calculate scroll position for a given page
 */
export function calculateScrollPositionForPage(
  page: number,
  pagesPerRow: number,
  rowHeight: number
): number {
  const row = Math.floor((page - 1) / pagesPerRow);
  return row * rowHeight;
}

/**
 * Calculate visible page range for virtualization
 */
export function calculateVisibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  pagesPerRow: number,
  totalPages: number,
  preloadRows: number = 1
): { start: number; end: number } {
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - preloadRows);
  const endRow = Math.ceil((scrollTop + viewportHeight) / rowHeight) + preloadRows;

  const start = startRow * pagesPerRow + 1;
  const end = Math.min(totalPages, (endRow + 1) * pagesPerRow);

  return { start: Math.max(1, start), end };
}
