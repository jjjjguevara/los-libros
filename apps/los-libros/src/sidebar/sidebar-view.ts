/**
 * Book Sidebar View
 *
 * Obsidian ItemView for the book sidebar.
 * Based on Doc Doctor sidebar pattern.
 */
import { ItemView, WorkspaceLeaf } from 'obsidian';
import type LosLibrosPlugin from '../main';
import Sidebar from './components/Sidebar.svelte';

export const BOOK_SIDEBAR_VIEW_TYPE = 'los-libros-book-sidebar';

export class BookSidebarView extends ItemView {
  component: Sidebar | undefined;
  icon = 'book-open';

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: LosLibrosPlugin,
  ) {
    super(leaf);
  }

  getViewType() {
    return BOOK_SIDEBAR_VIEW_TYPE;
  }

  getDisplayText() {
    return 'Book Notebook';
  }

  async onOpen() {
    this.contentEl.addClass('los-libros-book-sidebar');
    this.component = new Sidebar({
      target: this.contentEl,
      props: {
        plugin: this.plugin,
      },
    });
  }

  async onClose() {
    this.component?.$destroy();
  }
}
