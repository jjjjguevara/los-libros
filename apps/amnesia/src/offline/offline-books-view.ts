/**
 * Offline Books View
 *
 * An ItemView that displays offline books and provides
 * management controls for offline reading.
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import type AmnesiaPlugin from '../main';
import OfflineBooksViewComponent from './components/OfflineBooksView.svelte';

export const OFFLINE_BOOKS_VIEW_TYPE = 'amnesia-offline-books';

export class OfflineBooksView extends ItemView {
  plugin: AmnesiaPlugin;
  component: OfflineBooksViewComponent | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: AmnesiaPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return OFFLINE_BOOKS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Offline Books';
  }

  getIcon(): string {
    return 'cloud-off';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('amnesia-offline-books-view');

    this.component = new OfflineBooksViewComponent({
      target: container,
      props: {
        offlineManager: this.plugin.offlineManager,
      },
    });

    // Handle events from the component
    this.component.$on('open', (e: CustomEvent<{ bookId: string }>) => {
      this.plugin.openBook(e.detail.bookId);
    });

    this.component.$on('remove', () => {
      // Book removed, component will refresh automatically
    });
  }

  async onClose(): Promise<void> {
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }
  }
}
