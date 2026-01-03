import { ItemView, WorkspaceLeaf } from 'obsidian';
import type AmnesiaPlugin from '../main';
import LibraryComponent from './components/LibraryView.svelte';

export const LIBRARY_VIEW_TYPE = 'amnesia-library';

export class LibraryView extends ItemView {
  plugin: AmnesiaPlugin;
  component: LibraryComponent | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: AmnesiaPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LIBRARY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Amnesia';
  }

  getIcon(): string {
    return 'book-open';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('amnesia-library');

    this.component = new LibraryComponent({
      target: container,
      props: {
        plugin: this.plugin,
        store: this.plugin.libraryStore
      }
    });
  }

  async onClose(): Promise<void> {
    if (this.component) {
      this.component.$destroy();
      this.component = null;
    }
  }
}
