<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { SyncCheckpoint } from '../../sync/types';

  export let checkpoint: SyncCheckpoint | null = null;
  export let autoDismissMs = 10000;

  const dispatch = createEventDispatcher<{
    resume: void;
    dismiss: void;
    discard: void;
  }>();

  // Visibility state
  let visible = true;
  let dismissTimeout: ReturnType<typeof setTimeout> | null = null;
  let remainingTime = Math.ceil(autoDismissMs / 1000);
  let countdownInterval: ReturnType<typeof setInterval> | null = null;

  // Progress info
  $: progressPercentage = checkpoint
    ? Math.round(
        (Object.values(checkpoint.adapterProgress).reduce((a, b) => a + b, 0) /
          (checkpoint.pendingChanges.length + Object.values(checkpoint.adapterProgress).reduce((a, b) => a + b, 0))) *
          100
      ) || 0
    : 0;

  $: pendingCount = checkpoint?.pendingChanges.length ?? 0;

  // Format timestamp
  function formatTimestamp(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  }

  // Handle resume
  function handleResume() {
    clearTimers();
    visible = false;
    dispatch('resume');
  }

  // Handle dismiss (minimize to notification)
  function handleDismiss() {
    clearTimers();
    visible = false;
    dispatch('dismiss');
  }

  // Handle discard (delete checkpoint)
  function handleDiscard() {
    if (confirm('Are you sure you want to discard this incomplete sync? All progress will be lost.')) {
      clearTimers();
      visible = false;
      dispatch('discard');
    }
  }

  // Clear all timers
  function clearTimers() {
    if (dismissTimeout) {
      clearTimeout(dismissTimeout);
      dismissTimeout = null;
    }
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  // Pause auto-dismiss on hover
  function handleMouseEnter() {
    clearTimers();
  }

  // Resume auto-dismiss on mouse leave
  function handleMouseLeave() {
    startAutoDismiss();
  }

  // Start auto-dismiss countdown
  function startAutoDismiss() {
    if (autoDismissMs <= 0) return;

    remainingTime = Math.ceil(autoDismissMs / 1000);

    countdownInterval = setInterval(() => {
      remainingTime--;
      if (remainingTime <= 0) {
        handleDismiss();
      }
    }, 1000);

    dismissTimeout = setTimeout(() => {
      handleDismiss();
    }, autoDismissMs);
  }

  onMount(() => {
    startAutoDismiss();
    return clearTimers;
  });
</script>

{#if visible && checkpoint}
  <div
    class="resume-toast"
    role="alert"
    on:mouseenter={handleMouseEnter}
    on:mouseleave={handleMouseLeave}
  >
    <div class="toast-content">
      <!-- Icon -->
      <div class="toast-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
          <path d="M21 3v5h-5"></path>
        </svg>
      </div>

      <!-- Info -->
      <div class="toast-info">
        <h3>Incomplete Sync Detected</h3>
        <p>
          Your last sync was interrupted at {progressPercentage}% progress.
          {pendingCount} items remaining.
        </p>
        <span class="timestamp">Started: {formatTimestamp(checkpoint.timestamp)}</span>
      </div>

      <!-- Progress bar -->
      <div class="mini-progress">
        <div class="mini-progress-fill" style="width: {progressPercentage}%"></div>
      </div>

      <!-- Actions -->
      <div class="toast-actions">
        <button class="action resume" on:click={handleResume}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          Resume
        </button>
        <button class="action dismiss" on:click={handleDismiss}>
          Later
        </button>
        <button class="action discard" on:click={handleDiscard} title="Discard and start fresh">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>

      <!-- Countdown -->
      {#if remainingTime > 0}
        <div class="countdown">
          Dismissing in {remainingTime}s
        </div>
      {/if}

      <!-- Close button -->
      <button class="close-button" on:click={handleDismiss} aria-label="Close">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  </div>
{/if}

<style>
  .resume-toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 1000;
    animation: slideIn 0.3s ease;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .toast-content {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 20px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    max-width: 360px;
  }

  .toast-icon {
    position: absolute;
    top: 16px;
    left: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-radius: 8px;
  }

  .toast-info {
    padding-left: 52px;
  }

  .toast-info h3 {
    margin: 0 0 4px 0;
    font-size: 15px;
    font-weight: 600;
  }

  .toast-info p {
    margin: 0;
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .timestamp {
    display: block;
    margin-top: 4px;
    font-size: 11px;
    color: var(--text-faint);
  }

  .mini-progress {
    height: 4px;
    background: var(--background-modifier-border);
    border-radius: 2px;
    overflow: hidden;
  }

  .mini-progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    transition: width 0.3s ease;
  }

  .toast-actions {
    display: flex;
    gap: 8px;
  }

  .action {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s;
  }

  .action.resume {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    flex: 1;
    justify-content: center;
  }

  .action.resume:hover {
    opacity: 0.9;
  }

  .action.dismiss {
    background: var(--background-secondary);
    color: var(--text-muted);
  }

  .action.dismiss:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .action.discard {
    background: transparent;
    color: var(--text-muted);
    padding: 8px;
  }

  .action.discard:hover {
    color: var(--color-red);
    background: rgba(var(--color-red-rgb), 0.1);
  }

  .countdown {
    text-align: center;
    font-size: 11px;
    color: var(--text-faint);
  }

  .close-button {
    position: absolute;
    top: 8px;
    right: 8px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    color: var(--text-muted);
    border-radius: 4px;
    opacity: 0.6;
    transition: all 0.2s;
  }

  .close-button:hover {
    background: var(--background-modifier-hover);
    opacity: 1;
  }

  /* Mobile responsive */
  @media (max-width: 480px) {
    .resume-toast {
      bottom: 16px;
      right: 16px;
      left: 16px;
    }

    .toast-content {
      max-width: 100%;
    }
  }
</style>
