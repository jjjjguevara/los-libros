/**
 * WASM Adapter for EPUB Processor
 *
 * Provides a TypeScript interface to the Rust WASM EPUB processor.
 * Handles WASM loading, initialization, and method calls.
 */

// These types mirror the Rust structures
export interface ParsedBook {
  id: string;
  metadata: BookMetadata;
  spine: SpineItem[];
  toc: TocEntry[];
}

export interface BookMetadata {
  title: string;
  creators: Creator[];
  language?: string;
  identifier?: string;
  publisher?: string;
  description?: string;
  coverHref?: string;
}

export interface Creator {
  name: string;
  role?: string;
}

export interface SpineItem {
  id: string;
  href: string;
  mediaType: string;
  linear: boolean;
}

export interface TocEntry {
  id: string;
  href: string;
  label: string;
  level: number;
  children: TocEntry[];
}

export interface ChapterContent {
  href: string;
  html: string;
  css: string[];
  images: string[];
}

export interface CfiLocation {
  href: string;
  spineIndex: number;
  elementPath: string;
  offset?: number;
}

export interface SearchResult {
  href: string;
  spineIndex: number;
  cfi: string;
  excerpt: string;
  position: number;
}

/**
 * WASM EPUB Processor interface
 */
export interface WasmEpubProcessor {
  loadBook(data: Uint8Array): Promise<ParsedBook>;
  getChapter(bookId: string, href: string): ChapterContent;
  getResource(bookId: string, href: string): Uint8Array;
  generateCfi(bookId: string, spineIndex: number, path: string, offset: number): string;
  resolveCfi(bookId: string, cfi: string): CfiLocation;
  buildSearchIndex(bookId: string): Promise<void>;
  search(bookId: string, query: string, limit?: number): SearchResult[];
  unloadBook(bookId: string): void;
  getLoadedBooks(): string[];
}

/**
 * WASM module instance (to be set after loading)
 */
let wasmInstance: any = null;
let processorInstance: any = null;

/**
 * Check if WASM is supported in this environment
 */
export function isWasmSupported(): boolean {
  try {
    if (typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function') {
      const module = new WebAssembly.Module(
        Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00)
      );
      if (module instanceof WebAssembly.Module) {
        return new WebAssembly.Instance(module) instanceof WebAssembly.Instance;
      }
    }
  } catch (e) {
    // WASM not supported
  }
  return false;
}

/**
 * Initialize the WASM module
 *
 * @param wasmSource - Path/URL to the WASM file, or WASM bytes as ArrayBuffer
 * @returns Promise that resolves when WASM is ready
 */
export async function initializeWasm(wasmSource?: string | ArrayBuffer): Promise<WasmEpubProcessor> {
  if (processorInstance) {
    return createProcessor();
  }

  if (!isWasmSupported()) {
    throw new Error('WebAssembly is not supported in this environment');
  }

  try {
    // Dynamic import of the WASM bindings
    // The WASM module must be built first with: cd src/wasm/epub-processor && wasm-pack build --target web
    // @ts-ignore - Module may not exist until WASM is built
    const wasm = await import('./epub-processor/pkg/epub_processor.js');
    wasmInstance = wasm;

    // Initialize WASM with provided source or let it find itself
    if (typeof wasm.default === 'function') {
      if (wasmSource) {
        // Pass the WASM source explicitly
        await wasm.default(wasmSource);
      } else {
        // Try to find WASM file automatically (may fail in some environments)
        await wasm.default();
      }
    }

    // Create processor instance
    if (wasm.EpubProcessor) {
      processorInstance = new wasm.EpubProcessor();
    } else {
      throw new Error('EpubProcessor class not found in WASM module');
    }

    return createProcessor();
  } catch (error) {
    console.error('Failed to initialize WASM:', error);
    throw new Error(`WASM initialization failed: ${error}`);
  }
}

/**
 * Create a processor wrapper with the TypeScript interface
 */
function createProcessor(): WasmEpubProcessor {
  if (!processorInstance) {
    throw new Error('WASM not initialized. Call initializeWasm() first.');
  }

  return {
    async loadBook(data: Uint8Array): Promise<ParsedBook> {
      return await processorInstance.loadBook(data);
    },

    getChapter(bookId: string, href: string): ChapterContent {
      return processorInstance.getChapter(bookId, href);
    },

    getResource(bookId: string, href: string): Uint8Array {
      return processorInstance.getResource(bookId, href);
    },

    generateCfi(bookId: string, spineIndex: number, path: string, offset: number): string {
      return processorInstance.generateCfi(bookId, spineIndex, path, offset);
    },

    resolveCfi(bookId: string, cfi: string): CfiLocation {
      return processorInstance.resolveCfi(bookId, cfi);
    },

    async buildSearchIndex(bookId: string): Promise<void> {
      await processorInstance.buildSearchIndex(bookId);
    },

    search(bookId: string, query: string, limit = 50): SearchResult[] {
      return processorInstance.search(bookId, query, limit);
    },

    unloadBook(bookId: string): void {
      processorInstance.unloadBook(bookId);
    },

    getLoadedBooks(): string[] {
      return processorInstance.getLoadedBooks();
    },
  };
}

/**
 * Get the current processor instance (if initialized)
 */
export function getProcessor(): WasmEpubProcessor | null {
  if (!processorInstance) {
    return null;
  }
  return createProcessor();
}

/**
 * Check if WASM is currently initialized
 */
export function isWasmInitialized(): boolean {
  return processorInstance !== null;
}

/**
 * Clean up WASM resources
 */
export function cleanupWasm(): void {
  if (processorInstance) {
    // Unload all books
    const books = processorInstance.getLoadedBooks();
    for (const bookId of books) {
      processorInstance.unloadBook(bookId);
    }
    processorInstance = null;
  }
  wasmInstance = null;
}
