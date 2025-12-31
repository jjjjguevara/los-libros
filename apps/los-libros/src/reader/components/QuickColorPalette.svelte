<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { HapticFeedback } from '../../utils/haptics';
  import type { HighlightColor } from '../../library/types';

  export let x: number;
  export let y: number;
  export let visible = false;

  const dispatch = createEventDispatcher<{
    select: { color: HighlightColor };
    close: void;
  }>();

  // Color definitions that read from CSS variables
  const colors: { color: HighlightColor; label: string; cssVar: string; fallback: string }[] = [
    { color: 'yellow', label: 'Yellow', cssVar: '--los-libros-highlight-yellow', fallback: 'rgba(254, 243, 199, 0.6)' },
    { color: 'green', label: 'Green', cssVar: '--los-libros-highlight-green', fallback: 'rgba(209, 250, 229, 0.6)' },
    { color: 'blue', label: 'Blue', cssVar: '--los-libros-highlight-blue', fallback: 'rgba(219, 234, 254, 0.6)' },
    { color: 'pink', label: 'Pink', cssVar: '--los-libros-highlight-pink', fallback: 'rgba(252, 231, 243, 0.6)' },
    { color: 'purple', label: 'Purple', cssVar: '--los-libros-highlight-purple', fallback: 'rgba(237, 233, 254, 0.6)' },
  ];

  let paletteEl: HTMLDivElement;

  // Calculate position to keep palette on screen
  $: adjustedX = Math.max(10, Math.min(x, window.innerWidth - 200));
  $: adjustedY = Math.max(10, Math.min(y - 50, window.innerHeight - 60));

  function getColorValue(cssVar: string, fallback: string): string {
    if (typeof document === 'undefined') return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    return value || fallback;
  }

  function handleColorClick(color: HighlightColor) {
    HapticFeedback.light();
    dispatch('select', { color });
  }

  function handleClickOutside(event: MouseEvent) {
    if (paletteEl && !paletteEl.contains(event.target as Node)) {
      dispatch('close');
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      dispatch('close');
    }
    // Number keys 1-5 for quick selection
    const num = parseInt(event.key);
    if (num >= 1 && num <= 5) {
      handleColorClick(colors[num - 1].color);
    }
  }

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside as any);
    document.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    document.removeEventListener('mousedown', handleClickOutside);
    document.removeEventListener('touchstart', handleClickOutside as any);
    document.removeEventListener('keydown', handleKeydown);
  });
</script>

{#if visible}
  <div
    bind:this={paletteEl}
    class="los-libros-quick-palette"
    style="left: {adjustedX}px; top: {adjustedY}px;"
    role="toolbar"
    aria-label="Quick highlight colors"
  >
    {#each colors as { color, label, cssVar, fallback }, index}
      <button
        class="los-libros-quick-palette-color"
        style="background-color: {getColorValue(cssVar, fallback)};"
        title="{label} ({index + 1})"
        aria-label="Highlight with {label}"
        on:click={() => handleColorClick(color)}
      />
    {/each}
  </div>
{/if}

<style>
  /* Styles defined in src/styles.css for CSS variable compatibility */
</style>
