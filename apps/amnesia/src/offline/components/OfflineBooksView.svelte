<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { setIcon } from 'obsidian';
  import type { OfflineManager, OfflineBook } from '../offline-manager';

  export let offlineManager: OfflineManager | null;

  const dispatch = createEventDispatcher<{
    open: { bookId: string };
    remove: { bookId: string };
  }>();

  let books: OfflineBook[] = [];
  let loading = true;
  let error: string | null = null;
  let storageInfo = { used: 0, quota: 0, available: 0, percentage: 0 };
  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  // Helper to format bytes
  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  // Helper to format date
  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  // Status badge styling
  function getStatusClass(status: OfflineBook['status']): string {
    switch (status) {
      case 'completed': return 'status-completed';
      case 'downloading': return 'status-downloading';
      case 'paused': return 'status-paused';
      case 'failed': return 'status-failed';
      case 'partial': return 'status-partial';
      default: return 'status-pending';
    }
  }

  function getStatusLabel(status: OfflineBook['status']): string {
    switch (status) {
      case 'completed': return 'Available';
      case 'downloading': return 'Downloading';
      case 'paused': return 'Paused';
      case 'failed': return 'Failed';
      case 'partial': return 'Partial';
      default: return 'Pending';
    }
  }

  async function loadBooks() {
    if (!offlineManager) {
      error = 'Offline manager not available';
      loading = false;
      return;
    }

    try {
      books = offlineManager.getOfflineBooks();
      storageInfo = await offlineManager.getStorageInfo();
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load offline books';
    } finally {
      loading = false;
    }
  }

  async function handleRemove(bookId: string) {
    if (!offlineManager) return;

    try {
      await offlineManager.removeOfflineBook(bookId);
      await loadBooks();
      dispatch('remove', { bookId });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to remove book';
    }
  }

  function handleOpen(bookId: string) {
    dispatch('open', { bookId });
  }

  function setIconEl(node: HTMLElement, icon: string) {
    setIcon(node, icon);
  }

  onMount(() => {
    loadBooks();

    // Refresh every 5 seconds
    refreshInterval = setInterval(loadBooks, 5000);
  });

  onDestroy(() => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  });

  $: completedBooks = books.filter(b => b.status === 'completed');
  $: downloadingBooks = books.filter(b => b.status === 'downloading' || b.status === 'paused');
  $: failedBooks = books.filter(b => b.status === 'failed');
  $: totalOfflineSize = books
    .filter(b => b.status === 'completed')
    .reduce((sum, b) => sum + b.totalSize, 0);
</script>

<div class="offline-books-view">
  {#if loading}
    <div class="loading">
      <span class="loading-spinner" use:setIconEl={'loader-2'}></span>
      <span>Loading offline books...</span>
    </div>
  {:else if error}
    <div class="error">
      <span use:setIconEl={'alert-circle'}></span>
      <span>{error}</span>
    </div>
  {:else}
    <!-- Storage Overview -->
    <div class="storage-overview">
      <div class="storage-header">
        <span use:setIconEl={'hard-drive'}></span>
        <span>Storage Usage</span>
      </div>
      <div class="storage-stats">
        <div class="stat">
          <span class="stat-value">{formatBytes(totalOfflineSize)}</span>
          <span class="stat-label">Offline Books</span>
        </div>
        <div class="stat">
          <span class="stat-value">{formatBytes(storageInfo.used)}</span>
          <span class="stat-label">Total Used</span>
        </div>
        <div class="stat">
          <span class="stat-value">{formatBytes(storageInfo.available)}</span>
          <span class="stat-label">Available</span>
        </div>
      </div>
      <div class="storage-bar">
        <div class="storage-fill" style="width: {storageInfo.percentage}%"></div>
      </div>
      <div class="storage-label">{storageInfo.percentage.toFixed(1)}% used</div>
    </div>

    <!-- Active Downloads -->
    {#if downloadingBooks.length > 0}
      <div class="section">
        <div class="section-header">
          <span use:setIconEl={'download'}></span>
          <span>In Progress ({downloadingBooks.length})</span>
        </div>
        <div class="books-list">
          {#each downloadingBooks as book (book.bookId)}
            <div class="book-item">
              <div class="book-info">
                <div class="book-title">{book.title || book.bookId}</div>
                {#if book.author}
                  <div class="book-author">{book.author}</div>
                {/if}
                <div class="book-progress">
                  <div class="progress-bar">
                    <div
                      class="progress-fill"
                      style="width: {(book.downloadedSize / book.totalSize) * 100}%"
                    ></div>
                  </div>
                  <span class="progress-text">
                    {formatBytes(book.downloadedSize)} / {formatBytes(book.totalSize)}
                  </span>
                </div>
              </div>
              <div class="book-status">
                <span class="status-badge {getStatusClass(book.status)}">
                  {getStatusLabel(book.status)}
                </span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Completed Books -->
    {#if completedBooks.length > 0}
      <div class="section">
        <div class="section-header">
          <span use:setIconEl={'check-circle'}></span>
          <span>Available Offline ({completedBooks.length})</span>
        </div>
        <div class="books-list">
          {#each completedBooks as book (book.bookId)}
            <div class="book-item clickable" on:click={() => handleOpen(book.bookId)}>
              <div class="book-info">
                <div class="book-title">{book.title || book.bookId}</div>
                {#if book.author}
                  <div class="book-author">{book.author}</div>
                {/if}
                <div class="book-meta">
                  <span>{formatBytes(book.totalSize)}</span>
                  <span class="separator">|</span>
                  <span>Last read: {formatDate(book.lastAccessedAt)}</span>
                </div>
              </div>
              <div class="book-actions">
                <button
                  class="clickable-icon"
                  on:click|stopPropagation={() => handleOpen(book.bookId)}
                  title="Open"
                >
                  <span use:setIconEl={'book-open'}></span>
                </button>
                <button
                  class="clickable-icon mod-warning"
                  on:click|stopPropagation={() => handleRemove(book.bookId)}
                  title="Remove from offline"
                >
                  <span use:setIconEl={'trash-2'}></span>
                </button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {:else}
      <div class="empty-state">
        <span use:setIconEl={'cloud-off'}></span>
        <p>No books downloaded for offline reading</p>
        <p class="hint">Download books from the library to read offline</p>
      </div>
    {/if}

    <!-- Failed Downloads -->
    {#if failedBooks.length > 0}
      <div class="section">
        <div class="section-header mod-error">
          <span use:setIconEl={'alert-triangle'}></span>
          <span>Failed Downloads ({failedBooks.length})</span>
        </div>
        <div class="books-list">
          {#each failedBooks as book (book.bookId)}
            <div class="book-item mod-error">
              <div class="book-info">
                <div class="book-title">{book.title || book.bookId}</div>
                {#if book.error}
                  <div class="book-error">{book.error}</div>
                {/if}
              </div>
              <div class="book-actions">
                <button
                  class="clickable-icon mod-warning"
                  on:click={() => handleRemove(book.bookId)}
                  title="Remove"
                >
                  <span use:setIconEl={'trash-2'}></span>
                </button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .offline-books-view {
    padding: 16px;
    max-width: 800px;
  }

  .loading,
  .error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 20px;
    color: var(--text-muted);
  }

  .error {
    color: var(--text-error);
  }

  .loading-spinner {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .storage-overview {
    background: var(--background-secondary);
    border-radius: var(--radius-m);
    padding: 16px;
    margin-bottom: 20px;
  }

  .storage-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
    margin-bottom: 12px;
  }

  .storage-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-bottom: 12px;
  }

  .stat {
    text-align: center;
  }

  .stat-value {
    font-size: 1.2em;
    font-weight: 600;
    display: block;
  }

  .stat-label {
    font-size: 0.8em;
    color: var(--text-muted);
  }

  .storage-bar {
    height: 8px;
    background: var(--background-modifier-border);
    border-radius: 4px;
    overflow: hidden;
  }

  .storage-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.3s ease;
  }

  .storage-label {
    font-size: 0.75em;
    color: var(--text-muted);
    margin-top: 4px;
    text-align: right;
  }

  .section {
    margin-bottom: 20px;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
    margin-bottom: 12px;
    color: var(--text-normal);
  }

  .section-header.mod-error {
    color: var(--text-error);
  }

  .books-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .book-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--background-secondary);
    border-radius: var(--radius-s);
    padding: 12px;
  }

  .book-item.clickable {
    cursor: pointer;
  }

  .book-item.clickable:hover {
    background: var(--background-secondary-alt);
  }

  .book-item.mod-error {
    border-left: 3px solid var(--text-error);
  }

  .book-info {
    flex: 1;
    min-width: 0;
  }

  .book-title {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .book-author {
    font-size: 0.85em;
    color: var(--text-muted);
  }

  .book-meta {
    font-size: 0.8em;
    color: var(--text-muted);
    display: flex;
    gap: 4px;
    margin-top: 4px;
  }

  .separator {
    color: var(--background-modifier-border);
  }

  .book-error {
    font-size: 0.85em;
    color: var(--text-error);
    margin-top: 4px;
  }

  .book-progress {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }

  .progress-bar {
    flex: 1;
    height: 6px;
    background: var(--background-modifier-border);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.3s ease;
  }

  .progress-text {
    font-size: 0.75em;
    color: var(--text-muted);
  }

  .book-status {
    margin-left: 12px;
  }

  .status-badge {
    font-size: 0.7em;
    padding: 2px 8px;
    border-radius: var(--radius-s);
    text-transform: uppercase;
    font-weight: 600;
  }

  .status-completed {
    background: var(--background-modifier-success);
    color: var(--text-success);
  }

  .status-downloading {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .status-paused {
    background: var(--background-modifier-border);
    color: var(--text-muted);
  }

  .status-failed {
    background: var(--background-modifier-error);
    color: var(--text-error);
  }

  .status-partial {
    background: var(--color-orange);
    color: var(--text-normal);
  }

  .status-pending {
    background: var(--background-modifier-border);
    color: var(--text-muted);
  }

  .book-actions {
    display: flex;
    gap: 4px;
    margin-left: 12px;
  }

  .book-actions .clickable-icon {
    padding: 6px;
  }

  .book-actions .mod-warning:hover {
    color: var(--text-error);
  }

  .empty-state {
    text-align: center;
    padding: 40px 20px;
    color: var(--text-muted);
  }

  .empty-state p {
    margin: 8px 0;
  }

  .empty-state .hint {
    font-size: 0.85em;
  }
</style>
