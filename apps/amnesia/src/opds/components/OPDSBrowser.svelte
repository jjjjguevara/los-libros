<script lang="ts">
  import { onMount } from 'svelte';
  import type AmnesiaPlugin from '../../main';
  import type { OPDSFeed, OPDSEntryType, OPDSAcquisitionEntry, OPDSNavigationEntry } from '../opds-types';
  import { OPDSClient } from '../opds-client';
  import {
    ArrowLeft,
    Download,
    RefreshCw,
    Folder,
    Book,
    Search,
    ChevronRight,
    AlertCircle
  } from 'lucide-svelte';

  export let plugin: AmnesiaPlugin;
  export let catalogUrl: string;

  let client: OPDSClient;
  let feed: OPDSFeed | null = null;
  let entries: OPDSEntryType[] = [];
  let loading = true;
  let error: string | null = null;
  let searchQuery = '';
  let downloading: Set<string> = new Set();
  let navigationStack: OPDSFeed[] = [];

  onMount(async () => {
    client = new OPDSClient(plugin.app);
    await loadFeed(catalogUrl);
  });

  async function loadFeed(url: string, pushToStack = true) {
    loading = true;
    error = null;

    try {
      if (pushToStack && feed) {
        navigationStack = [...navigationStack, feed];
      }

      feed = await client.fetchFeed(url);
      entries = client.getClassifiedEntries(feed);
      loading = false;
    } catch (e) {
      error = String(e);
      loading = false;
    }
  }

  async function goBack() {
    if (navigationStack.length > 0) {
      const previousFeed = navigationStack[navigationStack.length - 1];
      navigationStack = navigationStack.slice(0, -1);

      // Find the self link of the previous feed
      const selfLink = previousFeed.links.find(l => l.rel === 'self');
      if (selfLink) {
        await loadFeed(selfLink.href, false);
      }
    }
  }

  async function refresh() {
    if (feed) {
      const selfLink = feed.links.find(l => l.rel === 'self');
      const url = selfLink?.href || catalogUrl;
      await loadFeed(url, false);
    }
  }

  async function handleSearch() {
    if (!feed || !searchQuery.trim()) return;

    loading = true;
    error = null;

    try {
      const results = await client.search(feed, searchQuery);
      if (results) {
        navigationStack = [...navigationStack, feed];
        feed = results;
        entries = client.getClassifiedEntries(feed);
      } else {
        error = 'Search not supported by this catalog';
      }
      loading = false;
    } catch (e) {
      error = String(e);
      loading = false;
    }
  }

  async function navigateToEntry(entry: OPDSNavigationEntry) {
    await loadFeed(entry.navigationUrl);
  }

  async function downloadBook(entry: OPDSAcquisitionEntry) {
    downloading = new Set([...downloading, entry.id]);

    try {
      const filePath = await client.downloadBook(
        entry,
        plugin.settings.localBooksFolder
      );

      // Refresh library to pick up new book
      await plugin.libraryService.scan(plugin.settings.localBooksFolder);

      // Remove from downloading
      downloading.delete(entry.id);
      downloading = downloading;
    } catch (e) {
      console.error('Download failed:', e);
      downloading.delete(entry.id);
      downloading = downloading;
    }
  }

  function isNavigationEntry(entry: OPDSEntryType): entry is OPDSNavigationEntry {
    return entry.isNavigation;
  }

  function isAcquisitionEntry(entry: OPDSEntryType): entry is OPDSAcquisitionEntry {
    return !entry.isNavigation;
  }

  // Check if search is supported
  $: hasSearch = feed?.links.some(l => l.rel === 'search') ?? false;

  // Check if can navigate back
  $: canGoBack = navigationStack.length > 0;
</script>

<div class="opds-browser">
  <!-- Header -->
  <div class="opds-header">
    <div class="header-left">
      {#if canGoBack}
        <button class="clickable-icon" on:click={goBack}>
          <ArrowLeft size={18} />
        </button>
      {/if}
      <h3>{feed?.title ?? 'Loading...'}</h3>
    </div>
    <button class="clickable-icon" on:click={refresh} disabled={loading}>
      <RefreshCw size={18} class={loading ? 'spinning' : ''} />
    </button>
  </div>

  <!-- Search -->
  {#if hasSearch}
    <form class="opds-search" on:submit|preventDefault={handleSearch}>
      <Search size={16} />
      <input
        type="text"
        placeholder="Search catalog..."
        bind:value={searchQuery}
      />
      <button type="submit" disabled={loading || !searchQuery.trim()}>
        Search
      </button>
    </form>
  {/if}

  <!-- Content -->
  <div class="opds-content">
    {#if loading}
      <div class="opds-loading">
        <div class="amnesia-spinner"></div>
        <p>Loading catalog...</p>
      </div>
    {:else if error}
      <div class="opds-error">
        <AlertCircle size={32} />
        <p>Failed to load catalog</p>
        <p class="error-details">{error}</p>
        <button on:click={refresh}>Retry</button>
      </div>
    {:else if entries.length === 0}
      <div class="opds-empty">
        <p>No entries found</p>
      </div>
    {:else}
      <div class="opds-entries">
        {#each entries as entry (entry.id)}
          {#if isNavigationEntry(entry)}
            <button
              class="opds-entry navigation"
              on:click={() => navigateToEntry(entry)}
            >
              <div class="entry-icon">
                <Folder size={24} />
              </div>
              <div class="entry-info">
                <div class="entry-title">{entry.title}</div>
                {#if entry.summary}
                  <div class="entry-summary">{entry.summary}</div>
                {/if}
              </div>
              <ChevronRight size={18} />
            </button>
          {:else if isAcquisitionEntry(entry)}
            <div class="opds-entry acquisition">
              {#if entry.thumbnailUrl}
                <img
                  src={entry.thumbnailUrl}
                  alt={entry.title}
                  class="entry-cover"
                  loading="lazy"
                />
              {:else}
                <div class="entry-icon">
                  <Book size={24} />
                </div>
              {/if}
              <div class="entry-info">
                <div class="entry-title">{entry.title}</div>
                {#if entry.author}
                  <div class="entry-author">{entry.author}</div>
                {/if}
                {#if entry.summary}
                  <div class="entry-summary">{entry.summary}</div>
                {/if}
                <div class="entry-formats">
                  {#each entry.formats as format}
                    <span class="format-badge">
                      {format.type.split('/').pop()?.split('+')[0] ?? 'unknown'}
                    </span>
                  {/each}
                </div>
              </div>
              <button
                class="download-btn"
                on:click={() => downloadBook(entry)}
                disabled={downloading.has(entry.id)}
              >
                {#if downloading.has(entry.id)}
                  <RefreshCw size={18} class="spinning" />
                {:else}
                  <Download size={18} />
                {/if}
              </button>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .opds-browser {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .opds-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .opds-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .opds-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .opds-search input {
    flex: 1;
    background: var(--background-secondary);
    border: none;
    border-radius: var(--radius-s);
    padding: 6px 10px;
    font-size: 0.875rem;
  }

  .opds-search button {
    padding: 6px 12px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: var(--radius-s);
    cursor: pointer;
  }

  .opds-search button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .opds-content {
    flex: 1;
    overflow-y: auto;
  }

  .opds-loading,
  .opds-error,
  .opds-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    text-align: center;
    color: var(--text-muted);
    padding: 24px;
  }

  .error-details {
    font-size: 0.875rem;
    margin-top: 8px;
  }

  .opds-entries {
    padding: 8px;
  }

  .opds-entry {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    margin-bottom: 8px;
    background: var(--background-secondary);
    border-radius: var(--radius-s);
    cursor: pointer;
    transition: background 0.2s ease;
  }

  .opds-entry.navigation {
    width: 100%;
    text-align: left;
    border: none;
    align-items: center;
  }

  .opds-entry:hover {
    background: var(--background-modifier-hover);
  }

  .entry-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    background: var(--background-primary);
    border-radius: var(--radius-s);
    color: var(--text-muted);
  }

  .entry-cover {
    width: 48px;
    height: 72px;
    object-fit: cover;
    border-radius: 4px;
  }

  .entry-info {
    flex: 1;
    min-width: 0;
  }

  .entry-title {
    font-weight: 500;
    margin-bottom: 4px;
  }

  .entry-author {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin-bottom: 4px;
  }

  .entry-summary {
    font-size: 0.75rem;
    color: var(--text-faint);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .entry-formats {
    display: flex;
    gap: 4px;
    margin-top: 8px;
  }

  .format-badge {
    font-size: 0.625rem;
    text-transform: uppercase;
    padding: 2px 6px;
    background: var(--background-primary);
    border-radius: 4px;
    color: var(--text-muted);
  }

  .download-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 50%;
    cursor: pointer;
    flex-shrink: 0;
  }

  .download-btn:hover {
    filter: brightness(1.1);
  }

  .download-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
