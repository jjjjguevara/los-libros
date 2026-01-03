<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import {
    Highlighter,
    MessageSquare,
    X,
    Bookmark,
    Tag,
    Underline,
    Copy,
    Link,
    Trash2,
    Lock,
    Unlock,
    Edit3,
    Check,
  } from 'lucide-svelte';
  import type { HighlightColor, Highlight } from '../../library/types';
  import type { PendingSelection } from '../highlight-store';

  // Mode: 'new' for new selection, 'existing' for clicking on existing highlight
  export let mode: 'new' | 'existing' = 'new';
  export let selection: PendingSelection | null = null;
  export let existingHighlight: Highlight | null = null;
  export let position: { x: number; y: number };
  export let existingTags: string[] = [];

  const dispatch = createEventDispatcher<{
    highlight: { color: HighlightColor; annotation?: string; tags?: string[]; type?: 'highlight' | 'underline' };
    updateHighlight: { id: string; color?: HighlightColor; annotation?: string; tags?: string[]; locked?: boolean };
    deleteHighlight: { id: string };
    bookmark: { name?: string };
    copyText: { text: string };
    copyLink: { cfi: string; bookId: string };
    close: void;
  }>();

  const colors: { color: HighlightColor; label: string; css: string }[] = [
    { color: 'yellow', label: 'Yellow', css: '#fef3c7' },
    { color: 'green', label: 'Green', css: '#d1fae5' },
    { color: 'blue', label: 'Blue', css: '#dbeafe' },
    { color: 'pink', label: 'Pink', css: '#fce7f3' },
    { color: 'purple', label: 'Purple', css: '#ede9fe' },
  ];

  let showAnnotation = false;
  let showTags = false;
  let annotation = '';
  let selectedColor: HighlightColor = 'yellow';
  let highlightType: 'highlight' | 'underline' = 'highlight';
  let tags: string[] = [];
  let newTag = '';
  let isEditing = false;
  let isLocked = false;

  // Initialize from existing highlight if in existing mode
  onMount(() => {
    if (mode === 'existing' && existingHighlight) {
      selectedColor = existingHighlight.color;
      annotation = existingHighlight.annotation || '';
      tags = existingHighlight.tags || [];
      isLocked = existingHighlight.locked || false;
      if (annotation) showAnnotation = true;
      if (tags.length > 0) showTags = true;
    }
  });

  // Get display text
  $: displayText = mode === 'existing' && existingHighlight
    ? existingHighlight.text
    : selection?.text || '';

  function handleColorClick(color: HighlightColor) {
    selectedColor = color;
    if (mode === 'existing' && existingHighlight && !isLocked) {
      // Update existing highlight color
      dispatch('updateHighlight', { id: existingHighlight.id, color });
    } else if (mode === 'new') {
      // Auto-apply new highlight immediately when color is clicked
      dispatch('highlight', {
        color: selectedColor,
        annotation: annotation.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        type: highlightType,
      });
    }
  }

  function handleHighlight() {
    dispatch('highlight', {
      color: selectedColor,
      annotation: annotation.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      type: highlightType,
    });
  }

  function handleUpdateHighlight() {
    if (!existingHighlight) return;
    dispatch('updateHighlight', {
      id: existingHighlight.id,
      color: selectedColor,
      annotation: annotation.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
    });
    isEditing = false;
  }

  function handleDeleteHighlight() {
    if (!existingHighlight) return;
    dispatch('deleteHighlight', { id: existingHighlight.id });
  }

  function handleToggleLock() {
    if (!existingHighlight) return;
    isLocked = !isLocked;
    dispatch('updateHighlight', { id: existingHighlight.id, locked: isLocked });
  }

  function handleAnnotateClick() {
    showAnnotation = !showAnnotation;
    if (showAnnotation) showTags = false;
  }

  function handleTagsClick() {
    showTags = !showTags;
    if (showTags) showAnnotation = false;
  }

  function handleBookmark() {
    dispatch('bookmark', {
      name: displayText.slice(0, 50),
    });
  }

  function handleCopyText() {
    dispatch('copyText', { text: displayText });
    // Also copy to clipboard directly
    navigator.clipboard.writeText(displayText).catch(() => {});
  }

  function handleCopyLink() {
    const cfi = mode === 'existing' && existingHighlight
      ? existingHighlight.cfi
      : selection?.cfi || '';
    const bookId = mode === 'existing' && existingHighlight
      ? existingHighlight.bookId
      : selection?.bookId || '';
    dispatch('copyLink', { cfi, bookId });
  }

  function addTag() {
    const trimmed = newTag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      tags = [...tags, trimmed];
      newTag = '';
    }
  }

  function removeTag(tag: string) {
    tags = tags.filter(t => t !== tag);
  }

  function selectExistingTag(tag: string) {
    if (!tags.includes(tag)) {
      tags = [...tags, tag];
    }
  }

  function handleTagKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  }

  function handleClose() {
    dispatch('close');
  }

  function toggleHighlightType() {
    highlightType = highlightType === 'highlight' ? 'underline' : 'highlight';
  }

  // Filter suggestions based on input
  $: tagSuggestions = existingTags.filter(
    t => t.toLowerCase().includes(newTag.toLowerCase()) && !tags.includes(t)
  ).slice(0, 5);

  // Simple popup positioning - appears at cursor, clamps to viewport
  let popupElement: HTMLElement | null = null;

  function calculatePosition(pos: { x: number; y: number }): { x: number; y: number } {
    const popupWidth = 300; // Fixed width from CSS
    const popupHeight = 250; // Approximate height
    const padding = 10;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Start at cursor position
    let x = pos.x;
    let y = pos.y;

    // Keep popup within viewport horizontally
    if (x + popupWidth > viewportWidth - padding) {
      x = viewportWidth - popupWidth - padding;
    }
    if (x < padding) {
      x = padding;
    }

    // Keep popup within viewport vertically
    if (y + popupHeight > viewportHeight - padding) {
      y = viewportHeight - popupHeight - padding;
    }
    if (y < padding) {
      y = padding;
    }

    console.log('[HighlightPopup] Position calc: input=(' + pos.x + ',' + pos.y + ') output=(' + x + ',' + y + ') viewport=(' + viewportWidth + 'x' + viewportHeight + ')');
    return { x, y };
  }

  // Recalculate whenever position prop changes
  $: calculatedPosition = calculatePosition(position);

  $: popupStyle = `
    left: ${calculatedPosition.x}px;
    top: ${calculatedPosition.y}px;
  `;
</script>

<div class="highlight-popup" bind:this={popupElement} style={popupStyle}>
  <div class="popup-header">
    <span class="selected-text">"{displayText.slice(0, 50)}{displayText.length > 50 ? '...' : ''}"</span>
    <button class="close-btn" on:click={handleClose} aria-label="Close">
      <X size={14} />
    </button>
  </div>

  {#if mode === 'existing' && existingHighlight}
    <!-- Existing highlight mode -->
    <div class="color-picker">
      {#each colors as { color, label, css }}
        <button
          class="color-btn"
          class:selected={selectedColor === color}
          class:disabled={isLocked}
          style="background-color: {css};"
          title={label}
          on:click={() => !isLocked && handleColorClick(color)}
          disabled={isLocked}
        />
      {/each}
    </div>

    <div class="popup-actions">
      <button class="action-btn" on:click={handleCopyText} title="Copy text">
        <Copy size={16} />
      </button>
      <button class="action-btn" on:click={handleCopyLink} title="Copy link to highlight">
        <Link size={16} />
      </button>
      <button
        class="action-btn"
        class:active={isLocked}
        on:click={handleToggleLock}
        title={isLocked ? 'Unlock highlight' : 'Lock highlight'}
      >
        {#if isLocked}
          <Lock size={16} />
        {:else}
          <Unlock size={16} />
        {/if}
      </button>
      <button
        class="action-btn danger"
        on:click={handleDeleteHighlight}
        title="Delete highlight"
        disabled={isLocked}
      >
        <Trash2 size={16} />
      </button>
    </div>

    <div class="popup-actions secondary">
      <button class="action-btn" class:active={showAnnotation} on:click={handleAnnotateClick}>
        <MessageSquare size={16} />
        Note
      </button>
      <button class="action-btn" class:active={showTags} on:click={handleTagsClick}>
        <Tag size={16} />
        Tags
      </button>
    </div>

    {#if showAnnotation}
      <div class="annotation-section">
        <textarea
          bind:value={annotation}
          placeholder="Add a note..."
          rows="3"
          disabled={isLocked}
        />
        {#if annotation !== (existingHighlight.annotation || '') && !isLocked}
          <button class="save-btn" on:click={handleUpdateHighlight}>
            <Check size={14} />
            Save
          </button>
        {/if}
      </div>
    {/if}

  {:else}
    <!-- New selection mode -->
    <div class="color-picker">
      {#each colors as { color, label, css }}
        <button
          class="color-btn"
          class:selected={selectedColor === color}
          style="background-color: {css};"
          title={label}
          on:click={() => handleColorClick(color)}
        />
      {/each}
      <button
        class="type-toggle"
        class:active={highlightType === 'underline'}
        title={highlightType === 'highlight' ? 'Switch to underline' : 'Switch to highlight'}
        on:click={toggleHighlightType}
      >
        <Underline size={16} />
      </button>
    </div>

    <div class="popup-actions">
      <button class="action-btn primary" on:click={handleHighlight}>
        <Highlighter size={16} />
        {highlightType === 'highlight' ? 'Highlight' : 'Underline'}
      </button>
      <button class="action-btn" on:click={handleCopyText} title="Copy text">
        <Copy size={16} />
      </button>
      <button class="action-btn" on:click={handleBookmark} title="Bookmark this location">
        <Bookmark size={16} />
      </button>
    </div>

    <div class="popup-actions secondary">
      <button class="action-btn" class:active={showAnnotation} on:click={handleAnnotateClick}>
        <MessageSquare size={16} />
        Note
      </button>
      <button class="action-btn" class:active={showTags} on:click={handleTagsClick}>
        <Tag size={16} />
        Tags
      </button>
      <button class="action-btn" on:click={handleCopyLink} title="Copy link">
        <Link size={16} />
      </button>
    </div>

    {#if showAnnotation}
      <div class="annotation-section">
        <textarea
          bind:value={annotation}
          placeholder="Add a note..."
          rows="3"
        />
      </div>
    {/if}
  {/if}

  {#if showTags}
    <div class="tags-section">
      {#if tags.length > 0}
        <div class="selected-tags">
          {#each tags as tag}
            <span class="tag">
              {tag}
              {#if !isLocked}
                <button class="tag-remove" on:click={() => removeTag(tag)}>
                  <X size={12} />
                </button>
              {/if}
            </span>
          {/each}
        </div>
      {/if}
      {#if !isLocked}
        <div class="tag-input-container">
          <input
            type="text"
            bind:value={newTag}
            placeholder="Add tag..."
            on:keydown={handleTagKeydown}
          />
          <button class="tag-add" on:click={addTag} disabled={!newTag.trim()}>
            Add
          </button>
        </div>
        {#if tagSuggestions.length > 0 && newTag}
          <div class="tag-suggestions">
            {#each tagSuggestions as suggestion}
              <button class="tag-suggestion" on:click={() => selectExistingTag(suggestion)}>
                {suggestion}
              </button>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .highlight-popup {
    position: fixed;
    z-index: 999999; /* Very high to supersede all Obsidian UI */
    background: var(--amnesia-popup-bg, var(--background-primary));
    border: 1px solid var(--amnesia-popup-border, var(--background-modifier-border));
    border-radius: var(--amnesia-popup-radius, 8px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.2);
    width: 300px;
    padding: 12px;
    max-height: calc(100vh - 40px);
    overflow-y: auto;
  }

  .popup-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
  }

  .selected-text {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-style: italic;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .close-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px;
    color: var(--text-muted);
  }

  .close-btn:hover {
    color: var(--text-normal);
  }

  .color-picker {
    display: flex;
    gap: 6px;
    margin-bottom: 12px;
    align-items: center;
  }

  .color-btn {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform 0.1s ease;
  }

  .color-btn:hover:not(.disabled) {
    transform: scale(1.1);
  }

  .color-btn.selected {
    border-color: var(--text-normal);
  }

  .color-btn.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .type-toggle {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    cursor: pointer;
    margin-left: auto;
    color: var(--text-muted);
    transition: all 0.2s ease;
  }

  .type-toggle:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .type-toggle.active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-color: var(--interactive-accent);
  }

  .popup-actions {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }

  .popup-actions.secondary {
    margin-bottom: 0;
  }

  .action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 8px 8px;
    background: var(--background-secondary);
    border: none;
    border-radius: 6px;
    font-size: 0.75rem;
    cursor: pointer;
    transition: background 0.2s ease;
    color: var(--text-normal);
  }

  .action-btn:hover:not(:disabled) {
    background: var(--background-modifier-hover);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn.active {
    background: var(--background-modifier-active-hover);
  }

  .action-btn.primary {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .action-btn.primary:hover {
    filter: brightness(1.1);
  }

  .action-btn.danger:hover:not(:disabled) {
    background: var(--background-modifier-error);
    color: var(--text-on-accent);
  }

  .annotation-section,
  .tags-section {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--background-modifier-border);
  }

  .annotation-section textarea {
    width: 100%;
    padding: 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-secondary);
    color: var(--text-normal);
    font-size: 0.875rem;
    resize: vertical;
  }

  .annotation-section textarea:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .annotation-section textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .save-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
    padding: 6px 12px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    font-size: 0.8rem;
    cursor: pointer;
    margin-left: auto;
  }

  .save-btn:hover {
    filter: brightness(1.1);
  }

  .selected-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-radius: 12px;
    font-size: 0.75rem;
  }

  .tag-remove {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    color: var(--text-on-accent);
    opacity: 0.7;
  }

  .tag-remove:hover {
    opacity: 1;
  }

  .tag-input-container {
    display: flex;
    gap: 6px;
  }

  .tag-input-container input {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    background: var(--background-secondary);
    color: var(--text-normal);
    font-size: 0.8rem;
  }

  .tag-input-container input:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }

  .tag-add {
    padding: 6px 12px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border: none;
    border-radius: 4px;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .tag-add:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tag-suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
  }

  .tag-suggestion {
    padding: 4px 8px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    font-size: 0.7rem;
    cursor: pointer;
    color: var(--text-muted);
  }

  .tag-suggestion:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }
</style>
