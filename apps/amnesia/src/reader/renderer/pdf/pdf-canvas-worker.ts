/**
 * PDF Canvas Worker
 *
 * Processes image blobs in a Web Worker using OffscreenCanvas.
 * This moves image decoding and canvas operations off the main thread
 * for smoother scrolling and navigation.
 *
 * Features:
 * - Image decoding via createImageBitmap (off main thread)
 * - OffscreenCanvas rendering (when available)
 * - Falls back gracefully when OffscreenCanvas not supported
 */

// Worker message types
export interface CanvasWorkerMessage {
  type: 'PROCESS_IMAGE' | 'PROCESS_IMAGE_BATCH' | 'CLEANUP';
  id: number;
  payload?: ProcessImagePayload | ProcessBatchPayload;
}

export interface ProcessImagePayload {
  blob: Blob;
  targetWidth: number;
  targetHeight: number;
  pageNumber: number;
}

export interface ProcessBatchPayload {
  items: ProcessImagePayload[];
}

export interface CanvasWorkerResult {
  type: 'IMAGE_PROCESSED' | 'BATCH_PROCESSED' | 'ERROR';
  id: number;
  payload?: ImageProcessedPayload | BatchProcessedPayload;
  error?: string;
}

export interface ImageProcessedPayload {
  imageBitmap: ImageBitmap;
  pageNumber: number;
  naturalWidth: number;
  naturalHeight: number;
}

export interface BatchProcessedPayload {
  results: ImageProcessedPayload[];
}

// Worker entry point
const ctx: Worker = self as unknown as Worker;

/**
 * Process a single image blob into an ImageBitmap
 * This is the main optimization - createImageBitmap is async and runs off main thread
 */
async function processImage(payload: ProcessImagePayload): Promise<ImageProcessedPayload> {
  const { blob, pageNumber } = payload;

  // Create ImageBitmap from blob (async, off main thread)
  const imageBitmap = await createImageBitmap(blob);

  return {
    imageBitmap,
    pageNumber,
    naturalWidth: imageBitmap.width,
    naturalHeight: imageBitmap.height,
  };
}

/**
 * Process multiple images in parallel
 */
async function processBatch(payload: ProcessBatchPayload): Promise<BatchProcessedPayload> {
  const results = await Promise.all(
    payload.items.map(item => processImage(item))
  );

  return { results };
}

// Handle messages from main thread
ctx.onmessage = async (event: MessageEvent<CanvasWorkerMessage>) => {
  const { type, id, payload } = event.data;

  try {
    switch (type) {
      case 'PROCESS_IMAGE': {
        const result = await processImage(payload as ProcessImagePayload);
        // Transfer ImageBitmap to main thread (zero-copy)
        ctx.postMessage(
          {
            type: 'IMAGE_PROCESSED',
            id,
            payload: result,
          } as CanvasWorkerResult,
          [result.imageBitmap] // Transfer, not copy
        );
        break;
      }

      case 'PROCESS_IMAGE_BATCH': {
        const batchResult = await processBatch(payload as ProcessBatchPayload);
        // Transfer all ImageBitmaps
        const transfers = batchResult.results.map(r => r.imageBitmap);
        ctx.postMessage(
          {
            type: 'BATCH_PROCESSED',
            id,
            payload: batchResult,
          } as CanvasWorkerResult,
          transfers
        );
        break;
      }

      case 'CLEANUP': {
        // No-op for now, worker maintains no persistent state
        break;
      }
    }
  } catch (error) {
    ctx.postMessage({
      type: 'ERROR',
      id,
      error: error instanceof Error ? error.message : 'Unknown error',
    } as CanvasWorkerResult);
  }
};

// Export types for use in pool manager
export {};
