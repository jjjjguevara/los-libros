/**
 * Standard Test Scenarios
 *
 * Pre-defined test scenarios for PDF rendering lifecycle tests.
 * Each scenario tests different aspects of the rendering pipeline.
 *
 * Scenarios:
 * - basicNavigation: Simple page navigation and zoom
 * - scrollStress: Continuous scrolling to test prefetch and caching
 * - zoomTransitions: Zoom level changes to test scale transitions
 * - randomNavigation: Random jumps to test cache invalidation
 * - highZoomQuality: High zoom rendering quality verification
 * - fullLifecycle: Comprehensive test covering all operations
 */

import type { LifecycleTestStep } from './lifecycle-test-runner';

/**
 * Standard test scenarios
 */
export const STANDARD_SCENARIOS: Record<string, LifecycleTestStep[]> = {
  /**
   * Basic Navigation Test
   *
   * Tests fundamental page navigation and zoom operations.
   * Good for verifying basic functionality works.
   */
  basicNavigation: [
    { type: 'navigate', params: { target: 1, label: 'Go to page 1' } },
    { type: 'wait', params: { duration: 500 } },
    { type: 'navigate', params: { target: 18, label: 'Go to problem page 18' } },
    { type: 'wait', params: { duration: 500 } },
    { type: 'zoom', params: { target: 4, label: 'Zoom to 4x' } },
    { type: 'wait', params: { duration: 500 } },
    { type: 'zoom', params: { target: 16, label: 'Zoom to max (16x)' } },
    { type: 'wait', params: { duration: 1000 } },
    { type: 'capture', params: { label: 'Capture high-zoom metrics' } },
    { type: 'zoom', params: { target: 1, label: 'Reset zoom to 1x' } },
    { type: 'wait', params: { duration: 500 } },
  ],

  /**
   * Scroll Stress Test
   *
   * Tests continuous scrolling to verify:
   * - Prefetch is working
   * - Cache is being utilized
   * - FPS stays stable
   * - No jank during scroll
   */
  scrollStress: [
    { type: 'navigate', params: { target: 1, label: 'Start at page 1' } },
    { type: 'wait', params: { duration: 300 } },
    { type: 'scroll', params: { distance: 2000, duration: 1000, label: 'Scroll down 2000px' } },
    { type: 'wait', params: { duration: 300 } },
    { type: 'scroll', params: { distance: 3000, duration: 1500, label: 'Scroll down 3000px' } },
    { type: 'wait', params: { duration: 300 } },
    { type: 'scroll', params: { distance: -2500, duration: 1200, label: 'Scroll up 2500px' } },
    { type: 'wait', params: { duration: 300 } },
    { type: 'scroll', params: { distance: 5000, duration: 2000, label: 'Fast scroll 5000px' } },
    { type: 'wait', params: { duration: 500 } },
    { type: 'capture', params: { label: 'Capture scroll metrics' } },
  ],

  /**
   * Zoom Transitions Test
   *
   * Tests zoom level changes to verify:
   * - Scale transitions are smooth
   * - High zoom uses tiling
   * - Quality matches zoom level
   * - No blank pages during transition
   */
  zoomTransitions: [
    { type: 'navigate', params: { target: 5, label: 'Go to page 5' } },
    { type: 'wait', params: { duration: 300 } },
    { type: 'zoom', params: { target: 1.5, label: 'Zoom to 1.5x' } },
    { type: 'wait', params: { duration: 300 } },
    { type: 'zoom', params: { target: 2, label: 'Zoom to 2x' } },
    { type: 'wait', params: { duration: 300 } },
    { type: 'zoom', params: { target: 4, label: 'Zoom to 4x' } },
    { type: 'wait', params: { duration: 300 } },
    { type: 'zoom', params: { target: 8, label: 'Zoom to 8x' } },
    { type: 'wait', params: { duration: 500 } },
    { type: 'zoom', params: { target: 16, label: 'Zoom to 16x (max)' } },
    { type: 'wait', params: { duration: 1000 } },
    { type: 'capture', params: { label: 'Capture max zoom metrics' } },
    { type: 'zoom', params: { target: 1, label: 'Reset to 1x' } },
    { type: 'wait', params: { duration: 300 } },
  ],

  /**
   * Random Navigation Test
   *
   * Tests cache behavior with random page jumps:
   * - Cache invalidation on distant jumps
   * - Prefetch effectiveness
   * - Memory management
   */
  randomNavigation: [
    { type: 'navigate', params: { random: true, label: 'Random page 1' } },
    { type: 'wait', params: { duration: 500 } },
    { type: 'zoom', params: { target: 2, label: 'Zoom to 2x' } },
    { type: 'wait', params: { duration: 300 } },
    { type: 'navigate', params: { random: true, label: 'Random page 2' } },
    { type: 'wait', params: { duration: 500 } },
    { type: 'zoom', params: { target: 4, label: 'Zoom to 4x' } },
    { type: 'wait', params: { duration: 300 } },
    { type: 'navigate', params: { random: true, label: 'Random page 3' } },
    { type: 'wait', params: { duration: 500 } },
    { type: 'zoom', params: { target: 1, label: 'Reset zoom' } },
    { type: 'wait', params: { duration: 300 } },
    { type: 'navigate', params: { random: true, label: 'Random page 4' } },
    { type: 'wait', params: { duration: 500 } },
    { type: 'navigate', params: { random: true, label: 'Random page 5' } },
    { type: 'wait', params: { duration: 500 } },
    { type: 'capture', params: { label: 'Capture random nav metrics' } },
  ],

  /**
   * High Zoom Quality Test
   *
   * Specifically tests sharpness at maximum zoom:
   * - Navigate to problem page (18)
   * - Zoom to maximum
   * - Verify scale matches expectations
   */
  highZoomQuality: [
    { type: 'navigate', params: { target: 18, label: 'Go to page 18 (problem page)' } },
    { type: 'wait', params: { duration: 500 } },
    { type: 'zoom', params: { target: 4, label: 'Zoom to 4x' } },
    { type: 'wait', params: { duration: 500 } },
    { type: 'capture', params: { label: 'Capture 4x metrics' } },
    { type: 'zoom', params: { target: 8, label: 'Zoom to 8x' } },
    { type: 'wait', params: { duration: 800 } },
    { type: 'capture', params: { label: 'Capture 8x metrics' } },
    { type: 'zoom', params: { target: 16, label: 'Zoom to 16x (max)' } },
    { type: 'wait', params: { duration: 2000, label: 'Wait for full tile render' } },
    { type: 'capture', params: { label: 'Capture 16x metrics' } },
  ],

  /**
   * Full Lifecycle Test
   *
   * Comprehensive test covering:
   * - Navigation
   * - Scrolling
   * - Zooming
   * - Random jumps
   * - All zoom levels
   */
  fullLifecycle: [
    // Initial navigation
    { type: 'navigate', params: { target: 1, label: 'Start at page 1' } },
    { type: 'wait', params: { duration: 300 } },

    // Scroll through first few pages
    { type: 'scroll', params: { distance: 1500, duration: 800, label: 'Initial scroll' } },
    { type: 'wait', params: { duration: 300 } },

    // Navigate to middle of document
    { type: 'navigate', params: { target: 18, label: 'Jump to page 18' } },
    { type: 'wait', params: { duration: 500 } },

    // Zoom sequence
    { type: 'zoom', params: { target: 2, label: 'Zoom to 2x' } },
    { type: 'wait', params: { duration: 300 } },
    { type: 'scroll', params: { distance: 500, duration: 400, label: 'Scroll at 2x' } },
    { type: 'wait', params: { duration: 200 } },

    { type: 'zoom', params: { target: 4, label: 'Zoom to 4x' } },
    { type: 'wait', params: { duration: 300 } },
    { type: 'scroll', params: { distance: 300, duration: 300, label: 'Scroll at 4x' } },
    { type: 'wait', params: { duration: 200 } },

    { type: 'zoom', params: { target: 8, label: 'Zoom to 8x' } },
    { type: 'wait', params: { duration: 500 } },

    { type: 'zoom', params: { target: 16, label: 'Zoom to max (16x)' } },
    { type: 'wait', params: { duration: 1000 } },
    { type: 'capture', params: { label: 'Max zoom capture' } },

    // Zoom out and navigate
    { type: 'zoom', params: { target: 1, label: 'Reset zoom' } },
    { type: 'wait', params: { duration: 300 } },

    // Random navigation
    { type: 'navigate', params: { random: true, label: 'Random page' } },
    { type: 'wait', params: { duration: 500 } },
    { type: 'zoom', params: { target: 4, label: 'Zoom to 4x' } },
    { type: 'wait', params: { duration: 300 } },

    // Final capture
    { type: 'zoom', params: { target: 1, label: 'Final reset' } },
    { type: 'wait', params: { duration: 300 } },
    { type: 'capture', params: { label: 'Final metrics capture' } },
  ],

  /**
   * Quick Smoke Test
   *
   * Fast test to verify basic functionality.
   * Use for rapid iteration.
   */
  quickSmoke: [
    { type: 'navigate', params: { target: 1 } },
    { type: 'wait', params: { duration: 200 } },
    { type: 'zoom', params: { target: 4 } },
    { type: 'wait', params: { duration: 300 } },
    { type: 'zoom', params: { target: 1 } },
    { type: 'wait', params: { duration: 200 } },
    { type: 'capture', params: {} },
  ],
};

/**
 * Get scenario by name
 */
export function getScenario(name: string): LifecycleTestStep[] | undefined {
  return STANDARD_SCENARIOS[name];
}

/**
 * List available scenario names
 */
export function listScenarios(): string[] {
  return Object.keys(STANDARD_SCENARIOS);
}

/**
 * Create a custom scenario
 */
export function createScenario(steps: LifecycleTestStep[]): LifecycleTestStep[] {
  return steps;
}

/**
 * Scenario descriptions for help text
 */
export const SCENARIO_DESCRIPTIONS: Record<string, string> = {
  basicNavigation: 'Simple page navigation and zoom operations',
  scrollStress: 'Continuous scrolling to test prefetch and FPS',
  zoomTransitions: 'Zoom level changes from 1x to 16x',
  randomNavigation: 'Random page jumps to test cache behavior',
  highZoomQuality: 'Maximum zoom quality verification (page 18)',
  fullLifecycle: 'Comprehensive test of all operations',
  quickSmoke: 'Fast smoke test for rapid iteration',
};
