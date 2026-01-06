<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { SyncConflict, ConflictStrategy } from '../../sync/types';
  import type { ConflictGroup, ResolutionResult } from '../../sync/conflict-resolution-manager';

  export let conflicts: SyncConflict[] = [];
  export let groups: ConflictGroup[] = [];
  export let currentIndex = 0;

  const dispatch = createEventDispatcher<{
    resolve: ResolutionResult;
    resolveAll: { strategy: ConflictStrategy };
    skip: { conflictId: string };
    close: void;
  }>();

  // Current conflict
  $: currentConflict = conflicts[currentIndex];
  $: hasNext = currentIndex < conflicts.length - 1;
  $: hasPrev = currentIndex > 0;
  $: progress = conflicts.length > 0 ? ((currentIndex + 1) / conflicts.length) * 100 : 0;

  // Resolution options
  let applyToSimilar = false;
  let rememberChoice = false;
  let selectedStrategy: ConflictStrategy = 'prefer-remote';

  // View mode
  type ViewMode = 'single' | 'batch';
  let viewMode: ViewMode = conflicts.length > 5 ? 'batch' : 'single';

  // Strategy descriptions
  const strategyDescriptions: Record<ConflictStrategy, string> = {
    'prefer-local': 'Keep your local version',
    'prefer-remote': 'Use the server version',
    'last-write-wins': 'Use whichever was modified more recently',
    merge: 'Combine both versions (for lists/tags)',
    'ask-user': 'Ask for each conflict',
  };

  // Format value for display
  function formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    return String(value);
  }

  // Format timestamp
  function formatTime(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  // Get field display name
  function getFieldName(conflict: SyncConflict): string {
    if (conflict.field) {
      return conflict.field
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (str) => str.toUpperCase());
    }
    return conflict.entityType
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase());
  }

  // Handle resolve
  function handleResolve(strategy: ConflictStrategy) {
    if (!currentConflict) return;

    const resolvedValue = computeResolvedValue(currentConflict, strategy);

    dispatch('resolve', {
      conflictId: currentConflict.id,
      strategy,
      resolvedValue,
      applyToSimilar,
      rememberChoice,
    });

    // Move to next or close
    if (hasNext) {
      currentIndex++;
    } else {
      dispatch('close');
    }
  }

  // Compute resolved value based on strategy
  function computeResolvedValue(conflict: SyncConflict, strategy: ConflictStrategy): unknown {
    switch (strategy) {
      case 'prefer-local':
        return conflict.localValue;
      case 'prefer-remote':
        return conflict.remoteValue;
      case 'last-write-wins':
        return conflict.localChange.timestamp >= conflict.remoteChange.timestamp
          ? conflict.localValue
          : conflict.remoteValue;
      case 'merge':
        if (Array.isArray(conflict.localValue) && Array.isArray(conflict.remoteValue)) {
          return [...new Set([...conflict.localValue, ...conflict.remoteValue])];
        }
        return conflict.remoteValue;
      default:
        return conflict.remoteValue;
    }
  }

  // Handle resolve all
  function handleResolveAll(strategy: ConflictStrategy) {
    dispatch('resolveAll', { strategy });
    dispatch('close');
  }

  // Handle skip
  function handleSkip() {
    if (!currentConflict) return;
    dispatch('skip', { conflictId: currentConflict.id });

    if (hasNext) {
      currentIndex++;
    } else {
      dispatch('close');
    }
  }

  // Handle navigation
  function goToPrev() {
    if (hasPrev) currentIndex--;
  }

  function goToNext() {
    if (hasNext) currentIndex++;
  }

  // Handle keyboard navigation
  function handleKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowLeft':
        goToPrev();
        break;
      case 'ArrowRight':
        goToNext();
        break;
      case 'Escape':
        dispatch('close');
        break;
      case '1':
        handleResolve('prefer-local');
        break;
      case '2':
        handleResolve('prefer-remote');
        break;
      case '3':
        handleResolve('merge');
        break;
    }
  }

  onMount(() => {
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  });
</script>

<div class="conflict-modal-overlay">
  <div class="conflict-modal">
    <!-- Header -->
    <div class="modal-header">
      <h2>Resolve Conflicts</h2>
      <div class="conflict-count">
        {currentIndex + 1} of {conflicts.length} conflicts
      </div>
      <button class="close-button" on:click={() => dispatch('close')}>
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <!-- Progress bar -->
    <div class="progress-bar">
      <div class="progress-fill" style="width: {progress}%"></div>
    </div>

    <!-- View mode tabs -->
    <div class="view-tabs">
      <button
        class="tab"
        class:active={viewMode === 'single'}
        on:click={() => (viewMode = 'single')}
      >
        One at a time
      </button>
      <button
        class="tab"
        class:active={viewMode === 'batch'}
        on:click={() => (viewMode = 'batch')}
      >
        Batch resolve
      </button>
    </div>

    {#if viewMode === 'single' && currentConflict}
      <!-- Single conflict view -->
      <div class="conflict-content">
        <div class="conflict-header">
          <span class="entity-type">{currentConflict.entityType}</span>
          <span class="field-name">{getFieldName(currentConflict)}</span>
        </div>

        <div class="comparison">
          <!-- Local side -->
          <div class="side local">
            <div class="side-header">
              <span class="side-label">Local (Your version)</span>
              <span class="timestamp">{formatTime(currentConflict.localChange.timestamp)}</span>
            </div>
            <div class="value-display">
              <pre>{formatValue(currentConflict.localValue)}</pre>
            </div>
            <button
              class="choose-button local"
              on:click={() => handleResolve('prefer-local')}
            >
              Keep Local
            </button>
          </div>

          <!-- Divider -->
          <div class="divider">
            <span>VS</span>
          </div>

          <!-- Remote side -->
          <div class="side remote">
            <div class="side-header">
              <span class="side-label">Remote (Server version)</span>
              <span class="timestamp">{formatTime(currentConflict.remoteChange.timestamp)}</span>
            </div>
            <div class="value-display">
              <pre>{formatValue(currentConflict.remoteValue)}</pre>
            </div>
            <button
              class="choose-button remote"
              on:click={() => handleResolve('prefer-remote')}
            >
              Keep Remote
            </button>
          </div>
        </div>

        <!-- Additional options -->
        <div class="additional-options">
          <button class="option-button" on:click={() => handleResolve('merge')}>
            Merge Both
          </button>
          <button class="option-button" on:click={() => handleResolve('last-write-wins')}>
            Use Most Recent
          </button>
          <button class="option-button secondary" on:click={handleSkip}>
            Skip for Now
          </button>
        </div>

        <!-- Checkboxes -->
        <div class="checkbox-group">
          <label>
            <input type="checkbox" bind:checked={applyToSimilar} />
            Apply to similar conflicts ({groups.find(g => g.key === (currentConflict.field || currentConflict.entityType))?.conflicts.length || 0} more)
          </label>
          <label>
            <input type="checkbox" bind:checked={rememberChoice} />
            Remember this choice for future syncs
          </label>
        </div>
      </div>

      <!-- Navigation -->
      <div class="navigation">
        <button class="nav-button" disabled={!hasPrev} on:click={goToPrev}>
          Previous
        </button>
        <div class="keyboard-hints">
          <span>1: Local</span>
          <span>2: Remote</span>
          <span>3: Merge</span>
          <span>Arrow keys: Navigate</span>
        </div>
        <button class="nav-button" disabled={!hasNext} on:click={goToNext}>
          Next
        </button>
      </div>
    {:else if viewMode === 'batch'}
      <!-- Batch view -->
      <div class="batch-content">
        <p class="batch-description">
          You have {conflicts.length} conflicts. Choose how to resolve them in bulk:
        </p>

        <div class="batch-groups">
          {#each groups as group}
            <div class="batch-group">
              <div class="group-header">
                <span class="group-name">{group.key}</span>
                <span class="group-count">{group.conflicts.length} conflicts</span>
              </div>
              <div class="group-actions">
                <button on:click={() => handleResolveAll('prefer-local')}>
                  All Local
                </button>
                <button on:click={() => handleResolveAll('prefer-remote')}>
                  All Remote
                </button>
                <button on:click={() => handleResolveAll('merge')}>
                  Merge All
                </button>
                <button on:click={() => handleResolveAll('last-write-wins')}>
                  Most Recent
                </button>
              </div>
            </div>
          {/each}
        </div>

        <div class="batch-actions">
          <div class="strategy-select">
            <label for="batch-strategy">Resolve all with:</label>
            <select id="batch-strategy" bind:value={selectedStrategy}>
              <option value="prefer-local">Prefer Local</option>
              <option value="prefer-remote">Prefer Remote</option>
              <option value="merge">Merge</option>
              <option value="last-write-wins">Last Write Wins</option>
            </select>
          </div>
          <button class="batch-resolve-button" on:click={() => handleResolveAll(selectedStrategy)}>
            Resolve All ({conflicts.length})
          </button>
        </div>
      </div>
    {:else}
      <div class="no-conflicts">
        <p>No conflicts to resolve!</p>
        <button on:click={() => dispatch('close')}>Close</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .conflict-modal-overlay {
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

  .conflict-modal {
    background: var(--background-primary);
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    width: 90%;
    max-width: 900px;
    max-height: 90vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .conflict-count {
    font-size: 14px;
    color: var(--text-muted);
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

  .progress-bar {
    height: 4px;
    background: var(--background-modifier-border);
  }

  .progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.3s ease;
  }

  .view-tabs {
    display: flex;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .tab {
    flex: 1;
    padding: 12px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    color: var(--text-muted);
    transition: all 0.2s;
  }

  .tab:hover {
    background: var(--background-modifier-hover);
  }

  .tab.active {
    color: var(--interactive-accent);
    border-bottom: 2px solid var(--interactive-accent);
  }

  .conflict-content {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .conflict-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
  }

  .entity-type {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    text-transform: uppercase;
  }

  .field-name {
    font-size: 16px;
    font-weight: 500;
  }

  .comparison {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 16px;
    margin-bottom: 20px;
  }

  .side {
    background: var(--background-secondary);
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .side.local {
    border: 2px solid var(--color-blue);
  }

  .side.remote {
    border: 2px solid var(--color-green);
  }

  .side-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .side-label {
    font-weight: 500;
    font-size: 14px;
  }

  .timestamp {
    font-size: 12px;
    color: var(--text-muted);
  }

  .value-display {
    background: var(--background-primary);
    border-radius: 4px;
    padding: 12px;
    min-height: 100px;
    max-height: 200px;
    overflow: auto;
  }

  .value-display pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-monospace);
    font-size: 13px;
  }

  .choose-button {
    padding: 10px 16px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s;
  }

  .choose-button.local {
    background: var(--color-blue);
    color: white;
  }

  .choose-button.remote {
    background: var(--color-green);
    color: white;
  }

  .choose-button:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  .divider {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-muted);
  }

  .additional-options {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }

  .option-button {
    flex: 1;
    padding: 10px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
  }

  .option-button:hover {
    background: var(--background-modifier-hover);
  }

  .option-button.secondary {
    color: var(--text-muted);
  }

  .checkbox-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .checkbox-group label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--text-muted);
    cursor: pointer;
  }

  .navigation {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .nav-button {
    padding: 8px 16px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
  }

  .nav-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .keyboard-hints {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .keyboard-hints span {
    background: var(--background-secondary);
    padding: 4px 8px;
    border-radius: 4px;
  }

  /* Batch view styles */
  .batch-content {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .batch-description {
    margin-bottom: 20px;
    color: var(--text-muted);
  }

  .batch-groups {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 20px;
  }

  .batch-group {
    background: var(--background-secondary);
    border-radius: 8px;
    padding: 16px;
  }

  .group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .group-name {
    font-weight: 500;
    text-transform: capitalize;
  }

  .group-count {
    font-size: 13px;
    color: var(--text-muted);
  }

  .group-actions {
    display: flex;
    gap: 8px;
  }

  .group-actions button {
    flex: 1;
    padding: 8px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s;
  }

  .group-actions button:hover {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-color: var(--interactive-accent);
  }

  .batch-actions {
    display: flex;
    align-items: center;
    gap: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .strategy-select {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .strategy-select label {
    font-size: 14px;
  }

  .strategy-select select {
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    font-size: 14px;
  }

  .batch-resolve-button {
    padding: 12px 24px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    font-size: 14px;
    margin-left: auto;
    transition: all 0.2s;
  }

  .batch-resolve-button:hover {
    opacity: 0.9;
  }

  .no-conflicts {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    gap: 16px;
  }

  .no-conflicts p {
    font-size: 16px;
    color: var(--text-muted);
  }

  .no-conflicts button {
    padding: 10px 24px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
  }
</style>
