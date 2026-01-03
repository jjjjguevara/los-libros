import { ItemView, WorkspaceLeaf } from 'obsidian';
import type AmnesiaPlugin from '../main';
import OPDSBrowser from './components/OPDSBrowser.svelte';

export const OPDS_VIEW_TYPE = 'amnesia-opds';

interface OPDSViewState extends Record<string, unknown> {
  catalogUrl: string;
}

export class OPDSView extends ItemView {
  plugin: AmnesiaPlugin;
  component: OPDSBrowser | null = null;
  catalogUrl: string = '';

  constructor(leaf: WorkspaceLeaf, plugin: AmnesiaPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return OPDS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'OPDS Catalog';
  }

  getIcon(): string {
    return 'library';
  }

  async setState(state: OPDSViewState, result: { history: boolean }): Promise<void> {
    this.catalogUrl = state.catalogUrl || this.plugin.settings.serverUrl + '/opds';
    await this.renderBrowser();
    await super.setState(state, result);
  }

  getState(): OPDSViewState {
    return { catalogUrl: this.catalogUrl };
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('amnesia-opds-view');

    // Use server URL if available, otherwise show placeholder
    this.catalogUrl = this.plugin.settings.serverUrl
      ? this.plugin.settings.serverUrl + '/opds'
      : '';

    await this.renderBrowser();
  }

  async renderBrowser(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();

    if (this.component) {
      this.component.$destroy();
    }

    if (!this.catalogUrl) {
      container.createEl('div', {
        cls: 'opds-no-server',
        text: 'Configure a Amnesia server URL in settings to browse OPDS catalogs.',
      });
      return;
    }

    this.component = new OPDSBrowser({
      target: container,
      props: {
        plugin: this.plugin,
        catalogUrl: this.catalogUrl,
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
