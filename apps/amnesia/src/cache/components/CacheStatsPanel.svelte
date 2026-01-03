<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { setIcon } from 'obsidian';
  import type { TieredCache, TieredCacheStats } from '../tiered-cache';
  import { CacheMonitor } from '../cache-monitor';

  export let cache: TieredCache;

  let stats: TieredCacheStats | null = null;
  let loading = true;
  let error: string | null = null;
  let clearing = false;
  let monitor: CacheMonitor | null = null;
  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  // Helper to format bytes
  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  // Helper to format percentage
  function formatPercent(ratio: number): string {
    return `${(ratio * 100).toFixed(1)}%`;
  }

  async function loadStats() {
    if (!cache) {
      error = 'Cache not available';
      loading = false;
      return;
    }

    try {
      stats = await cache.getStats();
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load stats';
    } finally {
      loading = false;
    }
  }

  async function clearCache() {
    if (!cache || clearing) return;

    clearing = true;
    try {
      await cache.clear();
      await loadStats();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to clear cache';
    } finally {
      clearing = false;
    }
  }

  async function refreshStats() {
    await loadStats();
  }

  function setIconEl(node: HTMLElement, icon: string) {
    setIcon(node, icon);
  }

  onMount(() => {
    loadStats();

    // Refresh stats every 5 seconds
    refreshInterval = setInterval(loadStats, 5000);

    // Create monitor if available
    if (cache) {
      monitor = new CacheMonitor(cache);
      monitor.start();
    }
  });

  onDestroy(() => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
    if (monitor) {
      monitor.stop();
    }
  });

  // Reactive calculations
  $: l1UsagePercent = stats ? (stats.l1.sizeBytes / stats.l1.maxSizeBytes) * 100 : 0;
  $: l2UsagePercent = stats?.l2 ? (stats.l2.sizeBytes / stats.l2.maxSizeBytes) * 100 : 0;
  $: totalHits = stats ? stats.combined.hitsByTier.L1 + stats.combined.hitsByTier.L2 : 0;
  $: totalMisses = stats ? stats.combined.hitsByTier.L3 : 0;
  $: hitRatio = totalHits + totalMisses > 0 ? totalHits / (totalHits + totalMisses) : 0;
</script>

<div class="cache-stats-panel">
  {#if loading}
    <div class="cache-loading">
      <span class="loading-spinner" use:setIconEl={'loader-2'}></span>
      <span>Loading cache statistics...</span>
    </div>
  {:else if error}
    <div class="cache-error">
      <span use:setIconEl={'alert-circle'}></span>
      <span>{error}</span>
    </div>
  {:else if stats}
    <!-- Header -->
    <div class="cache-header">
      <h3>Cache Statistics</h3>
      <div class="cache-actions">
        <button
          class="clickable-icon"
          on:click={refreshStats}
          title="Refresh"
        >
          <span use:setIconEl={'refresh-cw'}></span>
        </button>
        <button
          class="mod-warning"
          on:click={clearCache}
          disabled={clearing}
          title="Clear all cache"
        >
          {#if clearing}
            <span use:setIconEl={'loader-2'}></span>
          {:else}
            <span use:setIconEl={'trash-2'}></span>
          {/if}
          Clear Cache
        </button>
      </div>
    </div>

    <!-- Summary -->
    <div class="cache-summary">
      <div class="stat-card">
        <div class="stat-value">{formatBytes(stats.combined.totalSizeBytes)}</div>
        <div class="stat-label">Total Size</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{stats.combined.totalEntries}</div>
        <div class="stat-label">Total Entries</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{formatPercent(hitRatio)}</div>
        <div class="stat-label">Hit Ratio</div>
      </div>
    </div>

    <!-- L1 Cache (Memory) -->
    <div class="cache-tier">
      <div class="tier-header">
        <span use:setIconEl={'zap'}></span>
        <span class="tier-name">L1 Memory Cache</span>
        <span class="tier-badge">Fast</span>
      </div>
      <div class="tier-stats">
        <div class="tier-stat">
          <span class="stat-name">Size</span>
          <span class="stat-value">{formatBytes(stats.l1.sizeBytes)} / {formatBytes(stats.l1.maxSizeBytes)}</span>
        </div>
        <div class="tier-stat">
          <span class="stat-name">Entries</span>
          <span class="stat-value">{stats.l1.entries}</span>
        </div>
        <div class="tier-stat">
          <span class="stat-name">Hits</span>
          <span class="stat-value hit">{stats.combined.hitsByTier.L1}</span>
        </div>
      </div>
      <div class="usage-bar">
        <div class="usage-fill" style="width: {l1UsagePercent}%"></div>
      </div>
      <div class="usage-label">{l1UsagePercent.toFixed(1)}% used</div>
    </div>

    <!-- L2 Cache (IndexedDB) -->
    {#if stats.l2}
      <div class="cache-tier">
        <div class="tier-header">
          <span use:setIconEl={'database'}></span>
          <span class="tier-name">L2 IndexedDB Cache</span>
          <span class="tier-badge">Persistent</span>
        </div>
        <div class="tier-stats">
          <div class="tier-stat">
            <span class="stat-name">Size</span>
            <span class="stat-value">{formatBytes(stats.l2.sizeBytes)} / {formatBytes(stats.l2.maxSizeBytes)}</span>
          </div>
          <div class="tier-stat">
            <span class="stat-name">Entries</span>
            <span class="stat-value">{stats.l2.entries}</span>
          </div>
          <div class="tier-stat">
            <span class="stat-name">Hits</span>
            <span class="stat-value hit">{stats.combined.hitsByTier.L2}</span>
          </div>
        </div>
        <div class="usage-bar">
          <div class="usage-fill l2" style="width: {l2UsagePercent}%"></div>
        </div>
        <div class="usage-label">{l2UsagePercent.toFixed(1)}% used</div>
      </div>
    {:else}
      <div class="cache-tier disabled">
        <div class="tier-header">
          <span use:setIconEl={'database'}></span>
          <span class="tier-name">L2 IndexedDB Cache</span>
          <span class="tier-badge disabled">Disabled</span>
        </div>
        <p class="tier-disabled-text">Enable L2 cache in settings for persistent storage.</p>
      </div>
    {/if}

    <!-- L3 (Remote) Stats -->
    <div class="cache-tier remote">
      <div class="tier-header">
        <span use:setIconEl={'cloud'}></span>
        <span class="tier-name">L3 Remote Fetches</span>
        <span class="tier-badge miss">Miss</span>
      </div>
      <div class="tier-stats">
        <div class="tier-stat">
          <span class="stat-name">Fetches</span>
          <span class="stat-value miss">{stats.combined.hitsByTier.L3}</span>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .cache-stats-panel {
    padding: 16px;
    max-width: 600px;
  }

  .cache-loading,
  .cache-error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    color: var(--text-muted);
  }

  .cache-error {
    color: var(--text-error);
  }

  .loading-spinner {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .cache-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .cache-header h3 {
    margin: 0;
    font-size: 1.1em;
    font-weight: 600;
  }

  .cache-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .cache-actions button {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: var(--radius-s);
    font-size: 0.85em;
  }

  .cache-actions button.mod-warning {
    background-color: var(--background-modifier-error);
    color: var(--text-on-accent);
  }

  .cache-actions button.mod-warning:hover {
    background-color: var(--background-modifier-error-hover);
  }

  .cache-summary {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 20px;
  }

  .stat-card {
    background: var(--background-secondary);
    border-radius: var(--radius-m);
    padding: 12px;
    text-align: center;
  }

  .stat-card .stat-value {
    font-size: 1.4em;
    font-weight: 600;
    color: var(--text-normal);
  }

  .stat-card .stat-label {
    font-size: 0.8em;
    color: var(--text-muted);
    margin-top: 4px;
  }

  .cache-tier {
    background: var(--background-secondary);
    border-radius: var(--radius-m);
    padding: 12px;
    margin-bottom: 12px;
  }

  .cache-tier.disabled {
    opacity: 0.6;
  }

  .cache-tier.remote {
    background: var(--background-secondary-alt);
  }

  .tier-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .tier-name {
    font-weight: 500;
    flex: 1;
  }

  .tier-badge {
    font-size: 0.7em;
    padding: 2px 6px;
    border-radius: var(--radius-s);
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    text-transform: uppercase;
    font-weight: 600;
  }

  .tier-badge.disabled {
    background: var(--background-modifier-border);
    color: var(--text-muted);
  }

  .tier-badge.miss {
    background: var(--background-modifier-error);
  }

  .tier-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 8px;
  }

  .tier-stat {
    display: flex;
    flex-direction: column;
  }

  .tier-stat .stat-name {
    font-size: 0.75em;
    color: var(--text-muted);
  }

  .tier-stat .stat-value {
    font-weight: 500;
  }

  .tier-stat .stat-value.hit {
    color: var(--text-success);
  }

  .tier-stat .stat-value.miss {
    color: var(--text-error);
  }

  .usage-bar {
    height: 6px;
    background: var(--background-modifier-border);
    border-radius: 3px;
    overflow: hidden;
  }

  .usage-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.3s ease;
  }

  .usage-fill.l2 {
    background: var(--color-blue);
  }

  .usage-label {
    font-size: 0.75em;
    color: var(--text-muted);
    margin-top: 4px;
    text-align: right;
  }

  .tier-disabled-text {
    font-size: 0.85em;
    color: var(--text-muted);
    margin: 0;
  }
</style>
