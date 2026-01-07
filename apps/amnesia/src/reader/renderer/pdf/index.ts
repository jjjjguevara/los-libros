/**
 * PDF Renderer Module
 *
 * Provides PDF rendering functionality for Amnesia:
 * - Server-based page rendering
 * - Text layer for selection
 * - Annotation layer for highlights
 * - Region selection for scanned PDFs
 */

export { PdfRenderer } from './pdf-renderer';
export type { PdfRendererConfig, PdfContentProvider } from './pdf-renderer';

export { PdfCanvasLayer } from './pdf-canvas-layer';
export type { CanvasLayerConfig } from './pdf-canvas-layer';

export { PdfTextLayer } from './pdf-text-layer';
export type { TextLayerConfig, TextSelection } from './pdf-text-layer';

export { PdfAnnotationLayer } from './pdf-annotation-layer';
export type {
  PdfHighlightClickCallback,
  PdfHighlight,
  AnnotationLayerConfig,
} from './pdf-annotation-layer';

export { PdfRegionSelection } from './pdf-region-selection';
export type {
  RegionSelectionData,
  RegionSelectionCallback,
  RegionSelectionConfig,
} from './pdf-region-selection';

export { PdfPaginator } from './pdf-paginator';
export type {
  PdfPageLayout,
  PdfPageInfo,
  PdfPageChangeCallback,
  PdfPaginatorConfig,
} from './pdf-paginator';

export { PdfScroller } from './pdf-scroller';
export type {
  PdfScrollInfo,
  PdfScrollCallback,
  PageRenderCallback,
  PdfScrollerConfig,
} from './pdf-scroller';

// Server-based PDF provider (PDF.js deprecated)
export { HybridPdfProvider, createHybridPdfProvider } from './hybrid-pdf-provider';
export type {
  HybridPdfProviderConfig,
  HybridPdfProviderStatus,
  PdfProviderMode,
} from './hybrid-pdf-provider';

// Multi-page container
export { PdfMultiPageContainer } from './pdf-multi-page-container';
export type {
  MultiPageConfig,
  DisplayMode,
  ScrollDirection,
} from './pdf-multi-page-container';

// Page element
export { PdfPageElement } from './pdf-page-element';
export type { ReadingMode, PageHighlight, PageRenderData } from './pdf-page-element';

// Infinite canvas (new pan-zoom system)
export { PdfInfiniteCanvas } from './pdf-infinite-canvas';
export type { InfiniteCanvasConfig, PageLayout, DisplayMode as InfiniteCanvasDisplayMode } from './pdf-infinite-canvas';

// Camera system
export {
  createCamera,
  panCamera,
  zoomCameraToPoint,
  zoomCamera,
  setCameraZoom,
  centerOnPoint,
  fitBoxInView,
  getCameraTransform,
  getVisibleBounds,
  lerpCamera,
  screenToCanvas,
  canvasToScreen,
} from './pdf-canvas-camera';
export type { Camera, Point, CameraConstraints } from './pdf-canvas-camera';
