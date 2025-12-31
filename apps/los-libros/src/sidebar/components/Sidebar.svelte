<script lang="ts">
  /**
   * Book Sidebar
   *
   * Main sidebar component for viewing book highlights, bookmarks, notes, and images.
   * Uses Doc Doctor-style ViewModeSwitcher with expandable tab selector.
   * Uses Obsidian CSS variables for theming.
   */
  import { onMount, onDestroy } from 'svelte';
  import type LosLibrosPlugin from '../../main';
  import type { Highlight, HighlightColor } from '../../library/types';
  import type { Bookmark, ReadingNote } from '../../bookmarks/bookmark-types';
  import { sidebarStore, type SidebarTab } from '../sidebar.store';
  import ViewModeSwitcher from './ViewModeSwitcher.svelte';
  import ControlsBar from './ControlsBar.svelte';
  import HighlightsTab from './HighlightsTab.svelte';
  import BookmarksTab from './BookmarksTab.svelte';
  import NotesTab from './NotesTab.svelte';
  import ImagesTab from './ImagesTab.svelte';
  import {
    Search,
    X,
    BookOpen,
  } from 'lucide-svelte';

  export let plugin: LosLibrosPlugin;

  let activeTab: SidebarTab = 'highlights';
  let searchQuery = '';
  let showSearch = false;
  let activeBookId: string | null = null;
  let activeBookPath: string | null = null;
  let activeBookTitle: string | null = null;

  // Data for current book
  let highlights: Highlight[] = [];
  let bookmarks: Bookmark[] = [];
  let notes: ReadingNote[] = [];

  // Subscribe to sidebar store
  const unsubscribeSidebar = sidebarStore.subscribe(state => {
    activeTab = state.activeTab;
    searchQuery = state.searchQuery;
    showSearch = state.showSearch;
    activeBookId = state.activeBookId;
    activeBookPath = state.activeBookPath;
    activeBookTitle = state.activeBookTitle;

    // Load data for the active book
    if (activeBookId) {
      loadBookData(activeBookId);
    } else {
      clearData();
    }
  });

  // Subscribe to highlight service for live updates
  let unsubscribeHighlights: (() => void) | null = null;
  $: {
    // Clean up previous subscription
    if (unsubscribeHighlights) {
      unsubscribeHighlights();
      unsubscribeHighlights = null;
    }
    // Subscribe if we have a highlight service
    if (plugin.highlightService) {
      const store = plugin.highlightService.getStore();
      unsubscribeHighlights = store.subscribe((state) => {
        // Update highlights for current book when store changes
        if (activeBookId) {
          highlights = state.highlights[activeBookId] || [];
        }
      });
    }
  }

  function loadBookData(bookId: string) {
    if (plugin.highlightService) {
      highlights = plugin.highlightService.getHighlights(bookId);
    }
    if (plugin.bookmarkService) {
      const artifacts = plugin.bookmarkService.getBookArtifacts(bookId);
      bookmarks = artifacts.bookmarks;
      notes = artifacts.notes;
    }
  }

  function clearData() {
    highlights = [];
    bookmarks = [];
    notes = [];
  }

  function handleSearchInput(event: Event) {
    const target = event.target as HTMLInputElement;
    sidebarStore.setSearchQuery(target.value);
  }

  function clearSearch() {
    sidebarStore.clearSearch();
  }

  function navigateToCfi(cfi: string, text?: string) {
    if (!activeBookPath) {
      return;
    }
    // Find the reader view and navigate
    const leaves = plugin.app.workspace.getLeavesOfType('los-libros-reader');
    for (const leaf of leaves) {
      const view = leaf.view as any;
      if (view.bookPath === activeBookPath || view.getState?.()?.bookPath === activeBookPath) {
        // Use text-based navigation for better accuracy
        if (text) {
          view.navigateToHighlight?.(cfi, text);
        } else {
          view.navigateToCfi?.(cfi);
        }
        plugin.app.workspace.revealLeaf(leaf);
        return;
      }
    }
  }

  function deleteHighlight(id: string) {
    if (!activeBookId || !plugin.highlightService) return;
    plugin.highlightService.deleteHighlight(activeBookId, id);
    highlights = plugin.highlightService.getHighlights(activeBookId);

    // Also remove from renderer overlay
    const leaves = plugin.app.workspace.getLeavesOfType('los-libros-reader');
    for (const leaf of leaves) {
      const view = leaf.view as any;
      if (view.bookPath === activeBookPath) {
        view.removeHighlight?.(id);
        break;
      }
    }
  }

  function deleteBookmark(id: string) {
    if (!activeBookId || !plugin.bookmarkService) return;
    plugin.bookmarkService.deleteBookmark(activeBookId, id);
    const artifacts = plugin.bookmarkService.getBookArtifacts(activeBookId);
    bookmarks = artifacts.bookmarks;
  }

  function deleteNote(id: string) {
    if (!activeBookId || !plugin.bookmarkService) return;
    plugin.bookmarkService.deleteNote(activeBookId, id);
    const artifacts = plugin.bookmarkService.getBookArtifacts(activeBookId);
    notes = artifacts.notes;
  }

  function openImagesGallery() {
    if (!activeBookPath) return;
    plugin.openImagesView(activeBookPath, activeBookTitle || 'Book Images');
  }

  function handleExportData() {
    // Export notes functionality - can be implemented later
    console.log('Export notes requested');
  }

  function handleToggleFilter() {
    // Filter by highlight color - can be implemented later
    console.log('Toggle filter requested');
  }

  onDestroy(() => {
    unsubscribeSidebar();
    if (unsubscribeHighlights) {
      unsubscribeHighlights();
    }
  });

  // Filter items by search query
  $: filteredHighlights = searchQuery
    ? highlights.filter(h =>
        h.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.annotation?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.chapter?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : highlights;

  $: filteredBookmarks = searchQuery
    ? bookmarks.filter(b =>
        b.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.chapter?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : bookmarks;

  $: filteredNotes = searchQuery
    ? notes.filter(n =>
        n.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.chapter?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.tags?.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : notes;

  $: hasActiveBook = !!activeBookId;
</script>

<div class="book-sidebar">
  <!-- Header with ViewModeSwitcher and ControlsBar -->
  <div class="sidebar-header">
    <ViewModeSwitcher
      highlightsCount={highlights.length}
      bookmarksCount={bookmarks.length}
      notesCount={notes.length}
    />
    <ControlsBar
      {activeTab}
      {showSearch}
      {hasActiveBook}
      on:exportData={handleExportData}
      on:toggleFilter={handleToggleFilter}
    />
  </div>

  <!-- Expanded panels -->
  {#if showSearch && hasActiveBook}
    <div class="expanded-panel">
      <div class="search-bar">
        <Search size={14} />
        <input
          type="text"
          placeholder="Search {activeTab}..."
          value={searchQuery}
          on:input={handleSearchInput}
        />
        {#if searchQuery}
          <button class="clear-btn" on:click={clearSearch}>
            <X size={14} />
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Book title bar (when a book is selected) -->
  {#if activeBookTitle}
    <div class="book-title-bar">
      <BookOpen size={14} />
      <span class="book-title">{activeBookTitle}</span>
    </div>
  {/if}

  <!-- Content -->
  <div class="sidebar-content">
    {#if !activeBookId}
      <div class="empty-state">
        <BookOpen size={48} strokeWidth={1} />
        <p>No book selected</p>
        <p class="hint">Open a book to view its highlights, bookmarks, and notes</p>
      </div>
    {:else if activeTab === 'highlights'}
      <HighlightsTab
        highlights={filteredHighlights}
        on:navigate={(e) => navigateToCfi(e.detail.cfi, e.detail.text)}
        on:delete={(e) => deleteHighlight(e.detail.id)}
      />
    {:else if activeTab === 'bookmarks'}
      <BookmarksTab
        bookmarks={filteredBookmarks}
        on:navigate={(e) => navigateToCfi(e.detail.cfi)}
        on:delete={(e) => deleteBookmark(e.detail.id)}
      />
    {:else if activeTab === 'notes'}
      <NotesTab
        notes={filteredNotes}
        on:navigate={(e) => navigateToCfi(e.detail.cfi)}
        on:delete={(e) => deleteNote(e.detail.id)}
      />
    {:else if activeTab === 'images'}
      <ImagesTab
        bookPath={activeBookPath}
        bookTitle={activeBookTitle}
        on:openGallery={openImagesGallery}
      />
    {/if}
  </div>
</div>

<style>
  .book-sidebar {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--background-primary);
    color: var(--text-normal);
    gap: 8px;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px;
    gap: 8px;
    flex-shrink: 0;
    position: relative;
    z-index: 10;
  }

  .expanded-panel {
    width: 100%;
    padding: 0 8px;
    box-sizing: border-box;
  }

  .search-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--background-secondary);
    border-radius: var(--radius-s);
  }

  .search-bar input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 0.85rem;
    color: var(--text-normal);
  }

  .search-bar input::placeholder {
    color: var(--text-muted);
  }

  .clear-btn {
    padding: 2px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
  }

  .clear-btn:hover {
    color: var(--text-normal);
  }

  .book-title-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--background-secondary);
    margin: 0 8px;
    border-radius: var(--radius-s);
    color: var(--text-muted);
  }

  .book-title {
    font-size: 0.8rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 8px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 48px 24px;
    color: var(--text-muted);
  }

  .empty-state p {
    margin: 8px 0 0;
    font-size: 0.9rem;
  }

  .empty-state .hint {
    font-size: 0.8rem;
    opacity: 0.7;
    max-width: 200px;
  }
</style>
