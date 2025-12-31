<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ReadingNote } from '../../bookmarks/bookmark-types';
  import { ChevronDown, ChevronRight, Trash2 } from 'lucide-svelte';

  export let notes: ReadingNote[] = [];

  const dispatch = createEventDispatcher<{
    navigate: { cfi: string };
    delete: { id: string };
  }>();

  let expandedChapters = new Set<string>();

  $: notesByChapter = groupByChapter(notes);

  function groupByChapter(items: ReadingNote[]): Map<string, ReadingNote[]> {
    const grouped = new Map<string, ReadingNote[]>();
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

  function truncateText(text: string, max: number): string {
    return text.length <= max ? text : text.slice(0, max) + '...';
  }

  function formatDate(date: Date): string {
    return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
</script>

<div class="notes-tab">
  {#if notes.length === 0}
    <div class="empty-state">
      <p>No notes yet</p>
      <p class="hint">Add notes from the highlight popup</p>
    </div>
  {:else}
    {#each [...notesByChapter] as [chapter, chapterNotes] (chapter)}
      <div class="chapter-group">
        <button class="chapter-header" on:click={() => toggleChapter(chapter)}>
          {#if expandedChapters.has(chapter)}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
          <span class="chapter-name">{chapter}</span>
          <span class="count">{chapterNotes.length}</span>
        </button>
        {#if expandedChapters.has(chapter)}
          <div class="items">
            {#each chapterNotes as note (note.id)}
              <div
                class="item"
                role="button"
                tabindex="0"
                on:click={() => dispatch('navigate', { cfi: note.cfi })}
                on:keydown={(e) => e.key === 'Enter' && dispatch('navigate', { cfi: note.cfi })}
              >
                <div class="item-content">{truncateText(note.content, 150)}</div>
                {#if note.tags && note.tags.length > 0}
                  <div class="item-tags">
                    {#each note.tags as tag}<span class="tag">#{tag}</span>{/each}
                  </div>
                {/if}
                <div class="item-footer">
                  <span class="item-date">{formatDate(note.createdAt)}</span>
                  <button class="delete-btn" on:click|stopPropagation={() => dispatch('delete', { id: note.id })}><Trash2 size={12} /></button>
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
  .notes-tab { display: flex; flex-direction: column; gap: 4px; }
  .empty-state { text-align: center; padding: 32px 16px; color: var(--text-muted); }
  .empty-state .hint { font-size: 0.8rem; margin-top: 8px; opacity: 0.7; }
  .chapter-group { margin-bottom: 4px; }
  .chapter-header { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 8px; background: var(--background-secondary); border: none; border-radius: var(--radius-s); cursor: pointer; text-align: left; font-size: 0.8rem; color: var(--text-normal); }
  .chapter-header:hover { background: var(--background-modifier-hover); }
  .chapter-name { flex: 1; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count { font-size: 0.7rem; color: var(--text-muted); background: var(--background-primary); padding: 1px 5px; border-radius: 6px; }
  .items { padding-left: 8px; margin-top: 4px; }
  .item { padding: 8px 10px; margin-bottom: 4px; background: var(--background-secondary); border-radius: var(--radius-s); border-left: 3px solid var(--text-accent); cursor: pointer; }
  .item:hover { background: var(--background-modifier-hover); }
  .item-content { font-size: 0.8rem; line-height: 1.4; }
  .item-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .tag { font-size: 0.7rem; padding: 1px 5px; background: var(--background-modifier-border); border-radius: 4px; color: var(--text-muted); }
  .item-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
  .item-date { font-size: 0.7rem; color: var(--text-muted); }
  .delete-btn { padding: 2px; background: transparent; border: none; cursor: pointer; color: var(--text-muted); opacity: 0; transition: opacity 0.1s; }
  .item:hover .delete-btn { opacity: 1; }
  .delete-btn:hover { color: var(--text-error); }
</style>
