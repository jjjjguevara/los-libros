<script lang="ts">
  /**
   * Controls Bar
   *
   * View-specific controls that appear next to the ViewModeSwitcher.
   * Shows different buttons based on the active tab.
   */
  import { createEventDispatcher } from 'svelte';
  import { sidebarStore, type SidebarTab } from '../sidebar.store';
  import {
    Search,
    X,
    Settings,
    Download,
    Filter,
  } from 'lucide-svelte';

  export let activeTab: SidebarTab = 'highlights';
  export let showSearch = false;
  export let hasActiveBook = false;

  const dispatch = createEventDispatcher<{
    toggleSearch: void;
    openSettings: void;
    exportData: void;
    toggleFilter: void;
  }>();

  function handleToggleSearch() {
    sidebarStore.toggleSearch();
  }
</script>

<div class="controls-bar">
  {#if activeTab === 'highlights'}
    <button
      class="control-btn"
      class:active={showSearch}
      on:click={handleToggleSearch}
      title="Search highlights"
      disabled={!hasActiveBook}
    >
      {#if showSearch}
        <X size={14} />
      {:else}
        <Search size={14} />
      {/if}
    </button>
    <button
      class="control-btn"
      on:click={() => dispatch('toggleFilter')}
      title="Filter by color"
      disabled={!hasActiveBook}
    >
      <Filter size={14} />
    </button>
  {:else if activeTab === 'bookmarks'}
    <button
      class="control-btn"
      class:active={showSearch}
      on:click={handleToggleSearch}
      title="Search bookmarks"
      disabled={!hasActiveBook}
    >
      {#if showSearch}
        <X size={14} />
      {:else}
        <Search size={14} />
      {/if}
    </button>
  {:else if activeTab === 'notes'}
    <button
      class="control-btn"
      class:active={showSearch}
      on:click={handleToggleSearch}
      title="Search notes"
      disabled={!hasActiveBook}
    >
      {#if showSearch}
        <X size={14} />
      {:else}
        <Search size={14} />
      {/if}
    </button>
    <button
      class="control-btn"
      on:click={() => dispatch('exportData')}
      title="Export notes"
      disabled={!hasActiveBook}
    >
      <Download size={14} />
    </button>
  {:else if activeTab === 'images'}
    <!-- Images tab has fewer controls -->
  {/if}
</div>

<style>
  .controls-bar {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .control-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    background: transparent;
    border: none !important;
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
    outline: none !important;
  }

  .control-btn:hover:not(:disabled) {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .control-btn.active {
    background: var(--background-modifier-border);
    color: var(--text-normal);
  }

  .control-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .control-btn:focus,
  .control-btn:focus-visible {
    outline: none !important;
    box-shadow: none !important;
  }
</style>
