/**
 * MuPDF Web Worker
 *
 * Runs MuPDF WASM in a dedicated Web Worker to avoid blocking the main thread.
 * Handles PDF loading, rendering, and text extraction.
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

// Types for worker messages
// Each request has a `requestId` for correlation and `docId` for the document ID
export type WorkerRequest =
  | { type: 'LOAD_DOCUMENT'; requestId: string; docId: string; data: ArrayBuffer }
  | { type: 'RENDER_PAGE'; requestId: string; docId: string; pageNum: number; scale: number }
  | { type: 'RENDER_TILE'; requestId: string; docId: string; pageNum: number; tileX: number; tileY: number; tileSize: number; scale: number }
  | { type: 'GET_TEXT_LAYER'; requestId: string; docId: string; pageNum: number }
  | { type: 'SEARCH'; requestId: string; docId: string; query: string; maxHits: number }
  | { type: 'GET_PAGE_COUNT'; requestId: string; docId: string }
  | { type: 'GET_PAGE_DIMENSIONS'; requestId: string; docId: string; pageNum: number }
  | { type: 'UNLOAD_DOCUMENT'; requestId: string; docId: string };

export type WorkerResponse =
  | { type: 'LOADED'; requestId: string; pageCount: number; success: true }
  | { type: 'LOAD_ERROR'; requestId: string; error: string; success: false }
  | { type: 'PAGE_RENDERED'; requestId: string; pageNum: number; data: Uint8Array; width: number; height: number }
  | { type: 'TILE_RENDERED'; requestId: string; pageNum: number; tileX: number; tileY: number; data: Uint8Array; width: number; height: number }
  | { type: 'TILE_RENDER_ERROR'; requestId: string; pageNum: number; tileX: number; tileY: number; error: string }
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

// Document cache - uses 'any' since mupdf is dynamically loaded
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const documents = new Map<string, any>();

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
 * Render a specific tile of a page to PNG bytes
 * Enables CATiledLayer-style partial page rendering for smooth scrolling
 *
 * @param id Document ID
 * @param pageNum Page number (1-indexed)
 * @param tileX Tile X index (0-indexed)
 * @param tileY Tile Y index (0-indexed)
 * @param tileSize Tile size in pixels (typically 256)
 * @param scale Render scale (1 = 72 DPI, 2 = 144 DPI)
 */
function renderTile(
  id: string,
  pageNum: number,
  tileX: number,
  tileY: number,
  tileSize: number,
  scale: number
): { data: Uint8Array; width: number; height: number } {
  const doc = documents.get(id);
  if (!doc) {
    throw new Error(`Document ${id} not loaded`);
  }

  // MuPDF uses 0-indexed pages
  const page = doc.loadPage(pageNum - 1);

  // Calculate tile region in page coordinates (before scaling)
  // Each tile covers (tileSize/scale) points in page space
  const pageTileSize = tileSize / scale;
  const originX = tileX * pageTileSize;
  const originY = tileY * pageTileSize;

  // Get page bounds to calculate tile dimensions at page edge
  const bounds = page.getBounds();
  const pageWidth = bounds[2] - bounds[0];
  const pageHeight = bounds[3] - bounds[1];

  // Calculate actual tile dimensions in page coordinates (may be smaller at edges)
  const tileWidthPage = Math.min(pageTileSize, pageWidth - originX);
  const tileHeightPage = Math.min(pageTileSize, pageHeight - originY);

  // Skip if tile is outside page bounds
  if (tileWidthPage <= 0 || tileHeightPage <= 0) {
    throw new Error(`Tile (${tileX}, ${tileY}) is outside page bounds`);
  }

  // Calculate output dimensions in device pixels
  const outputWidth = Math.ceil(tileWidthPage * scale);
  const outputHeight = Math.ceil(tileHeightPage * scale);

  // Create a Pixmap with specific bounding box (in device coordinates)
  // This defines both the output size AND clips the content
  // Bbox: [x0, y0, x1, y1] in device coordinates
  const bbox: [number, number, number, number] = [0, 0, outputWidth, outputHeight];
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, true);

  // Clear pixmap to white (otherwise it may have garbage data)
  pixmap.clear(255);

  // Create DrawDevice to render into the pixmap
  // The device uses identity matrix - all transformation is in the page.run() call
  const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);

  // Create transformation matrix:
  // 1. Translate to move tile origin to (0, 0): translate(-originX, -originY)
  // 2. Scale to device coordinates: scale(scale, scale)
  //
  // MuPDF Matrix.concat(A, B) = B * A (applies A first, then B)
  // So concat(translate, scale) applies translate first, then scale
  const translateMatrix = mupdf.Matrix.translate(-originX, -originY);
  const scaleMatrix = mupdf.Matrix.scale(scale, scale);
  const matrix = mupdf.Matrix.concat(translateMatrix, scaleMatrix);

  // Run the page through the device - content will be clipped to pixmap bounds
  page.run(device, matrix);

  // Close the device to finalize rendering
  device.close();

  // Convert to PNG
  const pngData = pixmap.asPNG();

  const result = {
    data: pngData,
    width: outputWidth,
    height: outputHeight,
  };

  // Clean up resources to prevent memory leaks
  device.destroy();
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
  let currentLine: { chars: CharPosition[]; bbox: MuPDFTypes.Rect } | null = null;

  // Walk through structured text to extract character positions
  stext.walk({
    beginLine(bbox: MuPDFTypes.Rect, _wmode: number, _direction: MuPDFTypes.Point) {
      currentLine = { chars: [], bbox };
    },

    onChar(
      c: string,
      origin: MuPDFTypes.Point,
      font: MuPDFTypes.Font,
      size: number,
      quad: MuPDFTypes.Quad,
      _color: MuPDFTypes.Color
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

      const rects = quadArray.map((quad: MuPDFTypes.Quad) => {
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

/**
 * Handle regular PDF operation requests.
 * Only called after mupdf is initialized.
 */
function handleRequest(request: WorkerRequest): void {
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

      case 'RENDER_TILE': {
        const { data, width, height } = renderTile(
          request.docId,
          request.pageNum,
          request.tileX,
          request.tileY,
          request.tileSize,
          request.scale
        );
        const message: WorkerResponse = {
          type: 'TILE_RENDERED',
          requestId: request.requestId,
          pageNum: request.pageNum,
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

      case 'RENDER_TILE':
        self.postMessage({
          type: 'TILE_RENDER_ERROR',
          requestId: request.requestId,
          pageNum: request.pageNum,
          tileX: request.tileX,
          tileY: request.tileY,
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
}

/**
 * Initialize the worker by waiting for WASM binary from main thread,
 * then dynamically importing mupdf.
 */
async function initializeWorker(): Promise<void> {
  // Wait for WASM binary from main thread
  // The esbuild banner sets up $libmupdf_wasm_Module and __MUPDF_WASM_READY__
  const wasmReady = (globalThis as Record<string, unknown>).__MUPDF_WASM_READY__ as Promise<void>;
  await wasmReady;

  // Now dynamically import mupdf - it will use the wasmBinary we provided
  // @ts-ignore - mupdf types are available but moduleResolution needs bundler
  mupdf = await import('mupdf');

  // Set up message handler for regular requests
  self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    handleRequest(event.data);
  };

  // Signal worker is ready
  self.postMessage({ type: 'READY' });
}

// Start initialization
initializeWorker().catch((error) => {
  console.error('[MuPDF Worker] Initialization failed:', error);
  self.postMessage({ type: 'INIT_ERROR', error: String(error) });
});
