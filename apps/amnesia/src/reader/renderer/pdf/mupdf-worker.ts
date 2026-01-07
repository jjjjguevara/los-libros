/**
 * MuPDF Web Worker
 *
 * Runs MuPDF WASM in a dedicated Web Worker to avoid blocking the main thread.
 * Handles PDF loading, rendering, and text extraction.
 */

// @ts-ignore - mupdf types are available but moduleResolution needs bundler
import * as mupdf from 'mupdf';

// Types for worker messages
// Each request has a `requestId` for correlation and `docId` for the document ID
export type WorkerRequest =
  | { type: 'LOAD_DOCUMENT'; requestId: string; docId: string; data: ArrayBuffer }
  | { type: 'RENDER_PAGE'; requestId: string; docId: string; pageNum: number; scale: number }
  | { type: 'GET_TEXT_LAYER'; requestId: string; docId: string; pageNum: number }
  | { type: 'SEARCH'; requestId: string; docId: string; query: string; maxHits: number }
  | { type: 'GET_PAGE_COUNT'; requestId: string; docId: string }
  | { type: 'GET_PAGE_DIMENSIONS'; requestId: string; docId: string; pageNum: number }
  | { type: 'UNLOAD_DOCUMENT'; requestId: string; docId: string };

export type WorkerResponse =
  | { type: 'LOADED'; requestId: string; pageCount: number; success: true }
  | { type: 'LOAD_ERROR'; requestId: string; error: string; success: false }
  | { type: 'PAGE_RENDERED'; requestId: string; pageNum: number; data: Uint8Array; width: number; height: number }
  | { type: 'RENDER_ERROR'; requestId: string; pageNum: number; error: string }
  | { type: 'TEXT_LAYER'; requestId: string; pageNum: number; data: TextLayerData }
  | { type: 'TEXT_LAYER_ERROR'; requestId: string; pageNum: number; error: string }
  | { type: 'SEARCH_RESULTS'; requestId: string; results: SearchResult[] }
  | { type: 'SEARCH_ERROR'; requestId: string; error: string }
  | { type: 'PAGE_COUNT'; requestId: string; pageCount: number }
  | { type: 'PAGE_COUNT_ERROR'; requestId: string; error: string }
  | { type: 'PAGE_DIMENSIONS'; requestId: string; pageNum: number; width: number; height: number }
  | { type: 'PAGE_DIMENSIONS_ERROR'; requestId: string; pageNum: number; error: string }
  | { type: 'DOCUMENT_UNLOADED'; requestId: string }
  | { type: 'UNLOAD_ERROR'; requestId: string; error: string };

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

export interface TextLayerData {
  pageNum: number;
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
}

// Document cache
const documents = new Map<string, mupdf.Document>();

/**
 * Load a PDF document from ArrayBuffer
 */
function loadDocument(id: string, data: ArrayBuffer): { pageCount: number } {
  // Unload existing document with same ID
  if (documents.has(id)) {
    try {
      documents.get(id)?.destroy?.();
    } catch {
      // Ignore destroy errors
    }
    documents.delete(id);
  }

  const doc = mupdf.Document.openDocument(data, 'application/pdf');
  documents.set(id, doc);

  return { pageCount: doc.countPages() };
}

/**
 * Render a page to PNG bytes
 */
function renderPage(
  id: string,
  pageNum: number,
  scale: number
): { data: Uint8Array; width: number; height: number } {
  const doc = documents.get(id);
  if (!doc) {
    throw new Error(`Document ${id} not loaded`);
  }

  // MuPDF uses 0-indexed pages
  const page = doc.loadPage(pageNum - 1);

  // Create scale matrix
  const matrix = mupdf.Matrix.scale(scale, scale);

  // Render to pixmap (RGB, with alpha)
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, true, true);

  // Convert to PNG
  const pngData = pixmap.asPNG();

  const result = {
    data: pngData,
    width: pixmap.getWidth(),
    height: pixmap.getHeight(),
  };

  // Clean up resources to prevent memory leaks
  pixmap.destroy();
  page.destroy();

  return result;
}

/**
 * Extract text layer with character positions
 */
function getTextLayer(id: string, pageNum: number): TextLayerData {
  const doc = documents.get(id);
  if (!doc) {
    throw new Error(`Document ${id} not loaded`);
  }

  const page = doc.loadPage(pageNum - 1);
  const bounds = page.getBounds();
  const width = bounds[2] - bounds[0];
  const height = bounds[3] - bounds[1];

  // Get structured text
  const stext = page.toStructuredText('preserve-whitespace');

  const items: TextItem[] = [];
  let currentItem: TextItem | null = null;
  let currentLine: { chars: CharPosition[]; bbox: mupdf.Rect } | null = null;

  // Walk through structured text to extract character positions
  stext.walk({
    beginLine(bbox: mupdf.Rect, _wmode: number, _direction: mupdf.Point) {
      currentLine = { chars: [], bbox };
    },

    onChar(
      c: string,
      origin: mupdf.Point,
      font: mupdf.Font,
      size: number,
      quad: mupdf.Quad,
      _color: mupdf.Color
    ) {
      if (!currentLine) return;

      // Quad format: [ul_x, ul_y, ur_x, ur_y, lr_x, lr_y, ll_x, ll_y]
      const charX = Math.min(quad[0], quad[6]); // min of ul_x and ll_x
      const charY = Math.min(quad[1], quad[3]); // min of ul_y and ur_y
      const charWidth = Math.abs(quad[2] - quad[0]); // ur_x - ul_x
      const charHeight = Math.abs(quad[5] - quad[1]); // lr_y - ul_y

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

      // Convert line to TextItem
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

  // Clean up resources to prevent memory leaks
  stext.destroy();
  page.destroy();

  return {
    pageNum,
    width,
    height,
    items,
  };
}

/**
 * Search document for text
 */
function searchDocument(
  id: string,
  query: string,
  maxHits: number
): SearchResult[] {
  const doc = documents.get(id);
  if (!doc) {
    throw new Error(`Document ${id} not loaded`);
  }

  const results: SearchResult[] = [];
  const pageCount = doc.countPages();
  let remaining = maxHits;

  for (let i = 0; i < pageCount && remaining > 0; i++) {
    const page = doc.loadPage(i);
    const quads = page.search(query, remaining);

    for (const quadArray of quads) {
      if (remaining <= 0) break;

      const rects = quadArray.map((quad: mupdf.Quad) => {
        // Convert quad to bounding box
        // Quad format: [ul_x, ul_y, ur_x, ur_y, lr_x, lr_y, ll_x, ll_y]
        const x = Math.min(quad[0], quad[6]);
        const y = Math.min(quad[1], quad[3]);
        const width = Math.max(quad[2], quad[4]) - x;
        const height = Math.max(quad[5], quad[7]) - y;
        return { x, y, width, height };
      });

      results.push({
        page: i + 1, // 1-indexed
        text: query,
        quads: rects,
      });

      remaining--;
    }

    // Clean up page to prevent memory leaks
    page.destroy();
  }

  return results;
}

/**
 * Get page dimensions
 */
function getPageDimensions(
  id: string,
  pageNum: number
): { width: number; height: number } {
  const doc = documents.get(id);
  if (!doc) {
    throw new Error(`Document ${id} not loaded`);
  }

  const page = doc.loadPage(pageNum - 1);
  const bounds = page.getBounds();

  const result = {
    width: bounds[2] - bounds[0],
    height: bounds[3] - bounds[1],
  };

  // Clean up page to prevent memory leaks
  page.destroy();

  return result;
}

/**
 * Unload a document
 */
function unloadDocument(id: string): void {
  const doc = documents.get(id);
  if (doc) {
    try {
      doc.destroy?.();
    } catch {
      // Ignore destroy errors
    }
    documents.delete(id);
  }
}

// Message handler
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'LOAD_DOCUMENT': {
        const { pageCount } = loadDocument(request.docId, request.data);
        self.postMessage({
          type: 'LOADED',
          requestId: request.requestId,
          pageCount,
          success: true,
        } as WorkerResponse);
        break;
      }

      case 'RENDER_PAGE': {
        const { data, width, height } = renderPage(
          request.docId,
          request.pageNum,
          request.scale
        );
        // Transfer the ArrayBuffer for efficiency
        // Use postMessage with transfer list
        const message: WorkerResponse = {
          type: 'PAGE_RENDERED',
          requestId: request.requestId,
          pageNum: request.pageNum,
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

      case 'GET_TEXT_LAYER': {
        const textLayer = getTextLayer(request.docId, request.pageNum);
        self.postMessage({
          type: 'TEXT_LAYER',
          requestId: request.requestId,
          pageNum: request.pageNum,
          data: textLayer,
        } as WorkerResponse);
        break;
      }

      case 'SEARCH': {
        const results = searchDocument(request.docId, request.query, request.maxHits);
        self.postMessage({
          type: 'SEARCH_RESULTS',
          requestId: request.requestId,
          results,
        } as WorkerResponse);
        break;
      }

      case 'GET_PAGE_COUNT': {
        const doc = documents.get(request.docId);
        if (!doc) {
          throw new Error(`Document ${request.docId} not loaded`);
        }
        self.postMessage({
          type: 'PAGE_COUNT',
          requestId: request.requestId,
          pageCount: doc.countPages(),
        } as WorkerResponse);
        break;
      }

      case 'GET_PAGE_DIMENSIONS': {
        const dims = getPageDimensions(request.docId, request.pageNum);
        self.postMessage({
          type: 'PAGE_DIMENSIONS',
          requestId: request.requestId,
          pageNum: request.pageNum,
          ...dims,
        } as WorkerResponse);
        break;
      }

      case 'UNLOAD_DOCUMENT': {
        unloadDocument(request.docId);
        self.postMessage({
          type: 'DOCUMENT_UNLOADED',
          requestId: request.requestId,
        } as WorkerResponse);
        break;
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    switch (request.type) {
      case 'LOAD_DOCUMENT':
        self.postMessage({
          type: 'LOAD_ERROR',
          requestId: request.requestId,
          error: errorMessage,
          success: false,
        } as WorkerResponse);
        break;

      case 'RENDER_PAGE':
        self.postMessage({
          type: 'RENDER_ERROR',
          requestId: request.requestId,
          pageNum: request.pageNum,
          error: errorMessage,
        } as WorkerResponse);
        break;

      case 'GET_TEXT_LAYER':
        self.postMessage({
          type: 'TEXT_LAYER_ERROR',
          requestId: request.requestId,
          pageNum: request.pageNum,
          error: errorMessage,
        } as WorkerResponse);
        break;

      case 'SEARCH':
        self.postMessage({
          type: 'SEARCH_ERROR',
          requestId: request.requestId,
          error: errorMessage,
        } as WorkerResponse);
        break;

      case 'GET_PAGE_COUNT':
        self.postMessage({
          type: 'PAGE_COUNT_ERROR',
          requestId: request.requestId,
          error: errorMessage,
        } as WorkerResponse);
        break;

      case 'GET_PAGE_DIMENSIONS':
        self.postMessage({
          type: 'PAGE_DIMENSIONS_ERROR',
          requestId: request.requestId,
          pageNum: request.pageNum,
          error: errorMessage,
        } as WorkerResponse);
        break;

      case 'UNLOAD_DOCUMENT':
        self.postMessage({
          type: 'UNLOAD_ERROR',
          requestId: request.requestId,
          error: errorMessage,
        } as WorkerResponse);
        break;

      default:
        console.error('[MuPDF Worker] Error:', errorMessage);
    }
  }
};

// Signal worker is ready
self.postMessage({ type: 'READY' });
