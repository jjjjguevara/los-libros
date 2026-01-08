/**
 * MuPDF Bridge
 *
 * Main thread interface to the MuPDF Web Worker.
 * Provides Promise-based API for PDF operations.
 */

import type {
  WorkerRequest,
  WorkerResponse,
  TextLayerData,
  SearchResult,
} from './mupdf-worker';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  type: string;
};

// Static plugin path for worker loading - set by the plugin on startup
let pluginBasePath: string | null = null;
let cachedWorkerBlobUrl: string | null = null;

/**
 * Set the plugin base path for loading workers.
 * Should be called once during plugin initialization with the vault path.
 */
export function setMuPDFPluginPath(vaultPath: string): void {
  pluginBasePath = `${vaultPath}/.obsidian/plugins/amnesia`;
}

/**
 * Create a Blob URL from the worker file for cross-origin compatibility.
 * Obsidian runs on Electron with app:// origin, which can't load file:// workers directly.
 * The pre-built worker already has all necessary initialization code from esbuild.
 */
async function getWorkerBlobUrl(): Promise<string> {
  if (cachedWorkerBlobUrl) {
    return cachedWorkerBlobUrl;
  }

  if (!pluginBasePath) {
    throw new Error('MuPDF worker path not configured. Call setMuPDFPluginPath() first.');
  }

  // Use Node.js fs to read the pre-built worker file (available in Electron)
  const fs = window.require('fs') as typeof import('fs');
  const workerPath = `${pluginBasePath}/mupdf-worker.js`;

  // Read the pre-built worker - don't modify it, esbuild already set up initialization
  const workerCode = fs.readFileSync(workerPath, 'utf-8');
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  cachedWorkerBlobUrl = URL.createObjectURL(blob);

  return cachedWorkerBlobUrl;
}

/**
 * Bridge to communicate with MuPDF Web Worker
 */
export class MuPDFBridge {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestIdCounter = 0;
  private isReady = false;
  private readyPromise: Promise<void>;
  private readyResolve: (() => void) | null = null;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  /**
   * Initialize the worker
   */
  async initialize(): Promise<void> {
    if (this.worker) {
      return this.readyPromise;
    }

    if (!pluginBasePath) {
      throw new Error('MuPDF plugin path not configured. Call setMuPDFPluginPath() first.');
    }

    // Read WASM binary from disk using Node.js fs (available in Electron main thread)
    const fs = window.require('fs') as typeof import('fs');
    const wasmPath = `${pluginBasePath}/mupdf-wasm.wasm`;
    const wasmBinary = fs.readFileSync(wasmPath);

    // Create worker from Blob URL (required for cross-origin in Obsidian/Electron)
    const workerUrl = await getWorkerBlobUrl();

    // Use module worker for ESM format with top-level await support
    this.worker = new Worker(workerUrl, { type: 'module' });

    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = this.handleError.bind(this);

    // Send WASM binary to worker - required by esbuild banner setup
    // The worker is waiting for INIT_WASM message before loading mupdf
    this.worker.postMessage(
      { type: 'INIT_WASM', wasmBinary: wasmBinary },
      [wasmBinary.buffer] // Transfer ownership for performance
    );

    return this.readyPromise;
  }

  /**
   * Handle messages from worker
   */
  private handleMessage(event: MessageEvent<WorkerResponse | { type: 'READY' }>): void {
    const response = event.data;

    // Handle ready signal
    if (response.type === 'READY') {
      this.isReady = true;
      this.readyResolve?.();
      return;
    }

    // Handle response with requestId
    if ('requestId' in response) {
      const pending = this.pendingRequests.get(response.requestId);
      if (!pending) {
        console.warn('[MuPDF Bridge] No pending request for ID:', response.requestId);
        return;
      }

      this.pendingRequests.delete(response.requestId);

      // Check for error responses
      if (
        response.type === 'LOAD_ERROR' ||
        response.type === 'RENDER_ERROR' ||
        response.type === 'TILE_RENDER_ERROR' ||
        response.type === 'TEXT_LAYER_ERROR' ||
        response.type === 'SEARCH_ERROR' ||
        response.type === 'PAGE_COUNT_ERROR' ||
        response.type === 'PAGE_DIMENSIONS_ERROR' ||
        response.type === 'UNLOAD_ERROR'
      ) {
        pending.reject(new Error((response as { error: string }).error));
        return;
      }

      pending.resolve(response);
    }
  }

  /**
   * Handle worker errors
   */
  private handleError(event: ErrorEvent): void {
    console.error('[MuPDF Bridge] Worker error:', event.message);

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error(`Worker error: ${event.message}`));
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    return `req-${++this.requestIdCounter}`;
  }

  /**
   * Send a request to the worker and wait for response
   */
  private async sendRequest<T>(
    request: WorkerRequest,
    transferables?: Transferable[]
  ): Promise<T> {
    if (!this.worker) {
      throw new Error('Worker not initialized. Call initialize() first.');
    }

    await this.readyPromise;

    const requestId = request.requestId;

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        type: request.type,
      });

      if (transferables?.length) {
        this.worker!.postMessage(request, transferables);
      } else {
        this.worker!.postMessage(request);
      }
    });
  }

  /**
   * Load a PDF document from ArrayBuffer
   */
  async loadDocument(data: ArrayBuffer): Promise<{ pageCount: number }> {
    // Generate a document ID
    const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const requestId = this.generateRequestId();

    const response = await this.sendRequest<{
      type: 'LOADED';
      requestId: string;
      pageCount: number;
    }>(
      { type: 'LOAD_DOCUMENT', requestId, docId, data },
      [data] // Transfer ArrayBuffer ownership
    );

    return { pageCount: response.pageCount };
  }

  /**
   * Load a PDF document and return the document ID
   */
  async loadDocumentWithId(data: ArrayBuffer): Promise<{ id: string; pageCount: number }> {
    const docId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const requestId = this.generateRequestId();

    const response = await this.sendRequest<{
      type: 'LOADED';
      requestId: string;
      pageCount: number;
    }>(
      { type: 'LOAD_DOCUMENT', requestId, docId, data },
      [data]
    );

    return { id: docId, pageCount: response.pageCount };
  }

  /**
   * Render a page to PNG
   * @param docId Document ID from loadDocumentWithId
   * @param pageNum 1-indexed page number
   * @param scale Render scale (1.0 = 72 DPI)
   */
  async renderPage(
    docId: string,
    pageNum: number,
    scale: number
  ): Promise<{ data: Uint8Array; width: number; height: number }> {
    const requestId = this.generateRequestId();

    const response = await this.sendRequest<{
      type: 'PAGE_RENDERED';
      requestId: string;
      pageNum: number;
      data: Uint8Array;
      width: number;
      height: number;
    }>({ type: 'RENDER_PAGE', requestId, docId, pageNum, scale });

    return {
      data: response.data,
      width: response.width,
      height: response.height,
    };
  }

  /**
   * Get text layer with character positions
   * @param docId Document ID
   * @param pageNum 1-indexed page number
   */
  async getTextLayer(docId: string, pageNum: number): Promise<TextLayerData> {
    const requestId = this.generateRequestId();

    const response = await this.sendRequest<{
      type: 'TEXT_LAYER';
      requestId: string;
      pageNum: number;
      data: TextLayerData;
    }>({ type: 'GET_TEXT_LAYER', requestId, docId, pageNum });

    return response.data;
  }

  /**
   * Search document for text
   * @param docId Document ID
   * @param query Search query
   * @param maxHits Maximum number of results
   */
  async search(docId: string, query: string, maxHits: number = 100): Promise<SearchResult[]> {
    const requestId = this.generateRequestId();

    const response = await this.sendRequest<{
      type: 'SEARCH_RESULTS';
      requestId: string;
      results: SearchResult[];
    }>({ type: 'SEARCH', requestId, docId, query, maxHits });

    return response.results;
  }

  /**
   * Get page count for a loaded document
   * @param docId Document ID
   */
  async getPageCount(docId: string): Promise<number> {
    const requestId = this.generateRequestId();

    const response = await this.sendRequest<{
      type: 'PAGE_COUNT';
      requestId: string;
      pageCount: number;
    }>({ type: 'GET_PAGE_COUNT', requestId, docId });

    return response.pageCount;
  }

  /**
   * Get page dimensions (at scale 1.0)
   * @param docId Document ID
   * @param pageNum 1-indexed page number
   */
  async getPageDimensions(
    docId: string,
    pageNum: number
  ): Promise<{ width: number; height: number }> {
    const requestId = this.generateRequestId();

    const response = await this.sendRequest<{
      type: 'PAGE_DIMENSIONS';
      requestId: string;
      pageNum: number;
      width: number;
      height: number;
    }>({ type: 'GET_PAGE_DIMENSIONS', requestId, docId, pageNum });

    return { width: response.width, height: response.height };
  }

  /**
   * Unload a document from the worker
   * @param docId Document ID
   */
  async unloadDocument(docId: string): Promise<void> {
    const requestId = this.generateRequestId();

    await this.sendRequest<{ type: 'DOCUMENT_UNLOADED'; requestId: string }>({
      type: 'UNLOAD_DOCUMENT',
      requestId,
      docId,
    });
  }

  /**
   * Render a tile (256x256 region) of a page
   * @param docId Document ID from loadDocumentWithId
   * @param pageNum 1-indexed page number
   * @param tileX Tile X coordinate (0-indexed)
   * @param tileY Tile Y coordinate (0-indexed)
   * @param tileSize Tile size in pixels (typically 256)
   * @param scale Render scale (1.0 = 72 DPI, 2.0 = 144 DPI for retina)
   */
  async renderTile(
    docId: string,
    pageNum: number,
    tileX: number,
    tileY: number,
    tileSize: number,
    scale: number
  ): Promise<{ data: Uint8Array; width: number; height: number }> {
    const requestId = this.generateRequestId();

    const response = await this.sendRequest<{
      type: 'TILE_RENDERED';
      requestId: string;
      pageNum: number;
      tileX: number;
      tileY: number;
      data: Uint8Array;
      width: number;
      height: number;
    }>({
      type: 'RENDER_TILE',
      requestId,
      docId,
      pageNum,
      tileX,
      tileY,
      tileSize,
      scale,
    } as WorkerRequest);

    return {
      data: response.data,
      width: response.width,
      height: response.height,
    };
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.isReady = false;
      this.pendingRequests.clear();
    }
  }

  /**
   * Check if worker is ready
   */
  get ready(): boolean {
    return this.isReady;
  }
}

// Singleton instance for shared use - use promise to prevent race conditions
let sharedBridgePromise: Promise<MuPDFBridge> | null = null;
let sharedBridgeInstance: MuPDFBridge | null = null;

/**
 * Get or create the shared MuPDF bridge instance.
 * Uses promise-based singleton to prevent race conditions when multiple
 * callers invoke this concurrently during initialization.
 */
export async function getSharedMuPDFBridge(): Promise<MuPDFBridge> {
  if (!sharedBridgePromise) {
    sharedBridgePromise = (async () => {
      const bridge = new MuPDFBridge();
      await bridge.initialize();
      sharedBridgeInstance = bridge;
      return bridge;
    })();
  }
  return sharedBridgePromise;
}

/**
 * Destroy the shared bridge instance
 */
export function destroySharedMuPDFBridge(): void {
  if (sharedBridgeInstance) {
    sharedBridgeInstance.terminate();
    sharedBridgeInstance = null;
  }
  sharedBridgePromise = null;
}
