<script lang="ts">
  /**
   * BookHealthBadge Component
   *
   * Displays book health information from Doc Doctor integration.
   * Shows a compact badge with health percentage and breakdown tooltip.
   */
  import { onMount, onDestroy } from 'svelte';
  import { setIcon } from 'obsidian';
  import type { Readable } from 'svelte/store';
  import type { BookHealth } from '../../integrations/doc-doctor-bridge';

  // Props
  export let health: BookHealth | null = null;
  export let healthStore: Readable<BookHealth | null> | null = null;
  export let compact = false;
  export let showBreakdown = true;

  // Local state
  let iconEl: HTMLElement;
  let currentHealth: BookHealth | null = health;
  let unsubscribe: (() => void) | null = null;

  onMount(() => {
    // Set icon
    if (iconEl) {
      setIcon(iconEl, 'heart-pulse');
    }

    // Subscribe to store if provided
    if (healthStore) {
      unsubscribe = healthStore.subscribe((h) => {
        currentHealth = h;
      });
    }
  });

  onDestroy(() => {
    if (unsubscribe) {
      unsubscribe();
    }
  });

  // Update from prop changes
  $: if (health !== null) {
    currentHealth = health;
  }

  // Computed values
  $: healthPercent = currentHealth ? Math.round(currentHealth.overall * 100) : 0;
  $: healthColor = getHealthColor(currentHealth?.overall ?? 0);
  $: healthLabel = getHealthLabel(currentHealth?.overall ?? 0);

  function getHealthColor(value: number): 'green' | 'yellow' | 'red' | 'muted' {
    if (value >= 0.7) return 'green';
    if (value >= 0.4) return 'yellow';
    if (value > 0) return 'red';
    return 'muted';
  }

  function getHealthLabel(value: number): string {
    if (value >= 0.8) return 'Excellent';
    if (value >= 0.6) return 'Good';
    if (value >= 0.4) return 'Fair';
    if (value > 0) return 'Needs Work';
    return 'Unknown';
  }

  function formatTooltip(): string {
    if (!currentHealth) return 'Book health not available';

    const { breakdown } = currentHealth;
    const lines = [
      `Book Health: ${healthPercent}% (${healthLabel})`,
      '',
      `Highlights: ${breakdown.highlightCount}`,
      `Stubs: ${breakdown.stubCount}`,
      `Resolved: ${breakdown.resolvedStubCount}`,
      `Coverage: ${Math.round(breakdown.annotationCoverage * 100)}%`,
    ];

    return lines.join('\n');
  }
</script>

{#if currentHealth}
  <div
    class="book-health-badge"
    class:compact
    class:health-green={healthColor === 'green'}
    class:health-yellow={healthColor === 'yellow'}
    class:health-red={healthColor === 'red'}
    class:health-muted={healthColor === 'muted'}
    title={formatTooltip()}
  >
    <span class="health-icon" bind:this={iconEl}></span>
    <span class="health-percent">{healthPercent}%</span>

    {#if showBreakdown && !compact}
      <div class="health-breakdown">
        <span class="breakdown-item" title="Highlights">
          <span class="breakdown-icon highlight-icon"></span>
          {currentHealth.breakdown.highlightCount}
        </span>
        <span class="breakdown-item" title="Open stubs">
          <span class="breakdown-icon stub-icon"></span>
          {currentHealth.breakdown.stubCount - currentHealth.breakdown.resolvedStubCount}
        </span>
        <span class="breakdown-item" title="Resolved stubs">
          <span class="breakdown-icon resolved-icon"></span>
          {currentHealth.breakdown.resolvedStubCount}
        </span>
      </div>
    {/if}
  </div>
{:else}
  <div class="book-health-badge empty" class:compact title="Book health not available">
    <span class="health-icon" bind:this={iconEl}></span>
    <span class="health-percent">--</span>
  </div>
{/if}

<style>
  .book-health-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--size-4-1);
    padding: var(--size-4-1) var(--size-4-2);
    border-radius: var(--radius-s);
    font-family: var(--font-monospace);
    font-size: var(--font-ui-smaller);
    background: var(--background-secondary);
    transition: background-color 0.15s ease;
  }

  .book-health-badge:hover {
    background: var(--background-modifier-hover);
  }

  .book-health-badge.compact {
    padding: 0 var(--size-4-1);
    gap: 2px;
    background: transparent;
  }

  .book-health-badge.empty {
    opacity: 0.5;
  }

  .health-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
  }

  .health-icon :global(svg) {
    width: 14px;
    height: 14px;
  }

  .health-percent {
    font-weight: var(--font-semibold);
    min-width: 32px;
    text-align: right;
  }

  .health-breakdown {
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
    margin-left: var(--size-4-1);
    padding-left: var(--size-4-2);
    border-left: 1px solid var(--background-modifier-border);
  }

  .breakdown-item {
    display: flex;
    align-items: center;
    gap: 2px;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
  }

  .breakdown-icon {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .highlight-icon {
    background: var(--color-yellow);
  }

  .stub-icon {
    background: var(--color-orange);
  }

  .resolved-icon {
    background: var(--color-green);
  }

  /* Health color states */
  .health-green .health-icon,
  .health-green .health-percent {
    color: var(--color-green);
  }

  .health-yellow .health-icon,
  .health-yellow .health-percent {
    color: var(--color-yellow);
  }

  .health-red .health-icon,
  .health-red .health-percent {
    color: var(--color-red);
  }

  .health-muted .health-icon,
  .health-muted .health-percent {
    color: var(--text-muted);
  }
</style>
