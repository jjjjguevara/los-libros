/**
 * Unified Document Worker
 *
 * Web Worker for PDF and EPUB document handling via MuPDF WASM.
 * Provides a unified interface for loading, rendering, text extraction, and search
 * across both document formats.
 *
 * This worker consolidates the functionality of mupdf-worker.ts while adding
 * EPUB-specific capabilities like chapter XHTML extraction.
 *
 * IMPORTANT: This worker uses dynamic import for mupdf to wait for the WASM binary
 * to be provided by the main thread via INIT_WASM message before loading.
 */

// Import types only - the actual module is loaded dynamically
// @ts-ignore - mupdf types are available but moduleResolution needs bundler
import type * as MuPDFTypes from 'mupdf';

// MuPDF is loaded dynamically after receiving WASM binary
// @ts-ignore - mupdf types are available but moduleResolution needs bundler
let mupdf: typeof MuPDFTypes;

// ============================================================================
// Types
// ============================================================================

export type DocumentFormat = 'pdf' | 'epub';

export interface DocumentMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
}

export interface TocEntry {
  title: string;
  page: number;
  level: number;
  children: TocEntry[];
}

export interface ParsedDocument {
  id: string;
  format: DocumentFormat;
  metadata: DocumentMetadata;
  toc: TocEntry[];
  itemCount: number;
  hasTextLayer: boolean;
}

export interface CharPosition {
  char: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
}

export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  charPositions: CharPosition[];
}

export interface StructuredText {
  itemIndex: number;
  width: number;
  height: number;
  items: TextItem[];
}

export interface SearchResult {
  page: number;
  text: string;
  quads: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  context?: {
    prefix: string;
    suffix: string;
  };
}

// Worker message types
export type DocumentWorkerRequest =
  | { type: 'LOAD_DOCUMENT'; requestId: string; docId: string; data: ArrayBuffer; filename?: string }
  | { type: 'RENDER_ITEM'; requestId: string; docId: string; itemIndex: number; scale: number }
  | { type: 'RENDER_TILE'; requestId: string; docId: string; itemIndex: number; tileX: number; tileY: number; tileSize: number; scale: number }
  | { type: 'GET_STRUCTURED_TEXT'; requestId: string; docId: string; itemIndex: number }
  | { type: 'SEARCH'; requestId: string; docId: string; query: string; maxHits: number; includeContext?: boolean }
  | { type: 'GET_ITEM_COUNT'; requestId: string; docId: string }
  | { type: 'GET_ITEM_DIMENSIONS'; requestId: string; docId: string; itemIndex: number }
  | { type: 'GET_EPUB_CHAPTER'; requestId: string; docId: string; chapterIndex: number }
  | { type: 'UNLOAD_DOCUMENT'; requestId: string; docId: string };

export type DocumentWorkerResponse =
  | { type: 'LOADED'; requestId: string; document: ParsedDocument; success: true }
  | { type: 'LOAD_ERROR'; requestId: string; error: string; success: false }
  | { type: 'ITEM_RENDERED'; requestId: string; itemIndex: number; data: Uint8Array; width: number; height: number }
  | { type: 'TILE_RENDERED'; requestId: string; itemIndex: number; tileX: number; tileY: number; data: Uint8Array; width: number; height: number }
  | { type: 'TILE_RENDER_ERROR'; requestId: string; itemIndex: number; tileX: number; tileY: number; error: string }
  | { type: 'RENDER_ERROR'; requestId: string; itemIndex: number; error: string }
  | { type: 'STRUCTURED_TEXT'; requestId: string; itemIndex: number; data: StructuredText }
  | { type: 'STRUCTURED_TEXT_ERROR'; requestId: string; itemIndex: number; error: string }
  | { type: 'SEARCH_RESULTS'; requestId: string; results: SearchResult[] }
  | { type: 'SEARCH_ERROR'; requestId: string; error: string }
  | { type: 'ITEM_COUNT'; requestId: string; itemCount: number }
  | { type: 'ITEM_COUNT_ERROR'; requestId: string; error: string }
  | { type: 'ITEM_DIMENSIONS'; requestId: string; itemIndex: number; width: number; height: number }
  | { type: 'ITEM_DIMENSIONS_ERROR'; requestId: string; itemIndex: number; error: string }
  | { type: 'EPUB_CHAPTER'; requestId: string; chapterIndex: number; xhtml: string }
  | { type: 'EPUB_CHAPTER_ERROR'; requestId: string; chapterIndex: number; error: string }
  | { type: 'DOCUMENT_UNLOADED'; requestId: string }
  | { type: 'UNLOAD_ERROR'; requestId: string; error: string };

// ============================================================================
// Document Storage
// ============================================================================

interface CachedDocument {
  doc: any; // MuPDF Document
  format: DocumentFormat;
  metadata: ParsedDocument;
}

const documents = new Map<string, CachedDocument>();

// ============================================================================
// Format Detection
// ============================================================================

function detectFormat(data: ArrayBuffer, filename?: string): DocumentFormat {
  const bytes = new Uint8Array(data);

  // PDF magic: %PDF
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'pdf';
  }

  // EPUB magic: PK (ZIP with specific content)
  if (bytes[0] === 0x50 && bytes[1] === 0x4B) {
    // Could be EPUB or other ZIP - check filename
    if (filename?.toLowerCase().endsWith('.epub')) {
      return 'epub';
    }
    // Default to EPUB for ZIP files without better info
    return 'epub';
  }

  // Fallback to filename extension
  if (filename) {
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'pdf') return 'pdf';
    if (ext === 'epub') return 'epub';
  }

  // Default to PDF
  return 'pdf';
}

function getMimeType(format: DocumentFormat): string {
  return format === 'pdf' ? 'application/pdf' : 'application/epub+zip';
}

// ============================================================================
// Document Operations
// ============================================================================

function loadDocument(id: string, data: ArrayBuffer, filename?: string): ParsedDocument {
  // Unload existing document with same ID
  if (documents.has(id)) {
    try {
      documents.get(id)?.doc?.destroy?.();
    } catch {
      // Ignore destroy errors
    }
    documents.delete(id);
  }

  const format = detectFormat(data, filename);
  const mimeType = getMimeType(format);
  const doc = mupdf.Document.openDocument(data, mimeType);

  // Extract metadata
  const metadata: DocumentMetadata = {};
  try {
    metadata.title = doc.getMetaData('info:Title') || undefined;
    metadata.author = doc.getMetaData('info:Author') || undefined;
    metadata.subject = doc.getMetaData('info:Subject') || undefined;
    metadata.creator = doc.getMetaData('info:Creator') || undefined;
    metadata.producer = doc.getMetaData('info:Producer') || undefined;
    metadata.creationDate = doc.getMetaData('info:CreationDate') || undefined;
    metadata.modificationDate = doc.getMetaData('info:ModDate') || undefined;
    const keywords = doc.getMetaData('info:Keywords');
    if (keywords) {
      metadata.keywords = keywords.split(',').map((k: string) => k.trim());
    }
  } catch {
    // Metadata extraction is optional
  }

  // Extract TOC
  const toc: TocEntry[] = [];
  try {
    const outline = doc.loadOutline();
    if (outline) {
      function convertOutline(items: any[]): TocEntry[] {
        return items.map((item) => ({
          title: item.title || '',
          page: item.page ?? 0,
          level: item.level ?? 0,
          children: item.down ? convertOutline(item.down) : [],
        }));
      }
      toc.push(...convertOutline(outline));
    }
  } catch {
    // TOC is optional
  }

  const itemCount = doc.countPages();
  const hasTextLayer = checkHasTextLayer(doc, format);

  const parsed: ParsedDocument = {
    id,
    format,
    metadata,
    toc,
    itemCount,
    hasTextLayer,
  };

  documents.set(id, { doc, format, metadata: parsed });
  return parsed;
}

function checkHasTextLayer(doc: any, format: DocumentFormat): boolean {
  if (format === 'epub') {
    return true; // EPUBs always have text
  }

  try {
    if (doc.countPages() === 0) return false;
    const page = doc.loadPage(0);
    const stext = page.toStructuredText('preserve-whitespace');
    const text = stext.asText?.() || '';
    stext.destroy();
    page.destroy();
    return text.trim().length > 0;
  } catch {
    return false;
  }
}

function renderItem(
  id: string,
  itemIndex: number,
  scale: number
): { data: Uint8Array; width: number; height: number } {
  const cached = documents.get(id);
  if (!cached) {
    throw new Error(`Document ${id} not loaded`);
  }

  const page = cached.doc.loadPage(itemIndex);
  let pixmap: any = null;

  try {
    const matrix = mupdf.Matrix.scale(scale, scale);
    pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, true, true);
    const pngData = pixmap.asPNG();

    return {
      data: pngData,
      width: pixmap.getWidth(),
      height: pixmap.getHeight(),
    };
  } finally {
    // Ensure cleanup even if an error occurs
    try { pixmap?.destroy(); } catch { /* ignore */ }
    try { page.destroy(); } catch { /* ignore */ }
  }
}

function renderTile(
  id: string,
  itemIndex: number,
  tileX: number,
  tileY: number,
  tileSize: number,
  scale: number
): { data: Uint8Array; width: number; height: number } {
  const cached = documents.get(id);
  if (!cached) {
    throw new Error(`Document ${id} not loaded`);
  }

  const page = cached.doc.loadPage(itemIndex);
  let pixmap: any = null;
  let device: any = null;

  try {
    const bounds = page.getBounds();
    const pageWidth = bounds[2] - bounds[0];
    const pageHeight = bounds[3] - bounds[1];

    // Calculate tile region
    const pageTileSize = tileSize / scale;
    const originX = tileX * pageTileSize;
    const originY = tileY * pageTileSize;

    const tileWidthPage = Math.min(pageTileSize, pageWidth - originX);
    const tileHeightPage = Math.min(pageTileSize, pageHeight - originY);

    if (tileWidthPage <= 0 || tileHeightPage <= 0) {
      throw new Error(`Tile (${tileX}, ${tileY}) is outside page bounds`);
    }

    const outputWidth = Math.ceil(tileWidthPage * scale);
    const outputHeight = Math.ceil(tileHeightPage * scale);

    const bbox: [number, number, number, number] = [0, 0, outputWidth, outputHeight];
    pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, true);
    pixmap.clear(255);

    device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
    const translateMatrix = mupdf.Matrix.translate(-originX, -originY);
    const scaleMatrix = mupdf.Matrix.scale(scale, scale);
    const matrix = mupdf.Matrix.concat(translateMatrix, scaleMatrix);

    page.run(device, matrix);
    device.close();

    const pngData = pixmap.asPNG();

    return {
      data: pngData,
      width: outputWidth,
      height: outputHeight,
    };
  } finally {
    // Ensure cleanup even if an error occurs
    try { device?.destroy(); } catch { /* ignore */ }
    try { pixmap?.destroy(); } catch { /* ignore */ }
    try { page.destroy(); } catch { /* ignore */ }
  }
}

function getStructuredText(id: string, itemIndex: number): StructuredText {
  const cached = documents.get(id);
  if (!cached) {
    throw new Error(`Document ${id} not loaded`);
  }

  const page = cached.doc.loadPage(itemIndex);
  let stext: any = null;

  try {
    const bounds = page.getBounds();
    const width = bounds[2] - bounds[0];
    const height = bounds[3] - bounds[1];

    stext = page.toStructuredText('preserve-whitespace');
    const items: TextItem[] = [];
    let currentLine: { chars: CharPosition[]; bbox: MuPDFTypes.Rect } | null = null;

    stext.walk({
      beginLine(bbox: MuPDFTypes.Rect) {
        currentLine = { chars: [], bbox };
      },

      onChar(
        c: string,
        _origin: MuPDFTypes.Point,
        font: MuPDFTypes.Font,
        size: number,
        quad: MuPDFTypes.Quad
      ) {
        if (!currentLine) return;

        const charX = Math.min(quad[0], quad[6]);
        const charY = Math.min(quad[1], quad[3]);
        const charWidth = Math.abs(quad[2] - quad[0]);
        const charHeight = Math.abs(quad[5] - quad[1]);

        currentLine.chars.push({
          char: c,
          x: charX,
          y: charY,
          width: charWidth,
          height: charHeight,
          fontSize: size,
          fontName: font.getName(),
        });
      },

      endLine() {
        if (!currentLine || currentLine.chars.length === 0) {
          currentLine = null;
          return;
        }

        const text = currentLine.chars.map((c) => c.char).join('');
        const lineX = currentLine.bbox[0];
        const lineY = currentLine.bbox[1];
        const lineWidth = currentLine.bbox[2] - currentLine.bbox[0];
        const lineHeight = currentLine.bbox[3] - currentLine.bbox[1];
        const fontSize = currentLine.chars[0]?.fontSize ?? 12;

        items.push({
          text,
          x: lineX,
          y: lineY,
          width: lineWidth,
          height: lineHeight,
          fontSize,
          charPositions: currentLine.chars,
        });

        currentLine = null;
      },
    });

    return { itemIndex, width, height, items };
  } finally {
    // Ensure cleanup even if an error occurs
    try { stext?.destroy(); } catch { /* ignore */ }
    try { page.destroy(); } catch { /* ignore */ }
  }
}

function searchDocument(
  id: string,
  query: string,
  maxHits: number,
  includeContext: boolean = false
): SearchResult[] {
  const cached = documents.get(id);
  if (!cached) {
    throw new Error(`Document ${id} not loaded`);
  }

  const results: SearchResult[] = [];
  const pageCount = cached.doc.countPages();
  let remaining = maxHits;

  for (let i = 0; i < pageCount && remaining > 0; i++) {
    const page = cached.doc.loadPage(i);
    const quads = page.search(query, remaining);

    for (const quadArray of quads) {
      if (remaining <= 0) break;

      const rects = quadArray.map((quad: MuPDFTypes.Quad) => {
        const x = Math.min(quad[0], quad[6]);
        const y = Math.min(quad[1], quad[3]);
        const quadWidth = Math.max(quad[2], quad[4]) - x;
        const quadHeight = Math.max(quad[5], quad[7]) - y;
        return { x, y, width: quadWidth, height: quadHeight };
      });

      const result: SearchResult = {
        page: i + 1, // 1-indexed
        text: query,
        quads: rects,
      };

      // Extract context if requested
      if (includeContext) {
        try {
          const context = extractSearchContext(page, rects[0], query);
          if (context) {
            result.context = context;
          }
        } catch {
          // Context extraction is optional
        }
      }

      results.push(result);
      remaining--;
    }

    page.destroy();
  }

  return results;
}

function extractSearchContext(
  page: any,
  rect: { x: number; y: number; width: number; height: number },
  query: string
): { prefix: string; suffix: string } | null {
  try {
    const stext = page.toStructuredText('preserve-whitespace');
    const fullText = stext.asText?.() || '';
    stext.destroy();

    const queryIndex = fullText.toLowerCase().indexOf(query.toLowerCase());
    if (queryIndex === -1) return null;

    const prefixStart = Math.max(0, queryIndex - 50);
    const suffixEnd = Math.min(fullText.length, queryIndex + query.length + 50);

    return {
      prefix: fullText.slice(prefixStart, queryIndex),
      suffix: fullText.slice(queryIndex + query.length, suffixEnd),
    };
  } catch {
    return null;
  }
}

function getItemDimensions(id: string, itemIndex: number): { width: number; height: number } {
  const cached = documents.get(id);
  if (!cached) {
    throw new Error(`Document ${id} not loaded`);
  }

  const page = cached.doc.loadPage(itemIndex);
  const bounds = page.getBounds();
  const result = {
    width: bounds[2] - bounds[0],
    height: bounds[3] - bounds[1],
  };
  page.destroy();
  return result;
}

/**
 * Get EPUB chapter XHTML content.
 * Note: This requires MuPDF's archive access which may not be fully exposed.
 * Falls back to rendering the page as text if archive access isn't available.
 */
function getEpubChapter(id: string, chapterIndex: number): string {
  const cached = documents.get(id);
  if (!cached) {
    throw new Error(`Document ${id} not loaded`);
  }

  if (cached.format !== 'epub') {
    throw new Error('getEpubChapter is only available for EPUB documents');
  }

  // MuPDF's Node.js/WASM API may not expose direct archive access
  // For now, extract text content as a fallback
  // TODO: If mupdf-js exposes archive access, use it here
  const page = cached.doc.loadPage(chapterIndex);
  const stext = page.toStructuredText('preserve-whitespace');

  // Build basic HTML from structured text
  let html = '<html><head><meta charset="utf-8"></head><body>';

  const blocks: string[] = [];
  let currentBlock = '';

  stext.walk({
    beginLine() {
      // Start of a new line
    },
    onChar(c: string) {
      currentBlock += c;
    },
    endLine() {
      if (currentBlock.trim()) {
        blocks.push(`<p>${escapeHtml(currentBlock)}</p>`);
      }
      currentBlock = '';
    },
  });

  // Flush any remaining content
  if (currentBlock.trim()) {
    blocks.push(`<p>${escapeHtml(currentBlock)}</p>`);
  }

  html += blocks.join('\n');
  html += '</body></html>';

  stext.destroy();
  page.destroy();

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function unloadDocument(id: string): void {
  const cached = documents.get(id);
  if (cached) {
    try {
      cached.doc.destroy?.();
    } catch {
      // Ignore destroy errors
    }
    documents.delete(id);
  }
}

// ============================================================================
// Message Handling
// ============================================================================

function handleRequest(request: DocumentWorkerRequest): void {
  try {
    switch (request.type) {
      case 'LOAD_DOCUMENT': {
        const document = loadDocument(request.docId, request.data, request.filename);
        self.postMessage({
          type: 'LOADED',
          requestId: request.requestId,
          document,
          success: true,
        } as DocumentWorkerResponse);
        break;
      }

      case 'RENDER_ITEM': {
        const { data, width, height } = renderItem(
          request.docId,
          request.itemIndex,
          request.scale
        );
        const message: DocumentWorkerResponse = {
          type: 'ITEM_RENDERED',
          requestId: request.requestId,
          itemIndex: request.itemIndex,
          data,
          width,
          height,
        };
        (self.postMessage as (message: unknown, transfer: Transferable[]) => void)(
          message,
          [data.buffer as ArrayBuffer]
        );
        break;
      }

      case 'RENDER_TILE': {
        const { data, width, height } = renderTile(
          request.docId,
          request.itemIndex,
          request.tileX,
          request.tileY,
          request.tileSize,
          request.scale
        );
        const message: DocumentWorkerResponse = {
          type: 'TILE_RENDERED',
          requestId: request.requestId,
          itemIndex: request.itemIndex,
          tileX: request.tileX,
          tileY: request.tileY,
          data,
          width,
          height,
        };
        (self.postMessage as (message: unknown, transfer: Transferable[]) => void)(
          message,
          [data.buffer as ArrayBuffer]
        );
        break;
      }

      case 'GET_STRUCTURED_TEXT': {
        const stext = getStructuredText(request.docId, request.itemIndex);
        self.postMessage({
          type: 'STRUCTURED_TEXT',
          requestId: request.requestId,
          itemIndex: request.itemIndex,
          data: stext,
        } as DocumentWorkerResponse);
        break;
      }

      case 'SEARCH': {
        const results = searchDocument(
          request.docId,
          request.query,
          request.maxHits,
          request.includeContext
        );
        self.postMessage({
          type: 'SEARCH_RESULTS',
          requestId: request.requestId,
          results,
        } as DocumentWorkerResponse);
        break;
      }

      case 'GET_ITEM_COUNT': {
        const cached = documents.get(request.docId);
        if (!cached) {
          throw new Error(`Document ${request.docId} not loaded`);
        }
        self.postMessage({
          type: 'ITEM_COUNT',
          requestId: request.requestId,
          itemCount: cached.doc.countPages(),
        } as DocumentWorkerResponse);
        break;
      }

      case 'GET_ITEM_DIMENSIONS': {
        const dims = getItemDimensions(request.docId, request.itemIndex);
        self.postMessage({
          type: 'ITEM_DIMENSIONS',
          requestId: request.requestId,
          itemIndex: request.itemIndex,
          ...dims,
        } as DocumentWorkerResponse);
        break;
      }

      case 'GET_EPUB_CHAPTER': {
        const xhtml = getEpubChapter(request.docId, request.chapterIndex);
        self.postMessage({
          type: 'EPUB_CHAPTER',
          requestId: request.requestId,
          chapterIndex: request.chapterIndex,
          xhtml,
        } as DocumentWorkerResponse);
        break;
      }

      case 'UNLOAD_DOCUMENT': {
        unloadDocument(request.docId);
        self.postMessage({
          type: 'DOCUMENT_UNLOADED',
          requestId: request.requestId,
        } as DocumentWorkerResponse);
        break;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    handleError(request, errorMessage);
  }
}

function handleError(request: DocumentWorkerRequest, errorMessage: string): void {
  switch (request.type) {
    case 'LOAD_DOCUMENT':
      self.postMessage({
        type: 'LOAD_ERROR',
        requestId: request.requestId,
        error: errorMessage,
        success: false,
      } as DocumentWorkerResponse);
      break;

    case 'RENDER_ITEM':
      self.postMessage({
        type: 'RENDER_ERROR',
        requestId: request.requestId,
        itemIndex: request.itemIndex,
        error: errorMessage,
      } as DocumentWorkerResponse);
      break;

    case 'RENDER_TILE':
      self.postMessage({
        type: 'TILE_RENDER_ERROR',
        requestId: request.requestId,
        itemIndex: request.itemIndex,
        tileX: request.tileX,
        tileY: request.tileY,
        error: errorMessage,
      } as DocumentWorkerResponse);
      break;

    case 'GET_STRUCTURED_TEXT':
      self.postMessage({
        type: 'STRUCTURED_TEXT_ERROR',
        requestId: request.requestId,
        itemIndex: request.itemIndex,
        error: errorMessage,
      } as DocumentWorkerResponse);
      break;

    case 'SEARCH':
      self.postMessage({
        type: 'SEARCH_ERROR',
        requestId: request.requestId,
        error: errorMessage,
      } as DocumentWorkerResponse);
      break;

    case 'GET_ITEM_COUNT':
      self.postMessage({
        type: 'ITEM_COUNT_ERROR',
        requestId: request.requestId,
        error: errorMessage,
      } as DocumentWorkerResponse);
      break;

    case 'GET_ITEM_DIMENSIONS':
      self.postMessage({
        type: 'ITEM_DIMENSIONS_ERROR',
        requestId: request.requestId,
        itemIndex: request.itemIndex,
        error: errorMessage,
      } as DocumentWorkerResponse);
      break;

    case 'GET_EPUB_CHAPTER':
      self.postMessage({
        type: 'EPUB_CHAPTER_ERROR',
        requestId: request.requestId,
        chapterIndex: request.chapterIndex,
        error: errorMessage,
      } as DocumentWorkerResponse);
      break;

    case 'UNLOAD_DOCUMENT':
      self.postMessage({
        type: 'UNLOAD_ERROR',
        requestId: request.requestId,
        error: errorMessage,
      } as DocumentWorkerResponse);
      break;

    default:
      console.error('[Document Worker] Error:', errorMessage);
  }
}

// ============================================================================
// Initialization
// ============================================================================

async function initializeWorker(): Promise<void> {
  // Wait for WASM binary from main thread
  const wasmReady = (globalThis as Record<string, unknown>).__MUPDF_WASM_READY__ as Promise<void>;
  await wasmReady;

  // Dynamically import mupdf
  // @ts-ignore
  mupdf = await import('mupdf');

  // Set up message handler
  self.onmessage = (event: MessageEvent<DocumentWorkerRequest>) => {
    handleRequest(event.data);
  };

  // Signal worker is ready
  self.postMessage({ type: 'READY' });
}

// Start initialization
initializeWorker().catch((error) => {
  console.error('[Document Worker] Initialization failed:', error);
  self.postMessage({ type: 'INIT_ERROR', error: String(error) });
});
