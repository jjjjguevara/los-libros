/**
 * Amnesia Public API
 * Main API class that exposes all functionality to external plugins
 * @module api
 */

import type { Readable } from 'svelte/store';
import type {
  AmnesiaAPI,
  StateAPI,
  CommandsAPI,
  EventsAPI,
  HooksAPI,
  UIAPI,
  Capability,
  Disposable,
  ReaderEventMap,
  HookMap,
  ReaderState,
  LibraryState,
  HighlightState,
  BookmarkState
} from './types';

import { TypedEventEmitter } from './events/emitter';
import { HookRegistry } from './events/hooks';
import { ToolbarRegistry } from './ui/toolbar';
import { SidebarRegistry } from './ui/sidebar';
import { ContextMenuRegistry } from './ui/context-menu';
import { ConnectionRegistry, expandCapabilities } from './security/capabilities';
import { DisposableStore } from './disposable';

import { createLibraryAPI } from './facades/library';
import { createHighlightsAPI } from './facades/highlights';
import { createBookmarksAPI } from './facades/bookmarks';
import { createReaderAPI } from './facades/reader';

import type { LibraryService } from '../library/library-service';
import type { HighlightService } from '../highlights/highlight-service';
import type { BookmarkService } from '../bookmarks/bookmark-service';
import type { Store } from '../helpers/store';
import type { LibraryAction, LibraryState as InternalLibraryState } from '../library/library-reducer';
import type { HighlightAction, HighlightState as InternalHighlightState } from '../highlights/highlight-store';

// File System Architecture Services
import type { TieredCache } from '../cache/tiered-cache';
import type { OfflineManager } from '../offline/offline-manager';
import type { NetworkMonitor } from '../offline/network-monitor';
import type { DeduplicationManager } from '../dedup/deduplication-manager';
import type { AssetExtractor } from '../assets/asset-extractor';
import type { OPDSFeedClient } from './opds-feed-client';

/**
 * API version
 */
export const API_VERSION = '1.0.0';

/**
 * Services required to create the API
 */
export interface APIServices {
  libraryService: LibraryService;
  highlightService: HighlightService;
  bookmarkService: BookmarkService;
  libraryStore: Store<InternalLibraryState, LibraryAction>;
  highlightStore: Store<InternalHighlightState, HighlightAction>;
  // File System Architecture Services (optional - may not be initialized)
  tieredCache?: TieredCache | null;
  offlineManager?: OfflineManager | null;
  networkMonitor?: NetworkMonitor | null;
  deduplicationManager?: DeduplicationManager | null;
  assetExtractor?: AssetExtractor | null;
  opdsFeedClient?: OPDSFeedClient | null;
}

/**
 * Internal API implementation
 */
class AmnesiaAPIImpl implements AmnesiaAPI {
  readonly version = API_VERSION;

  // Core systems
  private eventEmitter: TypedEventEmitter;
  private hookRegistry: HookRegistry;
  private connectionRegistry: ConnectionRegistry;
  private disposables: DisposableStore;

  // UI registries
  private toolbarRegistry: ToolbarRegistry;
  private sidebarRegistry: SidebarRegistry;
  private contextMenuRegistry: ContextMenuRegistry;

  // State and commands
  private _state: StateAPI;
  private _commands: CommandsAPI;

  // Capabilities for this instance
  private capabilities: Set<Capability>;
  private pluginId: string | null;

  constructor(
    services: APIServices,
    capabilities: Set<Capability> = new Set(['read-state']),
    pluginId: string | null = null,
    // Shared instances for connected APIs
    sharedEmitter?: TypedEventEmitter,
    sharedHooks?: HookRegistry,
    sharedToolbar?: ToolbarRegistry,
    sharedSidebar?: SidebarRegistry,
    sharedContextMenu?: ContextMenuRegistry,
    sharedConnections?: ConnectionRegistry
  ) {
    this.capabilities = capabilities;
    this.pluginId = pluginId;
    this.disposables = new DisposableStore();

    // Use shared instances or create new ones
    this.eventEmitter = sharedEmitter ?? new TypedEventEmitter();
    this.hookRegistry = sharedHooks ?? new HookRegistry();
    this.connectionRegistry = sharedConnections ?? new ConnectionRegistry();
    this.toolbarRegistry = sharedToolbar ?? new ToolbarRegistry();
    this.sidebarRegistry = sharedSidebar ?? new SidebarRegistry();
    this.contextMenuRegistry = sharedContextMenu ?? new ContextMenuRegistry();

    // Create facades
    const library = createLibraryAPI(
      services.libraryService,
      services.libraryStore,
      capabilities,
      this.eventEmitter
    );

    const highlights = createHighlightsAPI(
      services.highlightService,
      services.highlightStore,
      capabilities,
      this.eventEmitter
    );

    const bookmarks = createBookmarksAPI(
      services.bookmarkService,
      services.bookmarkService.getStore(),
      capabilities,
      this.eventEmitter
    );

    const reader = createReaderAPI(
      capabilities,
      this.eventEmitter,
      this.hookRegistry
    );

    // Assemble state API
    this._state = {
      reader: reader.state,
      library: library.state as Readable<LibraryState>,
      highlights: highlights.state,
      bookmarks: bookmarks.state
    };

    // Assemble commands API
    this._commands = {
      reader: reader.commands,
      library: library.commands,
      highlights: highlights.commands,
      bookmarks: bookmarks.commands
    };

    // Store services for connected API creation
    (this as any)._services = services;
  }

  // =========================================================================
  // State API
  // =========================================================================

  get state(): StateAPI {
    return this._state;
  }

  // =========================================================================
  // Commands API
  // =========================================================================

  get commands(): CommandsAPI {
    return this._commands;
  }

  // =========================================================================
  // Events API
  // =========================================================================

  get events(): EventsAPI {
    return {
      on: <K extends keyof ReaderEventMap>(
        event: K,
        handler: (data: ReaderEventMap[K]) => void
      ): Disposable => {
        return this.eventEmitter.on(event, handler);
      },

      off: <K extends keyof ReaderEventMap>(
        event: K,
        handler: (data: ReaderEventMap[K]) => void
      ): void => {
        this.eventEmitter.off(event, handler);
      },

      once: <K extends keyof ReaderEventMap>(
        event: K,
        handler: (data: ReaderEventMap[K]) => void
      ): Disposable => {
        return this.eventEmitter.once(event, handler);
      }
    };
  }

  // =========================================================================
  // Hooks API
  // =========================================================================

  get hooks(): HooksAPI {
    return {
      register: <K extends keyof HookMap>(
        hook: K,
        handler: HookMap[K]
      ): Disposable => {
        return this.hookRegistry.register(hook, handler);
      }
    };
  }

  // =========================================================================
  // UI API
  // =========================================================================

  get ui(): UIAPI {
    return {
      toolbar: this.toolbarRegistry,
      sidebar: this.sidebarRegistry,
      contextMenu: this.contextMenuRegistry
    };
  }

  // =========================================================================
  // Connection API
  // =========================================================================

  async connect(pluginId: string, requestedCapabilities: Capability[]): Promise<AmnesiaAPI> {
    // Register the connection
    const info = this.connectionRegistry.connect(pluginId, requestedCapabilities);

    // Create a new API instance with the scoped capabilities
    const services = (this as any)._services as APIServices;
    const scopedApi = new AmnesiaAPIImpl(
      services,
      info.capabilities,
      pluginId,
      // Share registries so events and UI extensions are unified
      this.eventEmitter,
      this.hookRegistry,
      this.toolbarRegistry,
      this.sidebarRegistry,
      this.contextMenuRegistry,
      this.connectionRegistry
    );

    return scopedApi;
  }

  // =========================================================================
  // Internal Methods (for use by Amnesia internals)
  // =========================================================================

  /**
   * Get the event emitter for internal use
   */
  getEventEmitter(): TypedEventEmitter {
    return this.eventEmitter;
  }

  /**
   * Get the hook registry for internal use
   */
  getHookRegistry(): HookRegistry {
    return this.hookRegistry;
  }

  /**
   * Emit an event (for internal use)
   */
  emit<K extends keyof ReaderEventMap>(event: K, data: ReaderEventMap[K]): void {
    this.eventEmitter.emit(event, data);
  }

  /**
   * Execute hooks (for internal use)
   */
  async executeHook<K extends keyof HookMap>(
    hook: K,
    context: Parameters<HookMap[K]>[0]
  ): Promise<boolean> {
    return this.hookRegistry.execute(hook, context as any);
  }

  /**
   * Dispose the API
   */
  dispose(): void {
    this.disposables.dispose();
    this.eventEmitter.dispose();
    this.hookRegistry.dispose();
    this.toolbarRegistry.clear();
    this.sidebarRegistry.clear();
    this.contextMenuRegistry.clear();
    this.connectionRegistry.clear();
  }

  // =========================================================================
  // File System Architecture Services API
  // =========================================================================

  /**
   * Get the tiered cache service
   */
  get cache(): TieredCache | null {
    const services = (this as any)._services as APIServices;
    return services.tieredCache ?? null;
  }

  /**
   * Get the offline manager service
   */
  get offline(): OfflineManager | null {
    const services = (this as any)._services as APIServices;
    return services.offlineManager ?? null;
  }

  /**
   * Get the network monitor service
   */
  get network(): NetworkMonitor | null {
    const services = (this as any)._services as APIServices;
    return services.networkMonitor ?? null;
  }

  /**
   * Get the deduplication manager service
   */
  get dedup(): DeduplicationManager | null {
    const services = (this as any)._services as APIServices;
    return services.deduplicationManager ?? null;
  }

  /**
   * Get the asset extractor service
   */
  get assets(): AssetExtractor | null {
    const services = (this as any)._services as APIServices;
    return services.assetExtractor ?? null;
  }

  /**
   * Get the OPDS feed client service
   */
  get opds(): OPDSFeedClient | null {
    const services = (this as any)._services as APIServices;
    return services.opdsFeedClient ?? null;
  }
}

/**
 * Create the Amnesia API
 */
export function createAPI(services: APIServices): AmnesiaAPIImpl {
  // Create with admin capabilities for internal use
  const adminCapabilities = expandCapabilities(['admin']);
  return new AmnesiaAPIImpl(services, adminCapabilities, 'amnesia');
}

export { AmnesiaAPIImpl };
