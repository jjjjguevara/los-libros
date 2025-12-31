<script lang="ts">
  import type LosLibrosPlugin from '../../main';
  import type { Store } from '../../helpers/store';
  import type { LibraryState, LibraryAction } from '../library-reducer';
  import type { Book, BookStatus } from '../types';
  import BookCard from './BookCard.svelte';
  import { RefreshCw, FolderOpen, Search, Filter, SortAsc } from 'lucide-svelte';

  export let plugin: LosLibrosPlugin;
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

<div class="los-libros-library">
  <div class="los-libros-library-header">
    <h2 class="los-libros-library-title">Library</h2>
    <div class="los-libros-library-actions">
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
  <div class="los-libros-controls">
    <div class="los-libros-search">
      <Search size={16} />
      <input
        type="text"
        placeholder="Search books..."
        bind:value={searchQuery}
      />
    </div>

    <div class="los-libros-filters">
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
    <div class="los-libros-book-count">
      {books.length} of {allBooks.length} books
    </div>
  {/if}

  {#if error}
    <div class="los-libros-error">
      <p>{error}</p>
      <button on:click={refreshLibrary}>Retry</button>
    </div>
  {:else if loading}
    <div class="los-libros-loading">
      <div class="los-libros-spinner"></div>
    </div>
  {:else if allBooks.length === 0}
    <div class="los-libros-empty">
      <div class="los-libros-empty-icon">
        <FolderOpen size={48} />
      </div>
      <p>No books found</p>
      <p class="los-libros-empty-hint">
        Add EPUB files to your <code>{plugin.settings.localBooksFolder}</code> folder
        or connect to a Los Libros server.
      </p>
      <button on:click={refreshLibrary}>Scan Library</button>
    </div>
  {:else if books.length === 0}
    <div class="los-libros-empty">
      <div class="los-libros-empty-icon">
        <Search size={48} />
      </div>
      <p>No matching books</p>
      <p class="los-libros-empty-hint">
        Try adjusting your search or filters.
      </p>
    </div>
  {:else}
    <div class="los-libros-library-grid">
      {#each books as book (book.id)}
        <BookCard {book} on:click={() => openBook(book)} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .los-libros-library-actions {
    display: flex;
    gap: 8px;
  }

  .los-libros-controls {
    display: flex;
    gap: 12px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }

  .los-libros-search {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 200px;
    background: var(--background-secondary);
    border-radius: var(--radius-s);
    padding: 6px 10px;
  }

  .los-libros-search input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 0.875rem;
    color: var(--text-normal);
  }

  .los-libros-search input::placeholder {
    color: var(--text-muted);
  }

  .los-libros-filters {
    display: flex;
    gap: 8px;
  }

  .los-libros-filters select {
    background: var(--background-secondary);
    border: none;
    border-radius: var(--radius-s);
    padding: 6px 10px;
    font-size: 0.875rem;
    color: var(--text-normal);
    cursor: pointer;
  }

  .los-libros-book-count {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-bottom: 12px;
  }

  .los-libros-error {
    text-align: center;
    padding: 32px;
    color: var(--text-error);
  }

  .los-libros-empty-hint {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin-top: 8px;
  }

  .los-libros-empty-hint code {
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
