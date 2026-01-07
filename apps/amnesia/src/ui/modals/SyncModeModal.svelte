<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { SyncMode, SyncAdapterType } from '../../sync/types';

  export let lastSyncTime: Date | null = null;
  export let availableAdapters: { type: SyncAdapterType; name: string; enabled: boolean }[] = [];

  const dispatch = createEventDispatcher<{
    select: { mode: SyncMode; adapters?: SyncAdapterType[]; force?: boolean };
    cancel: void;
  }>();

  // Selected mode
  let selectedMode: SyncMode = 'incremental';

  // Custom adapter selection
  let selectedAdapters: Set<SyncAdapterType> = new Set(
    availableAdapters.filter((a) => a.enabled).map((a) => a.type)
  );

  // Force option for incremental
  let forceRescan = false;

  // Mode descriptions
  const modeInfo: Record<SyncMode, { title: string; description: string; icon: string }> = {
    incremental: {
      title: 'Catch-Up Sync',
      description: 'Only sync changes since your last sync. Fast and efficient.',
      icon: 'fast-forward',
    },
    full: {
      title: 'Full Re-Sync',
      description: 'Rebuild your entire library from scratch. Use if something seems wrong.',
      icon: 'refresh-cw',
    },
    custom: {
      title: 'Custom Sync',
      description: 'Choose which sources to sync from.',
      icon: 'sliders',
    },
  };

  // Format last sync time
  function formatLastSync(date: Date | null): string {
    if (!date) return 'Never';
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  // Toggle adapter selection
  function toggleAdapter(type: SyncAdapterType) {
    if (selectedAdapters.has(type)) {
      selectedAdapters.delete(type);
    } else {
      selectedAdapters.add(type);
    }
    selectedAdapters = selectedAdapters; // Trigger reactivity
  }

  // Handle start sync
  function handleStart() {
    dispatch('select', {
      mode: selectedMode,
      adapters: selectedMode === 'custom' ? Array.from(selectedAdapters) : undefined,
      force: forceRescan,
    });
  }

  // Handle cancel
  function handleCancel() {
    dispatch('cancel');
  }

  // Handle keyboard
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      handleCancel();
    } else if (event.key === 'Enter') {
      handleStart();
    }
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  });

  // Helper to set mode (avoids 'as' in template)
  function setMode(mode: string) {
    selectedMode = mode as SyncMode;
  }
</script>

<div class="sync-mode-overlay">
  <div class="sync-mode-modal">
    <!-- Header -->
    <div class="modal-header">
      <h2>Sync Library</h2>
      <button class="close-button" on:click={handleCancel}>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <!-- Last sync info -->
    <div class="last-sync-info">
      <span class="label">Last synced:</span>
      <span class="value">{formatLastSync(lastSyncTime)}</span>
    </div>

    <!-- Mode selection -->
    <div class="mode-selection">
      {#each Object.entries(modeInfo) as [mode, info]}
        <button
          class="mode-option"
          class:selected={selectedMode === mode}
          on:click={() => setMode(mode)}
        >
          <div class="mode-icon">
            {#if info.icon === 'fast-forward'}
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="13 19 22 12 13 5 13 19"></polygon>
                <polygon points="2 19 11 12 2 5 2 19"></polygon>
              </svg>
            {:else if info.icon === 'refresh-cw'}
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="m3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
            {:else if info.icon === 'sliders'}
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="4" y1="21" x2="4" y2="14"></line>
                <line x1="4" y1="10" x2="4" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12" y2="3"></line>
                <line x1="20" y1="21" x2="20" y2="16"></line>
                <line x1="20" y1="12" x2="20" y2="3"></line>
                <line x1="1" y1="14" x2="7" y2="14"></line>
                <line x1="9" y1="8" x2="15" y2="8"></line>
                <line x1="17" y1="16" x2="23" y2="16"></line>
              </svg>
            {/if}
          </div>
          <div class="mode-content">
            <span class="mode-title">{info.title}</span>
            <span class="mode-description">{info.description}</span>
          </div>
          {#if mode === 'incremental'}
            <span class="recommended-badge">Recommended</span>
          {/if}
          <div class="check-indicator" class:visible={selectedMode === mode}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
        </button>
      {/each}
    </div>

    <!-- Custom options -->
    {#if selectedMode === 'custom'}
      <div class="custom-options">
        <h3>Select Sources</h3>
        <div class="adapter-list">
          {#each availableAdapters as adapter}
            <label class="adapter-option" class:disabled={!adapter.enabled}>
              <input
                type="checkbox"
                checked={selectedAdapters.has(adapter.type)}
                disabled={!adapter.enabled}
                on:change={() => toggleAdapter(adapter.type)}
              />
              <span class="adapter-name">{adapter.name}</span>
              {#if !adapter.enabled}
                <span class="disabled-note">(Not configured)</span>
              {/if}
            </label>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Advanced options -->
    {#if selectedMode === 'incremental'}
      <div class="advanced-options">
        <label class="option-checkbox">
          <input type="checkbox" bind:checked={forceRescan} />
          <span>Force full scan (ignore cached timestamps)</span>
        </label>
      </div>
    {/if}

    <!-- Actions -->
    <div class="modal-actions">
      <button class="cancel-button" on:click={handleCancel}>Cancel</button>
      <button
        class="start-button"
        on:click={handleStart}
        disabled={selectedMode === 'custom' && selectedAdapters.size === 0}
      >
        Start Sync
      </button>
    </div>
  </div>
</div>

<style>
  .sync-mode-overlay {
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

  .sync-mode-modal {
    background: var(--background-primary);
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    width: 90%;
    max-width: 500px;
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
    font-size: 20px;
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

  .last-sync-info {
    padding: 12px 24px;
    background: var(--background-secondary);
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }

  .last-sync-info .label {
    color: var(--text-muted);
  }

  .last-sync-info .value {
    font-weight: 500;
  }

  .mode-selection {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .mode-option {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    background: var(--background-secondary);
    border: 2px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s;
  }

  .mode-option:hover {
    background: var(--background-modifier-hover);
  }

  .mode-option.selected {
    border-color: var(--interactive-accent);
    background: var(--background-primary-alt);
  }

  .mode-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    background: var(--background-primary);
    border-radius: 8px;
    color: var(--interactive-accent);
  }

  .mode-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .mode-title {
    font-weight: 500;
    font-size: 15px;
  }

  .mode-description {
    font-size: 13px;
    color: var(--text-muted);
  }

  .recommended-badge {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    font-size: 11px;
    font-weight: 500;
    padding: 4px 8px;
    border-radius: 4px;
    text-transform: uppercase;
  }

  .check-indicator {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--interactive-accent);
    opacity: 0;
    transition: opacity 0.2s;
  }

  .check-indicator.visible {
    opacity: 1;
  }

  .custom-options {
    padding: 0 24px 16px;
  }

  .custom-options h3 {
    font-size: 14px;
    font-weight: 500;
    margin: 0 0 12px 0;
    color: var(--text-muted);
  }

  .adapter-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .adapter-option {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: var(--background-secondary);
    border-radius: 6px;
    cursor: pointer;
  }

  .adapter-option.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .adapter-option input {
    margin: 0;
  }

  .adapter-name {
    flex: 1;
    font-size: 14px;
  }

  .disabled-note {
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
  }

  .advanced-options {
    padding: 0 24px 16px;
  }

  .option-checkbox {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--text-muted);
    cursor: pointer;
  }

  .option-checkbox input {
    margin: 0;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .cancel-button {
    padding: 10px 20px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
  }

  .cancel-button:hover {
    background: var(--background-modifier-hover);
  }

  .start-button {
    padding: 10px 24px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    font-size: 14px;
    transition: all 0.2s;
  }

  .start-button:hover:not(:disabled) {
    opacity: 0.9;
  }

  .start-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
