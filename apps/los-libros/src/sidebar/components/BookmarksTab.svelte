<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Bookmark } from '../../bookmarks/bookmark-types';
  import { ChevronDown, ChevronRight, Trash2, BookmarkIcon } from 'lucide-svelte';

  export let bookmarks: Bookmark[] = [];

  const dispatch = createEventDispatcher<{
    navigate: { cfi: string };
    delete: { id: string };
  }>();

  let expandedChapters = new Set<string>();

  $: bookmarksByChapter = groupByChapter(bookmarks);

  function groupByChapter(items: Bookmark[]): Map<string, Bookmark[]> {
    const grouped = new Map<string, Bookmark[]>();
    for (const item of items) {
      const chapter = item.chapter || 'Unknown Chapter';
      if (!grouped.has(chapter)) grouped.set(chapter, []);
      grouped.get(chapter)!.push(item);
    }
    return grouped;
  }

  function toggleChapter(chapter: string) {
    if (expandedChapters.has(chapter)) expandedChapters.delete(chapter);
    else expandedChapters.add(chapter);
    expandedChapters = expandedChapters;
  }

  function formatDate(date: Date): string {
    return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
</script>

<div class="bookmarks-tab">
  {#if bookmarks.length === 0}
    <div class="empty-state">
      <p>No bookmarks yet</p>
      <p class="hint">Tap the bookmark icon while reading</p>
    </div>
  {:else}
    {#each [...bookmarksByChapter] as [chapter, chapterBookmarks] (chapter)}
      <div class="chapter-group">
        <button class="chapter-header" on:click={() => toggleChapter(chapter)}>
          {#if expandedChapters.has(chapter)}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
          <span class="chapter-name">{chapter}</span>
          <span class="count">{chapterBookmarks.length}</span>
        </button>
        {#if expandedChapters.has(chapter)}
          <div class="items">
            {#each chapterBookmarks as bookmark (bookmark.id)}
              <div
                class="item"
                role="button"
                tabindex="0"
                on:click={() => dispatch('navigate', { cfi: bookmark.cfi })}
                on:keydown={(e) => e.key === 'Enter' && dispatch('navigate', { cfi: bookmark.cfi })}
              >
                <div class="item-title"><BookmarkIcon size={12} /> {bookmark.name || 'Unnamed'}</div>
                <div class="item-footer">
                  <span class="item-date">{formatDate(bookmark.createdAt)}</span>
                  <button class="delete-btn" on:click|stopPropagation={() => dispatch('delete', { id: bookmark.id })}><Trash2 size={12} /></button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .bookmarks-tab { display: flex; flex-direction: column; gap: 4px; }
  .empty-state { text-align: center; padding: 32px 16px; color: var(--text-muted); }
  .empty-state .hint { font-size: 0.8rem; margin-top: 8px; opacity: 0.7; }
  .chapter-group { margin-bottom: 4px; }
  .chapter-header { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 8px; background: var(--background-secondary); border: none; border-radius: var(--radius-s); cursor: pointer; text-align: left; font-size: 0.8rem; color: var(--text-normal); }
  .chapter-header:hover { background: var(--background-modifier-hover); }
  .chapter-name { flex: 1; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count { font-size: 0.7rem; color: var(--text-muted); background: var(--background-primary); padding: 1px 5px; border-radius: 6px; }
  .items { padding-left: 8px; margin-top: 4px; }
  .item { display: flex; flex-direction: column; padding: 8px 10px; margin-bottom: 4px; background: var(--background-secondary); border-radius: var(--radius-s); border-left: 3px solid var(--interactive-accent); cursor: pointer; }
  .item:hover { background: var(--background-modifier-hover); }
  .item-title { display: flex; align-items: center; gap: 4px; font-size: 0.85rem; font-weight: 500; }
  .item-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
  .item-date { font-size: 0.7rem; color: var(--text-muted); }
  .delete-btn { padding: 2px; background: transparent; border: none; cursor: pointer; color: var(--text-muted); opacity: 0; transition: opacity 0.1s; }
  .item:hover .delete-btn { opacity: 1; }
  .delete-btn:hover { color: var(--text-error); }
</style>
