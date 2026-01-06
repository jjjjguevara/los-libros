/**
 * DevTools Helpers
 *
 * Helper functions for testing with Obsidian DevTools MCP.
 * Provides utilities for sync state extraction, progress monitoring,
 * and console log analysis.
 *
 * @see CLAUDE.md for MCP usage patterns
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Sync state from the plugin
 */
export interface SyncState {
  status: 'idle' | 'syncing' | 'paused' | 'error';
  progress: number;
  currentOperation?: string;
  lastSyncTime?: Date;
  error?: string;
}

/**
 * Console log entry
 */
export interface ConsoleLogEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  timestamp: number;
  message: string;
  args?: unknown[];
}

/**
 * Plugin info
 */
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
}

/**
 * Reader state from Amnesia plugin
 */
export interface ReaderState {
  bookId?: string;
  currentCfi?: string;
  progress?: number;
  chapterIndex?: number;
  totalChapters?: number;
}

// ============================================================================
// JavaScript Snippets for MCP Execution
// ============================================================================

/**
 * JavaScript to extract sync state from plugin
 */
export const EXTRACT_SYNC_STATE_JS = `
(function() {
  try {
    const plugin = app.plugins.plugins['amnesia'];
    if (!plugin) return { error: 'Plugin not found' };

    const syncEngine = plugin.syncEngine;
    if (!syncEngine) return { error: 'Sync engine not initialized' };

    return {
      status: syncEngine.status || 'idle',
      progress: syncEngine.progress || 0,
      currentOperation: syncEngine.currentOperation,
      lastSyncTime: syncEngine.lastSyncTime?.toISOString(),
      error: syncEngine.lastError?.message
    };
  } catch (e) {
    return { error: e.message };
  }
})()
`;

/**
 * JavaScript to get reader state
 */
export const EXTRACT_READER_STATE_JS = `
(function() {
  try {
    const leaves = app.workspace.getLeavesOfType('amnesia-reader');
    if (leaves.length === 0) return { error: 'No reader view open' };

    const view = leaves[0].view;
    const component = view.component;
    const ctx = component.$$.ctx;
    const reader = ctx[3];

    if (!reader) return { error: 'Reader not initialized' };

    const nav = reader.navigator;
    return {
      bookId: reader.bookId,
      currentCfi: nav?.getCurrentCfi?.(),
      progress: nav?.getProgress?.() || 0,
      chapterIndex: nav?.currentSpineIndex,
      totalChapters: nav?.spine?.length
    };
  } catch (e) {
    return { error: e.message };
  }
})()
`;

/**
 * JavaScript to get plugin settings
 */
export const GET_PLUGIN_SETTINGS_JS = `
(function() {
  try {
    const plugin = app.plugins.plugins['amnesia'];
    if (!plugin) return { error: 'Plugin not found' };
    return plugin.settings || {};
  } catch (e) {
    return { error: e.message };
  }
})()
`;

/**
 * JavaScript to list all sync adapters
 */
export const LIST_SYNC_ADAPTERS_JS = `
(function() {
  try {
    const plugin = app.plugins.plugins['amnesia'];
    if (!plugin) return { error: 'Plugin not found' };

    const syncEngine = plugin.syncEngine;
    if (!syncEngine) return { error: 'Sync engine not initialized' };

    const adapters = syncEngine.adapters || [];
    return adapters.map(a => ({
      type: a.type,
      name: a.name,
      connected: a.isConnected?.() || false,
      lastSync: a.lastSyncTime?.toISOString()
    }));
  } catch (e) {
    return { error: e.message };
  }
})()
`;

/**
 * JavaScript to trigger a sync
 */
export const TRIGGER_SYNC_JS = `
(async function() {
  try {
    const plugin = app.plugins.plugins['amnesia'];
    if (!plugin) return { error: 'Plugin not found' };

    const syncEngine = plugin.syncEngine;
    if (!syncEngine) return { error: 'Sync engine not initialized' };

    const result = await syncEngine.sync({ mode: 'incremental' });
    return {
      success: result.success,
      processed: result.stats?.processed || 0,
      errors: result.errors?.length || 0
    };
  } catch (e) {
    return { error: e.message };
  }
})()
`;

/**
 * JavaScript to cancel ongoing sync
 */
export const CANCEL_SYNC_JS = `
(function() {
  try {
    const plugin = app.plugins.plugins['amnesia'];
    if (!plugin) return { error: 'Plugin not found' };

    const syncEngine = plugin.syncEngine;
    if (!syncEngine) return { error: 'Sync engine not initialized' };

    syncEngine.cancel();
    return { cancelled: true };
  } catch (e) {
    return { error: e.message };
  }
})()
`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse console logs for sync-related entries
 */
export function filterSyncLogs(logs: ConsoleLogEntry[]): ConsoleLogEntry[] {
  const syncKeywords = [
    'sync',
    'calibre',
    'upload',
    'download',
    'conflict',
    'metadata',
    'progress',
  ];

  return logs.filter((log) => {
    const message = log.message.toLowerCase();
    return syncKeywords.some((keyword) => message.includes(keyword));
  });
}

/**
 * Parse console logs for errors
 */
export function filterErrorLogs(logs: ConsoleLogEntry[]): ConsoleLogEntry[] {
  return logs.filter((log) => log.level === 'error' || log.level === 'warn');
}

/**
 * Extract progress updates from logs
 */
export function extractProgressFromLogs(
  logs: ConsoleLogEntry[]
): { timestamp: number; progress: number }[] {
  const progressPattern = /progress[:\s]+(\d+(?:\.\d+)?)/i;
  const results: { timestamp: number; progress: number }[] = [];

  for (const log of logs) {
    const match = log.message.match(progressPattern);
    if (match) {
      results.push({
        timestamp: log.timestamp,
        progress: parseFloat(match[1]),
      });
    }
  }

  return results;
}

/**
 * Calculate sync duration from logs
 */
export function calculateSyncDuration(logs: ConsoleLogEntry[]): number | null {
  const startPatterns = [/sync started/i, /starting sync/i, /beginning sync/i];
  const endPatterns = [/sync completed/i, /sync finished/i, /sync done/i];

  let startTime: number | null = null;
  let endTime: number | null = null;

  for (const log of logs) {
    if (!startTime && startPatterns.some((p) => p.test(log.message))) {
      startTime = log.timestamp;
    }
    if (endPatterns.some((p) => p.test(log.message))) {
      endTime = log.timestamp;
    }
  }

  if (startTime && endTime) {
    return endTime - startTime;
  }
  return null;
}

/**
 * Create a polling function to wait for sync completion
 */
export function createSyncWaiter(
  executeJs: (code: string) => Promise<unknown>,
  timeoutMs = 60000,
  intervalMs = 1000
): Promise<SyncState> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const poll = async () => {
      try {
        const state = (await executeJs(EXTRACT_SYNC_STATE_JS)) as SyncState;

        if (state.status === 'idle' || state.status === 'error') {
          resolve(state);
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          reject(new Error('Sync timeout'));
          return;
        }

        setTimeout(poll, intervalMs);
      } catch (error) {
        reject(error);
      }
    };

    poll();
  });
}

/**
 * Format sync state for display
 */
export function formatSyncState(state: SyncState): string {
  const lines = [
    `Status: ${state.status}`,
    `Progress: ${(state.progress * 100).toFixed(1)}%`,
  ];

  if (state.currentOperation) {
    lines.push(`Operation: ${state.currentOperation}`);
  }
  if (state.lastSyncTime) {
    lines.push(`Last Sync: ${state.lastSyncTime}`);
  }
  if (state.error) {
    lines.push(`Error: ${state.error}`);
  }

  return lines.join('\n');
}

/**
 * Format reader state for display
 */
export function formatReaderState(state: ReaderState): string {
  const lines = [];

  if (state.bookId) {
    lines.push(`Book: ${state.bookId}`);
  }
  if (state.progress !== undefined) {
    lines.push(`Progress: ${(state.progress * 100).toFixed(1)}%`);
  }
  if (state.chapterIndex !== undefined && state.totalChapters !== undefined) {
    lines.push(`Chapter: ${state.chapterIndex + 1}/${state.totalChapters}`);
  }
  if (state.currentCfi) {
    lines.push(`CFI: ${state.currentCfi}`);
  }

  return lines.join('\n');
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Verify plugin is loaded and accessible
 */
export const VERIFY_PLUGIN_JS = `
(function() {
  const plugin = app.plugins.plugins['amnesia'];
  return {
    loaded: !!plugin,
    enabled: plugin?.manifest?.id === 'amnesia',
    version: plugin?.manifest?.version
  };
})()
`;

/**
 * Get vault statistics
 */
export const GET_VAULT_STATS_JS = `
(function() {
  const files = app.vault.getFiles();
  const mdFiles = app.vault.getMarkdownFiles();
  return {
    totalFiles: files.length,
    markdownFiles: mdFiles.length,
    plugins: Object.keys(app.plugins.plugins).length
  };
})()
`;

/**
 * Clear plugin cache (for testing fresh state)
 */
export const CLEAR_PLUGIN_CACHE_JS = `
(async function() {
  try {
    const plugin = app.plugins.plugins['amnesia'];
    if (!plugin) return { error: 'Plugin not found' };

    // Clear any cached data
    if (plugin.clearCache) {
      await plugin.clearCache();
    }

    return { cleared: true };
  } catch (e) {
    return { error: e.message };
  }
})()
`;
