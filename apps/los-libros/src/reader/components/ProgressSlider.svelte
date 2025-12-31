<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { ChevronLeft, ChevronRight, Play, Pause, Settings2 } from 'lucide-svelte';
  import { HapticFeedback } from '../../utils/haptics';

  export let progress: number = 0; // 0-100
  export let currentChapter: string = '';
  export let totalPages: number = 0;
  export let currentPage: number = 0;
  export let isAutoScrolling: boolean = false;
  export let autoScrollSpeed: number = 5;
  export let hapticEnabled: boolean = true;

  const dispatch = createEventDispatcher<{
    seek: { percent: number };
    prev: void;
    next: void;
    toggleAutoScroll: void;
    speedChange: { speed: number };
  }>();

  let sliderContainer: HTMLElement;
  let isDragging = false;
  let showTooltip = false;
  let tooltipValue = 0;
  let tooltipX = 0;
  let lastHapticPage = -1; // Track last page for haptic ticking

  // Calculate approximate page from progress
  $: approximatePage = totalPages > 0
    ? Math.round((tooltipValue / 100) * totalPages)
    : Math.round(tooltipValue);

  // Trigger haptic tick when page changes during drag
  function triggerHapticTick(newPage: number) {
    if (hapticEnabled && isDragging && newPage !== lastHapticPage && totalPages > 0) {
      HapticFeedback.light();
      lastHapticPage = newPage;
    }
  }

  // Watch for page changes during drag
  $: if (isDragging) {
    triggerHapticTick(approximatePage);
  }

  function handleMouseDown(e: MouseEvent) {
    isDragging = true;
    showTooltip = true;
    updateFromMouse(e);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(e: MouseEvent) {
    if (isDragging) {
      updateFromMouse(e);
    }
  }

  function handleMouseUp(e: MouseEvent) {
    if (isDragging) {
      dispatch('seek', { percent: tooltipValue });
    }
    isDragging = false;
    showTooltip = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }

  function handleTouchStart(e: TouchEvent) {
    e.preventDefault(); // Prevent scroll while dragging
    isDragging = true;
    showTooltip = true;
    lastHapticPage = -1; // Reset haptic tracking
    updateFromTouch(e);
    // Add document-level listeners for reliable tracking outside component bounds
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);
  }

  function handleTouchMove(e: TouchEvent) {
    if (isDragging) {
      e.preventDefault(); // Prevent scroll while dragging
      updateFromTouch(e);
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    if (isDragging) {
      dispatch('seek', { percent: tooltipValue });
      if (hapticEnabled) {
        HapticFeedback.medium(); // Confirm selection
      }
    }
    isDragging = false;
    showTooltip = false;
    // Remove document-level listeners
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleTouchEnd);
    document.removeEventListener('touchcancel', handleTouchEnd);
  }

  function updateFromMouse(e: MouseEvent) {
    if (!sliderContainer) return;
    const rect = sliderContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    tooltipValue = percent;
    tooltipX = x;
  }

  function updateFromTouch(e: TouchEvent) {
    if (!sliderContainer || !e.touches[0]) return;
    const rect = sliderContainer.getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    tooltipValue = percent;
    tooltipX = x;
  }

  function handleSliderClick(e: MouseEvent) {
    if (!sliderContainer) return;
    const rect = sliderContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    dispatch('seek', { percent });
  }

  function handleSliderHover(e: MouseEvent) {
    if (isDragging) return;
    if (!sliderContainer) return;
    const rect = sliderContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    tooltipValue = percent;
    tooltipX = x;
    showTooltip = true;
  }

  function handleSliderLeave() {
    if (!isDragging) {
      showTooltip = false;
    }
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();

    // Calculate step size based on total pages (1 page per scroll notch, or 5% if no pages)
    const step = totalPages > 0 ? (100 / totalPages) : 5;

    // Scroll down/right = forward (increase), scroll up/left = backward (decrease)
    const delta = e.deltaY > 0 ? step : -step;
    const newPercent = Math.max(0, Math.min(100, progress + delta));

    if (newPercent !== progress) {
      if (hapticEnabled) {
        HapticFeedback.light();
      }
      dispatch('seek', { percent: newPercent });
    }
  }

  function formatTooltip(percent: number): string {
    if (totalPages > 0) {
      const page = Math.round((percent / 100) * totalPages);
      return `Page ${page} of ${totalPages}`;
    }
    return `${Math.round(percent)}%`;
  }

  onDestroy(() => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleTouchEnd);
    document.removeEventListener('touchcancel', handleTouchEnd);
  });
</script>

<div class="progress-slider-container">
  <!-- Navigation row -->
  <div class="nav-row">
    <button
      class="nav-btn"
      on:click|stopPropagation={() => dispatch('prev')}
      aria-label="Previous page"
    >
      <ChevronLeft size={20} />
    </button>

    <div
      class="slider-wrapper"
      bind:this={sliderContainer}
      on:mousedown|stopPropagation={handleMouseDown}
      on:click|stopPropagation={handleSliderClick}
      on:mousemove={handleSliderHover}
      on:mouseleave={handleSliderLeave}
      on:touchstart|stopPropagation={handleTouchStart}
      on:touchmove={handleTouchMove}
      on:touchend={handleTouchEnd}
      on:wheel|stopPropagation={handleWheel}
      role="slider"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
      tabindex="0"
    >
      <div class="slider-track">
        <div class="slider-fill" style="width: {isDragging ? tooltipValue : progress}%"></div>
        <div
          class="slider-thumb"
          style="left: {isDragging ? tooltipValue : progress}%"
          class:dragging={isDragging}
        ></div>
      </div>

      {#if showTooltip}
        <div
          class="slider-tooltip"
          style="left: {tooltipX}px"
        >
          {formatTooltip(tooltipValue)}
        </div>
      {/if}
    </div>

    <button
      class="nav-btn"
      on:click|stopPropagation={() => dispatch('next')}
      aria-label="Next page"
    >
      <ChevronRight size={20} />
    </button>
  </div>

  <!-- Info row -->
  <div class="info-row">
    <span class="progress-text">
      {#if totalPages > 0}
        Page {currentPage} of {totalPages}
      {:else}
        {Math.round(progress)}%
      {/if}
    </span>

    {#if currentChapter}
      <span class="chapter-text" title={currentChapter}>
        {currentChapter}
      </span>
    {/if}

    <div class="controls-right">
      <button
        class="control-btn"
        class:active={isAutoScrolling}
        on:click|stopPropagation={() => dispatch('toggleAutoScroll')}
        aria-label={isAutoScrolling ? 'Stop auto-scroll' : 'Start auto-scroll'}
        title={isAutoScrolling ? 'Stop auto-scroll' : 'Auto-scroll'}
      >
        {#if isAutoScrolling}
          <Pause size={16} />
        {:else}
          <Play size={16} />
        {/if}
      </button>

      {#if isAutoScrolling}
        <div class="speed-control">
          <input
            type="range"
            min="1"
            max="10"
            bind:value={autoScrollSpeed}
            on:input={() => dispatch('speedChange', { speed: autoScrollSpeed })}
            class="speed-slider"
            title="Auto-scroll speed: {autoScrollSpeed}"
          />
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .progress-slider-container {
    padding: 8px 16px 12px;
    background: var(--background-primary);
    border-top: 1px solid var(--background-modifier-border);
    user-select: none;
  }

  .nav-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }

  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: var(--background-secondary);
    border: none;
    border-radius: 50%;
    cursor: pointer;
    color: var(--text-normal);
    transition: all 0.2s ease;
  }

  .nav-btn:hover {
    background: var(--background-modifier-hover);
    transform: scale(1.05);
  }

  .nav-btn:active {
    transform: scale(0.95);
  }

  .slider-wrapper {
    flex: 1;
    position: relative;
    height: 32px;
    display: flex;
    align-items: center;
    cursor: pointer;
  }

  .slider-track {
    position: relative;
    width: 100%;
    height: 6px;
    background: var(--background-modifier-border);
    border-radius: 3px;
    overflow: visible;
  }

  .slider-fill {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    background: var(--interactive-accent);
    border-radius: 3px;
    transition: width 0.1s ease;
  }

  .slider-thumb {
    position: absolute;
    top: 50%;
    width: 16px;
    height: 16px;
    background: var(--interactive-accent);
    border: 2px solid var(--background-primary);
    border-radius: 50%;
    transform: translate(-50%, -50%);
    cursor: grab;
    transition: transform 0.1s ease, box-shadow 0.1s ease;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .slider-thumb:hover,
  .slider-thumb.dragging {
    transform: translate(-50%, -50%) scale(1.2);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .slider-thumb.dragging {
    cursor: grabbing;
  }

  .slider-tooltip {
    position: absolute;
    bottom: 100%;
    transform: translateX(-50%);
    padding: 4px 8px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    font-size: 0.75rem;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    margin-bottom: 8px;
    pointer-events: none;
    z-index: 1000;
  }

  .slider-tooltip::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-top-color: var(--background-modifier-border);
  }

  .info-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .progress-text {
    font-weight: 500;
  }

  .chapter-text {
    flex: 1;
    text-align: center;
    padding: 0 12px;
    overflow: hidden;
    white-space: nowrap;
    max-width: 100%;
    position: relative;
    /* Use gradient fade instead of ellipsis */
    mask-image: linear-gradient(to right, black 90%, transparent 100%);
    -webkit-mask-image: linear-gradient(to right, black 90%, transparent 100%);
  }

  .controls-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .control-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: var(--background-secondary);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-muted);
    transition: all 0.2s ease;
  }

  .control-btn:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .control-btn.active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .speed-control {
    display: flex;
    align-items: center;
  }

  .speed-slider {
    width: 60px;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--background-modifier-border);
    border-radius: 2px;
    cursor: pointer;
  }

  .speed-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    background: var(--interactive-accent);
    border-radius: 50%;
    cursor: pointer;
  }

  .speed-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    background: var(--interactive-accent);
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }
</style>
