<script lang="ts">
  import type { Book } from '../types';
  import { createEventDispatcher } from 'svelte';
  import { Book as BookIcon, CloudOff, Download } from 'lucide-svelte';

  export let book: Book;
  export let isOffline = false;
  export let isDownloading = false;
  export let downloadProgress = 0;

  const dispatch = createEventDispatcher();

  function handleClick() {
    dispatch('click', book);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick();
    }
  }

  $: progressWidth = `${book.progress}%`;
</script>

<div
  class="amnesia-book-card"
  role="button"
  tabindex="0"
  on:click={handleClick}
  on:keydown={handleKeydown}
>
  {#if book.coverUrl}
    <img
      src={book.coverUrl}
      alt={book.title}
      class="amnesia-book-cover"
      loading="lazy"
    />
  {:else}
    <div class="amnesia-book-cover-placeholder">
      <BookIcon size={32} />
    </div>
  {/if}

  <!-- Offline/Download badges -->
  {#if isDownloading}
    <div class="amnesia-book-badge downloading" title="Downloading for offline...">
      <Download size={12} />
      <svg class="progress-ring" viewBox="0 0 24 24">
        <circle
          class="progress-ring-bg"
          cx="12"
          cy="12"
          r="10"
          fill="none"
          stroke-width="2"
        />
        <circle
          class="progress-ring-fill"
          cx="12"
          cy="12"
          r="10"
          fill="none"
          stroke-width="2"
          stroke-dasharray="{62.8 * (downloadProgress / 100)} 62.8"
          transform="rotate(-90 12 12)"
        />
      </svg>
    </div>
  {:else if isOffline}
    <div class="amnesia-book-badge offline" title="Available offline">
      <CloudOff size={12} />
    </div>
  {/if}

  {#if book.progress > 0}
    <div class="amnesia-progress-bar">
      <div class="amnesia-progress-fill" style="width: {progressWidth}"></div>
    </div>
  {/if}

  <div class="amnesia-book-title" title={book.title}>
    {book.title}
  </div>

  {#if book.author}
    <div class="amnesia-book-author" title={book.author}>
      {book.author}
    </div>
  {/if}
</div>

<style>
  .amnesia-book-card {
    position: relative;
  }

  .amnesia-progress-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    margin-top: -4px;
  }

  .amnesia-book-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1;
  }

  .amnesia-book-badge.offline {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .amnesia-book-badge.downloading {
    background: var(--background-primary);
    color: var(--text-muted);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .progress-ring {
    position: absolute;
    top: 0;
    left: 0;
    width: 24px;
    height: 24px;
  }

  .progress-ring-bg {
    stroke: var(--background-modifier-border);
  }

  .progress-ring-fill {
    stroke: var(--interactive-accent);
    transition: stroke-dasharray 0.3s ease;
  }
</style>
