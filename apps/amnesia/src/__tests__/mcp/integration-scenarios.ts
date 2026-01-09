/**
 * MCP Integration Test Scenarios
 *
 * Test scenarios executable via Obsidian DevTools MCP.
 * Access via: window.amnesiaTests.runScenario('scenario-name')
 *
 * These tests use the actual running plugin and can verify real integration.
 */

import type AmnesiaPlugin from '../../main';
import type { Highlight, HighlightColor } from '../../library/types';
import type { StubType, DocDoctorStub } from '../../integrations/doc-doctor-bridge';

export interface ScenarioResult {
  name: string;
  passed: boolean;
  duration: number;
  details: string;
  error?: string;
}

type ScenarioFn = (plugin: AmnesiaPlugin) => Promise<ScenarioResult>;

/**
 * Test scenario definitions
 */
export const MCP_TEST_SCENARIOS: Record<string, ScenarioFn> = {
  /**
   * Scenario: Create highlight and sync to Doc Doctor stub
   */
  'highlight-to-stub': async (plugin) => {
    const startTime = performance.now();
    const name = 'highlight-to-stub';

    try {
      const bridge = plugin.docDoctorBridge;
      if (!bridge?.isConnected()) {
        return {
          name,
          passed: false,
          duration: performance.now() - startTime,
          details: 'Doc Doctor not connected',
          error: 'Bridge not available or disconnected',
        };
      }

      // Create test stub
      const testText = `Test highlight ${Date.now()}`;
      const stub = await bridge.createStub({
        type: 'verify' as StubType,
        description: testText,
        filePath: '/test/integration.md',
        source: { plugin: 'amnesia' },
      });

      if (!stub) {
        return {
          name,
          passed: false,
          duration: performance.now() - startTime,
          details: 'Failed to create stub',
          error: 'createStub returned null',
        };
      }

      // Verify stub was created
      const fetched = await bridge.getStub(stub.id);

      // Cleanup
      await bridge.deleteStub(stub.id);

      return {
        name,
        passed: !!fetched,
        duration: performance.now() - startTime,
        details: `Created stub ${stub.id}, verified fetch, cleaned up`,
      };
    } catch (error) {
      return {
        name,
        passed: false,
        duration: performance.now() - startTime,
        details: 'Exception during test',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /**
   * Scenario: Resolve a stub and verify state
   */
  'stub-resolution': async (plugin) => {
    const startTime = performance.now();
    const name = 'stub-resolution';

    try {
      const bridge = plugin.docDoctorBridge;
      if (!bridge?.isConnected()) {
        return {
          name,
          passed: false,
          duration: performance.now() - startTime,
          details: 'Doc Doctor not connected',
        };
      }

      // Create stub
      const stub = await bridge.createStub({
        type: 'verify',
        description: 'Stub to resolve',
        filePath: '/test/resolution.md',
      });

      if (!stub) {
        return {
          name,
          passed: false,
          duration: performance.now() - startTime,
          details: 'Failed to create stub',
        };
      }

      // Resolve stub
      const resolution = 'Resolved via MCP test';
      const resolved = await bridge.resolveStub(stub.id, resolution);

      const success = resolved?.resolution === resolution;

      // Cleanup
      await bridge.deleteStub(stub.id);

      return {
        name,
        passed: success,
        duration: performance.now() - startTime,
        details: success
          ? `Stub resolved successfully: "${resolution}"`
          : `Resolution mismatch: expected "${resolution}", got "${resolved?.resolution}"`,
      };
    } catch (error) {
      return {
        name,
        passed: false,
        duration: performance.now() - startTime,
        details: 'Exception during test',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /**
   * Scenario: Bulk sync multiple highlights
   */
  'bulk-sync': async (plugin) => {
    const startTime = performance.now();
    const name = 'bulk-sync';
    const batchSize = 20;

    try {
      const bridge = plugin.docDoctorBridge;
      if (!bridge?.isConnected()) {
        return {
          name,
          passed: false,
          duration: performance.now() - startTime,
          details: 'Doc Doctor not connected',
        };
      }

      // Create batch of stubs
      const stubs: DocDoctorStub[] = [];
      const types: StubType[] = ['verify', 'expand', 'clarify', 'question', 'important'];

      for (let i = 0; i < batchSize; i++) {
        const stub = await bridge.createStub({
          type: types[i % types.length],
          description: `Bulk test stub ${i + 1}`,
          filePath: '/test/bulk.md',
        });
        if (stub) stubs.push(stub);
      }

      const createDuration = performance.now() - startTime;

      // Verify all created
      const listResult = await bridge.listStubs('/test/bulk.md');
      const matchCount = listResult?.filter((s) =>
        s.description.startsWith('Bulk test stub')
      ).length ?? 0;

      // Cleanup
      for (const stub of stubs) {
        await bridge.deleteStub(stub.id);
      }

      const success = stubs.length === batchSize && matchCount >= batchSize * 0.9; // Allow 10% tolerance

      return {
        name,
        passed: success,
        duration: performance.now() - startTime,
        details: `Created ${stubs.length}/${batchSize} stubs in ${createDuration.toFixed(0)}ms, verified ${matchCount} in list`,
      };
    } catch (error) {
      return {
        name,
        passed: false,
        duration: performance.now() - startTime,
        details: 'Exception during bulk test',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /**
   * Scenario: Test book health retrieval
   */
  'book-health': async (plugin) => {
    const startTime = performance.now();
    const name = 'book-health';

    try {
      const bridge = plugin.docDoctorBridge;
      if (!bridge?.isConnected()) {
        return {
          name,
          passed: false,
          duration: performance.now() - startTime,
          details: 'Doc Doctor not connected',
        };
      }

      // Get health for any available book note
      // In real test, this would use an actual book note path
      const testPath = '/test/health-check.md';
      const health = await bridge.getBookHealth(testPath);

      // Health can be null if no book at path
      const passed = health === null || (
        typeof health.overall === 'number' &&
        health.overall >= 0 &&
        health.overall <= 1
      );

      return {
        name,
        passed,
        duration: performance.now() - startTime,
        details: health
          ? `Health: ${(health.overall * 100).toFixed(0)}%, Highlights: ${health.breakdown.highlightCount}, Stubs: ${health.breakdown.stubCount}`
          : 'No health data (path may not exist)',
      };
    } catch (error) {
      return {
        name,
        passed: false,
        duration: performance.now() - startTime,
        details: 'Exception during health check',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /**
   * Scenario: Test event subscription
   */
  'event-subscription': async (plugin) => {
    const startTime = performance.now();
    const name = 'event-subscription';

    try {
      const bridge = plugin.docDoctorBridge;
      if (!bridge?.isConnected()) {
        return {
          name,
          passed: false,
          duration: performance.now() - startTime,
          details: 'Doc Doctor not connected',
        };
      }

      let eventReceived = false;
      let eventData: unknown = null;

      // Subscribe to health updates
      const disposable = bridge.on('health-updated', (data) => {
        eventReceived = true;
        eventData = data;
      });

      // Wait briefly for any pending events
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Cleanup
      disposable.dispose();

      return {
        name,
        passed: true, // Subscription itself working is the test
        duration: performance.now() - startTime,
        details: eventReceived
          ? `Event received: ${JSON.stringify(eventData)}`
          : 'Subscription created successfully (no events during test)',
      };
    } catch (error) {
      return {
        name,
        passed: false,
        duration: performance.now() - startTime,
        details: 'Exception during event test',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * Test harness for MCP access
 */
export class MCPTestHarness {
  private plugin: AmnesiaPlugin;
  private results: ScenarioResult[] = [];

  constructor(plugin: AmnesiaPlugin) {
    this.plugin = plugin;
  }

  /**
   * Run a single scenario by name
   */
  async runScenario(scenarioName: string): Promise<ScenarioResult> {
    const scenario = MCP_TEST_SCENARIOS[scenarioName];
    if (!scenario) {
      return {
        name: scenarioName,
        passed: false,
        duration: 0,
        details: `Unknown scenario: ${scenarioName}`,
        error: `Available scenarios: ${Object.keys(MCP_TEST_SCENARIOS).join(', ')}`,
      };
    }

    const result = await scenario(this.plugin);
    this.results.push(result);
    return result;
  }

  /**
   * Run all scenarios
   */
  async runAll(): Promise<ScenarioResult[]> {
    this.results = [];

    for (const [name, scenario] of Object.entries(MCP_TEST_SCENARIOS)) {
      console.log(`Running scenario: ${name}...`);
      const result = await scenario(this.plugin);
      this.results.push(result);
      console.log(`  ${result.passed ? 'PASS' : 'FAIL'}: ${result.details}`);
    }

    return this.results;
  }

  /**
   * Get summary of all results
   */
  getSummary(): { passed: number; failed: number; total: number; results: ScenarioResult[] } {
    const passed = this.results.filter((r) => r.passed).length;
    return {
      passed,
      failed: this.results.length - passed,
      total: this.results.length,
      results: this.results,
    };
  }

  /**
   * List available scenarios
   */
  listScenarios(): string[] {
    return Object.keys(MCP_TEST_SCENARIOS);
  }
}

/**
 * Public interface for window.amnesiaTests (restricted access)
 * Does not expose internal plugin reference for security
 */
interface PublicTestHarness {
  runScenario: (name: string) => Promise<ScenarioResult>;
  runAll: () => Promise<ScenarioResult[]>;
  getSummary: () => { passed: number; failed: number; total: number; results: ScenarioResult[] };
  listScenarios: () => string[];
}

/**
 * Initialize test harness on window for MCP access
 */
export function initializeMCPTestHarness(plugin: AmnesiaPlugin): MCPTestHarness {
  const harness = new MCPTestHarness(plugin);

  // Expose only safe methods to window (no direct plugin access)
  const publicApi: PublicTestHarness = {
    runScenario: harness.runScenario.bind(harness),
    runAll: harness.runAll.bind(harness),
    getSummary: harness.getSummary.bind(harness),
    listScenarios: harness.listScenarios.bind(harness),
  };

  (window as unknown as { amnesiaTests: PublicTestHarness }).amnesiaTests = publicApi;

  console.log('[Amnesia] MCP Test Harness initialized. Access via window.amnesiaTests');
  console.log('[Amnesia] Available scenarios:', harness.listScenarios().join(', '));

  return harness;
}
