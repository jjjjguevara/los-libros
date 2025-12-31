<script lang="ts">
  /**
   * Tab Bar Component
   *
   * Displays tabs for switching between highlights, bookmarks, notes, and images.
   */
  import { createEventDispatcher } from 'svelte';
  import type { SidebarTab } from '../sidebar.store';
  import {
    Highlighter,
    BookmarkIcon,
    StickyNote,
    Image,
  } from 'lucide-svelte';

  export let activeTab: SidebarTab = 'highlights';
  export let highlightsCount = 0;
  export let bookmarksCount = 0;
  export let notesCount = 0;

  const dispatch = createEventDispatcher<{
    tabChange: { tab: SidebarTab };
  }>();

  function selectTab(tab: SidebarTab) {
    dispatch('tabChange', { tab });
  }
</script>

<div class="tab-bar">
  <button
    class="tab"
    class:active={activeTab === 'highlights'}
    on:click={() => selectTab('highlights')}
    title="Highlights"
  >
    <Highlighter size={16} />
    {#if highlightsCount > 0}
      <span class="badge">{highlightsCount}</span>
    {/if}
  </button>

  <button
    class="tab"
    class:active={activeTab === 'bookmarks'}
    on:click={() => selectTab('bookmarks')}
    title="Bookmarks"
  >
    <BookmarkIcon size={16} />
    {#if bookmarksCount > 0}
      <span class="badge">{bookmarksCount}</span>
    {/if}
  </button>

  <button
    class="tab"
    class:active={activeTab === 'notes'}
    on:click={() => selectTab('notes')}
    title="Notes"
  >
    <StickyNote size={16} />
    {#if notesCount > 0}
      <span class="badge">{notesCount}</span>
    {/if}
  </button>

  <button
    class="tab"
    class:active={activeTab === 'images'}
    on:click={() => selectTab('images')}
    title="Images"
  >
    <Image size={16} />
  </button>
</div>

<style>
  .tab-bar {
    display: flex;
    padding: 4px 8px;
    gap: 2px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 8px 4px;
    background: transparent;
    border: none;
    border-radius: var(--radius-s);
    cursor: pointer;
    color: var(--text-muted);
    transition: all 0.15s ease;
    position: relative;
  }

  .tab:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .tab.active {
    background: var(--background-secondary);
    color: var(--text-normal);
  }

  .badge {
    font-size: 0.65rem;
    min-width: 16px;
    padding: 1px 4px;
    background: var(--background-modifier-border);
    border-radius: 8px;
    text-align: center;
  }

  .tab.active .badge {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }
</style>
