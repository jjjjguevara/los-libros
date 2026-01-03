<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { setIcon } from 'obsidian';
  import type { OfflineManager, DownloadProgress, OfflineBook } from '../offline-manager';

  export let offlineManager: OfflineManager;

  const dispatch = createEventDispatcher<{
    cancel: { bookId: string };
    pause: { bookId: string };
    resume: { bookId: string };
  }>();

  let activeDownloads: Map<string, DownloadProgress> = new Map();
  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  // Helper to format bytes
  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  // Helper to format time
  function formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  function handleProgress(progress: DownloadProgress) {
    activeDownloads.set(progress.bookId, progress);
    activeDownloads = activeDownloads; // Trigger reactivity
  }

  function handleComplete(data: { bookId: string }) {
    activeDownloads.delete(data.bookId);
    activeDownloads = activeDownloads;
  }

  function handleError(data: { bookId: string }) {
    activeDownloads.delete(data.bookId);
    activeDownloads = activeDownloads;
  }

  function handleCancel(data: { bookId: string }) {
    activeDownloads.delete(data.bookId);
    activeDownloads = activeDownloads;
  }

  function handlePause(bookId: string) {
    offlineManager.pauseDownload(bookId);
    dispatch('pause', { bookId });
  }

  function handleCancelClick(bookId: string) {
    offlineManager.cancelDownload(bookId);
    dispatch('cancel', { bookId });
  }

  function setIconEl(node: HTMLElement, icon: string) {
    setIcon(node, icon);
  }

  onMount(() => {
    if (offlineManager) {
      offlineManager.on('progress', handleProgress);
      offlineManager.on('complete', handleComplete);
      offlineManager.on('error', handleError);
      offlineManager.on('cancel', handleCancel);
    }
  });

  onDestroy(() => {
    if (offlineManager) {
      offlineManager.off('progress', handleProgress);
      offlineManager.off('complete', handleComplete);
      offlineManager.off('error', handleError);
      offlineManager.off('cancel', handleCancel);
    }
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });

  $: downloadList = Array.from(activeDownloads.values());
  $: hasDownloads = downloadList.length > 0;
</script>

{#if hasDownloads}
  <div class="download-progress-panel">
    <div class="panel-header">
      <span use:setIconEl={'download-cloud'}></span>
      <span>Active Downloads ({downloadList.length})</span>
    </div>

    <div class="downloads-list">
      {#each downloadList as download (download.bookId)}
        <div class="download-item">
          <div class="download-info">
            <div class="download-name">{download.bookId}</div>
            <div class="download-stats">
              <span>{formatBytes(download.bytesDownloaded)} / {formatBytes(download.totalBytes)}</span>
              <span class="separator">|</span>
              <span>{formatBytes(download.speed)}/s</span>
              <span class="separator">|</span>
              <span>ETA: {formatTime(download.eta)}</span>
            </div>
          </div>

          <div class="download-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: {download.percentage}%"></div>
            </div>
            <span class="progress-text">{download.percentage.toFixed(0)}%</span>
          </div>

          <div class="download-actions">
            <button
              class="clickable-icon"
              on:click={() => handlePause(download.bookId)}
              title="Pause"
            >
              <span use:setIconEl={'pause'}></span>
            </button>
            <button
              class="clickable-icon mod-warning"
              on:click={() => handleCancelClick(download.bookId)}
              title="Cancel"
            >
              <span use:setIconEl={'x'}></span>
            </button>
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .download-progress-panel {
    background: var(--background-secondary);
    border-radius: var(--radius-m);
    padding: 12px;
    margin: 12px 0;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
    margin-bottom: 12px;
    color: var(--text-normal);
  }

  .downloads-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .download-item {
    background: var(--background-primary);
    border-radius: var(--radius-s);
    padding: 10px;
  }

  .download-info {
    margin-bottom: 8px;
  }

  .download-name {
    font-weight: 500;
    margin-bottom: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .download-stats {
    font-size: 0.8em;
    color: var(--text-muted);
    display: flex;
    gap: 4px;
  }

  .separator {
    color: var(--background-modifier-border);
  }

  .download-progress {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .progress-bar {
    flex: 1;
    height: 8px;
    background: var(--background-modifier-border);
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.3s ease;
  }

  .progress-text {
    font-size: 0.8em;
    font-weight: 500;
    min-width: 40px;
    text-align: right;
  }

  .download-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }

  .download-actions .clickable-icon {
    padding: 4px;
  }

  .download-actions .mod-warning:hover {
    color: var(--text-error);
  }
</style>
