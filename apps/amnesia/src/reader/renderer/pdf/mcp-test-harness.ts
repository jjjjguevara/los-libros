/**
 * MCP Test Harness
 *
 * Exposes PDF lifecycle tests to the window object for access via
 * Obsidian DevTools MCP. Enables interactive testing and benchmarking.
 *
 * Usage via MCP:
 * ```javascript
 * // List available scenarios
 * window.pdfLifecycleTests.listScenarios()
 *
 * // Run a specific scenario
 * await window.pdfLifecycleTests.runTest('basicNavigation')
 *
 * // Run all scenarios
 * await window.pdfLifecycleTests.runAllTests()
 *
 * // Capture comparison screenshot
 * await window.pdfLifecycleTests.captureComparisonScreenshot(18, 16)
 *
 * // Get telemetry summary
 * window.pdfLifecycleTests.getTelemetry()
 * ```
 */

import {
  LifecycleTestRunner,
  formatTestResults,
  type LifecycleTestResult,
  type InfiniteCanvasInterface,
} from './lifecycle-test-runner';
import {
  STANDARD_SCENARIOS,
  SCENARIO_DESCRIPTIONS,
  listScenarios,
  getScenario,
} from './standard-scenarios';
import { getTelemetry } from './pdf-telemetry';

/** Comparison screenshot result */
export interface ComparisonScreenshotResult {
  page: number;
  zoom: number;
  pixelRatio: number;
  canvasSize: { width: number; height: number } | null;
  cssSize: { width: number; height: number } | null;
  computedRatio: number | null;
  expectedRatio: number;
  isSharp: boolean;
  renderTime: number;
  tileCount: number;
  cacheHitRate: number;
}

/** MCP test harness interface */
export interface McpTestHarness {
  /** List available test scenarios */
  listScenarios(): { name: string; description: string }[];

  /** Run a specific test scenario */
  runTest(scenarioName: string): Promise<LifecycleTestResult>;

  /** Run all test scenarios */
  runAllTests(): Promise<Record<string, LifecycleTestResult>>;

  /** Capture comparison screenshot at specific page and zoom */
  captureComparisonScreenshot(
    page: number,
    zoom: number
  ): Promise<ComparisonScreenshotResult>;

  /** Get current telemetry stats */
  getTelemetry(): ReturnType<typeof getTelemetry>['getStats'] extends () => infer R
    ? R
    : never;

  /** Get telemetry summary string */
  getTelemetrySummary(): string;

  /** Reset telemetry */
  resetTelemetry(): void;

  /** Check if canvas is available */
  isCanvasAvailable(): boolean;

  /** Get canvas info */
  getCanvasInfo(): {
    currentPage: number;
    zoom: number;
    pageCount: number;
    mode: string;
  } | null;
}

/**
 * Get the PDF infinite canvas from the Obsidian workspace
 */
function getInfiniteCanvas(): InfiniteCanvasInterface | null {
  try {
    // Access via Obsidian's workspace API
    const app = (globalThis as Record<string, unknown>).app as {
      workspace: {
        getLeavesOfType(type: string): Array<{
          view: {
            component?: {
              $$?: {
                ctx?: Array<{
                  infiniteCanvas?: InfiniteCanvasInterface;
                }>;
              };
            };
          };
        }>;
      };
    };

    if (!app?.workspace) {
      console.warn('[MCPTestHarness] Obsidian app not found');
      return null;
    }

    const leaves = app.workspace.getLeavesOfType('amnesia-reader');
    if (leaves.length === 0) {
      console.warn('[MCPTestHarness] No amnesia-reader leaves found');
      return null;
    }

    const view = leaves[0].view;
    const component = view.component;
    const ctx = component?.$$?.ctx;

    if (!ctx) {
      console.warn('[MCPTestHarness] Svelte context not found');
      return null;
    }

    // Find the infiniteCanvas in the context (usually at index 3)
    for (let i = 0; i < ctx.length; i++) {
      const item = ctx[i];
      if (item && typeof item === 'object' && 'infiniteCanvas' in item) {
        return item.infiniteCanvas as InfiniteCanvasInterface;
      }
    }

    // Try direct access at common indices
    for (const idx of [3, 4, 5, 2]) {
      const item = ctx[idx];
      if (item?.infiniteCanvas) {
        return item.infiniteCanvas as InfiniteCanvasInterface;
      }
    }

    console.warn('[MCPTestHarness] infiniteCanvas not found in context');
    return null;
  } catch (error) {
    console.error('[MCPTestHarness] Error accessing canvas:', error);
    return null;
  }
}

/**
 * Create the MCP test harness
 */
function createMcpTestHarness(): McpTestHarness {
  return {
    listScenarios() {
      return listScenarios().map((name) => ({
        name,
        description: SCENARIO_DESCRIPTIONS[name] ?? 'No description',
      }));
    },

    async runTest(scenarioName: string): Promise<LifecycleTestResult> {
      const canvas = getInfiniteCanvas();
      if (!canvas) {
        throw new Error('PDF canvas not available. Open a PDF in Amnesia reader first.');
      }

      const scenario = getScenario(scenarioName);
      if (!scenario) {
        throw new Error(
          `Unknown scenario: ${scenarioName}. Available: ${listScenarios().join(', ')}`
        );
      }

      console.log(`[MCPTestHarness] Running scenario: ${scenarioName}`);
      const runner = new LifecycleTestRunner(canvas);
      const result = await runner.runTest(scenario, scenarioName);

      // Log formatted results
      console.log(formatTestResults(result));

      return result;
    },

    async runAllTests(): Promise<Record<string, LifecycleTestResult>> {
      const results: Record<string, LifecycleTestResult> = {};

      for (const scenarioName of listScenarios()) {
        console.log(`\n[MCPTestHarness] Running: ${scenarioName}`);
        try {
          results[scenarioName] = await this.runTest(scenarioName);
        } catch (error) {
          console.error(`[MCPTestHarness] Failed: ${scenarioName}`, error);
        }

        // Brief pause between scenarios
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Print summary
      console.log('\n========================================');
      console.log('ALL TESTS COMPLETE');
      console.log('========================================');

      for (const [name, result] of Object.entries(results)) {
        const status =
          result.summary.failedSteps === 0 ? 'PASS' : 'FAIL';
        console.log(
          `${status} ${name}: ${result.summary.successfulSteps}/${result.summary.totalSteps} steps, ` +
            `${result.summary.averageRenderTime.toFixed(0)}ms avg render, ` +
            `${(result.summary.overallCacheHitRate * 100).toFixed(0)}% cache hit`
        );
      }

      return results;
    },

    async captureComparisonScreenshot(
      page: number,
      zoom: number
    ): Promise<ComparisonScreenshotResult> {
      const canvas = getInfiniteCanvas();
      if (!canvas) {
        throw new Error('PDF canvas not available');
      }

      // Navigate and zoom
      await canvas.goToPage(page);
      canvas.setZoom(zoom);

      // Wait for render to complete
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get metrics
      const stats = getTelemetry().getStats();
      const pixelRatio = window.devicePixelRatio ?? 2;

      // Get canvas element info
      const pageEl = canvas.pageElements.get(page) as {
        getElement?: () => HTMLElement;
      } | undefined;

      let canvasSize: { width: number; height: number } | null = null;
      let cssSize: { width: number; height: number } | null = null;
      let computedRatio: number | null = null;

      if (pageEl?.getElement) {
        const element = pageEl.getElement();
        const canvasEl = element?.querySelector('canvas');
        if (canvasEl) {
          canvasSize = {
            width: canvasEl.width,
            height: canvasEl.height,
          };
          cssSize = {
            width: parseFloat(canvasEl.style.width) || element.clientWidth,
            height: parseFloat(canvasEl.style.height) || element.clientHeight,
          };
          computedRatio = canvasEl.width / cssSize.width;
        }
      }

      const expectedRatio = zoom * pixelRatio;
      const isSharp = computedRatio !== null && computedRatio >= expectedRatio * 0.95;

      return {
        page,
        zoom,
        pixelRatio,
        canvasSize,
        cssSize,
        computedRatio,
        expectedRatio,
        isSharp,
        renderTime: stats.avgRenderTime,
        tileCount: stats.totalTileRenders,
        cacheHitRate: stats.overallHitRate,
      };
    },

    getTelemetry() {
      return getTelemetry().getStats();
    },

    getTelemetrySummary() {
      return getTelemetry().getSummary();
    },

    resetTelemetry() {
      getTelemetry().reset();
    },

    isCanvasAvailable() {
      return getInfiniteCanvas() !== null;
    },

    getCanvasInfo() {
      const canvas = getInfiniteCanvas();
      if (!canvas) return null;

      return {
        currentPage: canvas.getCurrentPage(),
        zoom: canvas.getZoom(),
        pageCount: canvas.getPageCount(),
        mode: 'paginated', // TODO: get actual mode
      };
    },
  };
}

/**
 * Expose lifecycle tests to window for MCP access
 */
export function exposeLifecycleTests(): void {
  const harness = createMcpTestHarness();
  (globalThis as Record<string, unknown>).pdfLifecycleTests = harness;

  // Also expose convenience functions at top level
  (globalThis as Record<string, unknown>).runLifecycleTest = harness.runTest.bind(harness);
  (globalThis as Record<string, unknown>).runAllLifecycleTests = harness.runAllTests.bind(harness);
  (globalThis as Record<string, unknown>).captureComparisonScreenshot =
    harness.captureComparisonScreenshot.bind(harness);

  console.log('[MCPTestHarness] Lifecycle tests exposed to window.pdfLifecycleTests');
}

/**
 * Initialize the test harness (call from main.ts)
 */
export function initializeTestHarness(): void {
  exposeLifecycleTests();
}
