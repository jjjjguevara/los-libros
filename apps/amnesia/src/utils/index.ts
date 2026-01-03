/**
 * Utils Module
 *
 * Exports utility classes and functions.
 */

export {
  HapticFeedback,
  type HapticPattern,
  type HapticOptions,
} from './haptics';

export {
  LongPressDetector,
  createLongPressDetector,
  type LongPressOptions,
  type LongPressEvent,
  type LongPressCallback,
} from './long-press';

export {
  SwipeDetector,
  createSwipeDetector,
  type SwipeDirection,
  type SwipeConfig,
  type SwipeCallbacks,
} from './swipe-detector';

export {
  PinchZoomDetector,
  createPinchZoomDetector,
  type PinchZoomConfig,
  type PinchZoomCallbacks,
} from './pinch-zoom';
