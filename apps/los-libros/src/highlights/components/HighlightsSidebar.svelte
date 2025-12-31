<script lang="ts">
  import { onDestroy } from 'svelte';
  import type LosLibrosPlugin from '../../main';
  import type { Store } from '../../helpers/store';
  import type { HighlightState, HighlightAction } from '../highlight-store';
  import type { Highlight, Book, HighlightColor } from '../../library/types';
  import { Search, Trash2, ExternalLink, ChevronDown, ChevronRight } from 'lucide-svelte';

  export let plugin: LosLibrosPlugin;
  export let store: Store<HighlightState, HighlightAction>;

  let state: HighlightState;
  let searchQuery = '';
  let selectedBookId: string | null = null;
  let expandedBooks = new Set<string>();

  $: state = $store;
  $: allHighlights = Object.entries(state?.highlights ?? {});
  $: filteredHighlights = filterHighlights(allHighlights, searchQuery);
  $: books = plugin.libraryStore.getValue().books;

  // Get book by ID
  function getBook(bookId: string): Book | undefined {
    return books.find(b => b.id === bookId);
  }

  // Filter highlights by search query
  function filterHighlights(
    highlights: [string, Highlight[]][],
    query: string
  ): [string, Highlight[]][] {
    if (!query.trim()) {
      return highlights;
    }

    const q = query.toLowerCase();
    return highlights
      .map(([bookId, bookHighlights]) => {
        const filtered = bookHighlights.filter(h =>
          h.text.toLowerCase().includes(q) ||
          h.annotation?.toLowerCase().includes(q)
        );
        return [bookId, filtered] as [string, Highlight[]];
      })
      .filter(([_, bookHighlights]) => bookHighlights.length > 0);
  }

  // Toggle book expansion
  function toggleBook(bookId: string) {
    if (expandedBooks.has(bookId)) {
      expandedBooks.delete(bookId);
    } else {
      expandedBooks.add(bookId);
    }
    expandedBooks = expandedBooks; // Trigger reactivity
  }

  // Get color class for highlight
  function getColorStyle(color: HighlightColor): string {
    const colors: Record<HighlightColor, string> = {
      yellow: '#fef3c7',
      green: '#d1fae5',
      blue: '#dbeafe',
      pink: '#fce7f3',
      purple: '#ede9fe',
    };
    return `border-left-color: ${colors[color]};`;
  }

  // Navigate to highlight in reader
  async function goToHighlight(highlight: Highlight) {
    const book = getBook(highlight.bookId);
    if (book?.localPath) {
      await plugin.openBook(book.localPath);
      // The reader will navigate to the CFI
    }
  }

  // Open atomic note
  async function openAtomicNote(highlight: Highlight) {
    if (highlight.atomicNotePath) {
      const file = plugin.app.vault.getAbstractFileByPath(highlight.atomicNotePath);
      if (file) {
        await plugin.app.workspace.getLeaf('tab').openFile(file as any);
      }
    }
  }

  // Delete highlight
  async function deleteHighlight(highlight: Highlight) {
    await plugin.highlightService.deleteHighlight(highlight.bookId, highlight.id);
  }

  // Get total highlight count
  $: totalCount = allHighlights.reduce((sum, [_, h]) => sum + h.length, 0);
</script>

<div class="highlights-sidebar">
  <div class="sidebar-header">
    <h3>Highlights</h3>
    <span class="highlight-count">{totalCount}</span>
  </div>

  <div class="search-box">
    <Search size={16} />
    <input
      type="text"
      placeholder="Search highlights..."
      bind:value={searchQuery}
    />
  </div>

  <div class="highlights-list">
    {#if filteredHighlights.length === 0}
      <div class="empty-state">
        {#if searchQuery}
          <p>No highlights match your search</p>
        {:else}
          <p>No highlights yet</p>
          <p class="empty-hint">Select text while reading to create highlights</p>
        {/if}
      </div>
    {:else}
      {#each filteredHighlights as [bookId, highlights] (bookId)}
        {@const book = getBook(bookId)}
        {#if book}
          <div class="book-group">
            <button
              class="book-header"
              on:click={() => toggleBook(bookId)}
            >
              {#if expandedBooks.has(bookId)}
                <ChevronDown size={16} />
              {:else}
                <ChevronRight size={16} />
              {/if}
              <span class="book-title">{book.title}</span>
              <span class="book-count">{highlights.length}</span>
            </button>

            {#if expandedBooks.has(bookId)}
              <div class="book-highlights">
                {#each highlights as highlight (highlight.id)}
                  <div
                    class="highlight-card"
                    style={getColorStyle(highlight.color)}
                  >
                    <div class="highlight-text">
                      "{highlight.text}"
                    </div>

                    {#if highlight.chapter}
                      <div class="highlight-meta">
                        {highlight.chapter}
                        {#if highlight.pagePercent}
                          — {highlight.pagePercent}%
                        {/if}
                      </div>
                    {/if}

                    {#if highlight.annotation}
                      <div class="highlight-annotation">
                        {highlight.annotation}
                      </div>
                    {/if}

                    <div class="highlight-actions">
                      <button
                        class="action-btn"
                        title="Go to highlight"
                        on:click={() => goToHighlight(highlight)}
                      >
                        <ExternalLink size={14} />
                      </button>
                      <button
                        class="action-btn danger"
                        title="Delete highlight"
                        on:click={() => deleteHighlight(highlight)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  </div>
</div>

<style>
  .highlights-sidebar {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: 12px;
  }

  .sidebar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .sidebar-header h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .highlight-count {
    background: var(--background-secondary);
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--background-secondary);
    border-radius: var(--radius-s);
    padding: 8px 12px;
    margin-bottom: 12px;
  }

  .search-box input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 0.875rem;
    color: var(--text-normal);
  }

  .search-box input::placeholder {
    color: var(--text-muted);
  }

  .highlights-list {
    flex: 1;
    overflow-y: auto;
  }

  .empty-state {
    text-align: center;
    padding: 24px;
    color: var(--text-muted);
  }

  .empty-hint {
    font-size: 0.875rem;
    margin-top: 8px;
  }

  .book-group {
    margin-bottom: 8px;
  }

  .book-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px;
    background: var(--background-secondary);
    border: none;
    border-radius: var(--radius-s);
    cursor: pointer;
    text-align: left;
  }

  .book-header:hover {
    background: var(--background-modifier-hover);
  }

  .book-title {
    flex: 1;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .book-count {
    font-size: 0.75rem;
    color: var(--text-muted);
    background: var(--background-primary);
    padding: 2px 6px;
    border-radius: 8px;
  }

  .book-highlights {
    padding-left: 12px;
    margin-top: 8px;
  }

  .highlight-card {
    padding: 12px;
    margin-bottom: 8px;
    background: var(--background-secondary);
    border-radius: var(--radius-s);
    border-left: 4px solid;
  }

  .highlight-text {
    font-style: italic;
    margin-bottom: 8px;
    line-height: 1.5;
  }

  .highlight-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-bottom: 4px;
  }

  .highlight-annotation {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .highlight-actions {
    display: flex;
    gap: 4px;
    margin-top: 8px;
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .highlight-card:hover .highlight-actions {
    opacity: 1;
  }

  .action-btn {
    padding: 4px;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-muted);
  }

  .action-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .action-btn.danger:hover {
    color: var(--text-error);
  }
</style>
