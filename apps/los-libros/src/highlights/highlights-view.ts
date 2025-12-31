import { ItemView, WorkspaceLeaf } from 'obsidian';
import type LosLibrosPlugin from '../main';
import HighlightsSidebar from './components/HighlightsSidebar.svelte';

export const HIGHLIGHTS_VIEW_TYPE = 'los-libros-highlights';

export class HighlightsView extends ItemView {
  plugin: LosLibrosPlugin;
  component: HighlightsSidebar | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LosLibrosPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return HIGHLIGHTS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Highlights';
  }

  getIcon(): string {
    return 'highlighter';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('los-libros-highlights-view');

    this.component = new HighlightsSidebar({
      target: container,
      props: {
        plugin: this.plugin,
        store: this.plugin.highlightStore
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
