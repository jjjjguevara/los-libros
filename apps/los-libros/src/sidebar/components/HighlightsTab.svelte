<script lang="ts">
  /**
   * Highlights Tab Component
   *
   * Displays book highlights grouped by chapter.
   */
  import { createEventDispatcher } from 'svelte';
  import type { Highlight, HighlightColor } from '../../library/types';
  import {
    ChevronDown,
    ChevronRight,
    Trash2,
  } from 'lucide-svelte';

  export let highlights: Highlight[] = [];

  const dispatch = createEventDispatcher<{
    navigate: { cfi: string; text: string };
    delete: { id: string };
  }>();

  let expandedChapters = new Set<string>();

  // Group highlights by chapter
  $: highlightsByChapter = groupByChapter(highlights);

  // Auto-expand all chapters on load for easier navigation
  $: {
    const allChapters = new Set(highlightsByChapter.keys());
    if (allChapters.size > 0 && expandedChapters.size === 0) {
      expandedChapters = allChapters;
    }
  }

  function groupByChapter(items: Highlight[]): Map<string, Highlight[]> {
    const grouped = new Map<string, Highlight[]>();
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

  function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  }

  function formatDate(date: Date): string {
    return new Date(date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }
</script>

<div class="highlights-tab">
  {#if highlights.length === 0}
    <div class="empty-state">
      <p>No highlights yet</p>
      <p class="hint">Select text while reading to create highlights</p>
    </div>
  {:else}
    {#each [...highlightsByChapter] as [chapter, chapterHighlights] (chapter)}
      <div class="chapter-group">
        <button
          class="chapter-header"
          on:click={() => toggleChapter(chapter)}
        >
          {#if expandedChapters.has(chapter)}
            <ChevronDown size={14} />
          {:else}
            <ChevronRight size={14} />
          {/if}
          <span class="chapter-name">{chapter}</span>
          <span class="count">{chapterHighlights.length}</span>
        </button>

        {#if expandedChapters.has(chapter)}
          <div class="items">
            {#each chapterHighlights as highlight (highlight.id)}
              <div
                class="item highlight-item"
                style={getHighlightColorStyle(highlight.color)}
                role="button"
                tabindex="0"
                on:click={() => dispatch('navigate', { cfi: highlight.cfi, text: highlight.text })}
                on:keydown={(e) => e.key === 'Enter' && dispatch('navigate', { cfi: highlight.cfi, text: highlight.text })}
              >
                <div class="item-text">"{truncateText(highlight.text, 120)}"</div>
                {#if highlight.annotation}
                  <div class="item-note">{truncateText(highlight.annotation, 80)}</div>
                {/if}
                <div class="item-footer">
                  <span class="item-date">{formatDate(highlight.createdAt)}</span>
                  <button
                    class="delete-btn"
                    on:click|stopPropagation={() => dispatch('delete', { id: highlight.id })}
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
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
  .highlights-tab {
    display: flex;
    flex-direction: column;
    gap: 4px;
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
    margin-bottom: 4px;
  }

  .chapter-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 8px;
    background: var(--background-secondary);
    border: none;
    border-radius: var(--radius-s);
    cursor: pointer;
    text-align: left;
    font-size: 0.8rem;
    color: var(--text-normal);
  }

  .chapter-header:hover {
    background: var(--background-modifier-hover);
  }

  .chapter-name {
    flex: 1;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .count {
    font-size: 0.7rem;
    color: var(--text-muted);
    background: var(--background-primary);
    padding: 1px 5px;
    border-radius: 6px;
  }

  .items {
    padding-left: 8px;
    margin-top: 4px;
  }

  .item {
    padding: 8px 10px;
    margin-bottom: 4px;
    background: var(--background-secondary);
    border-radius: var(--radius-s);
    border-left: 3px solid transparent;
    cursor: pointer;
    transition: all 0.1s ease;
  }

  .item:hover {
    background: var(--background-modifier-hover);
  }

  .highlight-item {
    border-left-width: 4px;
  }

  .item-text {
    font-style: italic;
    font-size: 0.8rem;
    line-height: 1.4;
    color: var(--text-normal);
  }

  .item-note {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 4px;
    padding-left: 8px;
    border-left: 2px solid var(--background-modifier-border);
  }

  .item-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 6px;
  }

  .item-date {
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .delete-btn {
    padding: 2px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.1s;
  }

  .item:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    color: var(--text-error);
  }
</style>
