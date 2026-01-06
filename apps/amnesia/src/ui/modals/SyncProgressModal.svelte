<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import type { SyncProgress, SyncEngineStatus, SyncError } from '../../sync/types';

  export let progress: SyncProgress | null = null;
  export let errors: SyncError[] = [];
  export let canPause = true;
  export let canCancel = true;

  const dispatch = createEventDispatcher<{
    pause: void;
    resume: void;
    cancel: void;
    close: void;
    viewErrors: void;
  }>();

  // Local state
  let isPaused = false;
  let showErrors = false;
  let animationFrame: number;
  let pulseOpacity = 1;

  // Reactive computed values
  $: percentage = progress?.percentage ?? 0;
  $: status = progress?.status ?? 'idle';
  $: phase = progress?.phase ?? 'Preparing...';
  $: total = progress?.total ?? 0;
  $: processed = progress?.processed ?? 0;
  $: skipped = progress?.skipped ?? 0;
  $: errorCount = progress?.errors ?? 0;
  $: currentItem = progress?.currentItem ?? '';
  $: eta = progress?.eta;
  $: speed = progress?.speed;
  $: isComplete = status === 'idle' && percentage === 100;
  $: hasErrors = errors.length > 0 || errorCount > 0;

  // Format ETA
  function formatEta(seconds: number | undefined): string {
    if (!seconds || seconds <= 0) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Format speed
  function formatSpeed(itemsPerSec: number | undefined): string {
    if (!itemsPerSec) return '--';
    return `${itemsPerSec.toFixed(1)} items/s`;
  }

  // Get status color
  function getStatusColor(status: SyncEngineStatus): string {
    switch (status) {
      case 'syncing':
        return 'var(--interactive-accent)';
      case 'detecting-changes':
        return 'var(--color-blue)';
      case 'resolving-conflicts':
        return 'var(--color-orange)';
      case 'checkpointing':
        return 'var(--color-purple)';
      case 'error':
        return 'var(--color-red)';
      case 'paused':
        return 'var(--color-yellow)';
      case 'completing':
        return 'var(--color-green)';
      default:
        return 'var(--text-muted)';
    }
  }

  // Get status icon
  function getStatusIcon(status: SyncEngineStatus): string {
    switch (status) {
      case 'syncing':
        return 'sync';
      case 'detecting-changes':
        return 'search';
      case 'resolving-conflicts':
        return 'alert';
      case 'checkpointing':
        return 'save';
      case 'error':
        return 'x-circle';
      case 'paused':
        return 'pause';
      case 'completing':
        return 'check';
      default:
        return 'loader';
    }
  }

  // Truncate long item names
  function truncateItem(item: string, maxLength = 40): string {
    if (item.length <= maxLength) return item;
    return item.slice(0, maxLength - 3) + '...';
  }

  // Handle pause/resume
  function handlePauseResume() {
    if (isPaused) {
      dispatch('resume');
      isPaused = false;
    } else {
      dispatch('pause');
      isPaused = true;
    }
  }

  // Handle cancel
  function handleCancel() {
    if (confirm('Are you sure you want to cancel the sync? Progress will be saved.')) {
      dispatch('cancel');
    }
  }

  // Pulse animation for active status
  function animatePulse() {
    const time = Date.now() / 1000;
    pulseOpacity = 0.5 + Math.sin(time * 2) * 0.5;
    animationFrame = requestAnimationFrame(animatePulse);
  }

  onMount(() => {
    animatePulse();
  });

  onDestroy(() => {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
    }
  });
</script>

<div class="progress-modal-overlay">
  <div class="progress-modal">
    <!-- Header -->
    <div class="modal-header">
      <h2>Syncing Library</h2>
      {#if isComplete}
        <button class="close-button" on:click={() => dispatch('close')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      {/if}
    </div>

    <!-- Status indicator -->
    <div class="status-indicator" style="--status-color: {getStatusColor(status)}">
      <div class="status-icon" style="opacity: {status === 'syncing' ? pulseOpacity : 1}">
        {#if status === 'syncing'}
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spinning">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="m3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        {:else if status === 'error'}
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
        {:else if isComplete}
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        {:else if status === 'paused'}
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spinning">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        {/if}
      </div>
      <span class="status-text">{phase}</span>
    </div>

    <!-- Progress bar -->
    <div class="progress-section">
      <div class="progress-bar-container">
        <div
          class="progress-bar-fill"
          style="width: {percentage}%; background: {getStatusColor(status)}"
        ></div>
      </div>
      <div class="progress-stats">
        <span class="percentage">{Math.round(percentage)}%</span>
        <span class="count">{processed} / {total}</span>
      </div>
    </div>

    <!-- Current item -->
    {#if currentItem && !isComplete}
      <div class="current-item">
        <span class="label">Processing:</span>
        <span class="item-name" title={currentItem}>{truncateItem(currentItem)}</span>
      </div>
    {/if}

    <!-- Stats grid -->
    <div class="stats-grid">
      <div class="stat">
        <span class="stat-value">{processed}</span>
        <span class="stat-label">Processed</span>
      </div>
      <div class="stat">
        <span class="stat-value">{skipped}</span>
        <span class="stat-label">Skipped</span>
      </div>
      <div class="stat" class:has-errors={errorCount > 0}>
        <span class="stat-value">{errorCount}</span>
        <span class="stat-label">Errors</span>
      </div>
      <div class="stat">
        <span class="stat-value">{formatEta(eta)}</span>
        <span class="stat-label">ETA</span>
      </div>
      <div class="stat">
        <span class="stat-value">{formatSpeed(speed)}</span>
        <span class="stat-label">Speed</span>
      </div>
    </div>

    <!-- Error section -->
    {#if hasErrors}
      <div class="error-section">
        <button class="error-toggle" on:click={() => (showErrors = !showErrors)}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>{errors.length} error{errors.length !== 1 ? 's' : ''} occurred</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class:rotated={showErrors}
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        {#if showErrors}
          <div class="error-list">
            {#each errors.slice(0, 10) as error}
              <div class="error-item">
                <span class="error-entity">{error.entityId || 'Unknown'}</span>
                <span class="error-message">{error.message}</span>
              </div>
            {/each}
            {#if errors.length > 10}
              <button class="view-all-errors" on:click={() => dispatch('viewErrors')}>
                View all {errors.length} errors
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Actions -->
    <div class="modal-actions">
      {#if !isComplete}
        {#if canPause}
          <button class="action-button" on:click={handlePauseResume}>
            {#if isPaused}
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              Resume
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
              </svg>
              Pause
            {/if}
          </button>
        {/if}
        {#if canCancel}
          <button class="action-button cancel" on:click={handleCancel}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            Cancel
          </button>
        {/if}
      {:else}
        <button class="action-button primary" on:click={() => dispatch('close')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Done
        </button>
      {/if}
    </div>

    <!-- Completion message -->
    {#if isComplete}
      <div class="completion-message">
        <p>
          Sync completed! {processed} items processed
          {#if skipped > 0}
            ({skipped} unchanged)
          {/if}
          {#if errorCount > 0}
            with {errorCount} error{errorCount !== 1 ? 's' : ''}
          {/if}
        </p>
      </div>
    {/if}
  </div>
</div>

<style>
  .progress-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .progress-modal {
    background: var(--background-primary);
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    width: 90%;
    max-width: 480px;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .close-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    color: var(--text-muted);
    border-radius: 4px;
  }

  .close-button:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 20px 24px;
    background: var(--background-secondary);
  }

  .status-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: var(--background-primary);
    border-radius: 50%;
    color: var(--status-color);
  }

  .status-icon :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .status-text {
    font-size: 15px;
    font-weight: 500;
  }

  .progress-section {
    padding: 20px 24px;
  }

  .progress-bar-container {
    height: 8px;
    background: var(--background-modifier-border);
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .progress-stats {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
    font-size: 13px;
  }

  .percentage {
    font-weight: 600;
    color: var(--text-normal);
  }

  .count {
    color: var(--text-muted);
  }

  .current-item {
    padding: 0 24px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .current-item .label {
    color: var(--text-muted);
  }

  .item-name {
    color: var(--text-normal);
    font-family: var(--font-monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 1px;
    background: var(--background-modifier-border);
    margin: 0 24px;
    border-radius: 8px;
    overflow: hidden;
  }

  .stat {
    background: var(--background-secondary);
    padding: 12px 8px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stat.has-errors .stat-value {
    color: var(--color-red);
  }

  .stat-value {
    font-size: 16px;
    font-weight: 600;
  }

  .stat-label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .error-section {
    margin: 16px 24px;
    border: 1px solid var(--color-red);
    border-radius: 8px;
    overflow: hidden;
  }

  .error-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 12px 16px;
    background: rgba(var(--color-red-rgb), 0.1);
    border: none;
    cursor: pointer;
    font-size: 14px;
    color: var(--color-red);
  }

  .error-toggle svg:last-child {
    margin-left: auto;
    transition: transform 0.2s;
  }

  .error-toggle svg.rotated {
    transform: rotate(180deg);
  }

  .error-list {
    padding: 12px 16px;
    background: var(--background-secondary);
    max-height: 200px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .error-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px;
    background: var(--background-primary);
    border-radius: 4px;
  }

  .error-entity {
    font-size: 12px;
    color: var(--text-muted);
    font-family: var(--font-monospace);
  }

  .error-message {
    font-size: 13px;
    color: var(--color-red);
  }

  .view-all-errors {
    padding: 8px;
    background: none;
    border: 1px dashed var(--background-modifier-border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-muted);
  }

  .view-all-errors:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .modal-actions {
    display: flex;
    justify-content: center;
    gap: 12px;
    padding: 20px 24px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .action-button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
  }

  .action-button:hover {
    background: var(--background-modifier-hover);
  }

  .action-button.cancel {
    color: var(--color-red);
  }

  .action-button.cancel:hover {
    background: rgba(var(--color-red-rgb), 0.1);
    border-color: var(--color-red);
  }

  .action-button.primary {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-color: var(--interactive-accent);
  }

  .action-button.primary:hover {
    opacity: 0.9;
  }

  .completion-message {
    padding: 0 24px 20px;
    text-align: center;
  }

  .completion-message p {
    margin: 0;
    color: var(--text-muted);
    font-size: 14px;
  }
</style>
