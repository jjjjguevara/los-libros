import { ItemView, WorkspaceLeaf } from 'obsidian';
import type LosLibrosPlugin from '../main';
import ImagesComponent from './components/ImagesView.svelte';

export const IMAGES_VIEW_TYPE = 'los-libros-images';

interface ImagesViewState extends Record<string, unknown> {
  bookPath: string;
  bookTitle?: string;
}

export class ImagesView extends ItemView {
  plugin: LosLibrosPlugin;
  component: ImagesComponent | null = null;
  bookPath: string = '';
  bookTitle: string = '';

  constructor(leaf: WorkspaceLeaf, plugin: LosLibrosPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return IMAGES_VIEW_TYPE;
  }

  getDisplayText(): string {
    if (this.bookTitle) {
      return `Images: ${this.bookTitle}`;
    }
    if (this.bookPath) {
      const filename = this.bookPath.split('/').pop() ?? 'Images';
      return `Images: ${filename.replace(/\.epub$/i, '')}`;
    }
    return 'Images';
  }

  getIcon(): string {
    return 'image';
  }

  async setState(state: ImagesViewState, result: { history: boolean }): Promise<void> {
    this.bookPath = state.bookPath;
    this.bookTitle = state.bookTitle || '';

    await this.renderImages();
    await super.setState(state, result);

    // Update the leaf title
    this.app.workspace.requestSaveLayout();
  }

  getState(): ImagesViewState {
    return { bookPath: this.bookPath, bookTitle: this.bookTitle };
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('los-libros-images-view');

    if (this.bookPath) {
      await this.renderImages();
    }
  }

  async renderImages(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();

    if (this.component) {
      this.component.$destroy();
    }

    this.component = new ImagesComponent({
      target: container,
      props: {
        plugin: this.plugin,
        bookPath: this.bookPath,
        bookTitle: this.bookTitle
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
