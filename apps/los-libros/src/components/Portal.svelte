<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  // Target element to portal to (defaults to document.body)
  export let target: HTMLElement | null = null;

  let portalTarget: HTMLElement;
  let container: HTMLElement;

  onMount(() => {
    portalTarget = target || document.body;
    // Move container to target
    portalTarget.appendChild(container);
  });

  onDestroy(() => {
    // Clean up - remove from DOM
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });
</script>

<div bind:this={container} class="los-libros-portal">
  <slot />
</div>

<style>
  .los-libros-portal {
    /* Portal container should be invisible, only children matter */
    display: contents;
  }
</style>
