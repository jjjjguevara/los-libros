/**
 * EPUB Renderer
 *
 * Custom renderer that replaces epub.js with:
 * - Server-based content delivery
 * - CSS multi-column pagination
 * - Continuous scroll mode
 * - SVG highlight overlay
 */

import type {
  ParsedBook,
  ChapterContent,
  RendererConfig,
  ReadingLocation,
  NavigationTarget,
  RendererEvents,
  RendererEventListener,
  SpineItem,
  DisplayMode,
  ThemeColors,
  RenderedHighlight,
  HighlightColor,
  AnchoredHighlight,
} from './types';
import type { Highlight } from '../../library/types';
import { DEFAULT_RENDERER_CONFIG } from './types';
import { ApiClient } from './api-client';
import { Paginator } from './paginator';
import { Scroller } from './scroller';
import { HighlightOverlay } from './overlay';
import { SelectionHandler } from './selection';
import { HighlightAnchor } from './highlight-anchor';
import { getObsidianThemeColors, isObsidianDarkMode } from '../reader-settings';

/**
 * Content provider interface - implemented by both ApiClient and ProviderAdapter
 */
export interface ContentProvider {
  getBook(bookId: string): Promise<ParsedBook>;
  uploadBook(data: ArrayBuffer, filename?: string): Promise<ParsedBook>;
  isChapterCached(bookId: string, href: string): boolean;
  getChapter(bookId: string, href: string, includeHighlights?: boolean): Promise<ChapterContent>;
  preloadChapter(bookId: string, href: string): void;
  clearChapterCache?(bookId?: string): void;
  /** Get resource URL for embedding in HTML (data URL or server URL) */
  getResourceAsDataUrl?(bookId: string, href: string): Promise<string>;
}

/**
 * Theme color definitions
 */
const THEME_COLORS: Record<string, ThemeColors> = {
  // System theme uses dynamic Obsidian colors - see getSystemThemeColors()
  system: {
    background: '#ffffff',
    foreground: '#333333',
    linkColor: '#0066cc',
    highlightColor: 'rgba(0, 102, 204, 0.3)',
  },
  light: {
    background: '#ffffff',
    foreground: '#1a1a1a',
    linkColor: '#0066cc',
    highlightColor: 'rgba(255, 255, 0, 0.3)',
  },
  dark: {
    background: '#1a1a1a',
    foreground: '#e0e0e0',
    linkColor: '#6bb3ff',
    highlightColor: 'rgba(255, 255, 0, 0.2)',
  },
  sepia: {
    background: '#f4ecd8',
    foreground: '#5b4636',
    linkColor: '#7c5e3c',
    highlightColor: 'rgba(255, 200, 100, 0.3)',
  },
  night: {
    background: '#000000',
    foreground: '#ffcc66',
    linkColor: '#ffcc66',
    highlightColor: 'rgba(255, 204, 102, 0.2)',
  },
  paper: {
    background: '#f5f5f0',
    foreground: '#1a1a1a',
    linkColor: '#4a5568',
    highlightColor: 'rgba(255, 255, 0, 0.3)',
  },
  forest: {
    background: '#1a2e1a',
    foreground: '#a8d8a8',
    linkColor: '#7cb87c',
    highlightColor: 'rgba(168, 216, 168, 0.2)',
  },
};

/**
 * Get theme colors for system theme from Obsidian
 */
function getSystemThemeColors(): ThemeColors {
  const obsidian = getObsidianThemeColors();
  return {
    background: obsidian.bg,
    foreground: obsidian.text,
    linkColor: obsidian.link,
    highlightColor: obsidian.selection,
  };
}

/**
 * EPUB Renderer class
 */
export class EpubRenderer {
  private container: HTMLElement;
  private config: RendererConfig;
  private api: ContentProvider;

  // Book state
  private book: ParsedBook | null = null;
  private bookId: string = '';

  // Content display
  private iframe: HTMLIFrameElement | null = null;
  private contentContainer: HTMLElement | null = null;
  private paginator: Paginator | null = null;
  private scroller: Scroller | null = null;
  private overlay: HighlightOverlay | null = null;
  private selection: SelectionHandler | null = null;

  // Navigation state
  private currentSpineIndex = 0;
  private currentLocation: ReadingLocation | null = null;
  private locationHistory: ReadingLocation[] = [];

  // Page tracking for accurate progress calculation
  private chapterPageCounts: Map<number, number> = new Map();
  private estimatedPagesPerChapter = 20; // fallback estimate

  // Event listeners
  private listeners: Map<keyof RendererEvents, Set<RendererEventListener<any>>> = new Map();

  // Loading state
  private isLoading = false;
  private loadingChapter: string | null = null;
  private isNavigating = false; // Lock for chapter navigation to prevent overlapping

  // Event forwarding AbortController to prevent duplicate listeners
  private eventForwardingController: AbortController | null = null;

  // Scroll tracking AbortController for scrolled mode
  private scrollTrackingController: AbortController | null = null;

  // Chapter windowing for paginated mode (performance optimization)
  // Keep 5 chapters loaded for faster scrolling: 2 before + current + 2 after
  private loadedChapters: Set<number> = new Set();
  private chapterElements: Map<number, HTMLElement> = new Map();
  private windowSize = 5; // Number of chapters to keep loaded
  private lastChapterIndex = 0; // Track for scroll direction detection
  private isLoadingChapters = false; // Prevent concurrent loads

  // Track mouse position at parent document level for accurate popup positioning
  // This avoids coordinate issues with CSS columns inside the iframe
  private lastParentMousePosition = { x: 0, y: 0 };
  private parentMouseTrackingController: AbortController | null = null;
  private isModeSwitching = false; // Prevent windowing during mode switch

  // Theme observer for Obsidian theme changes
  private themeObserver: MutationObserver | null = null;

  // Highlight re-anchoring state
  private storedHighlights: Highlight[] = [];
  private reanchorTimeout: number | null = null;

  constructor(container: HTMLElement, api: ContentProvider, config?: Partial<RendererConfig>) {
    this.container = container;
    this.api = api;
    this.config = { ...DEFAULT_RENDERER_CONFIG, ...config };

    this.setupContainer();
    this.setupThemeObserver();
    this.setupParentMouseTracking();
  }

  /**
   * Set up mouse tracking for accurate popup positioning
   * Must be called after iframe document is ready
   */
  private setupParentMouseTracking(): void {
    // Initial setup - we'll set up iframe tracking when document is ready
    this.parentMouseTrackingController?.abort();
    this.parentMouseTrackingController = new AbortController();
  }

  /**
   * Set up mouse tracking inside the iframe document
   * This translates iframe coordinates to parent viewport coordinates
   */
  private setupIframeMouseTracking(): void {
    const doc = this.iframe?.contentDocument;
    if (!doc) return;

    // Track mouse movement inside iframe and translate to parent coordinates
    doc.addEventListener('mousemove', (e: MouseEvent) => {
      const iframeRect = this.iframe?.getBoundingClientRect();
      if (iframeRect) {
        this.lastParentMousePosition = {
          x: e.clientX + iframeRect.left,
          y: e.clientY + iframeRect.top,
        };
      }
    });

    // Track mouseup for final position
    doc.addEventListener('mouseup', (e: MouseEvent) => {
      const iframeRect = this.iframe?.getBoundingClientRect();
      if (iframeRect) {
        this.lastParentMousePosition = {
          x: e.clientX + iframeRect.left,
          y: e.clientY + iframeRect.top,
        };
      }
    });
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Set up the container element
   */
  private setupContainer(): void {
    this.container.style.position = 'relative';
    this.container.style.overflow = 'hidden';
    this.container.classList.add('epub-renderer');

    // Create iframe for isolated content
    this.iframe = document.createElement('iframe');
    this.iframe.style.cssText = `
      width: 100%;
      height: 100%;
      border: none;
      background: transparent;
    `;
    this.iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
    this.container.appendChild(this.iframe);

    // Initialize iframe document
    const doc = this.iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style id="renderer-styles"></style>
          <style id="theme-styles"></style>
          <style id="book-styles"></style>
        </head>
        <body>
          <div id="viewport-wrapper">
            <div id="content-container"></div>
          </div>
        </body>
        </html>
      `);
      doc.close();

      this.contentContainer = doc.getElementById('content-container');
      this.applyTheme();
      this.applyRendererStyles();
    }

    // Create highlight overlay (outside iframe for proper event handling)
    // Pass click handler to emit highlightClicked event when user clicks on existing highlights
    this.overlay = new HighlightOverlay(
      this.container,
      this.iframe,
      (annotationId, position) => this.emit('highlightClicked', { annotationId, position })
    );

    // Set up selection handler
    if (this.iframe.contentDocument) {
      console.log('[Renderer] Setting up SelectionHandler');
      this.selection = new SelectionHandler(
        this.iframe.contentDocument,
        this.config,
        (selection) => this.handleSelection(selection)
      );
      // Set up mouse tracking inside iframe for accurate popup positioning
      this.setupIframeMouseTracking();
    } else {
      console.warn('[Renderer] No contentDocument - SelectionHandler not created');
    }

    // Set up resize observer
    const resizeObserver = new ResizeObserver(() => this.handleResize());
    resizeObserver.observe(this.container);

    // Set up event forwarding from iframe to parent
    this.setupEventForwarding();
  }

  /**
   * Set up observer for Obsidian theme changes
   * Automatically re-applies theme when Obsidian switches between light/dark mode
   */
  private setupThemeObserver(): void {
    // Don't observe if document.body doesn't exist (SSR)
    if (typeof document === 'undefined' || !document.body) return;

    this.themeObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          // Only re-apply if using system theme
          if (this.config.theme === 'system') {
            console.log('[Renderer] Obsidian theme changed, re-applying system theme');
            this.applyTheme();
          }
        }
      }
    });

    this.themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  /**
   * Set up event forwarding from iframe to parent for keyboard and click events
   */
  private setupEventForwarding(): void {
    const doc = this.iframe?.contentDocument;
    if (!doc) return;

    // Abort previous listeners to prevent duplicates
    if (this.eventForwardingController) {
      this.eventForwardingController.abort();
    }
    this.eventForwardingController = new AbortController();
    const signal = this.eventForwardingController.signal;

    // Handle keyboard events in iframe for navigation
    // We handle them here directly instead of forwarding to avoid double-handling
    doc.addEventListener('keydown', (e) => {
      console.log('[Renderer] iframe keydown:', e.key, 'repeat:', e.repeat);
      // Handle navigation keys directly
      switch (e.key) {
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) this.prev(); // Ignore key repeat
          return;
        case 'ArrowRight':
        case 'PageDown':
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) this.next(); // Ignore key repeat
          return;
        case ' ':
          // Space scrolls/pages down (with shift scrolls up)
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) {
            if (e.shiftKey) {
              this.prev();
            } else {
              this.next();
            }
          }
          return;
        case 'Home':
          e.preventDefault();
          this.display({ type: 'spine', spineIndex: 0 });
          return;
        case 'End':
          e.preventDefault();
          if (this.book) {
            this.display({ type: 'spine', spineIndex: this.book.spine.length - 1 });
          }
          return;
      }

      // For other keys, forward to parent window for handling
      const newEvent = new KeyboardEvent('keydown', {
        key: e.key,
        code: e.code,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(newEvent);
    }, { signal });

    // Forward click events for page navigation (left/right zones)
    doc.addEventListener('click', (e) => {
      // Only forward clicks that aren't on links or interactive elements
      const target = e.target as Element;
      if (target.closest('a, button, input, textarea, select')) {
        return;
      }

      // Get click position relative to iframe
      const iframeRect = this.iframe?.getBoundingClientRect();
      if (!iframeRect) return;

      // Calculate position in parent container coordinates
      const clientX = e.clientX + iframeRect.left;
      const clientY = e.clientY + iframeRect.top;

      // Dispatch click event on parent container
      const newEvent = new MouseEvent('click', {
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
      });
      this.container.dispatchEvent(newEvent);
    }, { signal });

    // Handle wheel events for live gesture-based page turning in paginated mode
    doc.addEventListener('wheel', (e) => {
      if (this.config.mode === 'paginated' && this.paginator) {
        e.preventDefault();

        // Determine the primary scroll axis
        const isHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
        const delta = isHorizontal ? e.deltaX : e.deltaY;

        // Pass the delta to the paginator for live gesture handling
        // Use a sensitivity multiplier for better trackpad response
        // Negative because wheel delta is inverted relative to drag direction
        const sensitivity = 1.5;
        this.paginator.handleGestureInput(-delta * sensitivity);
      }
    }, { passive: false, signal });
  }

  /**
   * Load a book by ID (server-side) or from ArrayBuffer (client-side upload)
   */
  async load(bookIdOrBuffer: string | ArrayBuffer): Promise<void> {
    console.log('[EpubRenderer] Starting load');
    this.emit('loading', true);
    this.isLoading = true;

    try {
      if (typeof bookIdOrBuffer === 'string') {
        this.bookId = bookIdOrBuffer;
        console.log('[EpubRenderer] Getting book:', bookIdOrBuffer);
        this.book = await this.api.getBook(bookIdOrBuffer);
        console.log('[EpubRenderer] Book loaded:', this.book?.metadata?.title);
      } else {
        // Upload book to server first
        console.log('[EpubRenderer] Uploading book');
        this.book = await this.api.uploadBook(bookIdOrBuffer);
        this.bookId = this.book.id;
        console.log('[EpubRenderer] Book uploaded:', this.book?.metadata?.title);
      }

      // Initialize display mode handler
      if (this.config.mode === 'paginated') {
        console.log('[EpubRenderer] Creating paginator');
        this.paginator = new Paginator(
          this.iframe!,
          this.config,
          (page) => this.handlePageChange(page),
          () => this.applyRendererStyles() // Style update for first-page transitions
        );
        // Set up highlight overlay transform sync after a short delay for DOM to settle
        setTimeout(() => this.setupHighlightTransformSync(), 100);
      } else {
        console.log('[EpubRenderer] Creating scroller');
        this.scroller = new Scroller(
          this.iframe!,
          this.config,
          (scrollY) => this.handleScroll(scrollY)
        );
        // Set up scroll tracking for highlights
        setTimeout(() => this.setupScrollHighlightSync(), 100);
      }

      // Load all chapters for both modes - this enables seamless navigation
      // For paginated mode: CSS columns flow content horizontally, paginator handles page turns
      // For scrolled mode: chapters stack vertically, scroller handles scrolling
      console.log('[EpubRenderer] Loading all chapters for continuous reading');
      await this.loadAllChapters();
      console.log('[EpubRenderer] All chapters loaded')

      this.emit('loading', false);
      console.log('[EpubRenderer] Load complete');
    } catch (error) {
      console.error('[EpubRenderer] Load error:', error);
      this.emit('error', error as Error);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  // ============================================================================
  // Navigation
  // ============================================================================

  /**
   * Navigate to a location
   */
  async display(target?: NavigationTarget, options?: { instant?: boolean }): Promise<void> {
    if (!this.book) {
      throw new Error('No book loaded');
    }

    const instant = options?.instant ?? false;

    if (!target) {
      // Display first page - content is already loaded, just navigate
      if (this.config.mode === 'scrolled') {
        this.scrollToChapterElement(0, instant);
      } else {
        await this.navigateToChapterPage(0);
      }
      return;
    }

    switch (target.type) {
      case 'cfi':
        await this.navigateToCfi(target.cfi, instant);
        break;
      case 'href':
        await this.navigateToHref(target.href, target.hash);
        break;
      case 'percentage':
        await this.navigateToPercentage(target.percentage);
        break;
      case 'spine':
        if (this.config.mode === 'scrolled') {
          this.scrollToChapterElement(target.spineIndex, instant);
        } else {
          // Navigate to the chapter page, with optional page offset within chapter
          await this.navigateToChapterPage(target.spineIndex, target.offset);
        }
        break;
      case 'page':
        await this.navigateToPage(target.pageNumber);
        break;
    }
  }

  /**
   * Go to next page (paginated) or scroll down (scrolled)
   */
  async next(): Promise<void> {
    if (this.config.mode === 'paginated' && this.paginator) {
      // With all chapters loaded, just navigate to next page
      // Chapter tracking is handled by updateCurrentChapterFromPage()
      this.paginator.nextPage();
      this.updateCurrentChapterFromPage();
      // Always update location for real-time progress bar updates
      this.updateLocation();
    } else if (this.scroller) {
      // In continuous scroll mode, all chapters are loaded - just scroll down
      this.scroller.scrollDown();
      // Chapter tracking is handled by setupScrollChapterTracking
      this.updateLocation();
    }
  }

  /**
   * Go to previous page (paginated) or scroll up (scrolled)
   */
  async prev(): Promise<void> {
    if (this.config.mode === 'paginated' && this.paginator) {
      // With all chapters loaded, just navigate to previous page
      // Chapter tracking is handled by updateCurrentChapterFromPage()
      this.paginator.prevPage();
      this.updateCurrentChapterFromPage();
      // Always update location for real-time progress bar updates
      this.updateLocation();
    } else if (this.scroller) {
      // In continuous scroll mode, all chapters are loaded - just scroll up
      this.scroller.scrollUp();
      // Chapter tracking is handled by setupScrollChapterTracking
      this.updateLocation();
    }
  }

  /**
   * Get per-chapter page info from the book-wide page number
   * Returns the page number within the current chapter and the total pages in that chapter
   */
  private getChapterPageInfo(bookWidePage: number): { pageInChapter: number; totalPagesInChapter: number } | null {
    const doc = this.iframe?.contentDocument;
    if (!doc || !this.book) return null;

    const container = doc.getElementById('content-container');
    if (!container) return null;

    const pageWidth = container.clientWidth + this.config.columnGap;
    const currentOffset = bookWidePage * pageWidth;

    // Find the current chapter element
    const currentChapter = doc.querySelector(`.epub-chapter[data-chapter-index="${this.currentSpineIndex}"]`) as HTMLElement;
    if (!currentChapter || currentChapter.classList.contains('epub-chapter-placeholder')) {
      return null;
    }

    // Get chapter boundaries
    const chapterStart = currentChapter.offsetLeft;
    const chapterEnd = chapterStart + currentChapter.scrollWidth;

    // Calculate pages in this chapter
    const chapterStartPage = Math.floor(chapterStart / pageWidth);
    const chapterEndPage = Math.ceil(chapterEnd / pageWidth);
    const totalPagesInChapter = Math.max(1, chapterEndPage - chapterStartPage);

    // Calculate current page within chapter (1-indexed for display)
    const pageInChapter = Math.max(1, Math.min(totalPagesInChapter, bookWidePage - chapterStartPage + 1));

    return { pageInChapter, totalPagesInChapter };
  }

  /**
   * Update current chapter index based on the current page position (paginated mode)
   * With all chapters loaded, we determine which chapter is visible by checking
   * which chapter element contains the currently visible content.
   */
  private updateCurrentChapterFromPage(): void {
    const doc = this.iframe?.contentDocument;
    if (!doc || !this.paginator) return;

    const pageInfo = this.paginator.getCurrentPage();
    const container = doc.getElementById('content-container');
    if (!container) return;

    // Calculate the current x-offset being viewed
    const pageWidth = container.clientWidth + this.config.columnGap;
    const currentOffset = pageInfo.current * pageWidth;

    // Only check VISIBLE chapters (those that are loaded, not placeholders)
    // Hidden placeholders have offsetLeft=0 and would break the calculation
    const visibleChapters = Array.from(doc.querySelectorAll('.epub-chapter:not(.epub-chapter-placeholder)')) as HTMLElement[];

    // Sort by offsetLeft to ensure correct order
    visibleChapters.sort((a, b) => a.offsetLeft - b.offsetLeft);

    // Find which visible chapter contains this offset
    for (let i = visibleChapters.length - 1; i >= 0; i--) {
      const chapter = visibleChapters[i];
      if (chapter.offsetLeft <= currentOffset) {
        const newIndex = parseInt(chapter.dataset.chapterIndex || '0', 10);
        if (newIndex !== this.currentSpineIndex) {
          this.currentSpineIndex = newIndex;
          console.log(`[EpubRenderer] Now in chapter ${newIndex}`);
          this.updateLocation();

          // Update chapter window for paginated mode (load/unload adjacent chapters)
          this.updateChapterWindow(newIndex);
        }
        break;
      }
    }
  }

  /**
   * Go to a specific chapter by index
   */
  async goToChapter(index: number): Promise<void> {
    if (index >= 0 && index < (this.book?.spine.length ?? 0)) {
      if (this.config.mode === 'scrolled') {
        // In continuous scroll mode, scroll to the chapter element
        this.scrollToChapterElement(index);
      } else {
        // In paginated mode, navigate to the page where this chapter starts
        await this.navigateToChapterPage(index);
      }
    }
  }

  /**
   * Scroll to a chapter element (for scrolled mode)
   * @param instant - Use instant scroll (for initial load) vs smooth scroll (for navigation)
   */
  private scrollToChapterElement(index: number, instant = false): void {
    const doc = this.iframe?.contentDocument;
    if (!doc) return;

    const chapter = doc.querySelector(`.epub-chapter[data-chapter-index="${index}"]`);
    if (chapter) {
      chapter.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'start' });
      this.currentSpineIndex = index;
      this.updateLocation();
    }
  }

  /**
   * Navigate to the page where a chapter starts (for paginated mode)
   * @param index - The chapter index
   * @param pageOffset - Optional page offset within the chapter (0 = start, 'end' = last page)
   */
  private async navigateToChapterPage(index: number, pageOffset?: number | 'end'): Promise<void> {
    const doc = this.iframe?.contentDocument;
    if (!doc || !this.paginator) return;

    // Ensure the target chapter and its neighbors are loaded (for windowing)
    if (!this.loadedChapters.has(index)) {
      console.log(`[EpubRenderer] Loading chapter ${index} before navigation`);
      await this.updateChapterWindow(index);
      // Wait for layout to settle after loading
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const chapter = doc.querySelector(`.epub-chapter[data-chapter-index="${index}"]`) as HTMLElement;
    if (!chapter) return;

    const container = doc.getElementById('content-container');
    if (!container) return;

    // Calculate the page where this chapter starts
    // The chapter's offsetLeft tells us its position in the column layout
    const pageWidth = container.clientWidth + this.config.columnGap;
    const chapterStartPage = Math.floor(chapter.offsetLeft / pageWidth);

    // Calculate target page based on offset
    let targetPage = chapterStartPage;
    if (pageOffset === 'end') {
      // Go to the last page of this chapter
      // Find the next chapter to determine the end of this chapter
      const nextChapter = doc.querySelector(`.epub-chapter[data-chapter-index="${index + 1}"]`) as HTMLElement;
      if (nextChapter) {
        const nextChapterStartPage = Math.floor(nextChapter.offsetLeft / pageWidth);
        targetPage = nextChapterStartPage - 1;
      } else {
        // This is the last chapter, go to the last page of the book
        targetPage = this.paginator.getCurrentPage().total - 1;
      }
    } else if (typeof pageOffset === 'number') {
      targetPage = chapterStartPage + pageOffset;
    }

    this.paginator.goToPage(targetPage);
    this.currentSpineIndex = index;
    this.updateLocation();

    // Update chapter window to ensure adjacent chapters are loaded
    await this.updateChapterWindow(index);
  }

  /**
   * Get current location
   */
  getLocation(): ReadingLocation | null {
    return this.currentLocation;
  }

  // ============================================================================
  // Display Mode
  // ============================================================================

  /**
   * Set display mode (paginated or scrolled)
   */
  async setMode(mode: DisplayMode): Promise<void> {
    if (mode === this.config.mode) return;

    // Disable windowing during mode switch to prevent content unloading
    // while we're navigating to the target position
    this.isModeSwitching = true;

    // Save book-wide progress percentage (0-100) for position restoration
    const currentLocation = this.currentLocation;
    let bookPercentage = currentLocation?.percentage || 0;

    // Calculate percentage from current position based on current mode
    const oldMode = this.config.mode;
    if (oldMode === 'paginated' && this.paginator) {
      const pageInfo = this.paginator.getCurrentPage();
      bookPercentage = pageInfo.total > 0 ? (pageInfo.current / pageInfo.total) * 100 : 0;
    } else if (oldMode === 'scrolled' && this.scroller) {
      bookPercentage = this.scroller.getScrollProgress() * 100;
    }

    // Also save progress within current chapter for fine-grained restoration
    const progressInChapter = this.config.mode === 'scrolled' ? this.getScrollProgressInChapter() :
      (currentLocation?.pageInChapter || 0) / Math.max(1, currentLocation?.totalPagesInChapter || 1);

    this.config.mode = mode;

    // Switch handlers - content is already loaded (all chapters in DOM)
    // We just need to switch the mode handler and re-apply styles
    if (mode === 'paginated') {
      // Clean up scrolled mode resources
      this.scroller?.destroy();
      this.scroller = null;

      // Abort scroll tracking listeners from scrolled mode
      if (this.scrollTrackingController) {
        this.scrollTrackingController.abort();
        this.scrollTrackingController = null;
      }
      this.paginator = new Paginator(
        this.iframe!,
        this.config,
        (page) => this.handlePageChange(page),
        () => this.applyRendererStyles() // Style update for first-page transitions
      );

      // Apply paginated mode styles (CSS columns)
      this.applyRendererStyles();

      // Wait for layout to reflow with new column styles
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Initialize paginator with the merged content
      await this.paginator.initialize();

      // Navigate to the saved book percentage position
      const pageInfo = this.paginator.getCurrentPage();
      const targetPage = Math.round((bookPercentage / 100) * pageInfo.total);
      this.paginator.goToPage(targetPage);

      // Wait for navigation to complete before re-enabling windowing
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Update current chapter based on new position
      this.updateCurrentChapterFromPage();

      // Set up highlight transform sync for paginated mode
      this.setupHighlightTransformSync();

      // Re-enable windowing and apply it for the current position
      this.isModeSwitching = false;
      await this.updateChapterWindow(this.currentSpineIndex);
    } else {
      // Switching to scrolled mode
      this.paginator?.destroy();
      this.paginator = null;
      this.scroller = new Scroller(
        this.iframe!,
        this.config,
        (scrollY) => this.handleScroll(scrollY)
      );

      // CRITICAL: Reset the inline transform from paginated mode
      // The paginator sets style.transform which has higher specificity than CSS
      const doc = this.iframe?.contentDocument;
      const container = doc?.getElementById('content-container');
      if (container) {
        container.style.transform = 'none';
        container.style.transition = 'none';
      }

      // Load ALL chapters for scrolled mode (paginated mode uses windowing with placeholders)
      // This ensures user can scroll to any chapter, not just the windowed ones
      await this.loadAllPlaceholderChapters();

      // Apply scrolled mode styles (reset columns, enable vertical scroll)
      this.applyRendererStyles();

      // Wait for layout to reflow
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Initialize scroller (skip scroll reset - we'll scroll to position ourselves)
      await this.scroller.initialize(true);

      // Scroll to the saved book percentage position
      this.scrollToBookPercentage(bookPercentage);

      // Wait for scroll to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Set up scroll tracking after scroll is complete
      this.setupScrollChapterTracking();

      // Set up highlight scroll sync
      this.setupScrollHighlightSync();

      // Re-enable windowing (not used in scrolled mode but keep state clean)
      this.isModeSwitching = false;
    }

    // Re-anchor highlights for the new layout mode
    // Highlight rects are layout-dependent and become invalid after mode switch
    this.reanchorHighlights();
  }

  /**
   * Scroll to a book-wide percentage position (for mode switching)
   */
  private scrollToBookPercentage(percentage: number): void {
    const doc = this.iframe?.contentDocument;
    if (!doc) return;

    const scrollHeight = doc.documentElement.scrollHeight;
    const clientHeight = doc.documentElement.clientHeight;
    const maxScroll = scrollHeight - clientHeight;

    const targetScrollY = (percentage / 100) * maxScroll;

    doc.documentElement.scrollTo({
      top: Math.max(0, targetScrollY),
      behavior: 'auto' // Use auto for immediate positioning
    });

    // Update internal state
    this.updateLocation();
  }

  /**
   * Get scroll progress within the current chapter (0-1)
   */
  private getScrollProgressInChapter(): number {
    const doc = this.iframe?.contentDocument;
    if (!doc) return 0;

    const chapter = doc.querySelector(`.epub-chapter[data-chapter-index="${this.currentSpineIndex}"]`) as HTMLElement;
    if (!chapter) return 0;

    const scrollY = doc.documentElement.scrollTop || doc.body.scrollTop;
    const viewportHeight = doc.documentElement.clientHeight;
    const chapterTop = chapter.offsetTop;
    const chapterHeight = chapter.offsetHeight;

    // How far into this chapter are we?
    const scrollWithinChapter = scrollY - chapterTop + viewportHeight / 2;
    const progress = chapterHeight > 0 ? scrollWithinChapter / chapterHeight : 0;

    return Math.max(0, Math.min(1, progress));
  }

  /**
   * Scroll to a chapter with a specific progress within it (for mode switching)
   */
  private scrollToChapterWithProgress(index: number, progressInChapter: number): void {
    const doc = this.iframe?.contentDocument;
    if (!doc) return;

    const chapter = doc.querySelector(`.epub-chapter[data-chapter-index="${index}"]`) as HTMLElement;
    if (!chapter) return;

    // Calculate target scroll position
    const chapterTop = chapter.offsetTop;
    const chapterHeight = chapter.offsetHeight;
    const viewportHeight = doc.documentElement.clientHeight;

    // Scroll to the progress position within the chapter
    const targetScrollY = chapterTop + (progressInChapter * chapterHeight) - viewportHeight / 2;

    doc.documentElement.scrollTo({
      top: Math.max(0, targetScrollY),
      behavior: 'smooth'
    });

    this.currentSpineIndex = index;
    this.updateLocation();
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Update renderer configuration
   */
  async updateConfig(updates: Partial<RendererConfig>): Promise<void> {
    const prevMode = this.config.mode;
    const newMode = updates.mode;

    // Check if layout-affecting properties changed (these invalidate page counts)
    const layoutChanged =
      updates.fontSize !== undefined ||
      updates.fontFamily !== undefined ||
      updates.lineHeight !== undefined ||
      updates.margin !== undefined ||
      updates.columnGap !== undefined ||
      updates.columns !== undefined;

    // Apply updates EXCEPT mode (mode is handled separately by setMode)
    const { mode: _, ...otherUpdates } = updates;
    Object.assign(this.config, otherUpdates);

    // Handle mode change - must be done BEFORE updating config.mode
    // because setMode() has an early return if mode === this.config.mode
    if (newMode && newMode !== prevMode) {
      await this.setMode(newMode);
    } else if (newMode) {
      // Mode same as before, just update config
      this.config.mode = newMode;
    }

    // Apply styling changes
    this.applyTheme();
    this.applyRendererStyles();

    // Update paginator/scroller
    this.paginator?.updateConfig(this.config);
    this.scroller?.updateConfig(this.config);

    // If layout changed, invalidate chapter page counts cache and recalculate
    if (layoutChanged) {
      this.chapterPageCounts.clear();

      // Wait for reflow to complete before recalculating
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => setTimeout(r, 100));

      // Update location with fresh page counts
      this.updateLocation();

      // Re-anchor highlights with new layout dimensions
      this.reanchorHighlights();
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): RendererConfig {
    return { ...this.config };
  }

  // ============================================================================
  // Book Information
  // ============================================================================

  /**
   * Get loaded book
   */
  getBook(): ParsedBook | null {
    return this.book;
  }

  /**
   * Get table of contents
   */
  getToc() {
    return this.book?.toc ?? [];
  }

  /**
   * Get spine (reading order)
   */
  getSpine(): SpineItem[] {
    return this.book?.spine ?? [];
  }

  // ============================================================================
  // Events
  // ============================================================================

  /**
   * Add event listener
   */
  on<K extends keyof RendererEvents>(
    event: K,
    listener: RendererEventListener<K>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    // Return unsubscribe function
    return () => this.off(event, listener);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof RendererEvents>(
    event: K,
    listener: RendererEventListener<K>
  ): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * Emit an event
   */
  private emit<K extends keyof RendererEvents>(
    event: K,
    data: RendererEvents[K]
  ): void {
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(data);
      } catch (e) {
        console.error(`Error in ${event} listener:`, e);
      }
    });
  }

  // ============================================================================
  // Highlights
  // ============================================================================

  /**
   * Add a highlight to the current chapter's overlay
   * @param id Unique highlight ID
   * @param annotationId ID for the annotation (can be same as id)
   * @param color Highlight color
   * @param rects Array of DOMRect-like objects representing the highlight areas
   */
  addHighlight(
    id: string,
    annotationId: string,
    color: HighlightColor,
    rects: Array<{ x: number; y: number; width: number; height: number }>
  ): void {
    if (!this.overlay) return;

    const renderedHighlight: RenderedHighlight = {
      id,
      annotationId,
      color,
      rects: rects.map(r => new DOMRect(r.x, r.y, r.width, r.height)),
    };

    this.overlay.addHighlight(renderedHighlight);
  }

  /**
   * Remove a highlight from the overlay
   */
  removeHighlight(highlightId: string): void {
    this.overlay?.removeHighlight(highlightId);
  }

  /**
   * Update a highlight's color
   */
  updateHighlightColor(highlightId: string, color: HighlightColor): void {
    this.overlay?.updateHighlightColor(highlightId, color);
  }

  /**
   * Clear all highlights from the overlay
   */
  clearHighlights(): void {
    this.overlay?.clearHighlights();
  }

  /**
   * Clear the current text selection in the iframe
   */
  clearSelection(): void {
    this.selection?.clearSelection();
  }

  /**
   * Get the iframe element for external access
   */
  getIframe(): HTMLIFrameElement | null {
    return this.iframe;
  }

  getPaginator(): Paginator | null {
    return this.paginator;
  }

  getScroller(): Scroller | null {
    return this.scroller;
  }

  getMode(): 'paginated' | 'scrolled' {
    return this.config.mode;
  }

  /**
   * Render saved highlights from local storage
   * Finds text in DOM and creates overlay rects
   */
  renderHighlights(highlights: Highlight[]): void {
    if (!this.overlay || !this.iframe?.contentDocument) {
      console.warn('[Renderer] Cannot render highlights - overlay or document missing');
      return;
    }

    console.log('[Renderer] renderHighlights', { count: highlights.length, spineIndex: this.currentSpineIndex });

    // Filter to highlights for current chapter
    const chapterHighlights = highlights.filter(h => {
      // Parse CFI to check if it's for current chapter
      // CFI format: epubcfi(/6/N!...) where N/2-1 = spine index
      const cfiMatch = h.cfi.match(/epubcfi\(\/6\/(\d+)/);
      if (cfiMatch) {
        const hlSpineIndex = Math.floor(parseInt(cfiMatch[1], 10) / 2) - 1;
        return hlSpineIndex === this.currentSpineIndex;
      }
      return false;
    });

    console.log('[Renderer] Rendering chapter highlights', {
      chapterCount: chapterHighlights.length,
      spineIndex: this.currentSpineIndex
    });

    for (const highlight of chapterHighlights) {
      const rects = this.findHighlightRects(highlight.text);
      if (rects.length > 0) {
        this.addHighlight(highlight.id, highlight.id, highlight.color, rects);
        console.log('[Renderer] Rendered highlight', { id: highlight.id, rectsCount: rects.length });
      } else {
        console.warn('[Renderer] Could not find text for highlight', {
          id: highlight.id,
          textPreview: highlight.text.substring(0, 50)
        });
      }
    }
  }

  /**
   * Find text in current document and return its rects
   */
  private findHighlightRects(searchText: string): DOMRect[] {
    const doc = this.iframe?.contentDocument;
    if (!doc) return [];

    // Normalize search text for matching
    const normalizedSearch = searchText.replace(/\s+/g, ' ').trim();
    // Use first 100 chars to find the start of the highlight
    const searchPrefix = normalizedSearch.substring(0, 100);

    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const allRects: DOMRect[] = [];

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const nodeText = (node.textContent || '').replace(/\s+/g, ' ');
      const index = nodeText.indexOf(searchPrefix);

      if (index !== -1) {
        try {
          const range = doc.createRange();
          range.setStart(node, index);
          // Try to find the end - either the full text or end of node
          const endIndex = Math.min(index + normalizedSearch.length, node.textContent?.length || 0);
          range.setEnd(node, endIndex);

          const rects = range.getClientRects();
          for (let i = 0; i < rects.length; i++) {
            allRects.push(rects[i]);
          }

          // Found a match, return the rects
          if (allRects.length > 0) {
            return allRects;
          }
        } catch (e) {
          console.warn('[Renderer] Failed to create range for highlight', e);
        }
      }
    }

    return allRects;
  }

  // ============================================================================
  // Highlight Re-Anchoring
  // ============================================================================

  /**
   * Set stored highlights for re-anchoring
   * Call this when highlights are loaded or updated
   */
  setStoredHighlights(highlights: Highlight[]): void {
    this.storedHighlights = highlights;
    this.reanchorHighlights();
  }

  /**
   * Set up transform sync for paginated mode highlights
   * This makes highlights move smoothly with page turn animations
   */
  private setupHighlightTransformSync(): void {
    if (!this.overlay || !this.paginator) return;

    const contentContainer = this.paginator.getContentContainer();
    if (contentContainer) {
      this.overlay.observeContentTransform(contentContainer);
    }
  }

  /**
   * Set up scroll sync for scrolled mode highlights
   */
  private setupScrollHighlightSync(): void {
    if (!this.overlay || !this.iframe?.contentDocument) return;

    const doc = this.iframe.contentDocument;
    const scrollContainer = doc.scrollingElement || doc.documentElement;

    // Track scroll position and update overlay
    // Note: scroll event fires on document, not on scrollingElement
    doc.addEventListener('scroll', () => {
      const scrollTop = scrollContainer.scrollTop;
      if (this.overlay) {
        this.overlay.updateScrollPosition(scrollTop);
      }
    }, { passive: true });

    // Initial sync
    this.overlay.updateScrollPosition(scrollContainer.scrollTop);
  }

  /**
   * Re-anchor all highlights for the current view
   * Called on: page change, resize, font change, column change
   *
   * This is the core of the dynamic highlight system - it converts
   * stored selectors (CFI + TextQuote) to DOMRects
   */
  reanchorHighlights(): void {
    if (!this.overlay || !this.iframe?.contentDocument) {
      return;
    }

    const doc = this.iframe.contentDocument;

    // Force browser to recalculate layout before reading positions
    // Reading scrollHeight forces a reflow, ensuring scroll position is accurate
    const _forceReflow = doc.documentElement.scrollHeight;

    const anchor = new HighlightAnchor(doc);
    const iframeRect = this.iframe.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();

    // Get current transform offset to convert viewport coords to content-space coords
    const transformOffset = this.getCurrentTransformOffset();

    const anchoredHighlights: AnchoredHighlight[] = [];

    for (const highlight of this.storedHighlights) {
      // Skip highlights not in currently loaded chapters
      if (!this.loadedChapters.has(highlight.spineIndex)) {
        continue;
      }

      // Use the new selector if available, fallback to legacy fields
      const selector = highlight.selector ?? {
        primary: { type: 'CfiSelector' as const, cfi: highlight.cfi },
        fallback: {
          type: 'TextQuoteSelector' as const,
          exact: highlight.text,
        },
      };

      const result = anchor.anchor(selector);

      if (result.range && result.status !== 'orphaned') {
        // Get rects from the range
        const viewportRects = HighlightAnchor.getViewportRects(result.range, iframeRect, containerRect);

        if (viewportRects.length > 0) {
          // Convert to content-space coordinates by reversing the transform
          // This allows the overlay transform sync to position them correctly
          const contentSpaceRects = viewportRects.map(rect => new DOMRect(
            rect.x - transformOffset.x,
            rect.y - transformOffset.y,
            rect.width,
            rect.height
          ));

          // Merge adjacent rects for rendering efficiency
          const mergedRects = HighlightAnchor.mergeRects(contentSpaceRects);

          anchoredHighlights.push({
            id: highlight.id,
            annotationId: highlight.id,
            color: highlight.color,
            range: result.range,
            rects: mergedRects,
            status: result.status === 'exact' ? 'anchored' : 'fuzzy',
          });
        }
      }
    }

    // Update overlay with re-anchored highlights
    this.overlay.setHighlights(anchoredHighlights);

    // In scrolled mode, sync the overlay to current scroll position
    // This must be called AFTER setHighlights() to position new highlights correctly
    if (this.config.mode === 'scrolled') {
      const doc = this.iframe?.contentDocument;
      if (doc) {
        const scrollContainer = doc.scrollingElement || doc.documentElement;
        this.overlay.updateScrollPosition(scrollContainer.scrollTop);
      }
    }
  }

  /**
   * Get the current transform offset applied to content
   * Returns {x, y} offset that content has been moved
   */
  private getCurrentTransformOffset(): { x: number; y: number } {
    if (this.config.mode === 'paginated' && this.paginator) {
      const contentContainer = this.paginator.getContentContainer();
      if (contentContainer) {
        const transform = contentContainer.style.transform;
        // Parse translate3d(-Xpx, 0, 0) or matrix(...)
        const match = transform.match(/translate3d\(([^,]+),\s*([^,]+)/);
        if (match) {
          return {
            x: parseFloat(match[1]) || 0,
            y: parseFloat(match[2]) || 0,
          };
        }
        // Try matrix format
        const matrixMatch = transform.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,\s*([^,]+),\s*([^)]+)\)/);
        if (matrixMatch) {
          return {
            x: parseFloat(matrixMatch[1]) || 0,
            y: parseFloat(matrixMatch[2]) || 0,
          };
        }
      }
    } else if (this.config.mode === 'scrolled') {
      const doc = this.iframe?.contentDocument;
      if (doc) {
        const scrollContainer = doc.scrollingElement || doc.documentElement;
        return {
          x: 0,
          y: -scrollContainer.scrollTop,
        };
      }
    }
    return { x: 0, y: 0 };
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Destroy the renderer and clean up resources
   */
  destroy(): void {
    this.paginator?.destroy();
    this.scroller?.destroy();
    this.overlay?.destroy();
    this.selection?.destroy();

    // Disconnect theme observer
    if (this.themeObserver) {
      this.themeObserver.disconnect();
      this.themeObserver = null;
    }

    // Abort scroll tracking if active
    if (this.scrollTrackingController) {
      this.scrollTrackingController.abort();
      this.scrollTrackingController = null;
    }

    // Abort parent mouse tracking
    if (this.parentMouseTrackingController) {
      this.parentMouseTrackingController.abort();
      this.parentMouseTrackingController = null;
    }

    // Clear listeners
    this.listeners.clear();

    // Remove DOM elements
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }

    this.container.classList.remove('epub-renderer');
  }

  // ============================================================================
  // Internal Methods
  // ============================================================================

  /**
   * Display a spine item (chapter)
   */
  private async displaySpineItem(
    index: number,
    position: 'start' | 'end' | number = 'start'
  ): Promise<void> {
    if (!this.book || index < 0 || index >= this.book.spine.length) {
      return;
    }

    const spineItem = this.book.spine[index];

    // Prevent overlapping chapter navigations
    if (this.isNavigating) {
      console.log('[EpubRenderer] Navigation in progress, skipping:', index);
      return;
    }

    this.isNavigating = true;
    this.loadingChapter = spineItem.href;

    // Only show loading state if chapter is NOT cached (to avoid flicker)
    const isCached = this.api.isChapterCached(this.bookId, spineItem.href);
    if (!isCached) {
      this.emit('loading', true);
    }

    try {
      // Fetch chapter content from server (will use cache if available)
      const chapter = await this.api.getChapter(this.bookId, spineItem.href, true);

      // CRITICAL: Hide content container BEFORE injecting new content
      // This prevents the visual "jump" when navigating backward - without this,
      // the content briefly appears at page 0 before the paginator sets the correct transform
      if (this.contentContainer) {
        this.contentContainer.style.opacity = '0';
      }

      // Inject content into iframe
      await this.injectContent(chapter);

      this.currentSpineIndex = index;

      // Re-apply styles now that content is loaded and iframe has dimensions
      this.applyRendererStyles();

      // Navigate to position within chapter
      if (this.config.mode === 'paginated' && this.paginator) {
        // Initialize directly to the target position to avoid visual "reset" effect
        // When navigating backwards, this prevents showing page 0 before jumping to the end
        const initialPosition = position === 'end' ? 'end' :
                                typeof position === 'number' ? position : 'start';
        await this.paginator.initialize(initialPosition);

        // Record the page count for this chapter
        const pageInfo = this.paginator.getCurrentPage();
        this.chapterPageCounts.set(index, pageInfo.total);
      } else if (this.scroller) {
        await this.scroller.initialize();
        if (position === 'end') {
          this.scroller.scrollToEnd();
        } else if (typeof position === 'number') {
          this.scroller.scrollTo(position);
        }
      }

      // CRITICAL: Show content AFTER paginator/scroller has set the correct position
      // This completes the hiding trick that prevents the visual "jump"
      if (this.contentContainer) {
        // Use a short transition for a smooth fade-in effect
        this.contentContainer.style.transition = 'opacity 0.15s ease-out';
        this.contentContainer.style.opacity = '1';
      }

      // Update location
      this.updateLocation();

      // Emit rendered event
      this.emit('rendered', { spineIndex: index, href: spineItem.href });

      // Preload adjacent chapters for faster navigation
      this.preloadAdjacentChapters(index);
    } catch (error) {
      console.error('[EpubRenderer] Error displaying spine item:', error);
      this.emit('error', error as Error);
      // Ensure content is visible even on error
      if (this.contentContainer) {
        this.contentContainer.style.opacity = '1';
      }
    } finally {
      this.isNavigating = false;
      this.loadingChapter = null;
      this.emit('loading', false);
    }
  }

  /**
   * Preload adjacent chapters for faster navigation
   */
  private preloadAdjacentChapters(currentIndex: number): void {
    if (!this.book) return;

    // Preload next 2 chapters and previous 1 chapter
    const indicesToPreload = [
      currentIndex + 1,
      currentIndex + 2,
      currentIndex - 1,
    ].filter(i => i >= 0 && i < this.book!.spine.length && i !== currentIndex);

    for (const index of indicesToPreload) {
      const spineItem = this.book.spine[index];
      this.api.preloadChapter(this.bookId, spineItem.href);
    }
  }

  /**
   * Load chapters - uses windowing for paginated mode, full load for scrolled mode
   */
  private async loadAllChapters(): Promise<void> {
    if (!this.book || !this.contentContainer || !this.iframe?.contentDocument) return;

    this.emit('loading', true);
    console.log(`[EpubRenderer] Loading chapters (mode: ${this.config.mode})`);

    // Clear state
    this.contentContainer.innerHTML = '';
    this.loadedChapters.clear();
    this.chapterElements.clear();

    if (this.config.mode === 'paginated') {
      // PAGINATED MODE: Use chapter windowing for performance
      // Only load first few chapters, use placeholders for rest
      await this.loadChaptersWindowed(0);
    } else {
      // SCROLLED MODE: Load all chapters with content-visibility optimization
      await this.loadChaptersScrolled();
    }

    // Set up event forwarding first (creates new AbortController)
    this.setupEventForwarding();

    // Set up link handlers (uses the AbortController's signal)
    this.setupLinkHandlers();

    // Wait for content to render
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Apply styles
    this.applyRendererStyles();
    this.applyTheme();

    // Initialize the appropriate mode handler
    if (this.config.mode === 'paginated' && this.paginator) {
      await this.paginator.initialize();
      this.setupPaginatedChapterTracking();
    } else if (this.scroller) {
      await this.scroller.initialize();
      this.setupScrollChapterTracking();
    }

    this.recordChapterPositions();
    this.currentSpineIndex = 0;
    this.updateLocation();
    this.emit('loading', false);
  }

  /**
   * Load chapters with windowing for paginated mode
   * Only loads chapters around the target index, uses placeholders for others
   */
  private async loadChaptersWindowed(targetIndex: number): Promise<void> {
    if (!this.book || !this.contentContainer) return;

    const totalChapters = this.book.spine.length;
    console.log(`[EpubRenderer:Windowing] Loading window around chapter ${targetIndex}, total: ${totalChapters}`);

    // Initialize tracking state
    this.lastChapterIndex = targetIndex;

    // Determine which chapters to load (larger window for initial load)
    // Load 2 before and 5 after for forward reading expectation
    let windowStart = Math.max(0, targetIndex - 2);
    let windowEnd = Math.min(totalChapters - 1, targetIndex + 5);

    // Ensure minimum window of 7 chapters when possible (for smooth initial experience)
    const windowSize = windowEnd - windowStart + 1;
    if (windowSize < 7 && totalChapters >= 7) {
      if (windowStart === 0) {
        // At beginning - extend forward
        windowEnd = Math.min(totalChapters - 1, 6);
      } else if (windowEnd === totalChapters - 1) {
        // At end - extend backward
        windowStart = Math.max(0, totalChapters - 7);
      }
    }

    const chaptersToLoad = new Set<number>();
    for (let i = windowStart; i <= windowEnd; i++) {
      chaptersToLoad.add(i);
    }

    // STEP 1: Create all chapter containers first (fast, synchronous)
    // In paginated mode, we DON'T create separators - chapters are paginated separately
    for (let i = 0; i < totalChapters; i++) {
      const spineItem = this.book.spine[i];

      const chapterDiv = document.createElement('div');
      chapterDiv.className = 'epub-chapter';
      chapterDiv.dataset.chapterIndex = String(i);
      chapterDiv.dataset.href = spineItem.href;

      this.chapterElements.set(i, chapterDiv);

      // All start as placeholders (hidden in paginated mode)
      this.createChapterPlaceholder(i, chapterDiv);
      this.contentContainer.appendChild(chapterDiv);
    }

    // STEP 2: Load chapters in window IN PARALLEL (fast async)
    const loadPromises = Array.from(chaptersToLoad).map(async (i) => {
      const chapterDiv = this.chapterElements.get(i);
      if (chapterDiv) {
        await this.loadChapterContent(i, chapterDiv);
      }
    });

    await Promise.all(loadPromises);

    // Process images in loaded chapters
    await this.processImages('');

    console.log(`[EpubRenderer:Windowing] Loaded chapters: ${Array.from(this.loadedChapters).join(', ')}`);
  }

  /**
   * Load content into a chapter element
   */
  private async loadChapterContent(index: number, chapterDiv: HTMLElement): Promise<void> {
    if (!this.book || this.loadedChapters.has(index)) return;

    const spineItem = this.book.spine[index];
    console.log(`[EpubRenderer:Windowing] Loading chapter ${index}: ${spineItem.href}`);

    // Show loading indicator
    chapterDiv.classList.add('epub-chapter-loading');
    chapterDiv.classList.remove('epub-chapter-placeholder');
    chapterDiv.style.display = ''; // Make visible for loading indicator

    try {
      const chapter = await this.api.getChapter(this.bookId, spineItem.href, true);
      const processedHtml = await this.processHtml(chapter.html, chapter.href);

      chapterDiv.innerHTML = processedHtml;
      chapterDiv.classList.remove('epub-chapter-loading');
      chapterDiv.style.minHeight = '';

      this.loadedChapters.add(index);

      // Strip inline color styles from newly loaded content to respect theme
      this.stripInlineColorStylesFromElement(chapterDiv);
    } catch (error) {
      console.error(`[EpubRenderer:Windowing] Error loading chapter ${index}:`, error);
      chapterDiv.classList.remove('epub-chapter-loading');
      this.createChapterPlaceholder(index, chapterDiv);
    }
  }

  /**
   * Create a placeholder for a chapter (minimal DOM footprint)
   */
  private createChapterPlaceholder(index: number, chapterDiv: HTMLElement): void {
    chapterDiv.innerHTML = '';
    chapterDiv.classList.add('epub-chapter-placeholder');

    // In paginated mode, placeholders should NOT take space in the column layout
    // We hide them completely and track pages separately
    if (this.config.mode === 'paginated') {
      chapterDiv.style.display = 'none';
      chapterDiv.style.minHeight = '';
    } else {
      // In scrolled mode, use estimated height to maintain scroll position
      const estimatedHeight = this.estimatedPagesPerChapter * 600;
      chapterDiv.style.display = '';
      chapterDiv.style.minHeight = `${estimatedHeight}px`;
    }

    // Mark as not loaded
    this.loadedChapters.delete(index);
  }

  /**
   * Unload a chapter's content (replace with placeholder)
   */
  private unloadChapterContent(index: number): void {
    const chapterDiv = this.chapterElements.get(index);
    if (!chapterDiv || !this.loadedChapters.has(index)) return;

    console.log(`[EpubRenderer:Windowing] Unloading chapter ${index}`);

    chapterDiv.innerHTML = '';
    chapterDiv.classList.add('epub-chapter-placeholder');
    chapterDiv.classList.remove('epub-chapter-loading');

    // In paginated mode, hide placeholders completely to avoid blank pages
    if (this.config.mode === 'paginated') {
      chapterDiv.style.display = 'none';
      chapterDiv.style.minHeight = '';
    } else {
      // In scrolled mode, preserve height for scroll position
      const estimatedHeight = this.estimatedPagesPerChapter * 600;
      chapterDiv.style.display = '';
      chapterDiv.style.minHeight = `${estimatedHeight}px`;
    }

    this.loadedChapters.delete(index);
  }

  /**
   * Load all placeholder chapters (for switching to scrolled mode)
   * When switching from paginated mode (which uses windowing) to scrolled mode,
   * we need to load all chapters so the user can scroll to any position.
   */
  private async loadAllPlaceholderChapters(): Promise<void> {
    if (!this.book) return;

    const totalChapters = this.book.spine.length;
    const unloadedChapters: number[] = [];

    // Find all chapters that aren't loaded
    for (let i = 0; i < totalChapters; i++) {
      if (!this.loadedChapters.has(i)) {
        unloadedChapters.push(i);
      }
    }

    if (unloadedChapters.length === 0) {
      console.log('[EpubRenderer] All chapters already loaded');
      return;
    }

    console.log(`[EpubRenderer] Loading ${unloadedChapters.length} placeholder chapters for scrolled mode`);

    // Load chapters in parallel batches to avoid overwhelming the server
    const BATCH_SIZE = 5;
    for (let i = 0; i < unloadedChapters.length; i += BATCH_SIZE) {
      const batch = unloadedChapters.slice(i, i + BATCH_SIZE);
      const loadPromises = batch.map(async (chapterIndex) => {
        const chapterDiv = this.chapterElements.get(chapterIndex);
        if (chapterDiv) {
          // Make visible for scrolled mode (was hidden for paginated)
          chapterDiv.style.display = '';
          await this.loadChapterContent(chapterIndex, chapterDiv);
        }
      });
      await Promise.all(loadPromises);
    }

    console.log('[EpubRenderer] All placeholder chapters loaded for scrolled mode');
  }

  /**
   * Update the chapter window when navigation changes
   * Called when the current chapter index changes
   */
  private async updateChapterWindow(newIndex: number): Promise<void> {
    if (this.config.mode !== 'paginated' || !this.book) return;
    if (this.isLoadingChapters) return; // Prevent concurrent loads
    if (this.isModeSwitching) return; // Skip windowing during mode switch

    const totalChapters = this.book.spine.length;

    // Detect scroll direction for predictive loading
    const jumpDistance = Math.abs(newIndex - this.lastChapterIndex);
    const scrollDirection = newIndex > this.lastChapterIndex ? 1 : newIndex < this.lastChapterIndex ? -1 : 0;
    this.lastChapterIndex = newIndex;

    // Calculate window - always ensure at least 5 chapters are loaded
    // Use predictive loading for small moves, symmetric for jumps
    let windowStart: number;
    let windowEnd: number;

    if (jumpDistance > 2 || scrollDirection === 0) {
      // Large jump or stationary - symmetric window
      windowStart = Math.max(0, newIndex - 2);
      windowEnd = Math.min(totalChapters - 1, newIndex + 4);
    } else if (scrollDirection > 0) {
      // Scrolling forward - load more ahead
      windowStart = Math.max(0, newIndex - 1);
      windowEnd = Math.min(totalChapters - 1, newIndex + 5);
    } else {
      // Scrolling backward - load more behind, but ALWAYS keep chapters ahead
      windowStart = Math.max(0, newIndex - 3);
      windowEnd = Math.min(totalChapters - 1, newIndex + 3);
    }

    // Ensure minimum window of 6 chapters when possible
    const windowSize = windowEnd - windowStart + 1;
    if (windowSize < 6 && totalChapters >= 6) {
      if (windowStart === 0) {
        // At beginning - extend forward
        windowEnd = Math.min(totalChapters - 1, 5);
      } else if (windowEnd === totalChapters - 1) {
        // At end - extend backward
        windowStart = Math.max(0, totalChapters - 6);
      }
    }

    const newWindow = new Set<number>();
    for (let i = windowStart; i <= windowEnd; i++) {
      newWindow.add(i);
    }

    // Find chapters to load
    const toLoad: number[] = [];
    for (const i of newWindow) {
      if (!this.loadedChapters.has(i)) {
        toLoad.push(i);
      }
    }

    // Only unload if we have too many chapters loaded (memory management)
    // Keep chapters around for smoother scrolling back and forth
    const MAX_LOADED_CHAPTERS = 15;
    const toUnload: number[] = [];

    if (this.loadedChapters.size > MAX_LOADED_CHAPTERS) {
      // Unload chapters furthest from current position
      const sortedByDistance = Array.from(this.loadedChapters)
        .filter((i) => !newWindow.has(i))
        .sort((a, b) => Math.abs(a - newIndex) - Math.abs(b - newIndex))
        .reverse(); // Furthest first

      // Unload until we're under the limit
      const excessCount = this.loadedChapters.size - MAX_LOADED_CHAPTERS;
      for (let i = 0; i < Math.min(excessCount, sortedByDistance.length); i++) {
        toUnload.push(sortedByDistance[i]);
      }
    }

    // Skip if no changes needed
    if (toLoad.length === 0 && toUnload.length === 0) return;

    console.log(`[EpubRenderer:Windowing] Direction: ${scrollDirection > 0 ? 'forward' : scrollDirection < 0 ? 'backward' : 'none'}, load [${toLoad}], unload [${toUnload}], total loaded: ${this.loadedChapters.size}`);

    this.isLoadingChapters = true;

    try {
      // Unload excess chapters (only when over limit)
      for (const i of toUnload) {
        this.unloadChapterContent(i);
      }

      // Load chapters in PARALLEL for faster loading
      const loadPromises = toLoad.map(async (i) => {
        const chapterDiv = this.chapterElements.get(i);
        if (chapterDiv) {
          await this.loadChapterContent(i, chapterDiv);
        }
      });

      await Promise.all(loadPromises);

      // Process new images
      if (toLoad.length > 0) {
        await this.processImages('');
      }

      // Reinitialize paginator if content changed significantly
      if (toLoad.length > 0 && this.paginator) {
        // Recalculate after content change
        await new Promise((resolve) => requestAnimationFrame(resolve));
        this.paginator.handleResize();
      }
    } finally {
      this.isLoadingChapters = false;
    }
  }

  /**
   * Load all chapters for scrolled mode (with content-visibility optimization)
   */
  private async loadChaptersScrolled(): Promise<void> {
    if (!this.book || !this.contentContainer) return;

    console.log(`[EpubRenderer] Loading ${this.book.spine.length} chapters for scrolled mode`);

    for (let i = 0; i < this.book.spine.length; i++) {
      const spineItem = this.book.spine[i];

      try {
        const chapter = await this.api.getChapter(this.bookId, spineItem.href, true);

        const chapterDiv = document.createElement('div');
        chapterDiv.className = 'epub-chapter';
        chapterDiv.dataset.chapterIndex = String(i);
        chapterDiv.dataset.href = spineItem.href;

        const processedHtml = await this.processHtml(chapter.html, chapter.href);
        chapterDiv.innerHTML = processedHtml;

        // Store reference
        this.chapterElements.set(i, chapterDiv);
        this.loadedChapters.add(i);

        if (i > 0) {
          const separator = document.createElement('hr');
          separator.className = 'chapter-separator';
          separator.style.cssText = 'margin: 2rem 0; border: none; border-top: 1px solid var(--background-modifier-border, #ccc);';
          this.contentContainer.appendChild(separator);
        }

        this.contentContainer.appendChild(chapterDiv);
        console.log(`[EpubRenderer] Loaded chapter ${i + 1}/${this.book.spine.length}: ${spineItem.href}`);
      } catch (error) {
        console.error(`[EpubRenderer] Error loading chapter ${i}:`, error);
      }
    }

    await this.processImages('');
  }

  /**
   * Set up tracking to update current chapter based on page position (paginated mode)
   * With all chapters loaded, we need to determine which chapter is visible based on
   * the current transform position.
   */
  private setupPaginatedChapterTracking(): void {
    // The tracking happens in handlePageChange() which is called by the paginator
    // We need to calculate chapter boundaries based on their positions in the column layout
  }

  /**
   * Set up scroll tracking to update current chapter based on scroll position
   */
  private setupScrollChapterTracking(): void {
    const doc = this.iframe?.contentDocument;
    if (!doc) return;

    // Clean up any existing scroll tracking listeners
    if (this.scrollTrackingController) {
      this.scrollTrackingController.abort();
    }
    this.scrollTrackingController = new AbortController();
    const signal = this.scrollTrackingController.signal;

    doc.addEventListener('scroll', () => {
      const scrollY = doc.documentElement.scrollTop || doc.body.scrollTop;
      const viewportMiddle = scrollY + (doc.documentElement.clientHeight / 2);

      // Find which chapter is in view
      const chapters = doc.querySelectorAll('.epub-chapter');
      for (let i = chapters.length - 1; i >= 0; i--) {
        const chapter = chapters[i] as HTMLElement;
        const rect = chapter.getBoundingClientRect();
        const chapterTop = scrollY + rect.top;

        if (viewportMiddle >= chapterTop) {
          const newIndex = parseInt(chapter.dataset.chapterIndex || '0', 10);
          if (newIndex !== this.currentSpineIndex) {
            this.currentSpineIndex = newIndex;
            console.log(`[EpubRenderer] Now in chapter ${newIndex}`);
          }
          break;
        }
      }
    }, { passive: true, signal });
  }

  /**
   * Record chapter positions for navigation
   */
  private recordChapterPositions(): void {
    const doc = this.iframe?.contentDocument;
    if (!doc) return;

    const chapters = doc.querySelectorAll('.epub-chapter');
    chapters.forEach((chapter, i) => {
      const rect = (chapter as HTMLElement).getBoundingClientRect();
      // Store for later navigation
      console.log(`[EpubRenderer] Chapter ${i} position: top=${rect.top}, height=${rect.height}`);
    });
  }

  /**
   * Inject chapter content into iframe
   */
  private async injectContent(chapter: ChapterContent): Promise<void> {
    if (!this.contentContainer || !this.iframe?.contentDocument) return;

    // CRITICAL: Reset transform before injecting new content
    // The old chapter's transform should not persist when loading a new chapter
    // This prevents the state desync bug where old transform values cause content to disappear
    this.contentContainer.style.transform = 'none';
    this.contentContainer.style.transition = 'none';

    // Process HTML to handle relative URLs
    const processedHtml = await this.processHtml(chapter.html, chapter.href);

    // Insert content
    this.contentContainer.innerHTML = processedHtml;

    // Process images - convert to data URLs or server URLs
    await this.processImages(chapter.href);

    // Set up event forwarding first (creates new AbortController)
    this.setupEventForwarding();

    // Set up link handling (uses the AbortController's signal)
    this.setupLinkHandlers();

    // Update highlight overlay
    if (this.overlay && chapter.highlights) {
      this.overlay.setHighlights(chapter.highlights);
    }

    // Wait for content to render
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  /**
   * Process HTML content - handle URLs and sanitization
   */
  private async processHtml(html: string, baseHref: string): Promise<string> {
    // The server already sanitizes and processes HTML
    // Here we just handle any client-side adjustments

    // Extract the base path for relative URLs
    const basePath = baseHref.substring(0, baseHref.lastIndexOf('/') + 1);

    // Check if we have a server-based API client with config
    const apiConfig = (this.api as any)?.config;
    const baseUrl = apiConfig?.baseUrl;

    // Replace relative URLs with server resource URLs (only if server is available)
    let processed = html;
    if (baseUrl) {
      processed = processed.replace(/src="([^"]+)"/g, (match, src) => {
        if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('blob:')) {
          return match;
        }
        const fullPath = this.resolveUrl(src, basePath);
        return `src="${baseUrl}/api/v1/books/${this.bookId}/resources/${encodeURIComponent(fullPath)}"`;
      });
    }

    // Process href attributes for internal links
    processed = processed.replace(/href="([^"]+)"/g, (match, href) => {
      if (href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto:')) {
        return match;
      }
      // Keep internal links as-is for handler
      return `href="${href}" data-internal="true"`;
    });

    return processed;
  }

  /**
   * Resolve relative URL to full path
   */
  private resolveUrl(url: string, basePath: string): string {
    if (url.startsWith('/')) {
      return url.substring(1);
    }

    // Handle ../ paths
    const parts = (basePath + url).split('/');
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === '..') {
        resolved.pop();
      } else if (part !== '.' && part !== '') {
        resolved.push(part);
      }
    }
    return resolved.join('/');
  }

  /**
   * Process images in the content
   */
  private async processImages(baseHref: string): Promise<void> {
    const doc = this.iframe?.contentDocument;
    if (!doc) return;

    const images = Array.from(doc.querySelectorAll('img[data-src]'));
    for (const img of images) {
      const dataSrc = img.getAttribute('data-src');
      if (dataSrc) {
        img.setAttribute('src', dataSrc);
        img.removeAttribute('data-src');
      }
    }
  }

  /**
   * Set up handlers for internal links
   */
  private setupLinkHandlers(): void {
    const doc = this.iframe?.contentDocument;
    if (!doc) return;

    // Use the same signal as event forwarding to ensure cleanup
    const signal = this.eventForwardingController?.signal;

    doc.addEventListener('click', (e) => {
      const link = (e.target as Element).closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      // External links
      if (href.startsWith('http') || href.startsWith('mailto:')) {
        e.preventDefault();
        this.emit('linkClicked', { href, external: true });
        return;
      }

      // Internal links
      if (link.hasAttribute('data-internal')) {
        e.preventDefault();

        // Handle hash links
        if (href.startsWith('#')) {
          const element = doc.getElementById(href.substring(1));
          element?.scrollIntoView({ behavior: 'smooth' });
          this.emit('linkClicked', { href, external: false });
          return;
        }

        // Navigate to chapter
        this.navigateToHref(href);
        this.emit('linkClicked', { href, external: false });
      }
    }, { signal });
  }

  /**
   * Navigate to a CFI location
   */
  private async navigateToCfi(cfi: string, instant = false): Promise<void> {
    // Parse CFI to get spine index and offset
    // CFI format: epubcfi(/6/4!/4/2/1:0)
    // The /6/X gives us the spine index (X/2 - 1)

    const spineMatch = cfi.match(/epubcfi\(\/6\/(\d+)/);
    if (!spineMatch) {
      console.warn('Invalid CFI format:', cfi);
      return;
    }

    const spineIndex = Math.floor(parseInt(spineMatch[1], 10) / 2) - 1;

    if (this.config.mode === 'scrolled') {
      // In continuous scroll mode, scroll to the chapter element
      this.scrollToChapterElement(spineIndex, instant);
    } else {
      // In paginated mode, navigate to the chapter page
      await this.navigateToChapterPage(spineIndex);
    }

    // TODO: Navigate to specific element/offset within chapter
    // This requires CFI resolution logic
  }

  /**
   * Navigate to an href (chapter)
   */
  private async navigateToHref(href: string, hash?: string): Promise<void> {
    if (!this.book) return;

    // Extract hash from href if present (e.g., "chapter1.xhtml#section1")
    let targetHref = href;
    let targetHash = hash;
    if (href.includes('#')) {
      const parts = href.split('#');
      targetHref = parts[0];
      targetHash = targetHash || parts[1];
    }

    console.log('[Navigation] Looking for href:', targetHref, 'hash:', targetHash);

    // Try to find spine item with various matching strategies
    let spineIndex = -1;

    // 1. Exact match
    spineIndex = this.book.spine.findIndex((item) => item.href === targetHref);

    // 2. Match by filename (ignore directory path)
    if (spineIndex === -1) {
      const targetFilename = targetHref.split('/').pop();
      spineIndex = this.book.spine.findIndex((item) => {
        const itemFilename = item.href.split('/').pop();
        return itemFilename === targetFilename;
      });
    }

    // 3. Match where spine href ends with target href
    if (spineIndex === -1) {
      spineIndex = this.book.spine.findIndex((item) => item.href.endsWith(targetHref));
    }

    // 4. Match where target href ends with spine href
    if (spineIndex === -1) {
      spineIndex = this.book.spine.findIndex((item) => targetHref.endsWith(item.href));
    }

    if (spineIndex === -1) {
      console.warn('[Navigation] Href not found in spine:', targetHref);
      console.log('[Navigation] Available spine hrefs:', this.book.spine.map(s => s.href));
      return;
    }

    console.log('[Navigation] Found at spine index:', spineIndex, 'href:', this.book.spine[spineIndex].href);

    if (this.config.mode === 'scrolled') {
      // In continuous scroll mode, scroll to the chapter element
      this.scrollToChapterElement(spineIndex);

      // Scroll to hash if present
      if (targetHash && this.iframe?.contentDocument) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const element = this.iframe.contentDocument.getElementById(targetHash);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
          console.log('[Navigation] Scrolled to hash:', targetHash);
        }
      }
    } else {
      // In paginated mode, navigate to the chapter page
      // Content is already loaded, just navigate within it
      if (targetHash && this.iframe?.contentDocument) {
        // Navigate to the element containing the hash
        const element = this.iframe.contentDocument.getElementById(targetHash);
        if (element) {
          this.scrollToElement(element);
          console.log('[Navigation] Navigated to hash:', targetHash);
          return;
        }
      }
      // Fallback to chapter start
      await this.navigateToChapterPage(spineIndex);
    }
  }

  /**
   * Navigate to an element in paginated mode
   */
  private scrollToElement(element: HTMLElement): void {
    if (!this.paginator) return;

    const doc = this.iframe?.contentDocument;
    if (!doc) return;

    const container = doc.getElementById('content-container');
    if (!container) return;

    // Calculate which page contains this element
    // The element's offsetLeft tells us its horizontal position in the column layout
    const pageWidth = container.clientWidth + this.config.columnGap;
    const targetPage = Math.floor(element.offsetLeft / pageWidth);

    this.paginator.goToPage(targetPage);
    this.updateCurrentChapterFromPage();
  }

  /**
   * Navigate to a percentage of the book
   */
  private async navigateToPercentage(percentage: number): Promise<void> {
    if (!this.book) return;

    if (this.config.mode === 'scrolled' && this.scroller) {
      // In continuous scroll mode, scroll to that percentage of the document
      this.scroller.scrollToPercentage(percentage);
    } else if (this.paginator) {
      // In paginated mode, navigate to that percentage of total pages
      this.paginator.goToPercentage(percentage);
      this.updateCurrentChapterFromPage();
    }
  }

  /**
   * Navigate to a global page number
   */
  private async navigateToPage(pageNumber: number): Promise<void> {
    if (!this.book) return;

    if (this.config.mode === 'scrolled' && this.scroller) {
      // In scrolled mode, approximate by scrolling to a percentage
      // (Page number navigation doesn't map cleanly to scroll mode)
      const totalChapters = this.book.spine.length;
      const percentage = (pageNumber / (totalChapters * 20)) * 100; // Rough estimate
      this.scroller.scrollToPercentage(Math.min(percentage, 100));
    } else if (this.paginator) {
      // In paginated mode with all chapters loaded, we can directly go to the page
      this.paginator.goToPage(pageNumber);
      this.updateCurrentChapterFromPage();
    }
  }

  /**
   * Apply theme colors
   * Uses aggressive CSS to override any inline styles from EPUB content
   */
  private applyTheme(): void {
    const doc = this.iframe?.contentDocument;
    if (!doc) return;

    // For system theme, get colors from Obsidian dynamically
    let colors: ThemeColors;
    if (this.config.customColors) {
      colors = this.config.customColors;
    } else if (this.config.theme === 'system') {
      colors = getSystemThemeColors();
    } else {
      colors = THEME_COLORS[this.config.theme] ?? THEME_COLORS.light;
    }

    const styleEl = doc.getElementById('theme-styles');
    if (styleEl) {
      // Use aggressive CSS to override book styles including inline styles
      // Font-size is inherited from #content-container via renderer-styles
      styleEl.textContent = `
        /* Base document styles */
        html, body {
          background: ${colors.background} !important;
          color: ${colors.foreground} !important;
        }

        /* Override all text elements - colors only, NOT font-size */
        /* Font-size should inherit from #content-container set by renderer-styles */
        body, div, p, span, h1, h2, h3, h4, h5, h6,
        li, td, th, blockquote, figcaption, cite,
        article, section, aside, header, footer, nav, main,
        .epub-chapter, .epub-chapter * {
          color: ${colors.foreground} !important;
          background-color: transparent !important;
        }

        /* Force font-size inheritance for body content */
        /* This allows the container's font-size to cascade properly */
        .epub-chapter p, .epub-chapter div, .epub-chapter span,
        .epub-chapter li, .epub-chapter td, .epub-chapter blockquote {
          font-size: inherit !important;
        }

        /* Preserve background only on root elements */
        html, body, #viewport-wrapper, #content-container {
          background: ${colors.background} !important;
        }

        /* Links */
        a, a:link, a:visited, a:hover, a:active {
          color: ${colors.linkColor} !important;
        }

        /* Text selection */
        ::selection {
          background: ${colors.highlightColor} !important;
          color: ${colors.foreground} !important;
        }
        ::-moz-selection {
          background: ${colors.highlightColor} !important;
          color: ${colors.foreground} !important;
        }

        /* Ensure images don't get inverted */
        img, svg, picture, video, canvas {
          color: initial !important;
        }

        /* Override inline color styles only (not font-size) */
        [style*="color"], [style*="background"] {
          color: ${colors.foreground} !important;
          background-color: transparent !important;
        }
      `;
    }

    // Also strip inline color styles from content elements for stubborn books
    this.stripInlineColorStyles(doc);
  }

  /**
   * Strip inline color/background styles from content that might override theme
   * Called when theme is applied to handle stubborn EPUB styles
   */
  private stripInlineColorStyles(doc: Document): void {
    const container = doc.getElementById('content-container');
    if (!container) return;
    this.stripInlineColorStylesFromElement(container);
  }

  /**
   * Strip inline color/background/font-size styles from a specific element and its descendants
   */
  private stripInlineColorStylesFromElement(element: HTMLElement): void {
    // Find elements with inline styles
    const elementsWithInlineStyles = element.querySelectorAll('[style]');
    elementsWithInlineStyles.forEach(el => {
      const htmlEl = el as HTMLElement;
      // Remove inline color, background, and font-size styles
      // This allows theme and user settings to take effect
      htmlEl.style.color = '';
      htmlEl.style.backgroundColor = '';
      htmlEl.style.background = '';
      htmlEl.style.fontSize = '';
    });
  }

  /**
   * Apply renderer styles (pagination/scroll)
   */
  private applyRendererStyles(): void {
    const doc = this.iframe?.contentDocument;
    if (!doc) return;

    const styleEl = doc.getElementById('renderer-styles');
    if (!styleEl) return;

    const { fontSize, fontFamily, lineHeight, textAlign, margin, columnGap } = this.config;

    if (this.config.mode === 'paginated') {
      // Calculate container width and column dimensions
      const iframeRect = this.iframe?.getBoundingClientRect();
      const viewportWidth = (iframeRect?.width ?? 800) - (margin * 2);
      const viewportHeight = (iframeRect?.height ?? 600) - (margin * 2);

      // Determine number of columns per page
      // Use paginator's calculation if available (handles first-page logic for covers)
      let columnsPerPage: number;
      if (this.paginator && typeof (this.paginator as any).getColumnCountForStyles === 'function') {
        columnsPerPage = (this.paginator as any).getColumnCountForStyles();
      } else if (this.config.columns === 'single') {
        columnsPerPage = 1;
      } else if (this.config.columns === 'dual') {
        columnsPerPage = 2;
      } else {
        // Auto: use 2 columns if wide enough (paginator will handle first-page later)
        columnsPerPage = viewportWidth > 800 ? 2 : 1;
      }

      // Calculate column width - each "page" shows columnsPerPage columns
      const totalGapsPerPage = (columnsPerPage - 1) * columnGap;
      const columnWidth = Math.floor((viewportWidth - totalGapsPerPage) / columnsPerPage);

      // Page width is how much we translate to move to next "page"
      const pageWidth = viewportWidth + columnGap;

      styleEl.textContent = `
        html {
          height: 100%;
          overflow: hidden;
        }
        body {
          margin: 0;
          padding: ${margin}px;
          height: 100%;
          box-sizing: border-box;
          overflow: hidden;
        }
        /* Viewport wrapper creates the clipping boundary for paginated content */
        #viewport-wrapper {
          width: ${viewportWidth}px;
          height: ${viewportHeight}px;
          overflow: hidden;
          position: relative;
        }
        #content-container {
          /* Fixed dimensions - content overflows horizontally into columns */
          width: ${viewportWidth}px;
          height: ${viewportHeight}px;
          /* Column layout - columns expand rightward beyond container width */
          column-width: ${columnWidth}px;
          column-gap: ${columnGap}px;
          column-fill: auto;
          /* Typography */
          font-size: ${fontSize}px;
          font-family: ${fontFamily};
          line-height: ${lineHeight};
          text-align: ${textAlign};
          word-wrap: break-word;
          overflow-wrap: break-word;
          /* Allow horizontal overflow for columns, viewport-wrapper clips */
          overflow: visible;
          /* GPU acceleration and performance optimizations */
          will-change: transform;
          transform: translate3d(0, 0, 0);
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          /* Contain layout to prevent reflow propagation */
          contain: layout style;
        }
        img {
          max-width: ${columnWidth}px;
          max-height: ${viewportHeight - 40}px;
          height: auto;
          object-fit: contain;
          break-inside: avoid;
        }
        /* Prevent orphans and widows */
        p, li, blockquote {
          orphans: 2;
          widows: 2;
          break-inside: avoid-column;
        }
        /* Chapter containers - contain layout for isolation */
        .epub-chapter {
          contain: content;
          break-inside: avoid-column;
        }
        /* Placeholder chapters (unloaded for performance) */
        .epub-chapter-placeholder {
          /* Empty placeholder - just maintains layout space */
          display: block;
          background: transparent;
        }
      `;
    } else {
      // Scrolled mode - continuous vertical scrolling
      styleEl.textContent = `
        html {
          height: 100%;
          overflow-y: auto;
          overflow-x: hidden;
        }
        body {
          margin: 0;
          padding: ${margin}px;
          min-height: 100%;
        }
        /* Viewport wrapper in scroll mode - no height restriction, allows content flow */
        #viewport-wrapper {
          width: 100%;
          min-height: 100%;
          overflow: visible;
        }
        #content-container {
          max-width: 800px;
          margin: 0 auto;
          font-size: ${fontSize}px;
          font-family: ${fontFamily};
          line-height: ${lineHeight};
          text-align: ${textAlign};
          /* Reset any transform from paginated mode */
          transform: none;
          /* Reset column properties from paginated mode */
          width: auto;
          height: auto;
          column-width: auto;
          column-gap: normal;
        }
        .epub-chapter {
          margin-bottom: 2rem;
          /* Skip rendering of offscreen chapters (7x performance boost reported)
             Browser will still include in accessibility tree and find-in-page */
          content-visibility: auto;
          /* Size hint for skipped content - prevents layout jumps
             Estimate ~500px per chapter, will adjust based on actual content */
          contain-intrinsic-size: auto 500px;
        }
        .chapter-separator {
          margin: 2rem 0;
          border: none;
          border-top: 1px solid var(--background-modifier-border, #ccc);
        }
        img {
          max-width: 100%;
          height: auto;
        }
        /* Loading indicator for chapters being fetched */
        .epub-chapter-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 200px;
          opacity: 0.5;
        }
        .epub-chapter-loading::after {
          content: '';
          width: 32px;
          height: 32px;
          border: 3px solid var(--background-modifier-border, #ccc);
          border-top-color: var(--text-accent, #666);
          border-radius: 50%;
          animation: epub-spin 0.8s linear infinite;
        }
        @keyframes epub-spin {
          to { transform: rotate(360deg); }
        }
      `;
    }
  }

  /**
   * Handle container resize
   */
  private handleResize(): void {
    // Re-apply styles with new dimensions
    this.applyRendererStyles();

    this.paginator?.handleResize();
    this.scroller?.handleResize();
    this.overlay?.handleResize();

    // Debounced re-anchor highlights after resize settles
    if (this.reanchorTimeout) {
      window.clearTimeout(this.reanchorTimeout);
    }
    this.reanchorTimeout = window.setTimeout(() => {
      this.reanchorHighlights();
    }, 100);

    this.updateLocation();
  }

  /**
   * Handle page change in paginated mode
   */
  private handlePageChange(page: { current: number; total: number }): void {
    // Re-anchor highlights after CSS transition completes (0.3s)
    // getClientRects() returns values based on current animated position,
    // so we need to wait for the transition to finish
    if (this.reanchorTimeout) {
      window.clearTimeout(this.reanchorTimeout);
    }
    this.reanchorTimeout = window.setTimeout(() => {
      this.reanchorHighlights();
    }, 350); // Wait for 0.3s transition + buffer

    // Update chapter tracking when page changes (for merged chapters)
    this.updateCurrentChapterFromPage();
    this.updateLocation();

    // Proactively preload chapters based on position
    this.checkAndPreloadChapters(page);
  }

  /**
   * Check if we're approaching the edge of loaded content and preload
   */
  private checkAndPreloadChapters(page: { current: number; total: number }): void {
    if (this.config.mode !== 'paginated' || !this.book) return;

    // Don't block if already loading - queue the request
    if (this.isLoadingChapters) {
      // Schedule a retry after current load completes
      setTimeout(() => this.checkAndPreloadChapters(page), 100);
      return;
    }

    const doc = this.iframe?.contentDocument;
    if (!doc) return;

    const container = doc.getElementById('content-container');
    if (!container) return;

    // Calculate current position
    const pageWidth = container.clientWidth + this.config.columnGap;
    const currentOffset = page.current * pageWidth;
    const scrollWidth = container.scrollWidth;

    // Pages remaining forward
    const pagesRemainingForward = Math.floor((scrollWidth - currentOffset - pageWidth) / pageWidth);

    // Preload threshold - start loading when within 5 pages of edge
    const PRELOAD_THRESHOLD = 5;
    const PRELOAD_COUNT = 4; // Load 4 chapters at a time

    const totalChapters = this.book.spine.length;

    // Forward preloading
    if (pagesRemainingForward < PRELOAD_THRESHOLD && this.loadedChapters.size > 0) {
      const maxLoadedChapter = Math.max(...this.loadedChapters);

      if (maxLoadedChapter < totalChapters - 1) {
        console.log(`[EpubRenderer:Preload] ${pagesRemainingForward} pages ahead, preloading from chapter ${maxLoadedChapter + 1}`);
        this.preloadChaptersAhead(maxLoadedChapter + 1, PRELOAD_COUNT);
        return;
      }
    }

    // Backward preloading (less aggressive)
    const pagesFromStart = page.current;
    if (pagesFromStart < PRELOAD_THRESHOLD && this.loadedChapters.size > 0) {
      const minLoadedChapter = Math.min(...this.loadedChapters);

      if (minLoadedChapter > 0) {
        console.log(`[EpubRenderer:Preload] ${pagesFromStart} pages behind, preloading from chapter ${Math.max(0, minLoadedChapter - PRELOAD_COUNT)}`);
        this.preloadChaptersBehind(minLoadedChapter - 1, PRELOAD_COUNT);
      }
    }
  }

  /**
   * Preload chapters behind (for backward scrolling)
   */
  private async preloadChaptersBehind(endIndex: number, count: number): Promise<void> {
    if (this.isLoadingChapters || !this.book) return;

    const startIndex = Math.max(0, endIndex - count + 1);

    const toLoad: number[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      if (!this.loadedChapters.has(i)) {
        toLoad.push(i);
      }
    }

    if (toLoad.length === 0) return;

    this.isLoadingChapters = true;

    try {
      const loadPromises = toLoad.map(async (i) => {
        const chapterDiv = this.chapterElements.get(i);
        if (chapterDiv) {
          await this.loadChapterContent(i, chapterDiv);
        }
      });

      await Promise.all(loadPromises);
      await this.processImages('');

      // Only recalculate if no gesture/momentum is active
      if (this.paginator && !this.paginator.isGestureActive()) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        this.paginator.handleResize();
      }
    } finally {
      this.isLoadingChapters = false;
    }
  }

  /**
   * Preload chapters ahead without unloading current ones
   */
  private async preloadChaptersAhead(startIndex: number, count: number): Promise<void> {
    if (this.isLoadingChapters || !this.book) return;

    const totalChapters = this.book.spine.length;
    const endIndex = Math.min(startIndex + count - 1, totalChapters - 1);

    const toLoad: number[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      if (!this.loadedChapters.has(i)) {
        toLoad.push(i);
      }
    }

    if (toLoad.length === 0) return;

    this.isLoadingChapters = true;

    try {
      // Load chapters in parallel
      const loadPromises = toLoad.map(async (i) => {
        const chapterDiv = this.chapterElements.get(i);
        if (chapterDiv) {
          await this.loadChapterContent(i, chapterDiv);
        }
      });

      await Promise.all(loadPromises);

      // Process images
      await this.processImages('');

      // Only recalculate if no gesture/momentum is active
      // Don't interrupt the user's scroll animation
      if (this.paginator && !this.paginator.isGestureActive()) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        this.paginator.handleResize();
      }
    } finally {
      this.isLoadingChapters = false;
    }
  }

  /**
   * Handle scroll in scrolled mode
   */
  private handleScroll(scrollY: number): void {
    this.updateLocation();
  }

  /**
   * Update current location and emit event
   */
  private updateLocation(): void {
    if (!this.book) return;

    const spineItem = this.book.spine[this.currentSpineIndex];
    const totalChapters = this.book.spine.length;
    let percentage = 0;
    let pageInBook = 0;
    let totalPagesInBook = 0;
    let pageInChapter = 1;
    let totalPagesInChapter = 1;

    // Calculate book-wide percentage and page numbers
    if (this.config.mode === 'paginated' && this.paginator) {
      const pageInfo = this.paginator.getCurrentPage();

      // With all chapters loaded, pageInfo.current/total are book-wide values
      pageInBook = pageInfo.current;
      totalPagesInBook = pageInfo.total || 1;

      // Calculate per-chapter page info by finding the chapter element boundaries
      const chapterInfo = this.getChapterPageInfo(pageInfo.current);
      if (chapterInfo) {
        pageInChapter = chapterInfo.pageInChapter;
        totalPagesInChapter = chapterInfo.totalPagesInChapter;
      } else {
        // Fallback: estimate based on book position
        pageInChapter = pageInfo.current + 1;
        totalPagesInChapter = Math.max(1, Math.ceil(totalPagesInBook / Math.max(1, totalChapters)));
      }

      // Calculate book-wide percentage (avoid division by zero)
      // pageInBook is 0-indexed, add 1 for 1-indexed percentage
      if (totalPagesInBook > 0) {
        percentage = Math.round(((pageInBook + 1) / totalPagesInBook) * 100);
      }
    } else if (this.scroller) {
      // For scrolled mode, calculate book-wide progress from chapter position + scroll
      // scrollProgress is 0-1 WITHIN the current chapter, not book-wide!
      const chapterScrollProgress = this.scroller.getScrollProgress();

      // Calculate actual pages in chapter based on viewport height
      const contentHeight = this.scroller.getContentHeight();
      const viewportHeight = this.scroller.getViewportHeight() || 600;

      // Calculate pages based on actual content vs viewport
      if (contentHeight > 0 && viewportHeight > 0) {
        totalPagesInChapter = Math.max(1, Math.ceil(contentHeight / viewportHeight));
      } else {
        // Fallback to estimate
        totalPagesInChapter = this.estimatedPagesPerChapter;
      }

      // For total book pages, we still need estimates for other chapters
      // Use actual for current chapter, estimate for others
      totalPagesInBook = (totalChapters - 1) * this.estimatedPagesPerChapter + totalPagesInChapter;

      // Current page within chapter based on scroll progress
      pageInChapter = Math.round(chapterScrollProgress * totalPagesInChapter) + 1;
      pageInChapter = Math.max(1, Math.min(pageInChapter, totalPagesInChapter));

      // Pages before current chapter + current position in this chapter
      const pagesBeforeCurrentChapter = this.currentSpineIndex * this.estimatedPagesPerChapter;
      pageInBook = pagesBeforeCurrentChapter + pageInChapter;

      // Calculate book-wide percentage from completed chapters + current chapter progress
      // Each chapter contributes equally (1/totalChapters) to total progress
      const chapterWeight = 100 / totalChapters;
      const completedChaptersProgress = this.currentSpineIndex * chapterWeight;
      const currentChapterProgress = chapterScrollProgress * chapterWeight;
      percentage = Math.round(completedChaptersProgress + currentChapterProgress);

      console.log('[Renderer] Scroll progress calculated', {
        spineIndex: this.currentSpineIndex,
        scrollProgress: chapterScrollProgress.toFixed(3),
        percentage,
        pageInChapter,
        totalPagesInChapter,
        contentHeight,
        viewportHeight
      });
    }

    // Clamp percentage and ensure no NaN values
    percentage = Math.max(0, Math.min(100, percentage || 0));
    pageInBook = Math.max(1, pageInBook || 1);
    totalPagesInBook = Math.max(1, totalPagesInBook || 1);
    pageInChapter = Math.max(1, pageInChapter || 1);
    totalPagesInChapter = Math.max(1, totalPagesInChapter || 1);

    // Ensure page numbers don't exceed totals
    if (pageInBook > totalPagesInBook) {
      console.warn('[Renderer] Page exceeds total, clamping', { pageInBook, totalPagesInBook });
      pageInBook = totalPagesInBook;
    }
    if (pageInChapter > totalPagesInChapter) {
      pageInChapter = totalPagesInChapter;
    }

    this.currentLocation = {
      spineIndex: this.currentSpineIndex,
      href: spineItem.href,
      percentage,
      cfi: this.generateCfi(),
      pageInChapter,
      totalPagesInChapter,
      pageInBook,
      totalPagesInBook,
      totalChapters,
      scrollY: this.scroller?.getScrollY(),
    };

    this.emit('relocated', this.currentLocation);
  }

  /**
   * Generate CFI for current position
   */
  private generateCfi(): string {
    // Simple CFI generation - spine reference only
    // Full CFI would include element path and character offset
    const spinePosition = (this.currentSpineIndex + 1) * 2;
    return `epubcfi(/6/${spinePosition}!)`;
  }

  /**
   * Handle text selection
   */
  private handleSelection(selection: {
    text: string;
    range: Range;
    position: { x: number; y: number };
    selector?: import('./types').TextSelector;
  }): void {
    const cfi = this.generateCfi(); // TODO: Generate accurate CFI for selection

    // Use the parent document's tracked mouse position for popup placement
    // This avoids coordinate issues with CSS multi-column layouts inside the iframe
    // The parent position is tracked via window mousemove/mouseup events
    const popupPosition = { ...this.lastParentMousePosition };

    console.log('[Renderer] handleSelection - using parent mouse position: (' +
                popupPosition.x + ',' + popupPosition.y + ')' +
                ', iframe selection pos was: (' + selection.position.x + ',' + selection.position.y + ')');

    this.emit('selected', {
      text: selection.text,
      cfi,
      range: selection.range,
      position: popupPosition,
      spineIndex: this.currentSpineIndex,
      selector: selection.selector,
    });
  }
}
