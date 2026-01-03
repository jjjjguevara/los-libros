/**
 * Cache Statistics View
 *
 * An ItemView that displays cache statistics and provides
 * management controls for the tiered cache system.
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import type AmnesiaPlugin from '../main';
import CacheStatsPanel from './components/CacheStatsPanel.svelte';

export const CACHE_STATS_VIEW_TYPE = 'amnesia-cache-stats';

export class CacheStatsView extends ItemView {
  plugin: AmnesiaPlugin;
  component: CacheStatsPanel | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: AmnesiaPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return CACHE_STATS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Cache Statistics';
  }

  getIcon(): string {
    return 'database';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('amnesia-cache-stats-view');

    if (!this.plugin.tieredCache) {
      container.createEl('div', {
        cls: 'cache-not-available',
        text: 'Cache system not available. Enable caching in settings.',
      });
      return;
    }

    this.component = new CacheStatsPanel({
      target: container,
      props: {
        cache: this.plugin.tieredCache,
      },
    });
  }

  async onClose(): Promise<void> {
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }
  }
}
