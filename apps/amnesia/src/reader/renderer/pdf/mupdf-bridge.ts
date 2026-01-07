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

    // Create worker from the worker file
    // Note: In Vite/Rollup, we use the ?worker suffix or Worker constructor with type: 'module'
    this.worker = new Worker(
      new URL('./mupdf-worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = this.handleError.bind(this);

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

// Singleton instance for shared use
let sharedBridge: MuPDFBridge | null = null;

/**
 * Get or create the shared MuPDF bridge instance
 */
export async function getSharedMuPDFBridge(): Promise<MuPDFBridge> {
  if (!sharedBridge) {
    sharedBridge = new MuPDFBridge();
    await sharedBridge.initialize();
  }
  return sharedBridge;
}

/**
 * Destroy the shared bridge instance
 */
export function destroySharedMuPDFBridge(): void {
  if (sharedBridge) {
    sharedBridge.terminate();
    sharedBridge = null;
  }
}
