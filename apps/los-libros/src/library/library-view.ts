import { ItemView, WorkspaceLeaf } from 'obsidian';
import type LosLibrosPlugin from '../main';
import LibraryComponent from './components/LibraryView.svelte';

export const LIBRARY_VIEW_TYPE = 'los-libros-library';

export class LibraryView extends ItemView {
  plugin: LosLibrosPlugin;
  component: LibraryComponent | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LosLibrosPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return LIBRARY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Los Libros';
  }

  getIcon(): string {
    return 'book-open';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('los-libros-library');

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
