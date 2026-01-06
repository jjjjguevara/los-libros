/**
 * PDF Canvas View
 *
 * Displays all pages as a thumbnail grid when zoomed out.
 * Enables visual navigation and multi-page selection.
 */

export interface CanvasViewConfig {
  /** Thumbnail width in pixels. Default: 150 */
  thumbnailSize?: number;
  /** Gap between thumbnails. Default: 10 */
  gap?: number;
  /** Columns: 'auto' or fixed number. Default: 'auto' */
  columns?: 'auto' | number;
  /** Page width for aspect ratio calculation */
  pageWidth?: number;
  /** Page height for aspect ratio calculation */
  pageHeight?: number;
}

export interface CanvasViewCallbacks {
  /** Called when user clicks a page to navigate */
  onPageSelect: (page: number) => void;
  /** Called when user right-clicks with selected pages */
  onContextMenu: (pages: number[], x: number, y: number) => void;
  /** Get thumbnail for a page */
  getThumbnail: (page: number) => Promise<string>;
}

const DEFAULT_CONFIG: Required<CanvasViewConfig> = {
  thumbnailSize: 150,
  gap: 10,
  columns: 'auto',
  pageWidth: 612,   // US Letter at 72 DPI
  pageHeight: 792,
};

/**
 * Canvas view for thumbnail grid display
 */
export class PdfCanvasView {
  private container: HTMLElement;
  private canvasContainer: HTMLElement | null = null;
  private config: Required<CanvasViewConfig>;
  private callbacks: CanvasViewCallbacks;

  private selectedPages: Set<number> = new Set();
  private pageCount: number = 0;
  private thumbnailCache: Map<number, string> = new Map();
  private isVisible: boolean = false;

  constructor(
    container: HTMLElement,
    callbacks: CanvasViewCallbacks,
    config?: CanvasViewConfig
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Show the canvas view
   */
  show(): void {
    if (this.isVisible) return;

    this.isVisible = true;
    this.createContainer();

    // Fade in
    if (this.canvasContainer) {
      this.canvasContainer.style.opacity = '0';
      this.canvasContainer.style.transition = 'opacity 0.2s ease-in';
      requestAnimationFrame(() => {
        if (this.canvasContainer) {
          this.canvasContainer.style.opacity = '1';
        }
      });
    }
  }

  /**
   * Hide the canvas view
   */
  hide(): void {
    if (!this.isVisible) return;

    this.isVisible = false;
    if (this.canvasContainer) {
      this.canvasContainer.remove();
      this.canvasContainer = null;
    }
  }

  /**
   * Check if canvas view is visible
   */
  get visible(): boolean {
    return this.isVisible;
  }

  /**
   * Render thumbnails for all pages
   */
  async render(pageCount: number): Promise<void> {
    this.pageCount = pageCount;

    if (!this.canvasContainer) return;

    // Clear existing thumbnails
    this.canvasContainer.innerHTML = '';

    // Create thumbnail elements
    for (let page = 1; page <= pageCount; page++) {
      const thumbnail = this.createThumbnailElement(page);
      this.canvasContainer.appendChild(thumbnail);

      // Load thumbnail asynchronously
      this.loadThumbnail(thumbnail, page);
    }
  }

  /**
   * Create the canvas container
   */
  private createContainer(): void {
    this.canvasContainer = document.createElement('div');
    this.canvasContainer.className = 'pdf-canvas-view';

    // Calculate thumbnail height based on aspect ratio
    const aspectRatio = this.config.pageWidth / this.config.pageHeight;
    const thumbnailHeight = Math.round(this.config.thumbnailSize / aspectRatio);

    this.canvasContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-wrap: wrap;
      align-content: flex-start;
      justify-content: center;
      gap: ${this.config.gap}px;
      padding: 20px;
      overflow: auto;
      background: var(--background-secondary, #f5f5f5);
      z-index: 100;
    `;

    // Set up event handlers
    this.setupEventHandlers();

    this.container.appendChild(this.canvasContainer);
  }

  /**
   * Create a thumbnail element for a page
   */
  private createThumbnailElement(page: number): HTMLElement {
    // Calculate fixed dimensions based on aspect ratio
    const aspectRatio = this.config.pageWidth / this.config.pageHeight;
    const thumbnailWidth = this.config.thumbnailSize;
    const thumbnailHeight = Math.round(thumbnailWidth / aspectRatio);

    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-canvas-thumbnail';
    wrapper.dataset.page = String(page);
    wrapper.style.cssText = `
      position: relative;
      cursor: pointer;
      border: 2px solid transparent;
      border-radius: 4px;
      background: var(--background-primary, white);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
      width: ${thumbnailWidth}px;
      height: ${thumbnailHeight}px;
      flex-shrink: 0;
      overflow: hidden;
    `;

    const img = document.createElement('img');
    img.className = 'pdf-canvas-thumbnail-img';
    img.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: white;
    `;
    img.alt = `Page ${page}`;

    const label = document.createElement('span');
    label.className = 'pdf-canvas-thumbnail-label';
    label.textContent = String(page);
    label.style.cssText = `
      position: absolute;
      bottom: 4px;
      right: 4px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 500;
    `;

    // Loading placeholder
    const placeholder = document.createElement('div');
    placeholder.className = 'pdf-canvas-thumbnail-placeholder';
    placeholder.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--background-secondary, #f0f0f0);
      color: var(--text-muted, #888);
      font-size: 14px;
    `;
    placeholder.textContent = String(page);

    wrapper.appendChild(placeholder);
    wrapper.appendChild(img);
    wrapper.appendChild(label);

    return wrapper;
  }

  /**
   * Load thumbnail for a page
   */
  private async loadThumbnail(element: HTMLElement, page: number): Promise<void> {
    const img = element.querySelector('img') as HTMLImageElement;
    const placeholder = element.querySelector('.pdf-canvas-thumbnail-placeholder') as HTMLElement;

    try {
      // Check cache first
      let dataUrl = this.thumbnailCache.get(page);

      if (!dataUrl) {
        dataUrl = await this.callbacks.getThumbnail(page);
        this.thumbnailCache.set(page, dataUrl);
      }

      img.src = dataUrl;
      img.onload = () => {
        placeholder.style.display = 'none';
      };
    } catch (error) {
      console.error(`Failed to load thumbnail for page ${page}:`, error);
      placeholder.textContent = '!';
      placeholder.style.color = 'var(--text-error, red)';
    }
  }

  /**
   * Set up event handlers for selection and navigation
   */
  private setupEventHandlers(): void {
    if (!this.canvasContainer) return;

    // Click handler for selection/navigation
    this.canvasContainer.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('.pdf-canvas-thumbnail') as HTMLElement;
      if (!target) return;

      const page = parseInt(target.dataset.page!, 10);

      if (e.shiftKey) {
        // Range selection
        this.handleRangeSelection(page);
      } else if (e.metaKey || e.ctrlKey) {
        // Toggle selection
        this.toggleSelection(page);
      } else {
        // Single click - navigate to page
        this.callbacks.onPageSelect(page);
      }
    });

    // Context menu handler
    this.canvasContainer.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      const target = (e.target as HTMLElement).closest('.pdf-canvas-thumbnail') as HTMLElement;
      const page = target ? parseInt(target.dataset.page!, 10) : null;

      // If right-clicking an unselected page, select it
      if (page && !this.selectedPages.has(page)) {
        this.selectedPages.clear();
        this.selectedPages.add(page);
        this.updateSelectionUI();
      }

      const pages = Array.from(this.selectedPages).sort((a, b) => a - b);
      if (pages.length > 0) {
        this.callbacks.onContextMenu(pages, e.clientX, e.clientY);
      }
    });

    // Hover effects
    this.canvasContainer.addEventListener('mouseover', (e) => {
      const target = (e.target as HTMLElement).closest('.pdf-canvas-thumbnail') as HTMLElement;
      if (target) {
        target.style.borderColor = 'var(--interactive-accent, #007aff)';
        target.style.transform = 'scale(1.02)';
        target.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
      }
    });

    this.canvasContainer.addEventListener('mouseout', (e) => {
      const target = (e.target as HTMLElement).closest('.pdf-canvas-thumbnail') as HTMLElement;
      if (target && !this.selectedPages.has(parseInt(target.dataset.page!, 10))) {
        target.style.borderColor = 'transparent';
        target.style.transform = '';
        target.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
      }
    });

    // Keyboard shortcuts
    this.canvasContainer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.clearSelection();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        this.selectAll();
      }
    });

    // Make container focusable for keyboard events
    this.canvasContainer.tabIndex = 0;
  }

  /**
   * Toggle page selection
   */
  private toggleSelection(page: number): void {
    if (this.selectedPages.has(page)) {
      this.selectedPages.delete(page);
    } else {
      this.selectedPages.add(page);
    }
    this.updateSelectionUI();
  }

  /**
   * Handle Shift+click range selection
   */
  private lastSelectedPage: number = 1;
  private handleRangeSelection(page: number): void {
    const start = Math.min(this.lastSelectedPage, page);
    const end = Math.max(this.lastSelectedPage, page);

    for (let p = start; p <= end; p++) {
      this.selectedPages.add(p);
    }

    this.updateSelectionUI();
  }

  /**
   * Select all pages
   */
  selectAll(): void {
    for (let p = 1; p <= this.pageCount; p++) {
      this.selectedPages.add(p);
    }
    this.updateSelectionUI();
  }

  /**
   * Clear selection
   */
  clearSelection(): void {
    this.selectedPages.clear();
    this.updateSelectionUI();
  }

  /**
   * Get selected pages
   */
  getSelectedPages(): number[] {
    return Array.from(this.selectedPages).sort((a, b) => a - b);
  }

  /**
   * Update selection UI
   */
  private updateSelectionUI(): void {
    if (!this.canvasContainer) return;

    const thumbnails = this.canvasContainer.querySelectorAll('.pdf-canvas-thumbnail');
    thumbnails.forEach((thumb) => {
      const page = parseInt((thumb as HTMLElement).dataset.page!, 10);
      const isSelected = this.selectedPages.has(page);

      (thumb as HTMLElement).style.borderColor = isSelected
        ? 'var(--interactive-accent, #007aff)'
        : 'transparent';
      (thumb as HTMLElement).style.background = isSelected
        ? 'var(--interactive-accent-hover, rgba(0, 122, 255, 0.1))'
        : 'var(--background-primary, white)';
    });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<CanvasViewConfig>): void {
    Object.assign(this.config, config);

    if (this.canvasContainer) {
      this.canvasContainer.style.gap = `${this.config.gap}px`;

      // Update thumbnail sizes if thumbnailSize changed
      if (config.thumbnailSize !== undefined) {
        const aspectRatio = this.config.pageWidth / this.config.pageHeight;
        const thumbnailHeight = Math.round(this.config.thumbnailSize / aspectRatio);

        const thumbnails = this.canvasContainer.querySelectorAll('.pdf-canvas-thumbnail');
        thumbnails.forEach((thumb) => {
          (thumb as HTMLElement).style.width = `${this.config.thumbnailSize}px`;
          (thumb as HTMLElement).style.height = `${thumbnailHeight}px`;
        });
      }
    }
  }

  /**
   * Clear thumbnail cache
   */
  clearCache(): void {
    this.thumbnailCache.clear();
  }

  /**
   * Destroy the canvas view
   */
  destroy(): void {
    this.hide();
    this.thumbnailCache.clear();
    this.selectedPages.clear();
  }
}
