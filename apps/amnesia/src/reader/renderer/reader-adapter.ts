/**
 * Reader Adapter
 *
 * Bridges between the new EpubRenderer and the existing plugin patterns.
 * Provides an epub.js-like API for easier migration of ReaderContainer.
 *
 * This adapter can be used as a drop-in replacement for epub.js in the
 * existing ReaderContainer component while the server renderer is enabled.
 */

import type {
  ParsedBook,
  ReadingLocation,
  RendererConfig,
  Annotation,
  HighlightColor,
} from './types';
import { EpubRenderer } from './renderer';
import { ApiClient, createApiClient, getApiClient } from './api-client';
import { SyncManager } from './sync-manager';
import { getDeviceId } from './device-id';

/**
 * Events matching epub.js event names for compatibility
 */
interface AdapterEvents {
  relocated: (location: LocationData) => void;
  rendered: (section: SectionData, view: ViewData) => void;
  selected: (cfiRange: string, contents: ContentsData) => void;
  displayError: (error: Error) => void;
  ready: () => void;
}

/**
 * Location data matching epub.js format
 */
interface LocationData {
  start: {
    cfi: string;
    href: string;
    index: number;
    percentage: number;
  };
  end?: {
    cfi: string;
    href: string;
    index: number;
    percentage: number;
  };
  atStart: boolean;
  atEnd: boolean;
}

interface SectionData {
  href: string;
  index: number;
}

interface ViewData {
  document: Document | null;
  contents: {
    document: Document | null;
  };
}

interface ContentsData {
  window: Window | null;
  document: Document | null;
}

/**
 * Annotation matching epub.js format
 */
interface RenditionAnnotation {
  mark: (cfiRange: string, data?: object, callback?: Function, className?: string, styles?: object) => { remove: () => void };
  highlight: (cfiRange: string, data?: object, callback?: Function, className?: string, styles?: object) => { remove: () => void };
  underline: (cfiRange: string, data?: object, callback?: Function, className?: string, styles?: object) => { remove: () => void };
  remove: (cfiRange: string, type: string) => void;
}

/**
 * Themes matching epub.js format
 */
interface RenditionThemes {
  default: (styles: object) => void;
  register: (name: string, styles: object) => void;
  select: (name: string) => void;
  fontSize: (size: string) => void;
  override: (name: string, value: string) => void;
}

/**
 * Reader Adapter - provides epub.js-compatible API
 */
export class ReaderAdapter {
  private renderer: EpubRenderer | null = null;
  private api: ApiClient | null = null;
  private syncManager: SyncManager | null = null;

  private container: HTMLElement;
  private book: ParsedBook | null = null;
  private bookId: string = '';

  private eventListeners: Map<keyof AdapterEvents, Set<Function>> = new Map();
  private currentLocation: ReadingLocation | null = null;

  // epub.js-compatible properties
  public annotations: RenditionAnnotation;
  public themes: RenditionThemes;

  constructor() {
    // Initialize stub annotations API
    this.annotations = {
      mark: (cfi, data, cb, cls, styles) => this.addAnnotation('mark', cfi, data, cb, cls, styles),
      highlight: (cfi, data, cb, cls, styles) => this.addAnnotation('highlight', cfi, data, cb, cls, styles),
      underline: (cfi, data, cb, cls, styles) => this.addAnnotation('underline', cfi, data, cb, cls, styles),
      remove: (cfi, type) => this.removeAnnotation(cfi, type),
    };

    // Initialize stub themes API
    this.themes = {
      default: (styles) => this.applyStyles(styles),
      register: (name, styles) => { /* stored but not used */ },
      select: (name) => this.selectTheme(name),
      fontSize: (size) => this.setFontSize(size),
      override: (name, value) => { /* CSS override */ },
    };

    this.container = document.createElement('div');
  }

  /**
   * Initialize the adapter with server connection
   */
  async init(serverUrl: string): Promise<void> {
    if (!serverUrl) {
      throw new Error('Server URL is required');
    }

    const deviceId = getDeviceId();

    // Create API client
    this.api = createApiClient({
      baseUrl: serverUrl,
      deviceId,
    });

    // Verify server connection
    const healthy = await this.api.healthCheck();
    if (!healthy) {
      throw new Error('Cannot connect to Amnesia server');
    }
  }

  /**
   * Render to a container - matches epub.js renderTo()
   */
  renderTo(
    container: HTMLElement,
    options: {
      width?: string | number;
      height?: string | number;
      spread?: 'none' | 'auto';
      flow?: 'paginated' | 'scrolled' | 'scrolled-doc';
      manager?: 'default' | 'continuous';
    } = {}
  ): ReaderAdapter {
    this.container = container;

    if (!this.api) {
      throw new Error('Adapter not initialized. Call init() first.');
    }

    // Convert epub.js options to renderer config
    const config: Partial<RendererConfig> = {
      mode: options.flow === 'paginated' ? 'paginated' : 'scrolled',
      columns: options.spread === 'none' ? 'single' : 'auto',
    };

    // Create renderer
    this.renderer = new EpubRenderer(container, this.api, config);

    // Wire up events
    this.renderer.on('relocated', (location) => {
      this.currentLocation = location;
      this.emit('relocated', this.convertLocation(location));
    });

    this.renderer.on('rendered', ({ spineIndex, href }) => {
      const doc = this.getContentsDocument();
      this.emit('rendered', { href, index: spineIndex }, {
        document: doc,
        contents: { document: doc },
      });
    });

    this.renderer.on('selected', ({ text, cfi, range, position }) => {
      this.emit('selected', cfi, {
        window: null,
        document: this.getContentsDocument(),
      });
    });

    this.renderer.on('error', (error) => {
      this.emit('displayError', error);
    });

    return this;
  }

  /**
   * Display the book or navigate to a location
   */
  async display(target?: string): Promise<void> {
    if (!this.renderer || !this.book) {
      throw new Error('Book not loaded');
    }

    if (!target) {
      await this.renderer.display();
    } else if (target.startsWith('epubcfi')) {
      await this.renderer.display({ type: 'cfi', cfi: target });
    } else {
      await this.renderer.display({ type: 'href', href: target });
    }

    this.emit('ready');
  }

  /**
   * Load a book from ArrayBuffer - used when loading from vault/Calibre
   */
  async loadBook(arrayBuffer: ArrayBuffer, options?: { bookId?: string }): Promise<void> {
    if (!this.renderer || !this.api) {
      throw new Error('Renderer not initialized');
    }

    // Upload to server and get parsed book
    this.book = await this.api.uploadBook(arrayBuffer);
    this.bookId = this.book.id;

    // Load into renderer
    await this.renderer.load(this.bookId);

    // Initialize sync
    const deviceId = getDeviceId();
    this.syncManager = new SyncManager(this.api, {
      deviceId,
      onStatusChange: (status) => {
        console.log('[Sync]', status);
      },
    });
    await this.syncManager.initialize(this.bookId);
  }

  /**
   * Load a book by ID - when server already has the book
   */
  async loadBookById(bookId: string): Promise<void> {
    if (!this.renderer || !this.api) {
      throw new Error('Renderer not initialized');
    }

    this.bookId = bookId;
    this.book = await this.api.getBook(bookId);

    await this.renderer.load(bookId);

    // Initialize sync
    const deviceId = getDeviceId();
    this.syncManager = new SyncManager(this.api, {
      deviceId,
    });
    await this.syncManager.initialize(bookId);
  }

  /**
   * Go to next page
   */
  async next(): Promise<void> {
    await this.renderer?.next();
  }

  /**
   * Go to previous page
   */
  async prev(): Promise<void> {
    await this.renderer?.prev();
  }

  /**
   * Set spread mode
   */
  spread(value: 'none' | 'auto' | 'always'): void {
    const columns = value === 'none' ? 'single' : value === 'auto' ? 'auto' : 'dual';
    this.renderer?.updateConfig({ columns });
  }

  /**
   * Set flow mode
   */
  flow(value: 'paginated' | 'scrolled'): void {
    const mode = value === 'paginated' ? 'paginated' : 'scrolled';
    this.renderer?.updateConfig({ mode });
  }

  /**
   * Resize handler
   */
  resize(width?: number, height?: number): void {
    // Renderer handles resize automatically via ResizeObserver
  }

  /**
   * Get TOC (table of contents)
   */
  getToc(): { label: string; href: string; id: string }[] {
    return (this.book?.toc ?? []).map((item) => ({
      label: item.label,
      href: item.href,
      id: item.id,
    }));
  }

  /**
   * Get current location
   */
  getLocation(): LocationData | null {
    return this.currentLocation ? this.convertLocation(this.currentLocation) : null;
  }

  /**
   * Get book metadata
   */
  getMetadata(): ParsedBook['metadata'] | null {
    return this.book?.metadata ?? null;
  }

  /**
   * Get contents (for accessing iframe document)
   */
  getContents(): { document: Document | null }[] {
    const doc = this.getContentsDocument();
    return doc ? [{ document: doc }] : [];
  }

  /**
   * Event listener - matches epub.js on()
   */
  on<K extends keyof AdapterEvents>(event: K, listener: AdapterEvents[K]): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof AdapterEvents>(event: K, listener: AdapterEvents[K]): void {
    this.eventListeners.get(event)?.delete(listener);
  }

  /**
   * Destroy the adapter
   */
  destroy(): void {
    this.syncManager?.stop();
    this.renderer?.destroy();
    this.eventListeners.clear();
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private emit<K extends keyof AdapterEvents>(event: K, ...args: Parameters<AdapterEvents[K]>): void {
    this.eventListeners.get(event)?.forEach((listener) => {
      try {
        (listener as Function)(...args);
      } catch (e) {
        console.error(`Error in ${event} listener:`, e);
      }
    });
  }

  private convertLocation(location: ReadingLocation): LocationData {
    return {
      start: {
        cfi: location.cfi ?? '',
        href: location.href,
        index: location.spineIndex,
        percentage: location.percentage / 100,
      },
      atStart: location.spineIndex === 0 && location.percentage < 1,
      atEnd: location.percentage > 99,
    };
  }

  private getContentsDocument(): Document | null {
    // Access renderer's iframe document
    // This is a hack - proper solution would expose this in renderer
    const iframe = this.container.querySelector('iframe');
    return iframe?.contentDocument ?? null;
  }

  private addAnnotation(
    type: string,
    cfi: string,
    data?: object,
    callback?: Function,
    className?: string,
    styles?: object
  ): { remove: () => void } {
    // Create annotation on server
    if (this.api && this.bookId) {
      const annotation: Partial<Annotation> = {
        bookId: this.bookId,
        type: type as any,
        selector: { cfi },
        deviceId: getDeviceId(),
      };

      // Handle color from className (e.g., 'amnesia-highlight-yellow')
      if (className) {
        const colorMatch = className.match(/highlight-(\w+)/);
        if (colorMatch) {
          annotation.color = colorMatch[1] as HighlightColor;
        }
      }

      // Queue for sync
      this.syncManager?.create('annotation', cfi, annotation);
    }

    return {
      remove: () => this.removeAnnotation(cfi, type),
    };
  }

  private removeAnnotation(cfi: string, type: string): void {
    if (this.syncManager) {
      this.syncManager.delete('annotation', cfi);
    }
  }

  private applyStyles(styles: object): void {
    // Apply styles via renderer config
    // This is simplified - full implementation would parse epub.js style format
  }

  private selectTheme(name: string): void {
    const themeMap: Record<string, 'light' | 'dark' | 'sepia'> = {
      light: 'light',
      dark: 'dark',
      sepia: 'sepia',
    };
    this.renderer?.updateConfig({ theme: themeMap[name] ?? 'light' });
  }

  private setFontSize(size: string): void {
    // Parse size string (e.g., '16px', '120%')
    const match = size.match(/(\d+)/);
    if (match) {
      const fontSize = parseInt(match[1], 10);
      this.renderer?.updateConfig({ fontSize });
    }
  }
}

/**
 * Create a reader adapter instance
 */
export function createReaderAdapter(): ReaderAdapter {
  return new ReaderAdapter();
}
