/**
 * PDF Canvas Camera System
 *
 * Implements an infinite canvas with pan and zoom using the camera model.
 * Pages remain at fixed positions while the viewport moves.
 *
 * Key concepts:
 * - Camera: {x, y, z} where x,y is position and z is zoom
 * - Screen coordinates: Pixel positions in the viewport
 * - Canvas coordinates: Positions on the infinite canvas
 * - Transform: CSS transform applied to canvas container
 */

export interface Point {
  x: number;
  y: number;
}

export interface Camera {
  /** X offset in canvas coordinates */
  x: number;
  /** Y offset in canvas coordinates */
  y: number;
  /** Zoom level (1 = 100%, 0.5 = 50%, 2 = 200%) */
  z: number;
}

export interface CameraConstraints {
  minZoom: number;
  maxZoom: number;
  /** If true, constrain camera to keep content visible */
  constrainToBounds: boolean;
  /** Canvas bounds (if constrainToBounds is true) */
  bounds?: { width: number; height: number };
  /** Viewport size (needed for constraint calculations) */
  viewport?: { width: number; height: number };
}

const DEFAULT_CONSTRAINTS: CameraConstraints = {
  minZoom: 0.1,
  maxZoom: 10,
  constrainToBounds: false,
};

/**
 * Clamp a value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Convert a screen point to canvas coordinates
 *
 * Screen coordinates are relative to the viewport (0,0 is top-left of viewport)
 * Canvas coordinates are positions on the infinite canvas
 */
export function screenToCanvas(screen: Point, camera: Camera): Point {
  return {
    x: screen.x / camera.z - camera.x,
    y: screen.y / camera.z - camera.y,
  };
}

/**
 * Convert a canvas point to screen coordinates
 */
export function canvasToScreen(canvas: Point, camera: Camera): Point {
  return {
    x: (canvas.x + camera.x) * camera.z,
    y: (canvas.y + camera.y) * camera.z,
  };
}

/**
 * Create a new camera at default position
 */
export function createCamera(initialZoom = 1): Camera {
  return { x: 0, y: 0, z: initialZoom };
}

/**
 * Pan the camera by screen delta
 *
 * The delta is divided by zoom so panning feels consistent at any zoom level
 */
export function panCamera(camera: Camera, dx: number, dy: number): Camera {
  return {
    x: camera.x - dx / camera.z,
    y: camera.y - dy / camera.z,
    z: camera.z,
  };
}

/**
 * Zoom the camera toward a point
 *
 * The point (in screen coordinates) remains stationary during zoom.
 * This creates the natural "zoom to cursor" or "pinch-to-zoom" behavior.
 *
 * @param camera Current camera state
 * @param point Screen point to zoom toward (e.g., cursor position)
 * @param delta Zoom delta (positive = zoom out, negative = zoom in)
 * @param constraints Optional zoom constraints
 */
export function zoomCameraToPoint(
  camera: Camera,
  point: Point,
  delta: number,
  constraints: CameraConstraints = DEFAULT_CONSTRAINTS
): Camera {
  // Calculate new zoom level
  // Using multiplicative zoom: zoom *= (1 - delta)
  // This gives smooth, proportional zoom at any level
  const zoomFactor = 1 - delta;
  const newZoom = clamp(
    camera.z * zoomFactor,
    constraints.minZoom,
    constraints.maxZoom
  );

  // If zoom didn't change (hit constraints), return unchanged
  if (newZoom === camera.z) {
    return camera;
  }

  // Find where the point is in canvas coordinates BEFORE zoom
  const p1 = screenToCanvas(point, camera);

  // Find where the point would be in canvas coordinates AFTER zoom
  // (using the new zoom level but old position)
  const p2 = screenToCanvas(point, { ...camera, z: newZoom });

  // Adjust camera position to keep the point stationary
  // The difference (p2 - p1) is how much the point "moved" due to zoom
  // We compensate by moving the camera by that amount
  return {
    x: camera.x + (p2.x - p1.x),
    y: camera.y + (p2.y - p1.y),
    z: newZoom,
  };
}

/**
 * Zoom the camera toward the center of the viewport
 */
export function zoomCamera(
  camera: Camera,
  delta: number,
  viewportWidth: number,
  viewportHeight: number,
  constraints: CameraConstraints = DEFAULT_CONSTRAINTS
): Camera {
  const center: Point = {
    x: viewportWidth / 2,
    y: viewportHeight / 2,
  };
  return zoomCameraToPoint(camera, center, delta, constraints);
}

/**
 * Set the camera to a specific zoom level, centered on viewport
 */
export function setCameraZoom(
  camera: Camera,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
  constraints: CameraConstraints = DEFAULT_CONSTRAINTS
): Camera {
  const newZoom = clamp(zoom, constraints.minZoom, constraints.maxZoom);

  // Calculate delta needed to reach target zoom
  // Using: newZoom = oldZoom * (1 - delta)
  // So: delta = 1 - newZoom / oldZoom
  const delta = 1 - newZoom / camera.z;

  return zoomCamera(camera, delta, viewportWidth, viewportHeight, constraints);
}

/**
 * Center the camera on a specific canvas point
 */
export function centerOnPoint(
  camera: Camera,
  canvasPoint: Point,
  viewportWidth: number,
  viewportHeight: number
): Camera {
  // We want canvasPoint to be at screen center
  // Screen center is at (viewportWidth/2, viewportHeight/2)
  // Using canvasToScreen: screenX = (canvasX + camera.x) * camera.z
  // We want: viewportWidth/2 = (canvasPoint.x + newCamera.x) * camera.z
  // So: newCamera.x = viewportWidth/(2*camera.z) - canvasPoint.x

  return {
    x: viewportWidth / (2 * camera.z) - canvasPoint.x,
    y: viewportHeight / (2 * camera.z) - canvasPoint.y,
    z: camera.z,
  };
}

/**
 * Fit a bounding box in the viewport
 *
 * @param box The bounding box to fit (in canvas coordinates)
 * @param viewportWidth Viewport width in pixels
 * @param viewportHeight Viewport height in pixels
 * @param padding Padding around the box (in screen pixels)
 */
export function fitBoxInView(
  box: { x: number; y: number; width: number; height: number },
  viewportWidth: number,
  viewportHeight: number,
  padding = 20,
  constraints: CameraConstraints = DEFAULT_CONSTRAINTS
): Camera {
  // Calculate zoom to fit box with padding
  const availableWidth = viewportWidth - padding * 2;
  const availableHeight = viewportHeight - padding * 2;

  const scaleX = availableWidth / box.width;
  const scaleY = availableHeight / box.height;
  const zoom = clamp(
    Math.min(scaleX, scaleY),
    constraints.minZoom,
    constraints.maxZoom
  );

  // Center the box
  const boxCenterX = box.x + box.width / 2;
  const boxCenterY = box.y + box.height / 2;

  return {
    x: viewportWidth / (2 * zoom) - boxCenterX,
    y: viewportHeight / (2 * zoom) - boxCenterY,
    z: zoom,
  };
}

/**
 * Constrain camera to keep content visible
 */
export function constrainCamera(
  camera: Camera,
  constraints: CameraConstraints
): Camera {
  if (!constraints.constrainToBounds || !constraints.bounds || !constraints.viewport) {
    return camera;
  }

  const { bounds, viewport } = constraints;
  const { z } = camera;

  // Calculate the visible canvas area at current zoom
  const visibleWidth = viewport.width / z;
  const visibleHeight = viewport.height / z;

  // Calculate camera position limits
  // We want at least some of the content to be visible
  const margin = 100 / z; // 100px margin in screen space

  let { x, y } = camera;

  // Horizontal constraint
  const minX = -bounds.width + margin;
  const maxX = visibleWidth - margin;
  if (bounds.width * z < viewport.width) {
    // Content is smaller than viewport - center it
    x = (visibleWidth - bounds.width) / 2;
  } else {
    x = clamp(x, minX, maxX);
  }

  // Vertical constraint
  const minY = -bounds.height + margin;
  const maxY = visibleHeight - margin;
  if (bounds.height * z < viewport.height) {
    // Content is smaller than viewport - center it
    y = (visibleHeight - bounds.height) / 2;
  } else {
    y = clamp(y, minY, maxY);
  }

  return { x, y, z };
}

/**
 * Get the CSS transform string for the camera
 *
 * The transform order is: scale first, then translate
 * This ensures zoom happens correctly around the origin
 */
export function getCameraTransform(camera: Camera): string {
  // We use scale then translate
  // The translate values are multiplied by zoom because transform is applied in order
  return `scale(${camera.z}) translate(${camera.x}px, ${camera.y}px)`;
}

/**
 * Get the visible canvas bounds at current camera position
 */
export function getVisibleBounds(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number; width: number; height: number } {
  // Top-left corner in canvas coordinates
  const topLeft = screenToCanvas({ x: 0, y: 0 }, camera);

  // Visible dimensions in canvas coordinates
  const width = viewportWidth / camera.z;
  const height = viewportHeight / camera.z;

  return {
    x: topLeft.x,
    y: topLeft.y,
    width,
    height,
  };
}

/**
 * Animate camera transition (returns intermediate camera states)
 *
 * @param from Starting camera
 * @param to Target camera
 * @param progress Animation progress (0 to 1)
 */
export function lerpCamera(from: Camera, to: Camera, progress: number): Camera {
  const t = clamp(progress, 0, 1);

  // Use easeOutCubic for smooth deceleration
  const eased = 1 - Math.pow(1 - t, 3);

  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased,
    // Zoom should interpolate logarithmically for perceptual smoothness
    z: from.z * Math.pow(to.z / from.z, eased),
  };
}
