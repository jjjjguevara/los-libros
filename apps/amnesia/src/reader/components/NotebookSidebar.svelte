<script lang="ts">
  /**
   * NotebookSidebar
   *
   * Reading notebook sidebar for viewing highlights, bookmarks, notes, and images.
   * Displayed within the reader context for quick navigation.
   */
  import { createEventDispatcher } from 'svelte';
  import type { Highlight, HighlightColor } from '../../library/types';
  import type { Bookmark, ReadingNote } from '../../bookmarks/bookmark-types';
  import {
    Search,
    Trash2,
    Edit3,
    Highlighter,
    BookmarkIcon,
    StickyNote,
    ChevronDown,
    ChevronRight,
    X,
    Image as ImageIcon,
    ExternalLink,
  } from 'lucide-svelte';

  export let highlights: Highlight[] = [];
  export let bookmarks: Bookmark[] = [];
  export let notes: ReadingNote[] = [];
  export let bookPath: string = '';
  export let bookTitle: string = '';
  export let initialTab: 'highlights' | 'bookmarks' | 'notes' | 'images' = 'highlights';

  type Tab = 'highlights' | 'bookmarks' | 'notes' | 'images';
  let activeTab: Tab = initialTab;

  // Update active tab when initialTab prop changes (e.g., when opened from different buttons)
  $: if (initialTab) activeTab = initialTab;
  let searchQuery = '';
  let expandedChapters = new Set<string>();

  const dispatch = createEventDispatcher<{
    close: void;
    navigateTo: { cfi: string };
    editHighlight: { highlight: Highlight };
    deleteHighlight: { id: string };
    editBookmark: { bookmark: Bookmark };
    deleteBookmark: { id: string };
    editNote: { note: ReadingNote };
    deleteNote: { id: string };
    openImages: { bookPath: string; bookTitle: string };
  }>();

  // Filter items by search query
  $: filteredHighlights = filterHighlights(highlights, searchQuery);
  $: filteredBookmarks = filterBookmarks(bookmarks, searchQuery);
  $: filteredNotes = filterNotes(notes, searchQuery);

  // Group by chapter
  $: highlightsByChapter = groupByChapter(filteredHighlights, 'chapter');
  $: bookmarksByChapter = groupByChapter(filteredBookmarks, 'chapter');
  $: notesByChapter = groupByChapter(filteredNotes, 'chapter');

  // Auto-expand all chapters on load for easier navigation
  $: {
    const allChapters = new Set([
      ...Object.keys(highlightsByChapter),
      ...Object.keys(bookmarksByChapter),
      ...Object.keys(notesByChapter),
    ]);
    if (allChapters.size > 0 && expandedChapters.size === 0) {
      expandedChapters = allChapters;
    }
  }

  function filterHighlights(items: Highlight[], query: string): Highlight[] {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(h =>
      h.text.toLowerCase().includes(q) ||
      h.annotation?.toLowerCase().includes(q) ||
      h.chapter?.toLowerCase().includes(q)
    );
  }

  function filterBookmarks(items: Bookmark[], query: string): Bookmark[] {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(b =>
      b.name?.toLowerCase().includes(q) ||
      b.chapter?.toLowerCase().includes(q)
    );
  }

  function filterNotes(items: ReadingNote[], query: string): ReadingNote[] {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(n =>
      n.content.toLowerCase().includes(q) ||
      n.chapter?.toLowerCase().includes(q) ||
      n.tags?.some(t => t.toLowerCase().includes(q))
    );
  }

  function groupByChapter<T extends { chapter?: string }>(
    items: T[],
    _key: string
  ): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const item of items) {
      const chapter = item.chapter || 'Unknown Chapter';
      if (!grouped.has(chapter)) {
        grouped.set(chapter, []);
      }
      grouped.get(chapter)!.push(item);
    }
    return grouped;
  }

  function toggleChapter(chapter: string) {
    if (expandedChapters.has(chapter)) {
      expandedChapters.delete(chapter);
    } else {
      expandedChapters.add(chapter);
    }
    expandedChapters = expandedChapters;
  }

  function getHighlightColorStyle(color: HighlightColor): string {
    const colors: Record<HighlightColor, string> = {
      yellow: '#fef3c7',
      green: '#d1fae5',
      blue: '#dbeafe',
      pink: '#fce7f3',
      purple: '#ede9fe',
    };
    return `border-left-color: ${colors[color]};`;
  }

  function navigateTo(cfi: string, text?: string) {
    dispatch('navigateTo', { cfi, text });
  }

  function formatDate(date: Date): string {
    return new Date(date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  }
</script>

<div class="notebook-sidebar">
  <div class="sidebar-header">
    <div class="tab-bar">
      <button
        class="tab"
        class:active={activeTab === 'highlights'}
        on:click={() => (activeTab = 'highlights')}
      >
        <Highlighter size={16} />
        <span>Highlights</span>
        <span class="count">{highlights.length}</span>
      </button>
      <button
        class="tab"
        class:active={activeTab === 'bookmarks'}
        on:click={() => (activeTab = 'bookmarks')}
      >
        <BookmarkIcon size={16} />
        <span>Bookmarks</span>
        <span class="count">{bookmarks.length}</span>
      </button>
      <button
        class="tab"
        class:active={activeTab === 'notes'}
        on:click={() => (activeTab = 'notes')}
      >
        <StickyNote size={16} />
        <span>Notes</span>
        <span class="count">{notes.length}</span>
      </button>
      <button
        class="tab"
        class:active={activeTab === 'images'}
        on:click={() => (activeTab = 'images')}
      >
        <ImageIcon size={16} />
        <span>Images</span>
      </button>
    </div>
    <button class="close-btn" on:click={() => dispatch('close')} title="Close">
      <X size={18} />
    </button>
  </div>

  <div class="search-box">
    <Search size={16} />
    <input
      type="text"
      placeholder="Search..."
      bind:value={searchQuery}
    />
  </div>

  <div class="content-list">
    {#if activeTab === 'highlights'}
      {#if filteredHighlights.length === 0}
        <div class="empty-state">
          {#if searchQuery}
            <p>No highlights match your search</p>
          {:else}
            <p>No highlights yet</p>
            <p class="hint">Select text while reading to create highlights</p>
          {/if}
        </div>
      {:else}
        {#each [...highlightsByChapter] as [chapter, chapterHighlights] (chapter)}
          <div class="chapter-group">
            <button
              class="chapter-header"
              on:click={() => toggleChapter(chapter)}
            >
              {#if expandedChapters.has(chapter)}
                <ChevronDown size={16} />
              {:else}
                <ChevronRight size={16} />
              {/if}
              <span class="chapter-name">{chapter}</span>
              <span class="chapter-count">{chapterHighlights.length}</span>
            </button>

            {#if expandedChapters.has(chapter)}
              <div class="chapter-items">
                {#each chapterHighlights as highlight (highlight.id)}
                  <div
                    class="item-card highlight-card"
                    style={getHighlightColorStyle(highlight.color)}
                    role="button"
                    tabindex="0"
                    on:click={() => navigateTo(highlight.cfi, highlight.text)}
                    on:keydown={(e) => e.key === 'Enter' && navigateTo(highlight.cfi, highlight.text)}
                  >
                    <div class="item-text">"{truncateText(highlight.text, 150)}"</div>
                    {#if highlight.annotation}
                      <div class="item-annotation">{truncateText(highlight.annotation, 100)}</div>
                    {/if}
                    <div class="item-meta">
                      {formatDate(highlight.createdAt)}
                      {#if highlight.pagePercent}
                        <span class="separator">-</span>
                        {highlight.pagePercent}%
                      {/if}
                    </div>
                    <div class="item-actions">
                      <button
                        class="action-btn"
                        title="Edit"
                        on:click|stopPropagation={() => dispatch('editHighlight', { highlight })}
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        class="action-btn danger"
                        title="Delete"
                        on:click|stopPropagation={() => dispatch('deleteHighlight', { id: highlight.id })}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    {:else if activeTab === 'bookmarks'}
      {#if filteredBookmarks.length === 0}
        <div class="empty-state">
          {#if searchQuery}
            <p>No bookmarks match your search</p>
          {:else}
            <p>No bookmarks yet</p>
            <p class="hint">Tap the bookmark icon to save your place</p>
          {/if}
        </div>
      {:else}
        {#each [...bookmarksByChapter] as [chapter, chapterBookmarks] (chapter)}
          <div class="chapter-group">
            <button
              class="chapter-header"
              on:click={() => toggleChapter(chapter)}
            >
              {#if expandedChapters.has(chapter)}
                <ChevronDown size={16} />
              {:else}
                <ChevronRight size={16} />
              {/if}
              <span class="chapter-name">{chapter}</span>
              <span class="chapter-count">{chapterBookmarks.length}</span>
            </button>

            {#if expandedChapters.has(chapter)}
              <div class="chapter-items">
                {#each chapterBookmarks as bookmark (bookmark.id)}
                  <div
                    class="item-card bookmark-card"
                    role="button"
                    tabindex="0"
                    on:click={() => navigateTo(bookmark.cfi)}
                    on:keydown={(e) => e.key === 'Enter' && navigateTo(bookmark.cfi)}
                  >
                    <div class="item-title">
                      <BookmarkIcon size={14} />
                      {bookmark.name || 'Unnamed bookmark'}
                    </div>
                    <div class="item-meta">
                      {formatDate(bookmark.createdAt)}
                      {#if bookmark.pagePercent}
                        <span class="separator">-</span>
                        {bookmark.pagePercent}%
                      {/if}
                    </div>
                    <div class="item-actions">
                      <button
                        class="action-btn"
                        title="Edit"
                        on:click|stopPropagation={() => dispatch('editBookmark', { bookmark })}
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        class="action-btn danger"
                        title="Delete"
                        on:click|stopPropagation={() => dispatch('deleteBookmark', { id: bookmark.id })}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    {:else if activeTab === 'notes'}
      {#if filteredNotes.length === 0}
        <div class="empty-state">
          {#if searchQuery}
            <p>No notes match your search</p>
          {:else}
            <p>No notes yet</p>
            <p class="hint">Add notes from the highlight popup</p>
          {/if}
        </div>
      {:else}
        {#each [...notesByChapter] as [chapter, chapterNotes] (chapter)}
          <div class="chapter-group">
            <button
              class="chapter-header"
              on:click={() => toggleChapter(chapter)}
            >
              {#if expandedChapters.has(chapter)}
                <ChevronDown size={16} />
              {:else}
                <ChevronRight size={16} />
              {/if}
              <span class="chapter-name">{chapter}</span>
              <span class="chapter-count">{chapterNotes.length}</span>
            </button>

            {#if expandedChapters.has(chapter)}
              <div class="chapter-items">
                {#each chapterNotes as note (note.id)}
                  <div
                    class="item-card note-card"
                    role="button"
                    tabindex="0"
                    on:click={() => navigateTo(note.cfi)}
                    on:keydown={(e) => e.key === 'Enter' && navigateTo(note.cfi)}
                  >
                    <div class="item-content">{truncateText(note.content, 200)}</div>
                    {#if note.tags && note.tags.length > 0}
                      <div class="item-tags">
                        {#each note.tags as tag}
                          <span class="tag">#{tag}</span>
                        {/each}
                      </div>
                    {/if}
                    <div class="item-meta">
                      {formatDate(note.createdAt)}
                      {#if note.pagePercent}
                        <span class="separator">-</span>
                        {note.pagePercent}%
                      {/if}
                    </div>
                    <div class="item-actions">
                      <button
                        class="action-btn"
                        title="Edit"
                        on:click|stopPropagation={() => dispatch('editNote', { note })}
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        class="action-btn danger"
                        title="Delete"
                        on:click|stopPropagation={() => dispatch('deleteNote', { id: note.id })}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    {:else if activeTab === 'images'}
      <div class="images-tab">
        {#if !bookPath}
          <div class="empty-state">
            <p>No book loaded</p>
          </div>
        {:else}
          <div class="images-intro">
            <ImageIcon size={48} strokeWidth={1} />
            <h3>Book Images</h3>
            <p>Browse all images from "{bookTitle || 'this book'}"</p>
            <button
              class="open-gallery-btn"
              on:click={() => dispatch('openImages', { bookPath, bookTitle })}
            >
              <ExternalLink size={16} />
              Open Image Gallery
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .notebook-sidebar {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--background-primary);
    border-left: 1px solid var(--background-modifier-border);
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
    gap: 8px;
  }

  .tab-bar {
    display: flex;
    gap: 4px;
    flex: 1;
    overflow-x: auto;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-radius: var(--radius-s);
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--text-muted);
    white-space: nowrap;
    transition: all 0.15s ease;
  }

  .tab:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .tab.active {
    background: var(--background-secondary);
    color: var(--text-normal);
  }

  .tab .count {
    font-size: 0.7rem;
    background: var(--background-modifier-border);
    padding: 1px 5px;
    border-radius: 8px;
  }

  .close-btn {
    padding: 4px;
    background: transparent;
    border: none;
    border-radius: var(--radius-s);
    cursor: pointer;
    color: var(--text-muted);
  }

  .close-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--background-secondary);
    border-radius: var(--radius-s);
    padding: 8px 12px;
    margin: 8px 12px;
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

  .content-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 12px 12px;
  }

  .empty-state {
    text-align: center;
    padding: 32px 16px;
    color: var(--text-muted);
  }

  .empty-state .hint {
    font-size: 0.8rem;
    margin-top: 8px;
    opacity: 0.7;
  }

  .chapter-group {
    margin-bottom: 8px;
  }

  .chapter-header {
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
    font-size: 0.85rem;
  }

  .chapter-header:hover {
    background: var(--background-modifier-hover);
  }

  .chapter-name {
    flex: 1;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chapter-count {
    font-size: 0.7rem;
    color: var(--text-muted);
    background: var(--background-primary);
    padding: 2px 6px;
    border-radius: 8px;
  }

  .chapter-items {
    padding-left: 12px;
    margin-top: 6px;
  }

  .item-card {
    padding: 10px 12px;
    margin-bottom: 6px;
    background: var(--background-secondary);
    border-radius: var(--radius-s);
    border-left: 3px solid transparent;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .item-card:hover {
    background: var(--background-modifier-hover);
  }

  .highlight-card {
    border-left-width: 4px;
  }

  .bookmark-card {
    border-left-color: var(--interactive-accent);
  }

  .note-card {
    border-left-color: var(--text-accent);
  }

  .item-text {
    font-style: italic;
    font-size: 0.85rem;
    line-height: 1.5;
    margin-bottom: 6px;
  }

  .item-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    font-size: 0.9rem;
    margin-bottom: 4px;
  }

  .item-content {
    font-size: 0.85rem;
    line-height: 1.5;
    margin-bottom: 6px;
  }

  .item-annotation {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-bottom: 6px;
    padding-left: 8px;
    border-left: 2px solid var(--background-modifier-border);
  }

  .item-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }

  .tag {
    font-size: 0.7rem;
    padding: 2px 6px;
    background: var(--background-modifier-border);
    border-radius: 4px;
    color: var(--text-muted);
  }

  .item-meta {
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .separator {
    margin: 0 4px;
    opacity: 0.5;
  }

  .item-actions {
    display: flex;
    gap: 4px;
    margin-top: 6px;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .item-card:hover .item-actions {
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

  /* Images Tab Styles */
  .images-tab {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .images-intro {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 48px 24px;
    color: var(--text-muted);
  }

  .images-intro h3 {
    margin: 16px 0 8px;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-normal);
  }

  .images-intro p {
    margin: 0 0 24px;
    font-size: 0.9rem;
    max-width: 200px;
  }

  .open-gallery-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: var(--radius-m);
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .open-gallery-btn:hover {
    filter: brightness(1.1);
  }
</style>
