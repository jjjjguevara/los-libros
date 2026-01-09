/**
 * WASM Book Provider
 *
 * Uses the Rust WASM EPUB processor for offline book reading.
 * Falls back when server is unavailable.
 */

import type { ParsedBook, ChapterContent } from './types';
import type { BookProvider, SearchResult } from './book-provider';
import {
  initializeWasm,
  getProcessor,
  isWasmSupported,
  isWasmInitialized,
  type WasmEpubProcessor,
  type ParsedBook as WasmParsedBook,
  type ChapterContent as WasmChapterContent,
} from '../../wasm';

/**
 * WASM-based book provider for offline reading
 */
export class WasmBookProvider implements BookProvider {
  readonly name = 'wasm';

  private processor: WasmEpubProcessor | null = null;
  private resourceUrls: Map<string, string> = new Map();
  private wasmSource?: string | ArrayBuffer;

  /**
   * Set the WASM source (path or bytes) before initialization
   */
  setWasmSource(source: string | ArrayBuffer): void {
    this.wasmSource = source;
  }

  /**
   * Check if WASM is supported in this environment
   */
  async isAvailable(): Promise<boolean> {
    if (!isWasmSupported()) {
      return false;
    }

    // Try to initialize if not already done
    if (!isWasmInitialized()) {
      try {
        this.processor = await initializeWasm(this.wasmSource);
        return true;
      } catch (e) {
        console.warn('[WasmProvider] Failed to initialize WASM:', e);
        return false;
      }
    }

    this.processor = getProcessor();
    return this.processor !== null;
  }

  /**
   * Load a book from EPUB bytes
   */
  async loadBook(data: ArrayBuffer, filename?: string): Promise<ParsedBook> {
    if (!this.processor) {
      await this.isAvailable();
    }

    if (!this.processor) {
      throw new Error('WASM processor not available');
    }

    const uint8Array = new Uint8Array(data);
    const wasmBook = await this.processor.loadBook(uint8Array);

    return this.convertParsedBook(wasmBook as WasmParsedBook);
  }

  /**
   * Get chapter content
   */
  async getChapter(bookId: string, href: string): Promise<ChapterContent> {
    console.log('[WasmProvider] getChapter called:', { bookId, href });
    if (!this.processor) {
      throw new Error('WASM processor not available');
    }

    const wasmContent = this.processor.getChapter(bookId, href);
    console.log('[WasmProvider] WASM returned chapter:', {
      href: wasmContent.href,
      htmlLength: wasmContent.html?.length,
      imagesCount: wasmContent.images?.length,
      cssCount: wasmContent.css?.length
    });
    return this.convertChapterContent(wasmContent as WasmChapterContent, bookId);
  }

  /**
   * Get a resource as bytes
   */
  async getResource(bookId: string, href: string): Promise<Uint8Array> {
    if (!this.processor) {
      throw new Error('WASM processor not available');
    }

    return this.processor.getResource(bookId, href);
  }

  /**
   * Get resource as Blob URL
   */
  async getResourceAsUrl(bookId: string, href: string): Promise<string> {
    const cacheKey = `${bookId}:${href}`;

    // Check cache first
    const cached = this.resourceUrls.get(cacheKey);
    if (cached) {
      return cached;
    }

    const bytes = await this.getResource(bookId, href);
    const mimeType = this.guessMimeType(href);
    // Use a new Uint8Array to ensure we have a standard ArrayBuffer
    const copy = new Uint8Array(bytes);
    const blob = new Blob([copy], { type: mimeType });
    const url = URL.createObjectURL(blob);

    this.resourceUrls.set(cacheKey, url);
    return url;
  }

  /**
   * Unload a book to free memory
   */
  unloadBook(bookId: string): void {
    if (this.processor) {
      this.processor.unloadBook(bookId);
    }

    // Revoke blob URLs for this book
    for (const [key, url] of this.resourceUrls.entries()) {
      if (key.startsWith(`${bookId}:`)) {
        URL.revokeObjectURL(url);
        this.resourceUrls.delete(key);
      }
    }
  }

  /**
   * Search book content
   */
  async search(bookId: string, query: string, limit = 50): Promise<SearchResult[]> {
    if (!this.processor) {
      throw new Error('WASM processor not available');
    }

    // Build search index if not already built
    await this.processor.buildSearchIndex(bookId);

    return this.processor.search(bookId, query, limit);
  }

  /**
   * Convert WASM ParsedBook to our ParsedBook type
   */
  private convertParsedBook(wasm: WasmParsedBook): ParsedBook {
    // Generate an ID for the metadata if not present
    const metadataId = wasm.metadata.identifier || wasm.id;

    // Convert spine items
    const spine = wasm.spine.map((item) => ({
      id: item.id,
      href: item.href,
      mediaType: item.mediaType,
      linear: item.linear,
    }));

    // Convert TOC entries, with fallback to generate from spine if empty
    let toc = wasm.toc.map((entry) => this.convertTocEntry(entry));

    if (toc.length === 0 && spine.length > 0) {
      console.log(`[WasmProvider] TOC is empty, generating from spine (${spine.length} items)`);
      toc = this.generateTocFromSpine(spine);
      console.log(`[WasmProvider] Generated ${toc.length} TOC entries from spine`);
    }

    return {
      id: wasm.id,
      metadata: {
        id: metadataId,
        title: wasm.metadata.title,
        creators: (wasm.metadata.creators || []).map(c => ({
          name: c.name,
          role: c.role,
        })),
        language: wasm.metadata.language || 'en',
        identifier: wasm.metadata.identifier,
        publisher: wasm.metadata.publisher,
        description: wasm.metadata.description,
        coverHref: wasm.metadata.coverHref,
      },
      spine,
      toc,
    };
  }

  /**
   * Generate TOC entries from spine when no NAV/NCX is available
   */
  private generateTocFromSpine(spine: Array<{ id: string; href: string; linear: boolean }>): any[] {
    return spine
      .filter(item => item.linear)
      .map((item, index) => ({
        id: `spine-${index}`,
        href: item.href,
        label: `Chapter ${index + 1}`,
        level: 0,
        children: [],
      }));
  }

  /**
   * Convert WASM TocEntry recursively
   */
  private convertTocEntry(entry: any): any {
    return {
      id: entry.id,
      href: entry.href,
      label: entry.label,
      level: entry.level,
      children: entry.children?.map((c: any) => this.convertTocEntry(c)) || [],
    };
  }

  /**
   * Resolve a relative path against a base path
   * e.g., resolvePath('text/part0001.html', '../images/00002.jpeg') => 'images/00002.jpeg'
   */
  private resolvePath(basePath: string, relativePath: string): string {
    // If the path is already absolute (no ..), return as-is
    if (!relativePath.startsWith('.')) {
      // But we still need to handle paths relative to the chapter directory
      const baseDir = basePath.includes('/') ? basePath.substring(0, basePath.lastIndexOf('/') + 1) : '';
      return baseDir + relativePath;
    }

    // Get the directory of the base path
    const baseParts = basePath.split('/');
    baseParts.pop(); // Remove the filename

    // Split the relative path and resolve
    const relativeParts = relativePath.split('/');

    for (const part of relativeParts) {
      if (part === '..') {
        baseParts.pop();
      } else if (part !== '.') {
        baseParts.push(part);
      }
    }

    return baseParts.join('/');
  }

  /**
   * Convert WASM ChapterContent to our type
   */
  private async convertChapterContent(
    wasm: WasmChapterContent,
    bookId: string
  ): Promise<ChapterContent> {
    // Replace image src attributes with blob URLs
    let html = wasm.html;
    const chapterHref = wasm.href;

    for (const imageSrc of wasm.images) {
      try {
        // Resolve relative path to absolute path within EPUB
        const resolvedPath = this.resolvePath(chapterHref, imageSrc);
        const blobUrl = await this.getResourceAsUrl(bookId, resolvedPath);
        const escapedSrc = this.escapeRegex(imageSrc);

        // Replace both src= (for <img>) and xlink:href= (for SVG <image>)
        html = html.replace(
          new RegExp(`src=["']${escapedSrc}["']`, 'g'),
          `src="${blobUrl}"`
        );
        html = html.replace(
          new RegExp(`xlink:href=["']${escapedSrc}["']`, 'g'),
          `xlink:href="${blobUrl}"`
        );
      } catch (e) {
        console.warn('[WasmProvider] Failed to load image:', imageSrc, e);
      }
    }

    // Load and inline CSS into the HTML
    const inlinedCss: string[] = [];
    for (const cssHref of wasm.css) {
      try {
        // Resolve CSS path relative to chapter
        const resolvedCssPath = this.resolvePath(chapterHref, cssHref);
        const cssBytes = await this.getResource(bookId, resolvedCssPath);
        const cssText = new TextDecoder().decode(cssBytes);
        inlinedCss.push(cssText);
      } catch (e) {
        console.warn('[WasmProvider] Failed to load CSS:', cssHref, e);
      }
    }

    // Inject CSS into the HTML head if there's any
    if (inlinedCss.length > 0) {
      const styleTag = `<style>${inlinedCss.join('\n')}</style>`;
      // Insert before </head> if present, otherwise at the start
      if (html.includes('</head>')) {
        html = html.replace('</head>', `${styleTag}</head>`);
      } else if (html.includes('<body')) {
        html = html.replace('<body', `${styleTag}<body`);
      } else {
        html = styleTag + html;
      }
    }

    return {
      href: wasm.href,
      html,
      spineIndex: 0, // Will be set by caller
    };
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Guess MIME type from file extension
   */
  private guessMimeType(href: string): string {
    const ext = href.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      // Images
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      // Fonts
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      otf: 'font/otf',
      // CSS
      css: 'text/css',
      // HTML
      html: 'text/html',
      xhtml: 'application/xhtml+xml',
      // XML
      xml: 'application/xml',
      ncx: 'application/x-dtbncx+xml',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }
}
