<script lang="ts">
  import type AmnesiaPlugin from '../../main';
  import type { Store } from '../../helpers/store';
  import type { LibraryState, LibraryAction } from '../library-reducer';
  import type { Book, BookStatus } from '../types';
  import BookCard from './BookCard.svelte';
  import { RefreshCw, FolderOpen, Search, Filter, SortAsc } from 'lucide-svelte';

  export let plugin: AmnesiaPlugin;
  export let store: Store<LibraryState, LibraryAction>;

  let state: LibraryState;
  let searchQuery = '';
  let statusFilter: BookStatus | 'all' = 'all';
  let sortBy: 'title' | 'author' | 'recent' | 'progress' = 'recent';

  $: state = $store;
  $: allBooks = state?.books ?? [];
  $: loading = state?.loading ?? false;
  $: error = state?.error ?? null;

  // Filter and sort books
  $: filteredBooks = filterBooks(allBooks, searchQuery, statusFilter);
  $: books = sortBooks(filteredBooks, sortBy);

  function filterBooks(books: Book[], query: string, status: BookStatus | 'all'): Book[] {
    let result = books;

    // Filter by status
    if (status !== 'all') {
      result = result.filter(b => b.status === status);
    }

    // Filter by search query
    if (query.trim()) {
      const q = query.toLowerCase();
      result = result.filter(b =>
        b.title.toLowerCase().includes(q) ||
        b.author?.toLowerCase().includes(q)
      );
    }

    return result;
  }

  function sortBooks(books: Book[], sort: typeof sortBy): Book[] {
    const sorted = [...books];
    switch (sort) {
      case 'title':
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'author':
        return sorted.sort((a, b) => (a.author ?? '').localeCompare(b.author ?? ''));
      case 'recent':
        return sorted.sort((a, b) => {
          const aTime = a.lastRead?.getTime() ?? a.addedAt.getTime();
          const bTime = b.lastRead?.getTime() ?? b.addedAt.getTime();
          return bTime - aTime;
        });
      case 'progress':
        return sorted.sort((a, b) => b.progress - a.progress);
      default:
        return sorted;
    }
  }

  async function refreshLibrary() {
    await plugin.libraryService.scan(plugin.settings.localBooksFolder);
  }

  function openBook(book: Book) {
    if (book.localPath) {
      plugin.openBook(book.localPath);
    }
  }
</script>

<div class="amnesia-library">
  <div class="amnesia-library-header">
    <h2 class="amnesia-library-title">Library</h2>
    <div class="amnesia-library-actions">
      <button
        class="clickable-icon"
        aria-label="Refresh library"
        on:click={refreshLibrary}
        disabled={loading}
      >
        <RefreshCw size={18} class={loading ? 'spinning' : ''} />
      </button>
    </div>
  </div>

  <!-- Search and Filter Controls -->
  <div class="amnesia-controls">
    <div class="amnesia-search">
      <Search size={16} />
      <input
        type="text"
        placeholder="Search books..."
        bind:value={searchQuery}
      />
    </div>

    <div class="amnesia-filters">
      <select bind:value={statusFilter} aria-label="Filter by status">
        <option value="all">All</option>
        <option value="to-read">To Read</option>
        <option value="reading">Reading</option>
        <option value="completed">Completed</option>
        <option value="archived">Archived</option>
      </select>

      <select bind:value={sortBy} aria-label="Sort by">
        <option value="recent">Recent</option>
        <option value="title">Title</option>
        <option value="author">Author</option>
        <option value="progress">Progress</option>
      </select>
    </div>
  </div>

  <!-- Book count -->
  {#if allBooks.length > 0}
    <div class="amnesia-book-count">
      {books.length} of {allBooks.length} books
    </div>
  {/if}

  {#if error}
    <div class="amnesia-error">
      <p>{error}</p>
      <button on:click={refreshLibrary}>Retry</button>
    </div>
  {:else if loading}
    <div class="amnesia-loading">
      <div class="amnesia-spinner"></div>
    </div>
  {:else if allBooks.length === 0}
    <div class="amnesia-empty">
      <div class="amnesia-empty-icon">
        <FolderOpen size={48} />
      </div>
      <p>No books found</p>
      <p class="amnesia-empty-hint">
        Add EPUB files to your <code>{plugin.settings.localBooksFolder}</code> folder
        or connect to a Amnesia server.
      </p>
      <button on:click={refreshLibrary}>Scan Library</button>
    </div>
  {:else if books.length === 0}
    <div class="amnesia-empty">
      <div class="amnesia-empty-icon">
        <Search size={48} />
      </div>
      <p>No matching books</p>
      <p class="amnesia-empty-hint">
        Try adjusting your search or filters.
      </p>
    </div>
  {:else}
    <div class="amnesia-library-grid">
      {#each books as book (book.id)}
        <BookCard {book} on:click={() => openBook(book)} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .amnesia-library-actions {
    display: flex;
    gap: 8px;
  }

  .amnesia-controls {
    display: flex;
    gap: 12px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }

  .amnesia-search {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 200px;
    background: var(--background-secondary);
    border-radius: var(--radius-s);
    padding: 6px 10px;
  }

  .amnesia-search input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 0.875rem;
    color: var(--text-normal);
  }

  .amnesia-search input::placeholder {
    color: var(--text-muted);
  }

  .amnesia-filters {
    display: flex;
    gap: 8px;
  }

  .amnesia-filters select {
    background: var(--background-secondary);
    border: none;
    border-radius: var(--radius-s);
    padding: 6px 10px;
    font-size: 0.875rem;
    color: var(--text-normal);
    cursor: pointer;
  }

  .amnesia-book-count {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-bottom: 12px;
  }

  .amnesia-error {
    text-align: center;
    padding: 32px;
    color: var(--text-error);
  }

  .amnesia-empty-hint {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin-top: 8px;
  }

  .amnesia-empty-hint code {
    background: var(--background-secondary);
    padding: 2px 6px;
    border-radius: 4px;
  }

  :global(.spinning) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
