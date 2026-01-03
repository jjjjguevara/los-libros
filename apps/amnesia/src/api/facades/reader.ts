/**
 * Reader API Facade
 * @module api/facades/reader
 */

import { writable, type Readable, type Writable } from 'svelte/store';
import type {
  ReaderState,
  ReaderCommands,
  NavigationTarget,
  NavigatorConfig,
  Locator,
  SpineItem,
  Capability
} from '../types';
import { TypedEventEmitter } from '../events/emitter';
import { HookRegistry } from '../events/hooks';

/**
 * Reader state that can be updated by the ReaderView
 */
const defaultReaderState: ReaderState = {
  location: null,
  config: {
    fontSize: 16,
    fontFamily: 'system-ui',
    lineHeight: 1.6,
    textAlign: 'left',
    theme: 'light',
    displayMode: 'paginated',
    columnCount: 1,
    margins: 20,
    textDirection: 'ltr'
  },
  bookId: null,
  spine: [],
  currentSpineIndex: 0,
  totalPages: 0,
  currentPage: 0,
  loading: false
};

/**
 * Reader state store singleton
 * This is updated by the ReaderView when navigation occurs
 */
let readerStateStore: Writable<ReaderState> | null = null;

/**
 * Get or create the reader state store
 */
export function getReaderStateStore(): Writable<ReaderState> {
  if (!readerStateStore) {
    readerStateStore = writable(defaultReaderState);
  }
  return readerStateStore;
}

/**
 * Navigation callback type
 * Set by ReaderView to handle navigation requests
 */
type NavigationCallback = (target: NavigationTarget) => Promise<void>;
type ConfigUpdateCallback = (config: Partial<NavigatorConfig>) => void;
type GetVisibleTextCallback = () => string | null;
type GetCfiForRangeCallback = (range: Range) => string | null;

/**
 * Reader bridge - connects API to ReaderView
 */
class ReaderBridge {
  private navigateCallback: NavigationCallback | null = null;
  private updateConfigCallback: ConfigUpdateCallback | null = null;
  private getVisibleTextCallback: GetVisibleTextCallback | null = null;
  private getCfiForRangeCallback: GetCfiForRangeCallback | null = null;

  /**
   * Register navigation callback (called by ReaderView)
   */
  registerNavigate(callback: NavigationCallback): void {
    this.navigateCallback = callback;
  }

  /**
   * Register config update callback (called by ReaderView)
   */
  registerUpdateConfig(callback: ConfigUpdateCallback): void {
    this.updateConfigCallback = callback;
  }

  /**
   * Register get visible text callback (called by ReaderView)
   */
  registerGetVisibleText(callback: GetVisibleTextCallback): void {
    this.getVisibleTextCallback = callback;
  }

  /**
   * Register get CFI for range callback (called by ReaderView)
   */
  registerGetCfiForRange(callback: GetCfiForRangeCallback): void {
    this.getCfiForRangeCallback = callback;
  }

  /**
   * Clear all callbacks (called when ReaderView unmounts)
   */
  clear(): void {
    this.navigateCallback = null;
    this.updateConfigCallback = null;
    this.getVisibleTextCallback = null;
    this.getCfiForRangeCallback = null;
  }

  /**
   * Check if reader is connected
   */
  isConnected(): boolean {
    return this.navigateCallback !== null;
  }

  /**
   * Navigate to target
   */
  async navigate(target: NavigationTarget): Promise<void> {
    if (!this.navigateCallback) {
      throw new Error('No reader is currently open');
    }
    await this.navigateCallback(target);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<NavigatorConfig>): void {
    if (this.updateConfigCallback) {
      this.updateConfigCallback(config);
    }
  }

  /**
   * Get visible text
   */
  getVisibleText(): string | null {
    return this.getVisibleTextCallback?.() ?? null;
  }

  /**
   * Get CFI for range
   */
  getCfiForRange(range: Range): string | null {
    return this.getCfiForRangeCallback?.(range) ?? null;
  }
}

/**
 * Singleton reader bridge
 */
export const readerBridge = new ReaderBridge();

/**
 * Reader API implementation
 */
export class ReaderAPI implements ReaderCommands {
  constructor(
    private stateStore: Readable<ReaderState>,
    private bridge: ReaderBridge,
    private capabilities: Set<Capability>,
    private events: TypedEventEmitter,
    private hooks: HookRegistry
  ) {}

  /**
   * Get reactive state store
   */
  getState(): Readable<ReaderState> {
    return this.stateStore;
  }

  /**
   * Navigate to a target
   */
  async goTo(target: NavigationTarget): Promise<void> {
    // Execute hooks
    const state = this.getCurrentState();
    const allowed = await this.hooks.execute('onBeforeNavigate', {
      target,
      currentLocation: state.location
    });

    if (!allowed) return;

    await this.bridge.navigate(target);
  }

  /**
   * Go to next page
   */
  async next(): Promise<void> {
    const state = this.getCurrentState();

    // Execute hooks
    const allowed = await this.hooks.execute('onBeforePageTurn', {
      currentPage: state.currentPage,
      nextPage: state.currentPage + 1,
      direction: 'forward'
    });

    if (!allowed) return;

    await this.bridge.navigate({ type: 'page', page: state.currentPage + 1 });
  }

  /**
   * Go to previous page
   */
  async prev(): Promise<void> {
    const state = this.getCurrentState();

    // Execute hooks
    const allowed = await this.hooks.execute('onBeforePageTurn', {
      currentPage: state.currentPage,
      nextPage: state.currentPage - 1,
      direction: 'backward'
    });

    if (!allowed) return;

    await this.bridge.navigate({ type: 'page', page: state.currentPage - 1 });
  }

  /**
   * Update reader configuration
   */
  updateConfig(config: Partial<NavigatorConfig>): void {
    this.bridge.updateConfig(config);

    // Emit event
    const state = this.getCurrentState();
    this.events.emit('config-changed', {
      config: { ...state.config, ...config }
    });
  }

  /**
   * Get visible text
   */
  getVisibleText(): string | null {
    return this.bridge.getVisibleText();
  }

  /**
   * Get CFI for a DOM range
   */
  getCfiForRange(range: Range): string | null {
    return this.bridge.getCfiForRange(range);
  }

  /**
   * Check if reader is open
   */
  isOpen(): boolean {
    return this.bridge.isConnected();
  }

  /**
   * Get current location
   */
  getCurrentLocation(): Locator | null {
    return this.getCurrentState().location;
  }

  /**
   * Get current book ID
   */
  getCurrentBookId(): string | null {
    return this.getCurrentState().bookId;
  }

  /**
   * Get spine
   */
  getSpine(): SpineItem[] {
    return this.getCurrentState().spine;
  }

  /**
   * Get current state synchronously
   */
  private getCurrentState(): ReaderState {
    let state: ReaderState = defaultReaderState;
    this.stateStore.subscribe(s => { state = s; })();
    return state;
  }
}

/**
 * Create reader API
 */
export function createReaderAPI(
  capabilities: Set<Capability>,
  events: TypedEventEmitter,
  hooks: HookRegistry
): { state: Readable<ReaderState>; commands: ReaderCommands } {
  const stateStore = getReaderStateStore();
  const api = new ReaderAPI(stateStore, readerBridge, capabilities, events, hooks);
  return {
    state: stateStore,
    commands: api
  };
}
