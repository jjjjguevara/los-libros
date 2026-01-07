/**
 * PDF Page Element
 *
 * Self-contained element for rendering a single PDF page.
 * Includes canvas layer, text layer, and annotation layer.
 * Multiple instances can be created for multi-page display.
 */

import type { PdfTextLayer as TextLayerData, PdfTextLayerData } from '../types';
import type { HighlightColor } from '../types';
import { extractAsMarkdown, extractAsPlainText, prepareCopyData } from './smart-copy';
import { DarkModeRenderer } from './dark-mode-renderer';
import { MobileReflowRenderer, type ReflowConfig } from './mobile-reflow';

export type ReadingMode = 'device' | 'light' | 'sepia' | 'dark' | 'night';
export type RenderMode = 'page' | 'reflow';

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
  private reflowLayerEl: HTMLDivElement;

  private config: Required<PdfPageElementConfig>;
  private currentWidth = 0;
  private currentHeight = 0;
  private isRendered = false;
  private currentReadingMode: ReadingMode = 'light';
  private currentRenderMode: RenderMode = 'page';

  // Text layer data for smart copy
  private textLayerData: PdfTextLayerData | null = null;

  // Smart copy enabled (converts to Markdown on copy)
  private smartCopyEnabled = true;

  // Dark mode renderer for smart dark mode (preserves images)
  private darkModeRenderer: DarkModeRenderer | null = null;
  private useSmartDarkMode = false;
  // Track if smart dark mode needs to be reapplied after renders
  private smartDarkModeApplied = false;

  // Mobile reflow renderer
  private reflowRenderer: MobileReflowRenderer | null = null;

  // Callbacks
  private onSelectionCallback?: (page: number, text: string, rects: DOMRect[]) => void;
  private onHighlightClickCallback?: (annotationId: string, position: { x: number; y: number }) => void;

  constructor(config: PdfPageElementConfig) {
    this.config = {
      pageNumber: config.pageNumber,
      pixelRatio: config.pixelRatio ?? window.devicePixelRatio ?? 1,
      enableTextAntialiasing: config.enableTextAntialiasing ?? true,
      enableImageSmoothing: config.enableImageSmoothing ?? true,
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

    // Create text layer
    this.textLayerEl = document.createElement('div');
    this.textLayerEl.className = 'pdf-page-text-layer';
    this.textLayerEl.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      overflow: hidden;
      opacity: 0.2;
      line-height: 1;
      pointer-events: auto;
      user-select: text;
      -webkit-user-select: text;
    `;
    this.container.appendChild(this.textLayerEl);

    // Create annotation layer
    this.annotationLayerEl = document.createElement('div');
    this.annotationLayerEl.className = 'pdf-page-annotation-layer';
    this.annotationLayerEl.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
    `;
    this.container.appendChild(this.annotationLayerEl);

    // Create reflow layer (hidden by default)
    this.reflowLayerEl = document.createElement('div');
    this.reflowLayerEl.className = 'pdf-page-reflow-layer';
    this.reflowLayerEl.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      overflow-y: auto;
      display: none;
      background: white;
    `;
    this.container.appendChild(this.reflowLayerEl);

    // Setup selection listener
    this.setupSelectionListener();

    // Setup copy handler for smart copy
    this.setupCopyHandler();
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
  }

  /**
   * Render page content
   */
  async render(data: PageRenderData, scale: number): Promise<void> {
    // Render canvas
    await this.renderCanvas(data.imageBlob);

    // Render text layer if available
    if (data.textLayerData) {
      this.renderTextLayer(data.textLayerData, scale);
    }

    this.isRendered = true;

    // Re-apply smart dark mode if it was previously active
    if (this.smartDarkModeApplied && this.useSmartDarkMode) {
      await this.applySmartDarkMode();
    }
  }

  /**
   * Render canvas from image blob
   */
  private async renderCanvas(imageBlob: Blob): Promise<void> {
    const imageUrl = URL.createObjectURL(imageBlob);
    const image = new Image();

    return new Promise((resolve, reject) => {
      image.onload = () => {
        try {
          const pixelRatio = this.config.pixelRatio;

          // Set canvas size with pixel ratio
          this.canvas.width = Math.floor(this.currentWidth * pixelRatio);
          this.canvas.height = Math.floor(this.currentHeight * pixelRatio);
          this.canvas.style.width = `${this.currentWidth}px`;
          this.canvas.style.height = `${this.currentHeight}px`;

          // Scale context for HiDPI
          this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

          // Apply smoothing
          this.ctx.imageSmoothingEnabled = this.config.enableImageSmoothing;
          this.ctx.imageSmoothingQuality = 'high';

          // Clear and draw
          this.ctx.clearRect(0, 0, this.currentWidth, this.currentHeight);
          this.ctx.drawImage(image, 0, 0, this.currentWidth, this.currentHeight);

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
   */
  private renderTextLayer(data: TextLayerData, scale: number): void {
    this.textLayerEl.innerHTML = '';

    // Store text layer data for smart copy
    this.textLayerData = data;

    if (!data.items || data.items.length === 0) return;

    // Use page dimensions from data instead of hardcoded values
    const pageWidth = data.width || 612;  // Fallback to US Letter
    const pageHeight = data.height || 792;

    for (const item of data.items) {
      if (!item.text || item.text.trim() === '') continue;

      const span = document.createElement('span');
      span.textContent = item.text;

      // Position based on text item coordinates
      // Scale from PDF coordinates to display coordinates
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

      this.textLayerEl.appendChild(span);
    }
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
   * Setup copy handler for smart copy
   * Intercepts Ctrl+C/Cmd+C to provide Markdown-formatted text
   */
  private setupCopyHandler(): void {
    this.container.addEventListener('copy', (event: ClipboardEvent) => {
      if (!this.smartCopyEnabled || !this.textLayerData) return;

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;

      const selectedText = selection.toString().trim();
      if (!selectedText) return;

      // Prevent default copy behavior
      event.preventDefault();

      // For now, use the selected text directly as the primary content
      // The smart copy with formatting detection is available via getTextAsMarkdown()
      // when the selection spans the entire visible text and charPositions are available
      const plainText = selectedText;

      // Try to get markdown if we have the full data with charPositions
      let markdown = selectedText;
      if (this.textLayerData.items.some(item => item.charPositions && item.charPositions.length > 0)) {
        // We have char positions - use full markdown extraction
        // Note: This gives formatted output for the visible items
        markdown = extractAsMarkdown(this.textLayerData);
      }

      // Simple HTML escaping for selected text
      const html = selectedText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

      // Set clipboard data with multiple formats
      if (event.clipboardData) {
        event.clipboardData.setData('text/plain', plainText);
        event.clipboardData.setData('text/markdown', markdown);
        event.clipboardData.setData('text/html', html);
      }
    });
  }

  /**
   * Enable or disable smart copy
   */
  setSmartCopyEnabled(enabled: boolean): void {
    this.smartCopyEnabled = enabled;
  }

  /**
   * Get the current text layer data as Markdown
   */
  getTextAsMarkdown(): string {
    if (!this.textLayerData) return '';
    return extractAsMarkdown(this.textLayerData);
  }

  /**
   * Get the current text layer data as plain text
   */
  getTextAsPlainText(): string {
    if (!this.textLayerData) return '';
    return extractAsPlainText(this.textLayerData);
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
    // Handle reflow mode separately
    if (this.currentRenderMode === 'reflow') {
      this.applyReflowReadingMode();
      return;
    }

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

  /**
   * Enable or disable smart dark mode
   * When enabled, dark/night modes will preserve images from inversion
   */
  setSmartDarkMode(enabled: boolean): void {
    this.useSmartDarkMode = enabled;
    if (enabled && !this.darkModeRenderer) {
      this.darkModeRenderer = new DarkModeRenderer({
        preserveImages: true,
        imageSensitivity: 0.3,
      });
    }
    // Re-apply current reading mode with new setting
    if (this.currentReadingMode === 'dark' || this.currentReadingMode === 'night') {
      this.applyReadingModeStyles();
    }
  }

  /**
   * Apply smart dark mode to the current canvas
   * Returns immediately for CSS mode, or waits for canvas processing
   */
  async applySmartDarkMode(): Promise<void> {
    if (!this.darkModeRenderer || !this.useSmartDarkMode) return;

    // Apply dark mode with image preservation
    const success = this.darkModeRenderer.applyCanvasDarkMode(this.canvas);
    this.container.style.background = '#1e1e1e';

    if (success) {
      this.canvas.style.filter = 'none'; // Remove CSS filter since we processed canvas
      this.smartDarkModeApplied = true;
    } else {
      // CSS fallback was applied by the renderer
      this.smartDarkModeApplied = false;
    }
  }

  /**
   * Remove smart dark mode from the current canvas
   * Note: This doesn't restore the original image; it just clears the flag.
   * A re-render is required to get the original light-mode appearance.
   */
  removeSmartDarkMode(): void {
    this.smartDarkModeApplied = false;
    this.canvas.style.filter = '';
    this.container.style.background = 'white';
  }

  /**
   * Check if the current page likely contains images
   * Useful for deciding between CSS and canvas dark mode
   */
  async hasImages(blob: Blob): Promise<boolean> {
    if (!this.darkModeRenderer) {
      this.darkModeRenderer = new DarkModeRenderer();
    }
    return this.darkModeRenderer.detectImages(blob);
  }

  /**
   * Set render mode (page view or reflow view)
   */
  setRenderMode(mode: RenderMode): void {
    if (this.currentRenderMode === mode) return;

    this.currentRenderMode = mode;

    if (mode === 'reflow') {
      // Show reflow layer, hide canvas layers
      this.canvas.style.display = 'none';
      this.textLayerEl.style.display = 'none';
      this.reflowLayerEl.style.display = 'block';

      // Render reflow content if we have text data
      if (this.textLayerData) {
        this.renderReflow();
      }
    } else {
      // Show canvas layers, hide reflow layer
      this.canvas.style.display = 'block';
      this.textLayerEl.style.display = 'block';
      this.reflowLayerEl.style.display = 'none';
    }

    // Apply reading mode styles to the appropriate layer
    this.applyReadingModeStyles();
  }

  /**
   * Get current render mode
   */
  getRenderMode(): RenderMode {
    return this.currentRenderMode;
  }

  /**
   * Configure reflow renderer settings
   */
  setReflowConfig(config: ReflowConfig): void {
    if (!this.reflowRenderer) {
      this.reflowRenderer = new MobileReflowRenderer(config);
    } else {
      this.reflowRenderer.setConfig(config);
    }

    // Re-render if in reflow mode
    if (this.currentRenderMode === 'reflow' && this.textLayerData) {
      this.renderReflow();
    }
  }

  /**
   * Render content in reflow mode
   */
  private renderReflow(): void {
    if (!this.textLayerData) {
      this.reflowLayerEl.innerHTML = '<div class="reflow-empty">No text content available</div>';
      return;
    }

    // Create renderer if needed
    if (!this.reflowRenderer) {
      this.reflowRenderer = new MobileReflowRenderer();
    }

    // Inject styles if not already present
    this.injectReflowStyles();

    // Render the reflowed content
    this.reflowLayerEl.innerHTML = this.reflowRenderer.renderPage(this.textLayerData);

    // Apply reading mode to reflow content
    this.applyReflowReadingMode();
  }

  /**
   * Inject reflow CSS styles into the container
   */
  private injectReflowStyles(): void {
    const styleId = 'pdf-reflow-styles';
    if (this.container.querySelector(`#${styleId}`)) return;

    if (!this.reflowRenderer) {
      this.reflowRenderer = new MobileReflowRenderer();
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = this.reflowRenderer.getStyles();
    this.container.appendChild(style);
  }

  /**
   * Apply reading mode to reflow layer
   */
  private applyReflowReadingMode(): void {
    switch (this.currentReadingMode) {
      case 'device':
        const isDark = document.body.classList.contains('theme-dark');
        if (isDark) {
          this.reflowLayerEl.style.background = '#1e1e1e';
          this.reflowLayerEl.style.color = '#e0e0e0';
        } else {
          this.reflowLayerEl.style.background = 'white';
          this.reflowLayerEl.style.color = '#333';
        }
        break;
      case 'light':
        this.reflowLayerEl.style.background = 'white';
        this.reflowLayerEl.style.color = '#333';
        break;
      case 'sepia':
        this.reflowLayerEl.style.background = '#f4ecd8';
        this.reflowLayerEl.style.color = '#5b4636';
        break;
      case 'dark':
        this.reflowLayerEl.style.background = '#1e1e1e';
        this.reflowLayerEl.style.color = '#e0e0e0';
        break;
      case 'night':
        this.reflowLayerEl.style.background = '#1a1a1a';
        this.reflowLayerEl.style.color = '#c9b99a';
        break;
      default:
        this.reflowLayerEl.style.background = 'white';
        this.reflowLayerEl.style.color = '#333';
        break;
    }
  }

  /**
   * Get the reflowed HTML content (for external use)
   */
  getReflowedHtml(): string {
    if (!this.textLayerData) return '';

    if (!this.reflowRenderer) {
      this.reflowRenderer = new MobileReflowRenderer();
    }

    return this.reflowRenderer.renderPage(this.textLayerData);
  }

  /**
   * Show loading state
   */
  showLoading(): void {
    this.container.style.opacity = '0.7';
  }

  /**
   * Hide loading state
   */
  hideLoading(): void {
    this.container.style.opacity = '1';
  }

  /**
   * Clear rendered content
   */
  clear(): void {
    this.ctx.clearRect(0, 0, this.currentWidth, this.currentHeight);
    this.textLayerEl.innerHTML = '';
    this.annotationLayerEl.innerHTML = '';
    this.reflowLayerEl.innerHTML = '';
    this.isRendered = false;
    this.smartDarkModeApplied = false;
  }

  /**
   * Destroy element
   */
  destroy(): void {
    this.clear();
    this.container.remove();
  }
}
