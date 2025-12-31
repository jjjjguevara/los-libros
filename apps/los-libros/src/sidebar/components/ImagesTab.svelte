<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { Image, ExternalLink } from 'lucide-svelte';

  export let bookPath: string | null = null;
  export let bookTitle: string | null = null;

  const dispatch = createEventDispatcher<{
    openGallery: void;
  }>();
</script>

<div class="images-tab">
  {#if !bookPath}
    <div class="empty-state">
      <Image size={48} strokeWidth={1} />
      <p>No book selected</p>
    </div>
  {:else}
    <div class="images-intro">
      <Image size={48} strokeWidth={1} />
      <h3>Book Images</h3>
      <p>Browse all images from "{bookTitle || 'this book'}"</p>
      <button class="open-gallery-btn" on:click={() => dispatch('openGallery')}>
        <ExternalLink size={16} />
        Open Image Gallery
      </button>
    </div>
  {/if}
</div>

<style>
  .images-tab { height: 100%; display: flex; flex-direction: column; }
  .empty-state, .images-intro {
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
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-normal);
  }
  .images-intro p {
    margin: 0 0 24px;
    font-size: 0.85rem;
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
  }
  .open-gallery-btn:hover { filter: brightness(1.1); }
</style>
