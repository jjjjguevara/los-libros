/**
 * PDF Canvas Worker Pool
 *
 * Manages a pool of Web Workers for parallel image processing.
 * Distributes work across workers for 2-4x speedup on multi-core devices.
 *
 * Features:
 * - Automatic worker count based on navigator.hardwareConcurrency
 * - Round-robin load balancing
 * - Graceful fallback when workers not supported
 * - Zero-copy ImageBitmap transfers
 */

import type {
  CanvasWorkerMessage,
  CanvasWorkerResult,
  ProcessImagePayload,
  ImageProcessedPayload,
} from './pdf-canvas-worker';
import { getTelemetry } from './pdf-telemetry';

interface PendingTask {
  resolve: (result: ImageProcessedPayload) => void;
  reject: (error: Error) => void;
}

export class PdfCanvasPool {
  private workers: Worker[] = [];
  private pendingTasks: Map<number, PendingTask> = new Map();
  private nextTaskId = 0;
  private nextWorkerIndex = 0;
  private isSupported = false;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the worker pool
   * @param workerCount Number of workers (default: hardware concurrency / 2)
   */
  async initialize(workerCount?: number): Promise<void> {
    // Return existing promise if already initializing
    if (this.initPromise) return this.initPromise;
    if (this.isInitialized) return Promise.resolve();

    // Create and store the initialization promise
    this.initPromise = this.doInitialize(workerCount);
    return this.initPromise;
  }

  private async doInitialize(workerCount?: number): Promise<void> {
    // Check for worker and ImageBitmap support
    this.isSupported = typeof Worker !== 'undefined' && typeof createImageBitmap === 'function';

    if (!this.isSupported) {
      console.log('[CanvasPool] Workers not supported, using main thread fallback');
      this.isInitialized = true;
      return;
    }

    // Determine worker count - scale with hardware for better parallelism
    // On 8-core: 8 workers, on 4-core: 4 workers (was limited to 2-4)
    const cores = navigator.hardwareConcurrency || 4;
    const count = workerCount ?? Math.max(4, Math.min(cores, 8));

    try {
      // Create workers using inline blob URL (avoids separate worker file bundling issues)
      const workerCode = this.getWorkerCode();
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);

      for (let i = 0; i < count; i++) {
        const worker = new Worker(workerUrl);
        worker.onmessage = this.handleWorkerMessage.bind(this);
        worker.onerror = (e) => console.error('[CanvasPool] Worker error:', e);
        this.workers.push(worker);
      }

      // Clean up blob URL (workers keep reference)
      URL.revokeObjectURL(workerUrl);

      console.log(`[CanvasPool] Initialized ${count} workers`);
    } catch (error) {
      console.warn('[CanvasPool] Failed to create workers:', error);
      this.isSupported = false;
    }

    this.isInitialized = true;
  }

  /**
   * Process an image blob off the main thread
   * Returns ImageBitmap for direct canvas drawing
   */
  async processImage(
    blob: Blob,
    targetWidth: number,
    targetHeight: number,
    pageNumber: number
  ): Promise<ImageProcessedPayload> {
    // Wait for initialization to complete if pending
    if (this.initPromise && !this.isInitialized) {
      await this.initPromise;
    }

    // Fallback to main thread if workers not available
    if (!this.isSupported || this.workers.length === 0) {
      return this.processImageMainThread(blob, pageNumber);
    }

    return new Promise((resolve, reject) => {
      const taskId = this.nextTaskId++;
      this.pendingTasks.set(taskId, { resolve, reject });

      // Round-robin worker selection
      const worker = this.workers[this.nextWorkerIndex];
      this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;

      const message: CanvasWorkerMessage = {
        type: 'PROCESS_IMAGE',
        id: taskId,
        payload: {
          blob,
          targetWidth,
          targetHeight,
          pageNumber,
        },
      };

      // Track worker utilization
      // Active workers = min(pending tasks, total workers) since tasks are round-robin assigned
      const telemetry = getTelemetry();
      telemetry.trackWorkerTaskStart();
      const activeWorkers = Math.min(this.pendingTasks.size, this.workers.length);
      telemetry.trackWorkerUtilization(
        activeWorkers,           // active workers (approximation)
        this.workers.length,     // total workers
        this.pendingTasks.size   // pending tasks (may exceed workers)
      );

      worker.postMessage(message);
    });
  }

  /**
   * Process multiple images in parallel across all workers
   */
  async processImageBatch(
    items: Array<{ blob: Blob; targetWidth: number; targetHeight: number; pageNumber: number }>
  ): Promise<ImageProcessedPayload[]> {
    if (items.length === 0) return [];

    // Process all items in parallel using worker pool
    const results = await Promise.all(
      items.map(item => this.processImage(item.blob, item.targetWidth, item.targetHeight, item.pageNumber))
    );

    return results;
  }

  /**
   * Main thread fallback when workers not available
   */
  private async processImageMainThread(blob: Blob, pageNumber: number): Promise<ImageProcessedPayload> {
    const imageBitmap = await createImageBitmap(blob);
    return {
      imageBitmap,
      pageNumber,
      naturalWidth: imageBitmap.width,
      naturalHeight: imageBitmap.height,
    };
  }

  /**
   * Handle messages from workers
   */
  private handleWorkerMessage(event: MessageEvent<CanvasWorkerResult>): void {
    const { type, id, payload, error } = event.data;

    const task = this.pendingTasks.get(id);
    if (!task) return;

    this.pendingTasks.delete(id);

    // Track task completion
    const telemetry = getTelemetry();
    telemetry.trackWorkerTaskComplete();

    switch (type) {
      case 'IMAGE_PROCESSED':
        task.resolve(payload as ImageProcessedPayload);
        break;
      case 'ERROR':
        task.reject(new Error(error || 'Worker processing failed'));
        break;
    }
  }

  /**
   * Generate inline worker code
   * This avoids the need for separate worker file bundling
   */
  private getWorkerCode(): string {
    return `
      async function processImage(payload) {
        const { blob, pageNumber } = payload;
        const imageBitmap = await createImageBitmap(blob);
        return {
          imageBitmap,
          pageNumber,
          naturalWidth: imageBitmap.width,
          naturalHeight: imageBitmap.height,
        };
      }

      self.onmessage = async function(event) {
        const { type, id, payload } = event.data;

        try {
          if (type === 'PROCESS_IMAGE') {
            const result = await processImage(payload);
            self.postMessage(
              { type: 'IMAGE_PROCESSED', id, payload: result },
              [result.imageBitmap]
            );
          }
        } catch (error) {
          self.postMessage({
            type: 'ERROR',
            id,
            error: error.message || 'Unknown error',
          });
        }
      };
    `;
  }

  /**
   * Check if worker pool is available or will be available
   * Returns true if workers are supported (even if still initializing)
   * The processImage method will await initialization if needed
   */
  isAvailable(): boolean {
    // If already initialized, check actual state
    if (this.isInitialized) {
      return this.isSupported && this.workers.length > 0;
    }
    // If initialization is pending, assume it will succeed (browser supports workers)
    if (this.initPromise) {
      return typeof Worker !== 'undefined' && typeof createImageBitmap === 'function';
    }
    // Not yet started - check browser support
    return typeof Worker !== 'undefined' && typeof createImageBitmap === 'function';
  }

  /**
   * Get the number of workers in the pool
   */
  get workerCount(): number {
    return this.workers.length;
  }

  /**
   * Get pool statistics
   */
  getStats(): { workerCount: number; pendingTasks: number; isSupported: boolean } {
    return {
      workerCount: this.workers.length,
      pendingTasks: this.pendingTasks.size,
      isSupported: this.isSupported,
    };
  }

  /**
   * Destroy the worker pool
   */
  destroy(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.pendingTasks.clear();
    this.isInitialized = false;
  }
}

// Singleton instance for shared use
let poolInstance: PdfCanvasPool | null = null;

/**
 * Get the shared canvas pool instance
 * Eagerly starts initialization on first access
 */
export function getCanvasPool(): PdfCanvasPool {
  if (!poolInstance) {
    poolInstance = new PdfCanvasPool();
    // Start initialization immediately (non-blocking)
    // processImage will await completion if needed
    poolInstance.initialize().catch(err => {
      console.warn('[CanvasPool] Background initialization failed:', err);
    });
  }
  return poolInstance;
}

/**
 * Initialize the shared canvas pool (call once at app start)
 */
export async function initializeCanvasPool(): Promise<PdfCanvasPool> {
  const pool = getCanvasPool();
  await pool.initialize();
  return pool;
}
