/**
 * PDF SVG Text Layer
 *
 * Renders text layer using SVG for crisp text at any zoom level.
 * Supports two rendering modes:
 * 1. Server SVG: Fetch pre-generated SVG from server
 * 2. Local data: Render text layer data (from WASM/MuPDF) directly as SVG
 *
 * Key benefits over HTML text layer:
 * - Vector rendering: text stays crisp at 16x zoom (infinite zoom)
 * - Simpler positioning: SVG viewBox handles coordinate transformation
 * - Better text selection: native SVG text elements
 * - DPI-independent: always sharp regardless of devicePixelRatio
 *
 * Sharpness optimizations:
 * - Uses crispEdges shape-rendering for sharp vector edges
 * - Pixel-snapped coordinates at low zoom for reduced anti-aliasing blur
 * - ViewBox scaling at extreme zoom to prevent premature rasterization
 * - Subpixel anti-aliasing CSS properties for macOS/WebKit
 */

import type { PdfTextLayerData, PdfTextItem } from '../types';

/**
 * CSS for crisp SVG text rendering
 * These properties optimize text sharpness across different browsers and platforms
 */
const CRISP_SVG_CSS = `
  display: block;
  overflow: visible;
  max-width: 100%;
  max-height: 100%;
  shape-rendering: crispEdges;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: subpixel-antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-feature-settings: "kern" 1;
`;

/** Function to fetch SVG text layer from server */
export type SvgTextLayerFetcher = (pdfId: string, page: number) => Promise<string>;

export interface SvgTextLayerConfig {
  /** Show text layer for debugging (makes text visible) */
  debug?: boolean;
  /** Default font family fallback chain */
  fontFamily?: string;
}

export interface SvgTextSelection {
  text: string;
  page: number;
  rects: DOMRect[];
}

export class PdfSvgTextLayer {
  private container: HTMLDivElement;
  private svgContainer: HTMLDivElement;
  private config: SvgTextLayerConfig;
  private currentSvg: SVGSVGElement | null = null;
  private currentPage = 0;
  // Store viewBox aspect ratio for dimension adjustments
  private viewBoxAspectRatio: number | null = null;
  // Current display scale for pixel-snapping decisions
  private currentScale = 1.0;
  // Store original PDF dimensions for viewBox updates during zoom
  private originalPdfWidth: number | null = null;
  private originalPdfHeight: number | null = null;

  /**
   * Pixel-snap a coordinate value at low zoom levels
   * At zoom <= 1.5, snap to nearest pixel to reduce anti-aliasing blur
   * At higher zoom, preserve sub-pixel precision for smooth scaling
   */
  private pixelSnap(value: number, scale: number): number {
    if (scale <= 1.5) {
      // At low zoom, snap to nearest 0.5 pixel for sharper edges
      return Math.round(value * 2) / 2;
    }
    return value;
  }

  /**
   * Calculate viewBox scaling factor for high zoom levels
   * At extreme zoom (>4x), scale viewBox to prevent premature rasterization
   * This keeps SVG coordinates in a reasonable range for the browser's renderer
   */
  private getViewBoxScale(displayScale: number): number {
    // At zoom > 4x, start scaling the viewBox to prevent rasterization
    // This essentially renders the SVG at a smaller coordinate space
    // while the CSS transform handles the visual scaling
    if (displayScale > 8) {
      return displayScale / 8; // Cap effective SVG scale at 8x
    }
    if (displayScale > 4) {
      return displayScale / 4; // Gradual transition from 4x to 8x
    }
    return 1.0;
  }

  constructor(parent: HTMLElement, config?: SvgTextLayerConfig) {
    this.config = config ?? {};

    // Outer container for positioning
    // z-index: 3 ensures SVG layer is above text layer (1) and annotation layer (2)
    this.container = document.createElement('div');
    this.container.className = 'pdf-svg-text-layer-container';
    this.container.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      pointer-events: auto;
      z-index: 3;
      user-select: text;
      -webkit-user-select: text;
    `;

    // Inner container for the SVG - uses flexbox to center SVG when aspect ratio differs
    this.svgContainer = document.createElement('div');
    this.svgContainer.className = 'pdf-svg-text-layer';
    this.svgContainer.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: text;
      -webkit-user-select: text;
    `;

    this.container.appendChild(this.svgContainer);
    parent.appendChild(this.container);
  }

  /**
   * Render SVG text layer by fetching from server
   *
   * @param pdfId - The PDF identifier
   * @param page - Page number (1-indexed)
   * @param width - Display width in pixels
   * @param height - Display height in pixels
   * @param fetcher - Function to fetch SVG text layer
   */
  async render(
    pdfId: string,
    page: number,
    width: number,
    height: number,
    fetcher: SvgTextLayerFetcher
  ): Promise<void> {
    try {
      this.currentPage = page;

      // Fetch SVG from server
      const svgText = await fetcher(pdfId, page);

      // Parse SVG
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');

      // Check for parsing errors
      const parseError = svgDoc.querySelector('parsererror');
      if (parseError) {
        console.error('[PdfSvgTextLayer] SVG parse error:', parseError.textContent);
        return;
      }

      const svg = svgDoc.documentElement as unknown as SVGSVGElement;

      // Parse viewBox to get original aspect ratio for proper scaling
      const viewBox = svg.getAttribute('viewBox');
      let adjustedWidth = width;
      let adjustedHeight = height;

      if (viewBox) {
        const parts = viewBox.split(/\s+/).map(Number);
        if (parts.length === 4) {
          const [, , vbWidth, vbHeight] = parts;
          if (vbWidth > 0 && vbHeight > 0) {
            const svgAspect = vbWidth / vbHeight;
            const containerAspect = width / height;
            this.viewBoxAspectRatio = svgAspect;

            // Adjust dimensions to match viewBox aspect ratio for pixel-perfect text alignment
            if (Math.abs(svgAspect - containerAspect) > 0.005) {
              if (containerAspect > svgAspect) {
                // Container is wider than SVG - use height and adjust width
                adjustedWidth = height * svgAspect;
              } else {
                // Container is taller than SVG - use width and adjust height
                adjustedHeight = width / svgAspect;
              }
            }
          }
        }
      }

      // Set SVG dimensions with aspect-ratio-adjusted values
      svg.setAttribute('width', `${adjustedWidth}px`);
      svg.setAttribute('height', `${adjustedHeight}px`);
      // Use 'xMidYMid meet' for uniform scaling that preserves aspect ratio
      // This ensures text remains crisp and properly positioned
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

      // Style SVG - DO NOT use width/height 100% as it overrides attribute values
      // and causes non-uniform scaling. Use adjusted pixel dimensions from attributes.
      // geometricPrecision forces vector-based scaling for crisp edges at any zoom
      svg.style.cssText = `
        display: block;
        overflow: visible;
        max-width: 100%;
        max-height: 100%;
        shape-rendering: geometricPrecision;
        text-rendering: geometricPrecision;
      `;

      // Apply debug mode if enabled (makes text visible)
      if (this.config.debug) {
        const style = svg.querySelector('style');
        if (style) {
          style.textContent = style.textContent?.replace(
            'fill: transparent',
            'fill: rgba(0, 0, 255, 0.3)'
          ) ?? '';
        }
      }

      // Clear and insert new SVG
      this.clear();
      this.svgContainer.appendChild(svg);
      this.currentSvg = svg;
    } catch (error) {
      console.error('[PdfSvgTextLayer] Failed to render:', error);
      // Re-throw so caller can fall back to HTML text layer
      throw error;
    }
  }

  /**
   * Render text layer from local data (WASM/MuPDF structured text)
   *
   * Creates SVG text elements with precise positioning from character bounding boxes.
   * This enables instant text layer rendering without server round-trip.
   *
   * @param textLayer - Text layer data from MuPDF structured text extraction
   * @param displayWidth - Display width in pixels
   * @param displayHeight - Display height in pixels
   * @param scale - Current display scale for pixel-snapping decisions (default 1.0)
   */
  renderFromTextData(
    textLayer: PdfTextLayerData,
    displayWidth: number,
    displayHeight: number,
    scale: number = 1.0
  ): void {
    this.currentPage = textLayer.page;
    this.currentScale = scale;

    // Calculate viewBox scaling for high zoom levels
    const viewBoxScale = this.getViewBoxScale(scale);

    // Original PDF dimensions - store for viewBox updates during zoom
    const pdfWidth = textLayer.width;
    const pdfHeight = textLayer.height;
    this.originalPdfWidth = pdfWidth;
    this.originalPdfHeight = pdfHeight;

    // At high zoom, scale down the viewBox to prevent premature rasterization
    // The CSS dimensions remain the same, so visual size is unchanged
    const scaledViewBoxWidth = pdfWidth / viewBoxScale;
    const scaledViewBoxHeight = pdfHeight / viewBoxScale;

    // Create SVG with viewBox (possibly scaled for high zoom)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${scaledViewBoxWidth} ${scaledViewBoxHeight}`);
    svg.setAttribute('width', `${displayWidth}px`);
    svg.setAttribute('height', `${displayHeight}px`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // Store aspect ratio for dimension updates
    this.viewBoxAspectRatio = pdfWidth / pdfHeight;

    // Style SVG for vector-crisp rendering
    // Use crispEdges at low zoom for pixel-aligned text, geometricPrecision at high zoom
    const shapeRendering = scale <= 1.5 ? 'crispEdges' : 'geometricPrecision';
    svg.style.cssText = `
      display: block;
      overflow: visible;
      max-width: 100%;
      max-height: 100%;
      shape-rendering: ${shapeRendering};
      text-rendering: geometricPrecision;
      -webkit-font-smoothing: subpixel-antialiased;
      -moz-osx-font-smoothing: grayscale;
    `;

    // Add style element for text rendering
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = `
      text {
        fill: ${this.config.debug ? 'rgba(0, 0, 255, 0.3)' : 'transparent'};
        stroke: none;
        white-space: pre;
        pointer-events: auto;
        cursor: text;
      }
    `;
    svg.appendChild(style);

    // Create text group for all text elements
    // Apply inverse scale transform when using viewBox scaling
    const textGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    textGroup.setAttribute('class', 'text-layer-items');
    if (viewBoxScale > 1) {
      // Scale down text coordinates to match the scaled viewBox
      textGroup.setAttribute('transform', `scale(${1 / viewBoxScale})`);
    }

    // Render each text item with pixel-snapping
    for (const item of textLayer.items) {
      const textEl = this.createTextElement(item, pdfHeight, scale);
      textGroup.appendChild(textEl);
    }

    svg.appendChild(textGroup);

    // Clear and insert new SVG
    this.clear();
    this.svgContainer.appendChild(svg);
    this.currentSvg = svg;
  }

  /**
   * Create an SVG text element from a text item
   *
   * @param item - Text item with position and content
   * @param pageHeight - Page height for coordinate transformation (PDF uses bottom-left origin)
   * @param scale - Current display scale for pixel-snapping decisions
   */
  private createTextElement(item: PdfTextItem, pageHeight: number, scale: number = 1.0): SVGTextElement {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');

    // PDF coordinate system: origin at bottom-left, Y increases upward
    // SVG coordinate system: origin at top-left, Y increases downward
    // Transform: svgY = pageHeight - pdfY - itemHeight
    const rawSvgY = pageHeight - item.y;

    // Apply pixel-snapping at low zoom for crisp edges
    const snappedX = this.pixelSnap(item.x, scale);
    const snappedY = this.pixelSnap(rawSvgY, scale);
    const snappedFontSize = this.pixelSnap(item.fontSize, scale);

    text.setAttribute('x', String(snappedX));
    text.setAttribute('y', String(snappedY));
    text.setAttribute('font-size', String(snappedFontSize));
    text.setAttribute('font-family', this.config.fontFamily ?? 'sans-serif');

    // Store bounding box as data attribute for selection/search
    text.dataset.bbox = JSON.stringify({
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    });

    // If we have character-level positions, use tspan elements for precise positioning
    if (item.charPositions && item.charPositions.length > 0) {
      for (const char of item.charPositions) {
        const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        const charRawSvgY = pageHeight - char.y;

        // Apply pixel-snapping to character positions
        const charSnappedX = this.pixelSnap(char.x, scale);
        const charSnappedY = this.pixelSnap(charRawSvgY, scale);

        tspan.setAttribute('x', String(charSnappedX));
        tspan.setAttribute('y', String(charSnappedY));

        if (char.fontSize !== item.fontSize) {
          const charSnappedFontSize = this.pixelSnap(char.fontSize, scale);
          tspan.setAttribute('font-size', String(charSnappedFontSize));
        }
        if (char.fontName) {
          tspan.setAttribute('font-family', char.fontName);
        }

        tspan.textContent = char.char;
        text.appendChild(tspan);
      }
    } else {
      // Fallback: use text content directly
      text.textContent = item.text;
    }

    return text;
  }

  /**
   * Get current text selection
   */
  getSelection(): SvgTextSelection | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return null;
    }

    const text = selection.toString().trim();
    if (!text) {
      return null;
    }

    return {
      text,
      page: this.currentPage,
      rects: this.getSelectionRects(),
    };
  }

  /**
   * Get selection rects relative to container
   */
  getSelectionRects(): DOMRect[] {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return [];
    }

    const range = selection.getRangeAt(0);
    const clientRects = range.getClientRects();
    if (clientRects.length === 0) {
      return [];
    }

    const containerRect = this.container.getBoundingClientRect();
    const result: DOMRect[] = [];

    // Merge adjacent rects on same line
    let currentRect: DOMRect | null = null;

    for (let i = 0; i < clientRects.length; i++) {
      const rect = clientRects[i];

      // Skip tiny rects
      if (rect.width < 1 || rect.height < 1) continue;

      // Convert to container coordinates
      const relX = rect.left - containerRect.left;
      const relY = rect.top - containerRect.top;

      if (currentRect && Math.abs(currentRect.y - relY) < 2) {
        // Same line - extend current rect
        const newRight = Math.max(currentRect.x + currentRect.width, relX + rect.width);
        const newLeft = Math.min(currentRect.x, relX);
        currentRect = new DOMRect(newLeft, currentRect.y, newRight - newLeft, currentRect.height);
      } else {
        // New line
        if (currentRect) {
          result.push(currentRect);
        }
        currentRect = new DOMRect(relX, relY, rect.width, rect.height);
      }
    }

    if (currentRect) {
      result.push(currentRect);
    }

    return result;
  }

  /**
   * Update dimensions (called when container resizes)
   * Uses stored viewBox aspect ratio for proper scaling
   */
  setDimensions(width: number, height: number): void {
    if (this.currentSvg) {
      let adjustedWidth = width;
      let adjustedHeight = height;

      // Use stored viewBox aspect ratio if available for consistent scaling
      if (this.viewBoxAspectRatio !== null) {
        const containerAspect = width / height;
        if (Math.abs(this.viewBoxAspectRatio - containerAspect) > 0.005) {
          if (containerAspect > this.viewBoxAspectRatio) {
            // Container is wider - use height and adjust width
            adjustedWidth = height * this.viewBoxAspectRatio;
          } else {
            // Container is taller - use width and adjust height
            adjustedHeight = width / this.viewBoxAspectRatio;
          }
        }
      }

      this.currentSvg.setAttribute('width', `${adjustedWidth}px`);
      this.currentSvg.setAttribute('height', `${adjustedHeight}px`);
    }
  }

  /**
   * Clear the text layer
   */
  clear(): void {
    this.svgContainer.innerHTML = '';
    this.currentSvg = null;
  }

  /**
   * Get current page number
   */
  getPage(): number {
    return this.currentPage;
  }

  /**
   * Get container element
   */
  getContainer(): HTMLDivElement {
    return this.container;
  }

  /**
   * Toggle debug mode (makes text visible)
   */
  setDebug(debug: boolean): void {
    this.config.debug = debug;

    if (this.currentSvg) {
      const style = this.currentSvg.querySelector('style');
      if (style) {
        if (debug) {
          style.textContent = style.textContent?.replace(
            'fill: transparent',
            'fill: rgba(0, 0, 255, 0.3)'
          ) ?? '';
        } else {
          style.textContent = style.textContent?.replace(
            'fill: rgba(0, 0, 255, 0.3)',
            'fill: transparent'
          ) ?? '';
        }
      }
    }
  }

  /**
   * Update for zoom changes (useful in tiled rendering mode)
   *
   * At high zoom in tiled mode, we may need to adjust the text layer
   * positioning to align with the visible tiles.
   *
   * @param zoom - Current zoom level
   * @param displayWidth - Display width in pixels
   * @param displayHeight - Display height in pixels
   */
  updateForZoom(zoom: number, displayWidth: number, displayHeight: number): void {
    this.currentScale = zoom;

    if (this.currentSvg) {
      // Update dimensions
      this.setDimensions(displayWidth, displayHeight);

      // Update shape rendering based on zoom level
      const shapeRendering = zoom <= 1.5 ? 'crispEdges' : 'geometricPrecision';
      this.currentSvg.style.shapeRendering = shapeRendering;

      // At very high zoom (>8x), the text layer may need viewBox adjustment
      // to prevent premature rasterization
      const viewBoxScale = this.getViewBoxScale(zoom);

      // Update viewBox if we have original PDF dimensions stored
      if (this.originalPdfWidth !== null && this.originalPdfHeight !== null) {
        const scaledViewBoxWidth = this.originalPdfWidth / viewBoxScale;
        const scaledViewBoxHeight = this.originalPdfHeight / viewBoxScale;
        this.currentSvg.setAttribute('viewBox', `0 0 ${scaledViewBoxWidth} ${scaledViewBoxHeight}`);
      }

      // Update text group transform to match viewBox scale
      const textGroup = this.currentSvg.querySelector('.text-layer-items');
      if (textGroup) {
        if (viewBoxScale > 1) {
          textGroup.setAttribute('transform', `scale(${1 / viewBoxScale})`);
        } else {
          textGroup.removeAttribute('transform');
        }
      }
    }
  }

  /**
   * Set visibility of the text layer
   */
  setVisible(visible: boolean): void {
    this.container.style.display = visible ? 'block' : 'none';
  }

  /**
   * Check if the text layer has content
   */
  hasContent(): boolean {
    return this.currentSvg !== null;
  }

  /**
   * Destroy the layer
   */
  destroy(): void {
    this.clear();
    this.container.remove();
  }
}
