/**
 * Lifecycle Test Runner
 *
 * Framework for running comprehensive PDF rendering lifecycle tests.
 * Tests scroll, zoom, navigate operations and captures telemetry metrics at each stage.
 *
 * Features:
 * - Step-by-step test execution with metrics capture
 * - Standard test scenarios (navigation, scroll stress, zoom transitions)
 * - MCP integration for interactive testing
 * - Screenshot capture for visual comparison
 *
 * @example
 * ```typescript
 * const runner = new LifecycleTestRunner(canvas);
 * const results = await runner.runTest(STANDARD_SCENARIOS.basicNavigation);
 * console.log(results);
 * ```
 */

import { getTelemetry, type TelemetryStats } from './pdf-telemetry';

/** Lifecycle test step types */
export type TestStepType = 'scroll' | 'zoom' | 'navigate' | 'wait' | 'capture';

/** Parameters for test steps */
export interface TestStepParams {
  /** Target page number (for navigate) or zoom level (for zoom) */
  target?: number;
  /** Scroll distance in pixels */
  distance?: number;
  /** Animation/wait duration in ms */
  duration?: number;
  /** Use random target within page count */
  random?: boolean;
  /** Label for this step (for reporting) */
  label?: string;
}

/** A single test step */
export interface LifecycleTestStep {
  type: TestStepType;
  params: TestStepParams;
}

/** Metrics captured during a test step */
export interface StepMetrics {
  renderTime: number;
  cacheHitRate: number;
  memoryUsageMB: number;
  fps: number;
  jankEvents: number;
  tilesRendered: number;
  scale: number;
  zoom: number;
}

/** Result of a single test step */
export interface LifecycleTestStepResult {
  stepName: string;
  stepIndex: number;
  duration: number;
  success: boolean;
  error?: string;
  metrics: StepMetrics;
}

/** Complete test result */
export interface LifecycleTestResult {
  scenarioName: string;
  startTime: number;
  endTime: number;
  totalDuration: number;
  steps: LifecycleTestStepResult[];
  summary: {
    totalSteps: number;
    successfulSteps: number;
    failedSteps: number;
    averageRenderTime: number;
    overallCacheHitRate: number;
    peakMemoryMB: number;
    totalJankEvents: number;
    averageFps: number;
    maxScale: number;
  };
  telemetry: TelemetryStats;
}

/** Interface for the infinite canvas (duck-typed for flexibility) */
export interface InfiniteCanvasInterface {
  goToPage(page: number): Promise<void>;
  getZoom(): number;
  setZoom(zoom: number): void;
  getPageCount(): number;
  getCurrentPage(): number;
  pageElements: Map<number, unknown>;
}

/**
 * Lifecycle Test Runner
 */
export class LifecycleTestRunner {
  private canvas: InfiniteCanvasInterface;
  private results: LifecycleTestStepResult[] = [];
  private scenarioName: string = '';

  constructor(canvas: InfiniteCanvasInterface) {
    this.canvas = canvas;
  }

  /**
   * Run a complete test scenario
   */
  async runTest(
    steps: LifecycleTestStep[],
    scenarioName: string = 'unnamed'
  ): Promise<LifecycleTestResult> {
    this.scenarioName = scenarioName;
    this.results = [];

    // Reset telemetry for clean measurement
    getTelemetry().reset();

    const startTime = performance.now();

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const result = await this.executeStep(step, i);
      this.results.push(result);

      // Log progress
      console.log(
        `[LifecycleTest] Step ${i + 1}/${steps.length}: ${result.stepName} - ${
          result.success ? 'OK' : 'FAILED'
        } (${result.duration.toFixed(0)}ms)`
      );
    }

    const endTime = performance.now();
    const telemetry = getTelemetry().getStats();

    return this.buildResult(startTime, endTime, telemetry);
  }

  /**
   * Execute a single test step
   */
  private async executeStep(
    step: LifecycleTestStep,
    index: number
  ): Promise<LifecycleTestStepResult> {
    const stepName = this.getStepName(step);
    const startTime = performance.now();
    const startMetrics = this.captureMetrics();

    let success = true;
    let error: string | undefined;

    try {
      switch (step.type) {
        case 'navigate':
          await this.executeNavigate(step.params);
          break;
        case 'zoom':
          await this.executeZoom(step.params);
          break;
        case 'scroll':
          await this.executeScroll(step.params);
          break;
        case 'wait':
          await this.delay(step.params.duration ?? 500);
          break;
        case 'capture':
          // Capture is just a marker for metrics snapshot
          break;
      }
    } catch (e) {
      success = false;
      error = e instanceof Error ? e.message : String(e);
    }

    const endTime = performance.now();
    const endMetrics = this.captureMetrics();

    return {
      stepName,
      stepIndex: index,
      duration: endTime - startTime,
      success,
      error,
      metrics: this.diffMetrics(startMetrics, endMetrics),
    };
  }

  /**
   * Navigate to a specific page
   */
  private async executeNavigate(params: TestStepParams): Promise<void> {
    let targetPage: number;

    if (params.random) {
      const pageCount = this.canvas.getPageCount();
      targetPage = Math.floor(Math.random() * pageCount) + 1;
    } else {
      targetPage = params.target ?? 1;
    }

    await this.canvas.goToPage(targetPage);

    // Wait for render to complete
    await this.delay(params.duration ?? 300);
  }

  /**
   * Zoom to a specific level
   */
  private async executeZoom(params: TestStepParams): Promise<void> {
    const targetZoom = params.target ?? 1;
    this.canvas.setZoom(targetZoom);

    // Wait for re-render
    await this.delay(params.duration ?? 200);
  }

  /**
   * Simulate scroll by dispatching wheel events
   */
  private async executeScroll(params: TestStepParams): Promise<void> {
    const distance = params.distance ?? 500;
    const duration = params.duration ?? 500;
    const steps = 10;
    const stepDistance = distance / steps;
    const stepDuration = duration / steps;

    for (let i = 0; i < steps; i++) {
      // Dispatch wheel event to the viewport
      const viewport = document.querySelector('.pdf-infinite-canvas-viewport');
      if (viewport) {
        const event = new WheelEvent('wheel', {
          deltaY: stepDistance,
          bubbles: true,
          cancelable: true,
        });
        viewport.dispatchEvent(event);
      }
      await this.delay(stepDuration);
    }
  }

  /**
   * Capture current metrics snapshot
   */
  private captureMetrics(): StepMetrics {
    const stats = getTelemetry().getStats();
    return {
      renderTime: stats.avgRenderTime,
      cacheHitRate: stats.overallHitRate,
      memoryUsageMB: stats.currentMemoryMB,
      fps: stats.scrollAvgFps,
      jankEvents: stats.scrollJankEvents,
      tilesRendered: stats.totalTileRenders,
      scale: stats.avgRenderScale,
      zoom: this.canvas.getZoom(),
    };
  }

  /**
   * Calculate difference between two metric snapshots
   */
  private diffMetrics(start: StepMetrics, end: StepMetrics): StepMetrics {
    return {
      renderTime: end.renderTime, // Use end value (average)
      cacheHitRate: end.cacheHitRate,
      memoryUsageMB: end.memoryUsageMB,
      fps: end.fps,
      jankEvents: end.jankEvents - start.jankEvents,
      tilesRendered: end.tilesRendered - start.tilesRendered,
      scale: end.scale,
      zoom: end.zoom,
    };
  }

  /**
   * Build the final result object
   */
  private buildResult(
    startTime: number,
    endTime: number,
    telemetry: TelemetryStats
  ): LifecycleTestResult {
    const successfulSteps = this.results.filter((r) => r.success).length;
    const failedSteps = this.results.filter((r) => !r.success).length;

    // Calculate averages
    const avgRenderTime =
      this.results.length > 0
        ? this.results.reduce((sum, r) => sum + r.metrics.renderTime, 0) /
          this.results.length
        : 0;

    const totalJankEvents = this.results.reduce(
      (sum, r) => sum + r.metrics.jankEvents,
      0
    );

    const avgFps =
      this.results.length > 0
        ? this.results.reduce((sum, r) => sum + r.metrics.fps, 0) /
          this.results.length
        : 60;

    const peakMemory = Math.max(...this.results.map((r) => r.metrics.memoryUsageMB));
    const maxScale = Math.max(...this.results.map((r) => r.metrics.scale));

    return {
      scenarioName: this.scenarioName,
      startTime,
      endTime,
      totalDuration: endTime - startTime,
      steps: this.results,
      summary: {
        totalSteps: this.results.length,
        successfulSteps,
        failedSteps,
        averageRenderTime: avgRenderTime,
        overallCacheHitRate: telemetry.overallHitRate,
        peakMemoryMB: peakMemory,
        totalJankEvents,
        averageFps: avgFps,
        maxScale,
      },
      telemetry,
    };
  }

  /**
   * Get human-readable step name
   */
  private getStepName(step: LifecycleTestStep): string {
    const label = step.params.label;
    if (label) return label;

    switch (step.type) {
      case 'navigate':
        if (step.params.random) return 'Navigate to random page';
        return `Navigate to page ${step.params.target ?? 1}`;
      case 'zoom':
        return `Zoom to ${step.params.target ?? 1}x`;
      case 'scroll':
        return `Scroll ${step.params.distance ?? 500}px`;
      case 'wait':
        return `Wait ${step.params.duration ?? 500}ms`;
      case 'capture':
        return 'Capture metrics';
      default:
        return 'Unknown step';
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Format test results for console output
 */
export function formatTestResults(result: LifecycleTestResult): string {
  const lines: string[] = [
    ``,
    `========================================`,
    `Lifecycle Test Results: ${result.scenarioName}`,
    `========================================`,
    ``,
    `Duration: ${(result.totalDuration / 1000).toFixed(2)}s`,
    `Steps: ${result.summary.successfulSteps}/${result.summary.totalSteps} passed`,
    ``,
    `--- Performance Summary ---`,
    `Avg Render Time: ${result.summary.averageRenderTime.toFixed(1)}ms`,
    `Cache Hit Rate: ${(result.summary.overallCacheHitRate * 100).toFixed(1)}%`,
    `Peak Memory: ${result.summary.peakMemoryMB.toFixed(1)}MB`,
    `Avg FPS: ${result.summary.averageFps.toFixed(0)}`,
    `Jank Events: ${result.summary.totalJankEvents}`,
    `Max Scale: ${result.summary.maxScale}x`,
    ``,
    `--- Step Details ---`,
  ];

  for (const step of result.steps) {
    const status = step.success ? '✓' : '✗';
    lines.push(
      `${status} ${step.stepName}: ${step.duration.toFixed(0)}ms (scale: ${step.metrics.scale.toFixed(1)}x, zoom: ${step.metrics.zoom.toFixed(1)}x)`
    );
    if (step.error) {
      lines.push(`  Error: ${step.error}`);
    }
  }

  lines.push(``);
  lines.push(`========================================`);

  return lines.join('\n');
}
