/**
 * PDF Page Element
 *
 * Self-contained element for rendering a single PDF page.
 * Includes canvas layer, text layer, and annotation layer.
 * Multiple instances can be created for multi-page display.
 */

import type { PdfTextLayer as TextLayerData } from '../types';
import type { HighlightColor } from '../types';
import { VirtualizedTextLayer } from './virtualized-text-layer';
import { PdfSvgTextLayer, type SvgTextLayerFetcher } from './pdf-svg-text-layer';

export type ReadingMode = 'device' | 'light' | 'sepia' | 'dark' | 'night';
export type TextLayerMode = 'full' | 'virtualized' | 'svg' | 'disabled';

export interface PageRenderData {
  imageBlob: Blob;
  textLayerData?: TextLayerData;
}

export interface PdfPageElementConfig {
  /** Page number (1-indexed) */
  pageNumber: number;
  /** Pixel ratio for HiDPI */
  pixelRatio?: number;
  /** Enable text layer anti-aliasing */
  enableTextAntialiasing?: boolean;
  /** Enable image smoothing */
  enableImageSmoothing?: boolean;
  /** Text layer rendering mode. Default: 'svg' for crisp text at any zoom */
  textLayerMode?: TextLayerMode;
  /** PDF identifier (required for SVG text layer mode) */
  pdfId?: string;
  /** Function to fetch SVG text layer (required for SVG text layer mode) */
  svgTextLayerFetcher?: SvgTextLayerFetcher;
}

export interface PageHighlight {
  id: string;
  annotationId: string;
  color: HighlightColor;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
}

/**
 * Individual PDF page element with all layers
 */
export class PdfPageElement {
  private container: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private textLayerEl: HTMLDivElement;
  private annotationLayerEl: HTMLDivElement;

  private config: Omit<Required<PdfPageElementConfig>, 'pdfId' | 'svgTextLayerFetcher'> & Pick<PdfPageElementConfig, 'pdfId' | 'svgTextLayerFetcher'>;
  private currentWidth = 0;
  private currentHeight = 0;
  private isRendered = false;
  private currentReadingMode: ReadingMode = 'light';

  // Virtualized text layer for better performance
  private virtualizedTextLayer: VirtualizedTextLayer | null = null;

  // SVG text layer for crisp text at any zoom level
  private svgTextLayer: PdfSvgTextLayer | null = null;

  // Callbacks
  private onSelectionCallback?: (page: number, text: string, rects: DOMRect[]) => void;
  private onHighlightClickCallback?: (annotationId: string, position: { x: number; y: number }) => void;

  constructor(config: PdfPageElementConfig) {
    this.config = {
      pageNumber: config.pageNumber,
      pixelRatio: config.pixelRatio ?? window.devicePixelRatio ?? 1,
      enableTextAntialiasing: config.enableTextAntialiasing ?? true,
      enableImageSmoothing: config.enableImageSmoothing ?? true,
      textLayerMode: config.textLayerMode ?? 'svg', // Default to SVG for crisp text
      pdfId: config.pdfId,
      svgTextLayerFetcher: config.svgTextLayerFetcher,
    };

    // Create container
    this.container = document.createElement('div');
    this.container.className = 'pdf-page-element';
    this.container.dataset.page = String(config.pageNumber);
    this.container.style.cssText = `
      position: relative;
      background: white;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      overflow: hidden;
      flex-shrink: 0;
      contain: layout paint;
    `;

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pdf-page-canvas';
    this.canvas.style.cssText = `
      display: block;
      width: 100%;
      height: 100%;
    `;
    this.container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }
    this.ctx = ctx;

    // Create text layer - invisible but selectable for text selection
    this.textLayerEl = document.createElement('div');
    this.textLayerEl.className = 'pdf-page-text-layer';
    this.textLayerEl.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      overflow: hidden;
      opacity: 0.01;
      line-height: 1;
      pointer-events: auto;
      user-select: text;
      -webkit-user-select: text;
      z-index: 1;
    `;
    this.container.appendChild(this.textLayerEl);

    // Create annotation layer - above text layer for highlight visibility
    this.annotationLayerEl = document.createElement('div');
    this.annotationLayerEl.className = 'pdf-page-annotation-layer';
    this.annotationLayerEl.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      z-index: 2;
    `;
    this.container.appendChild(this.annotationLayerEl);

    // Create VirtualizedTextLayer for 'virtualized' mode
    // This provides DOM virtualization for pages with many text items
    if (this.config.textLayerMode === 'virtualized') {
      this.virtualizedTextLayer = new VirtualizedTextLayer(this.container, {
        mode: 'virtualized',
        bufferPx: 100,
        virtualizationThreshold: 50,
      });
    }

    // Create SVG text layer for 'svg' mode
    // SVG provides crisp text at any zoom level (up to 16x)
    if (this.config.textLayerMode === 'svg') {
      this.svgTextLayer = new PdfSvgTextLayer(this.container);
      // Disable HTML text layer pointer events - SVG layer handles text selection
      this.textLayerEl.style.pointerEvents = 'none';
    }

    // Setup selection listener
    this.setupSelectionListener();
  }

  /**
   * Get the DOM element
   */
  getElement(): HTMLDivElement {
    return this.container;
  }

  /**
   * Get page number
   */
  getPageNumber(): number {
    return this.config.pageNumber;
  }

  /**
   * Check if page is rendered
   */
  getIsRendered(): boolean {
    return this.isRendered;
  }

  /**
   * Set dimensions
   */
  setDimensions(width: number, height: number): void {
    this.currentWidth = width;
    this.currentHeight = height;

    this.container.style.width = `${width}px`;
    this.container.style.height = `${height}px`;

    // Update SVG text layer dimensions (SVG scales with viewBox)
    this.svgTextLayer?.setDimensions(width, height);
  }

  /**
   * Render page content
   */
  async render(data: PageRenderData, scale: number): Promise<void> {
    // Render canvas
    await this.renderCanvas(data.imageBlob);

    // Render text layer if available and not disabled
    if (this.config.textLayerMode !== 'disabled') {
      let svgRenderSucceeded = false;

      if (this.svgTextLayer && this.config.pdfId && this.config.svgTextLayerFetcher) {
        // Try SVG text layer for crisp text at any zoom level
        // Falls back to HTML text layer if server endpoint not available
        try {
          await this.svgTextLayer.render(
            this.config.pdfId,
            this.config.pageNumber,
            this.currentWidth,
            this.currentHeight,
            this.config.svgTextLayerFetcher
          );
          svgRenderSucceeded = true;
        } catch (error) {
          // SVG endpoint not available - fall back to HTML text layer
          console.debug('[PdfPageElement] SVG text layer unavailable, using HTML fallback');
        }
      }

      // Fall back to other text layer modes if SVG failed or not configured
      if (!svgRenderSucceeded) {
        if (this.virtualizedTextLayer && data.textLayerData) {
          // Use VirtualizedTextLayer for 'virtualized' mode
          this.virtualizedTextLayer.render(
            data.textLayerData,
            scale,
            0, // rotation - handled at container level
            this.currentWidth,
            this.currentHeight
          );
        } else if (data.textLayerData) {
          // Use inline text layer for 'full' mode
          this.renderTextLayer(data.textLayerData, scale);
        }
      }
    }

    this.isRendered = true;
  }

  /**
   * Render canvas from image blob
   *
   * Uses the image's native dimensions to preserve full DPI quality.
   * The server renders at the requested DPI (e.g., 300 DPI = 4.17× scale).
   * By using native dimensions, we avoid downscaling and preserve crispness.
   * CSS scales the canvas to display size for proper layout.
   */
  private async renderCanvas(imageBlob: Blob): Promise<void> {
    // Diagnostic: Log blob details before creating URL
    console.log('[PdfPageElement] renderCanvas called:', {
      page: this.config.pageNumber,
      blobType: imageBlob.type,
      blobSize: imageBlob.size,
      isValidType: ['image/png', 'image/jpeg', 'image/webp'].includes(imageBlob.type)
    });

    // Validate blob before attempting to render
    if (!imageBlob || imageBlob.size === 0) {
      throw new Error(`Invalid blob for page ${this.config.pageNumber}: empty or null`);
    }

    const imageUrl = URL.createObjectURL(imageBlob);
    const image = new Image();

    return new Promise((resolve, reject) => {
      image.onload = async () => {
        try {
          console.log('[PdfPageElement] Image loaded:', {
            page: this.config.pageNumber,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight
          });

          // NOTE: image.decode() was causing DOMException on some images
          // even after onload fires successfully. This appears to be a
          // Chromium/Electron issue with large images or memory pressure.
          // Skipping decode() - the drawImage call will decode synchronously
          // on the main thread, which is slightly less performant but reliable.
          // if (image.decode) {
          //   await image.decode();
          // }

          // Use the IMAGE's native dimensions to preserve DPI quality
          // This ensures we don't downscale the server's high-DPI output
          this.canvas.width = image.naturalWidth;
          this.canvas.height = image.naturalHeight;

          // CRITICAL: Set canvas CSS size to MATCH native dimensions to prevent downsampling.
          // Previously we set CSS to currentWidth/currentHeight which caused browser to
          // downsample the high-DPI image (e.g., 2819px → 400px), losing quality.
          // Instead, we set CSS to native size and use transform: scale() to fit the container.
          // This preserves full resolution - the browser scales a crisp image, not a blurry one.
          const scaleX = this.currentWidth / image.naturalWidth;
          const scaleY = this.currentHeight / image.naturalHeight;
          const fitScale = Math.min(scaleX, scaleY);

          // Canvas displays at native resolution, transformed to fit layout
          this.canvas.style.width = `${image.naturalWidth}px`;
          this.canvas.style.height = `${image.naturalHeight}px`;
          this.canvas.style.transformOrigin = '0 0';
          this.canvas.style.transform = `scale(${fitScale})`;

          // Reset context transform - draw at native resolution
          this.ctx.setTransform(1, 0, 0, 1, 0, 0);

          // Apply smoothing for image quality
          this.ctx.imageSmoothingEnabled = this.config.enableImageSmoothing;
          this.ctx.imageSmoothingQuality = 'high';

          // Clear and draw at native resolution (no JS-side scaling)
          this.ctx.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
          this.ctx.drawImage(image, 0, 0);

          URL.revokeObjectURL(imageUrl);
          resolve();
        } catch (error) {
          URL.revokeObjectURL(imageUrl);
          reject(error);
        }
      };

      image.onerror = () => {
        URL.revokeObjectURL(imageUrl);
        reject(new Error('Failed to load page image'));
      };

      image.src = imageUrl;
    });
  }

  /**
   * Render text layer for selection
   * Uses DocumentFragment for batched DOM insertion (better performance)
   */
  private renderTextLayer(data: TextLayerData, scale: number): void {
    this.textLayerEl.innerHTML = '';

    if (!data.items || data.items.length === 0) return;

    // Use actual page dimensions from server (not hardcoded 612x792)
    const pageWidth = data.width || 612;   // Fallback for older data
    const pageHeight = data.height || 792;

    // Use DocumentFragment for batched DOM insertion
    // This prevents multiple reflows and repaints
    const fragment = document.createDocumentFragment();

    for (const item of data.items) {
      if (!item.text || item.text.trim() === '') continue;

      const span = document.createElement('span');
      span.textContent = item.text;

      // Position based on text item coordinates
      // Scale from PDF coordinates to display coordinates using actual page dimensions
      const left = (item.x / pageWidth) * this.currentWidth;
      const top = (item.y / pageHeight) * this.currentHeight;
      const fontSize = Math.max(8, (item.height / pageHeight) * this.currentHeight);

      span.style.cssText = `
        position: absolute;
        left: ${left}px;
        top: ${top}px;
        font-size: ${fontSize}px;
        font-family: sans-serif;
        white-space: pre;
        transform-origin: 0 0;
        color: transparent;
      `;

      fragment.appendChild(span);
    }

    // Single DOM insertion for all spans
    this.textLayerEl.appendChild(fragment);
  }

  /**
   * Setup selection listener
   */
  private setupSelectionListener(): void {
    this.textLayerEl.addEventListener('mouseup', () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;

      const text = selection.toString().trim();
      if (!text) return;

      const rects = this.getSelectionRects();
      if (rects.length > 0 && this.onSelectionCallback) {
        this.onSelectionCallback(this.config.pageNumber, text, rects);
      }
    });
  }

  /**
   * Get selection rects relative to container
   */
  private getSelectionRects(): DOMRect[] {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return [];

    const range = selection.getRangeAt(0);
    const clientRects = range.getClientRects();
    const containerRect = this.container.getBoundingClientRect();

    const rects: DOMRect[] = [];
    for (let i = 0; i < clientRects.length; i++) {
      const rect = clientRects[i];
      rects.push(new DOMRect(
        rect.left - containerRect.left,
        rect.top - containerRect.top,
        rect.width,
        rect.height
      ));
    }

    return rects;
  }

  /**
   * Set selection callback
   */
  setOnSelection(callback: (page: number, text: string, rects: DOMRect[]) => void): void {
    this.onSelectionCallback = callback;
  }

  /**
   * Set highlights for this page
   */
  setHighlights(highlights: PageHighlight[]): void {
    this.annotationLayerEl.innerHTML = '';

    for (const highlight of highlights) {
      for (const rect of highlight.rects) {
        const el = document.createElement('div');
        el.className = 'pdf-highlight';
        el.dataset.annotationId = highlight.annotationId;

        // Scale rect from normalized (0-1) to display coordinates
        const left = rect.x * this.currentWidth;
        const top = rect.y * this.currentHeight;
        const width = rect.width * this.currentWidth;
        const height = rect.height * this.currentHeight;

        el.style.cssText = `
          position: absolute;
          left: ${left}px;
          top: ${top}px;
          width: ${width}px;
          height: ${height}px;
          background: ${this.getHighlightColor(highlight.color)};
          pointer-events: auto;
          cursor: pointer;
          mix-blend-mode: multiply;
        `;

        el.addEventListener('click', (e) => {
          if (this.onHighlightClickCallback) {
            this.onHighlightClickCallback(highlight.annotationId, {
              x: e.clientX,
              y: e.clientY,
            });
          }
        });

        this.annotationLayerEl.appendChild(el);
      }
    }
  }

  /**
   * Set highlight click callback
   */
  setOnHighlightClick(callback: (annotationId: string, position: { x: number; y: number }) => void): void {
    this.onHighlightClickCallback = callback;
  }

  /**
   * Get highlight color CSS value
   */
  private getHighlightColor(color: HighlightColor): string {
    const colors: Record<HighlightColor, string> = {
      yellow: 'rgba(255, 235, 59, 0.4)',
      green: 'rgba(76, 175, 80, 0.4)',
      blue: 'rgba(33, 150, 243, 0.4)',
      pink: 'rgba(233, 30, 99, 0.4)',
      purple: 'rgba(156, 39, 176, 0.4)',
      orange: 'rgba(255, 152, 0, 0.4)',
    };
    return colors[color] || colors.yellow;
  }

  /**
   * Set reading mode (applies CSS filters for theme)
   */
  setReadingMode(mode: ReadingMode): void {
    this.currentReadingMode = mode;
    this.applyReadingModeStyles();
  }

  /**
   * Apply reading mode styles to container and canvas
   */
  private applyReadingModeStyles(): void {
    switch (this.currentReadingMode) {
      case 'device':
        // Match Obsidian theme - detect from body class
        const isDark = document.body.classList.contains('theme-dark');
        if (isDark) {
          this.canvas.style.filter = 'invert(0.9) hue-rotate(180deg)';
          this.container.style.background = '#1e1e1e';
        } else {
          this.canvas.style.filter = 'none';
          this.container.style.background = 'white';
        }
        break;
      case 'light':
        // Pure light mode - slight brightness boost
        this.canvas.style.filter = 'brightness(1.02)';
        this.container.style.background = 'white';
        break;
      case 'sepia':
        // Warm sepia tone - easy on eyes
        this.canvas.style.filter = 'sepia(0.25) brightness(0.98)';
        this.container.style.background = '#f4ecd8';
        break;
      case 'dark':
        // Inverted colors for dark mode
        this.canvas.style.filter = 'invert(0.9) hue-rotate(180deg)';
        this.container.style.background = '#1e1e1e';
        break;
      case 'night':
        // Dark with warm tint - reduced blue light
        this.canvas.style.filter = 'invert(0.85) hue-rotate(180deg) sepia(0.2)';
        this.container.style.background = '#1a1a1a';
        break;
      default:
        // Fallback to light
        this.canvas.style.filter = 'none';
        this.container.style.background = 'white';
        break;
    }
  }

  // Loading indicator element
  private loadingIndicator: HTMLDivElement | null = null;

  /**
   * Show loading state
   *
   * Uses a subtle spinner in corner instead of opacity change to prevent
   * blank pages during fast scroll/zoom. If content is already rendered,
   * the existing canvas stays fully visible while loading new content.
   */
  showLoading(): void {
    // If content is already rendered, don't dim - keep showing existing content
    // while loading new version in background
    if (this.isRendered) {
      // Show subtle loading indicator in corner for re-renders (e.g., zoom quality upgrade)
      this.showLoadingIndicator();
      return;
    }

    // For unrendered pages, show a clean placeholder with subtle pulse
    // Never use opacity - it creates jarring blank appearance
    if (!this.loadingIndicator) {
      this.showLoadingIndicator();
    }
  }

  /**
   * Hide loading state
   */
  hideLoading(): void {
    this.hideLoadingIndicator();
    // Ensure full opacity (in case of edge cases)
    this.container.style.opacity = '1';
  }

  /**
   * Show subtle loading indicator in corner
   * This provides visual feedback without hiding content
   */
  private showLoadingIndicator(): void {
    if (this.loadingIndicator) return;

    this.loadingIndicator = document.createElement('div');
    this.loadingIndicator.className = 'pdf-page-loading-indicator';
    this.loadingIndicator.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(128, 128, 128, 0.3);
      border-top-color: rgba(128, 128, 128, 0.8);
      border-radius: 50%;
      animation: pdf-page-spin 0.8s linear infinite;
      z-index: 10;
      pointer-events: none;
    `;

    // Inject keyframes if not already present
    if (!document.getElementById('pdf-page-loading-keyframes')) {
      const style = document.createElement('style');
      style.id = 'pdf-page-loading-keyframes';
      style.textContent = `
        @keyframes pdf-page-spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }

    this.container.appendChild(this.loadingIndicator);
  }

  /**
   * Hide loading indicator
   */
  private hideLoadingIndicator(): void {
    if (this.loadingIndicator) {
      this.loadingIndicator.remove();
      this.loadingIndicator = null;
    }
  }

  /**
   * Clear rendered content
   */
  clear(): void {
    this.ctx.clearRect(0, 0, this.currentWidth, this.currentHeight);
    this.textLayerEl.innerHTML = '';
    this.annotationLayerEl.innerHTML = '';
    // Clear VirtualizedTextLayer if present
    this.virtualizedTextLayer?.clear();
    // Clear SVG text layer if present
    this.svgTextLayer?.clear();
    // Hide loading indicator
    this.hideLoadingIndicator();
    this.isRendered = false;
  }

  /**
   * Reset element for reuse with a new page number
   * Used by PageElementPool for element recycling
   */
  reset(pageNumber: number): void {
    this.clear();
    this.config.pageNumber = pageNumber;
    this.container.dataset.page = String(pageNumber);

    // Reset opacity and loading state
    this.container.style.opacity = '1';
    this.hideLoadingIndicator();

    // Clear callbacks (new page, new callbacks)
    this.onSelectionCallback = undefined;
    this.onHighlightClickCallback = undefined;
  }

  /**
   * Detach from DOM without destroying (for pool release)
   */
  detach(): void {
    if (this.container.parentElement) {
      this.container.remove();
    }
  }

  /**
   * Destroy element
   */
  destroy(): void {
    this.clear();
    // Destroy VirtualizedTextLayer if present
    if (this.virtualizedTextLayer) {
      this.virtualizedTextLayer.destroy();
      this.virtualizedTextLayer = null;
    }
    // Destroy SVG text layer if present
    if (this.svgTextLayer) {
      this.svgTextLayer.destroy();
      this.svgTextLayer = null;
    }
    // Clean up loading indicator
    this.hideLoadingIndicator();
    this.container.remove();
  }
}
