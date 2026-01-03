import { ItemView, WorkspaceLeaf } from 'obsidian';
import type AmnesiaPlugin from '../main';
import HighlightsSidebar from './components/HighlightsSidebar.svelte';

export const HIGHLIGHTS_VIEW_TYPE = 'amnesia-highlights';

export class HighlightsView extends ItemView {
  plugin: AmnesiaPlugin;
  component: HighlightsSidebar | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: AmnesiaPlugin) {
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
    container.addClass('amnesia-highlights-view');

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
