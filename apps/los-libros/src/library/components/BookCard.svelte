<script lang="ts">
  import type { Book } from '../types';
  import { createEventDispatcher } from 'svelte';
  import { Book as BookIcon } from 'lucide-svelte';

  export let book: Book;

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
  class="los-libros-book-card"
  role="button"
  tabindex="0"
  on:click={handleClick}
  on:keydown={handleKeydown}
>
  {#if book.coverUrl}
    <img
      src={book.coverUrl}
      alt={book.title}
      class="los-libros-book-cover"
      loading="lazy"
    />
  {:else}
    <div class="los-libros-book-cover-placeholder">
      <BookIcon size={32} />
    </div>
  {/if}

  {#if book.progress > 0}
    <div class="los-libros-progress-bar">
      <div class="los-libros-progress-fill" style="width: {progressWidth}"></div>
    </div>
  {/if}

  <div class="los-libros-book-title" title={book.title}>
    {book.title}
  </div>

  {#if book.author}
    <div class="los-libros-book-author" title={book.author}>
      {book.author}
    </div>
  {/if}
</div>

<style>
  .los-libros-book-card {
    position: relative;
  }

  .los-libros-progress-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    margin-top: -4px;
  }
</style>
