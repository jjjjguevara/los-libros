/**
 * Mock Obsidian Module for Testing
 *
 * Provides stub implementations of Obsidian API classes and types
 * to allow testing plugin code without the Obsidian runtime.
 */

// Types
export interface App {
  vault: Vault;
  workspace: Workspace;
  metadataCache: MetadataCache;
}

export interface Vault {
  getAbstractFileByPath(path: string): TAbstractFile | null;
  create(path: string, data: string): Promise<TFile>;
  modify(file: TFile, data: string): Promise<void>;
  delete(file: TAbstractFile, force?: boolean): Promise<void>;
  getMarkdownFiles(): TFile[];
  adapter: DataAdapter;
}

export interface DataAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
}

export interface Workspace {
  getLeavesOfType(type: string): WorkspaceLeaf[];
  getActiveViewOfType<T extends View>(type: ViewType<T>): T | null;
  on(name: string, callback: (...args: unknown[]) => unknown): EventRef;
  off(name: string, callback: (...args: unknown[]) => unknown): void;
}

export interface WorkspaceLeaf {
  view: View;
  getDisplayText(): string;
}

export interface View {
  contentEl: HTMLElement;
  containerEl: HTMLElement;
  getViewType(): string;
}

export type ViewType<T extends View> = new (...args: unknown[]) => T;

export interface MetadataCache {
  getFileCache(file: TFile): CachedMetadata | null;
  on(name: string, callback: (...args: unknown[]) => unknown): EventRef;
}

export interface CachedMetadata {
  frontmatter?: Record<string, unknown>;
  links?: LinkCache[];
}

export interface LinkCache {
  link: string;
  position: { start: Loc; end: Loc };
}

export interface Loc {
  line: number;
  col: number;
  offset: number;
}

export type EventRef = symbol;

export interface TAbstractFile {
  path: string;
  name: string;
  vault: Vault;
  parent: TFolder | null;
}

export interface TFile extends TAbstractFile {
  extension: string;
  stat: { mtime: number; ctime: number; size: number };
  basename: string;
}

export interface TFolder extends TAbstractFile {
  children: TAbstractFile[];
  isRoot(): boolean;
}

// Mock Classes
export class Component {
  load(): void {}
  unload(): void {}
  onload(): void {}
  onunload(): void {}
  registerEvent(_eventRef: EventRef): void {}
  registerDomEvent(_el: HTMLElement, _type: string, _callback: EventListener): void {}
  registerInterval(_id: number): number {
    return _id;
  }
  addChild<T extends Component>(child: T): T {
    return child;
  }
}

export class Plugin extends Component {
  app: App;
  manifest: PluginManifest;

  constructor(_app: App, _manifest: PluginManifest) {
    super();
    this.app = _app;
    this.manifest = _manifest;
  }

  addRibbonIcon(_icon: string, _title: string, _callback: () => void): HTMLElement {
    return document.createElement('div');
  }

  addSettingTab(_settingTab: PluginSettingTab): void {}

  loadData(): Promise<unknown> {
    return Promise.resolve({});
  }

  saveData(_data: unknown): Promise<void> {
    return Promise.resolve();
  }
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  author: string;
  description: string;
}

export class PluginSettingTab extends Component {
  app: App;
  plugin: Plugin;
  containerEl: HTMLElement;

  constructor(_app: App, _plugin: Plugin) {
    super();
    this.app = _app;
    this.plugin = _plugin;
    this.containerEl = document.createElement('div');
  }

  display(): void {}
  hide(): void {}
}

export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;

  constructor(_containerEl: HTMLElement) {
    this.settingEl = document.createElement('div');
    this.infoEl = document.createElement('div');
    this.nameEl = document.createElement('div');
    this.descEl = document.createElement('div');
    this.controlEl = document.createElement('div');
  }

  setName(_name: string): this {
    return this;
  }

  setDesc(_desc: string): this {
    return this;
  }

  addText(_cb: (text: TextComponent) => unknown): this {
    return this;
  }

  addTextArea(_cb: (text: TextAreaComponent) => unknown): this {
    return this;
  }

  addToggle(_cb: (toggle: ToggleComponent) => unknown): this {
    return this;
  }

  addDropdown(_cb: (dropdown: DropdownComponent) => unknown): this {
    return this;
  }

  addButton(_cb: (button: ButtonComponent) => unknown): this {
    return this;
  }

  addSlider(_cb: (slider: SliderComponent) => unknown): this {
    return this;
  }
}

export class TextComponent {
  inputEl: HTMLInputElement;

  constructor(_containerEl: HTMLElement) {
    this.inputEl = document.createElement('input');
  }

  setPlaceholder(_placeholder: string): this {
    return this;
  }

  setValue(_value: string): this {
    return this;
  }

  getValue(): string {
    return '';
  }

  onChange(_callback: (value: string) => unknown): this {
    return this;
  }
}

export class TextAreaComponent {
  inputEl: HTMLTextAreaElement;

  constructor(_containerEl: HTMLElement) {
    this.inputEl = document.createElement('textarea');
  }

  setPlaceholder(_placeholder: string): this {
    return this;
  }

  setValue(_value: string): this {
    return this;
  }

  getValue(): string {
    return '';
  }

  onChange(_callback: (value: string) => unknown): this {
    return this;
  }
}

export class ToggleComponent {
  toggleEl: HTMLElement;

  constructor(_containerEl: HTMLElement) {
    this.toggleEl = document.createElement('div');
  }

  setValue(_value: boolean): this {
    return this;
  }

  getValue(): boolean {
    return false;
  }

  onChange(_callback: (value: boolean) => unknown): this {
    return this;
  }
}

export class DropdownComponent {
  selectEl: HTMLSelectElement;

  constructor(_containerEl: HTMLElement) {
    this.selectEl = document.createElement('select');
  }

  addOption(_value: string, _display: string): this {
    return this;
  }

  addOptions(_options: Record<string, string>): this {
    return this;
  }

  setValue(_value: string): this {
    return this;
  }

  getValue(): string {
    return '';
  }

  onChange(_callback: (value: string) => unknown): this {
    return this;
  }
}

export class ButtonComponent {
  buttonEl: HTMLButtonElement;

  constructor(_containerEl: HTMLElement) {
    this.buttonEl = document.createElement('button');
  }

  setButtonText(_name: string): this {
    return this;
  }

  setCta(): this {
    return this;
  }

  setWarning(): this {
    return this;
  }

  onClick(_callback: () => unknown): this {
    return this;
  }
}

export class SliderComponent {
  sliderEl: HTMLInputElement;

  constructor(_containerEl: HTMLElement) {
    this.sliderEl = document.createElement('input');
    this.sliderEl.type = 'range';
  }

  setLimits(_min: number, _max: number, _step: number): this {
    return this;
  }

  setValue(_value: number): this {
    return this;
  }

  getValue(): number {
    return 0;
  }

  onChange(_callback: (value: number) => unknown): this {
    return this;
  }

  setDynamicTooltip(): this {
    return this;
  }
}

export class Notice {
  noticeEl: HTMLElement;

  constructor(_message: string, _timeout?: number) {
    this.noticeEl = document.createElement('div');
  }

  hide(): void {}
}

export class Modal extends Component {
  app: App;
  contentEl: HTMLElement;
  titleEl: HTMLElement;
  modalEl: HTMLElement;

  constructor(_app: App) {
    super();
    this.app = _app;
    this.contentEl = document.createElement('div');
    this.titleEl = document.createElement('div');
    this.modalEl = document.createElement('div');
  }

  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

// Utility functions
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function moment(): unknown {
  return {
    format: (fmt: string) => new Date().toISOString(),
    fromNow: () => 'just now',
  };
}

// Export everything needed
export default {
  App: class {} as unknown as typeof App,
  Plugin,
  PluginSettingTab,
  Setting,
  TextComponent,
  TextAreaComponent,
  ToggleComponent,
  DropdownComponent,
  ButtonComponent,
  SliderComponent,
  Notice,
  Modal,
  Component,
  normalizePath,
  moment,
};
