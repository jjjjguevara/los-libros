/**
 * Doc Doctor Bridge
 *
 * Bidirectional event bridge between Amnesia and Doc Doctor plugins.
 * Handles:
 * - Event forwarding from Amnesia → Doc Doctor
 * - Event listening from Doc Doctor → Amnesia
 * - Highlight ↔ Stub synchronization coordination
 *
 * @module integrations/doc-doctor-bridge
 */

import type { App, EventRef } from 'obsidian';
import type AmnesiaPlugin from '../main';
import type { Highlight as LibraryHighlight } from '../library/types';
import type { Disposable, Highlight as APIHighlight } from '../api/types';

/**
 * Doc Doctor API capabilities
 */
export type DocDoctorCapability =
  | 'read-documents'
  | 'write-stubs'
  | 'subscribe-events'
  | 'register-hud';

/**
 * Doc Doctor stub types (unified annotation vocabulary)
 */
export type StubType =
  | 'verify'      // yellow - Needs fact-checking
  | 'expand'      // green - Needs more detail
  | 'clarify'     // blue - Ambiguous
  | 'question'    // pink - Open question
  | 'important'   // purple - Key insight
  | 'citation'    // orange - Needs evidence
  | 'definition'  // teal - Term definition
  | 'argument'    // navy - Main thesis
  | 'evidence'    // lime - Supporting data
  | 'counterpoint'// red - Opposing view
  | 'todo'        // gray - Action item
  | 'connection'; // cyan - Cross-reference

/**
 * Doc Doctor stub data
 */
export interface DocDoctorStub {
  id: string;
  type: StubType;
  description: string;
  filePath: string;
  anchor?: string;
  source?: {
    plugin: string;
    highlightId?: string;
  };
  resolution?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Doc Doctor API interface (as exposed by Doc Doctor)
 */
export interface DocDoctorAPI {
  version: string;
  connect(pluginId: string, capabilities: DocDoctorCapability[]): Promise<ScopedDocDoctorAPI>;
}

/**
 * Scoped Doc Doctor API (after connection)
 */
export interface ScopedDocDoctorAPI {
  stubs: {
    create(data: Partial<DocDoctorStub>): Promise<DocDoctorStub>;
    update(stubId: string, data: Partial<DocDoctorStub>): Promise<DocDoctorStub>;
    delete(stubId: string): Promise<void>;
    get(stubId: string): Promise<DocDoctorStub | null>;
    list(filePath?: string): Promise<DocDoctorStub[]>;
    resolve(stubId: string, resolution: string): Promise<DocDoctorStub>;
  };
  health: {
    getBookHealth(bookNotePath: string): Promise<BookHealth | null>;
  };
  events: {
    on(event: string, handler: (data: any) => void): Disposable;
  };
}

/**
 * Book health data from Doc Doctor
 */
export interface BookHealth {
  overall: number; // 0-1
  breakdown: {
    highlightCount: number;
    stubCount: number;
    resolvedStubCount: number;
    annotationCoverage: number;
  };
}

/**
 * Bridge connection status
 */
export type BridgeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Bridge event map
 */
export interface BridgeEventMap {
  'status-changed': { status: BridgeStatus; error?: Error };
  'stub-created': { stub: DocDoctorStub; highlightId?: string };
  'stub-resolved': { stub: DocDoctorStub };
  'health-updated': { filePath: string; health: BookHealth };
}

/**
 * Doc Doctor Bridge
 *
 * Manages bidirectional communication between Amnesia and Doc Doctor.
 */
export class DocDoctorBridge {
  private docDoctorAPI: ScopedDocDoctorAPI | null = null;
  private status: BridgeStatus = 'disconnected';
  private eventRefs: EventRef[] = [];
  private disposables: Disposable[] = [];
  private listeners = new Map<keyof BridgeEventMap, Set<(data: any) => void>>();
  // Store window event handler for proper cleanup (memory leak fix)
  private windowReadyHandler: (() => void) | null = null;

  constructor(
    private plugin: AmnesiaPlugin,
    private app: App
  ) {}

  /**
   * Check if Doc Doctor is available
   */
  isDocDoctorAvailable(): boolean {
    return typeof (window as any).DocDoctor !== 'undefined';
  }

  /**
   * Get connection status
   */
  getStatus(): BridgeStatus {
    return this.status;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.status === 'connected' && this.docDoctorAPI !== null;
  }

  /**
   * Connect to Doc Doctor
   */
  async connect(): Promise<void> {
    // Guard against concurrent connection attempts (race condition fix)
    if (this.status === 'connected' || this.status === 'connecting') {
      return;
    }

    this.setStatus('connecting');

    try {
      // Check if Doc Doctor is available
      const globalDocDoctor = (window as any).DocDoctor as DocDoctorAPI | undefined;

      if (!globalDocDoctor) {
        // Listen for Doc Doctor ready event
        this.waitForDocDoctor();
        return;
      }

      // Connect with required capabilities
      this.docDoctorAPI = await globalDocDoctor.connect('amnesia', [
        'read-documents',
        'write-stubs',
        'subscribe-events',
        'register-hud',
      ]);

      this.setupEventListeners();
      this.setStatus('connected');

      console.log('[Amnesia] Connected to Doc Doctor');
    } catch (error) {
      console.error('[Amnesia] Failed to connect to Doc Doctor:', error);
      this.setStatus('error');
      throw error;
    }
  }

  /**
   * Wait for Doc Doctor to become available
   */
  private waitForDocDoctor(): void {
    // Clean up any existing handler first
    this.cleanupWindowHandler();

    // Create handler that cleans itself up (memory leak fix)
    this.windowReadyHandler = async () => {
      this.cleanupWindowHandler();
      try {
        await this.connect();
      } catch (error) {
        console.error('[Amnesia] Failed to connect after Doc Doctor ready:', error);
      }
    };

    // Use window event as primary listener
    window.addEventListener('doc-doctor:ready', this.windowReadyHandler);

    // Also listen via workspace events as backup
    const ref = this.app.workspace.on('doc-doctor:ready' as any, async () => {
      this.app.workspace.offref(ref);
      // Remove from eventRefs since we're handling it here
      const index = this.eventRefs.indexOf(ref);
      if (index > -1) this.eventRefs.splice(index, 1);
      try {
        await this.connect();
      } catch (error) {
        console.error('[Amnesia] Failed to connect after Doc Doctor ready:', error);
      }
    });
    this.eventRefs.push(ref);
  }

  /**
   * Clean up window event handler
   */
  private cleanupWindowHandler(): void {
    if (this.windowReadyHandler) {
      window.removeEventListener('doc-doctor:ready', this.windowReadyHandler);
      this.windowReadyHandler = null;
    }
  }

  /**
   * Set up event listeners for bidirectional communication
   */
  private setupEventListeners(): void {
    if (!this.docDoctorAPI) return;

    // Doc Doctor → Amnesia events
    const stubResolvedDisposable = this.docDoctorAPI.events.on(
      'stub-resolved',
      (data: { stub: DocDoctorStub }) => {
        this.emit('stub-resolved', { stub: data.stub });

        // If this stub originated from an Amnesia highlight, propagate the resolution
        if (data.stub.source?.plugin === 'amnesia' && data.stub.source.highlightId) {
          this.onStubResolved(data.stub);
        }
      }
    );
    this.disposables.push(stubResolvedDisposable);

    const healthUpdatedDisposable = this.docDoctorAPI.events.on(
      'health-updated',
      (data: { filePath: string; health: BookHealth }) => {
        this.emit('health-updated', data);
      }
    );
    this.disposables.push(healthUpdatedDisposable);

    // Amnesia → Doc Doctor events
    // Listen to Amnesia's internal events and forward relevant ones
    // Wrap handlers in try-catch to prevent event propagation failures (error handling fix)
    const highlightCreatedDisposable = this.plugin.api.events.on(
      'highlight-created',
      ({ highlight }) => {
        if (this.plugin.settings.docDoctorSync?.autoSyncHighlights) {
          this.onHighlightCreated(highlight).catch((error) => {
            console.error('[DocDoctorBridge] Error in highlight-created handler:', error);
          });
        }
      }
    );
    this.disposables.push(highlightCreatedDisposable);

    const highlightUpdatedDisposable = this.plugin.api.events.on(
      'highlight-updated',
      ({ highlight }) => {
        if (this.plugin.settings.docDoctorSync?.autoSyncHighlights) {
          this.onHighlightUpdated(highlight).catch((error) => {
            console.error('[DocDoctorBridge] Error in highlight-updated handler:', error);
          });
        }
      }
    );
    this.disposables.push(highlightUpdatedDisposable);

    const highlightDeletedDisposable = this.plugin.api.events.on(
      'highlight-deleted',
      ({ bookId, highlightId }) => {
        if (this.plugin.settings.docDoctorSync?.autoSyncHighlights) {
          this.onHighlightDeleted(bookId, highlightId).catch((error) => {
            console.error('[DocDoctorBridge] Error in highlight-deleted handler:', error);
          });
        }
      }
    );
    this.disposables.push(highlightDeletedDisposable);
  }

  /**
   * Handle highlight creation - potentially create a corresponding stub
   */
  private async onHighlightCreated(highlight: APIHighlight): Promise<void> {
    if (!this.docDoctorAPI) return;

    try {
      // Get the book note path for this highlight
      const bookNotePath = await this.getBookNotePath(highlight.bookId);
      if (!bookNotePath) {
        console.warn('[Amnesia] No book note found for highlight, skipping stub creation');
        return;
      }

      // Map highlight color to stub type
      const stubType = this.highlightColorToStubType(highlight.color);

      // Create stub in Doc Doctor
      const stub = await this.docDoctorAPI.stubs.create({
        type: stubType,
        description: highlight.text,
        filePath: bookNotePath,
        anchor: `^hl-${highlight.id}`,
        source: {
          plugin: 'amnesia',
          highlightId: highlight.id,
        },
      });

      this.emit('stub-created', { stub, highlightId: highlight.id });

      console.log('[Amnesia] Created Doc Doctor stub for highlight:', stub.id);
    } catch (error) {
      console.error('[Amnesia] Failed to create stub for highlight:', error);
    }
  }

  /**
   * Handle highlight update - update corresponding stub if exists
   */
  private async onHighlightUpdated(highlight: APIHighlight): Promise<void> {
    // Implementation will be added in M3 (Sync Manager)
    // For now, just log
    console.log('[Amnesia] Highlight updated, sync pending:', highlight.id);
  }

  /**
   * Handle highlight deletion - delete corresponding stub if exists
   */
  private async onHighlightDeleted(bookId: string, highlightId: string): Promise<void> {
    // Implementation will be added in M3 (Sync Manager)
    // For now, just log
    console.log('[Amnesia] Highlight deleted, sync pending:', highlightId);
  }

  /**
   * Handle stub resolution - update corresponding highlight
   */
  private async onStubResolved(stub: DocDoctorStub): Promise<void> {
    if (!stub.source?.highlightId) return;

    try {
      // Find the highlight
      const highlights = this.plugin.highlightService.searchHighlights('');
      const highlight = highlights.find(h => h.id === stub.source!.highlightId);

      if (!highlight) {
        console.warn('[Amnesia] Highlight not found for resolved stub:', stub.source.highlightId);
        return;
      }

      // Update highlight with resolution - append to preserve existing annotation (data loss fix)
      const existingAnnotation = highlight.annotation?.trim() || '';
      const resolutionText = stub.resolution ? `\n\n[Resolved] ${stub.resolution}` : '';
      const newAnnotation = existingAnnotation
        ? `${existingAnnotation}${resolutionText}`
        : resolutionText.trim();

      await this.plugin.highlightService.updateHighlight(
        highlight.bookId,
        highlight.id,
        {
          annotation: newAnnotation || highlight.annotation,
        }
      );

      console.log('[Amnesia] Updated highlight with stub resolution:', highlight.id);
    } catch (error) {
      console.error('[Amnesia] Failed to update highlight with resolution:', error);
    }
  }

  /**
   * Get book note path for a book ID
   */
  private async getBookNotePath(bookId: string): Promise<string | null> {
    // Try to find the book note using the generator
    const book = this.plugin.libraryService.getBook(bookId);
    if (!book) return null;

    // Create minimal UnifiedBook with just the fields needed for path generation
    const minimalBook = {
      id: book.id,
      title: book.title,
      authors: book.author ? [{ name: book.author }] : [],
      sources: [],
      formats: [],
      tags: [],
      status: 'to-read' as const,
      progress: 0,
      addedAt: new Date(),
    };

    // Check if book note exists using the note generator
    const notePath = this.plugin.bookNoteGenerator.getNotePath(minimalBook);

    // Verify the file exists
    const file = this.app.vault.getAbstractFileByPath(notePath);
    return file ? notePath : null;
  }

  /**
   * Map highlight color to stub type
   */
  private highlightColorToStubType(color: string): StubType {
    const mapping: Record<string, StubType> = {
      yellow: 'verify',
      green: 'expand',
      blue: 'clarify',
      pink: 'question',
      purple: 'important',
      orange: 'citation',
    };
    return mapping[color] || 'verify';
  }

  /**
   * Get book health from Doc Doctor
   */
  async getBookHealth(bookNotePath: string): Promise<BookHealth | null> {
    if (!this.docDoctorAPI) return null;

    try {
      return await this.docDoctorAPI.health.getBookHealth(bookNotePath);
    } catch (error) {
      console.error('[Amnesia] Failed to get book health:', error);
      return null;
    }
  }

  /**
   * Create a stub directly
   */
  async createStub(data: Partial<DocDoctorStub>): Promise<DocDoctorStub | null> {
    if (!this.docDoctorAPI) return null;

    try {
      return await this.docDoctorAPI.stubs.create(data);
    } catch (error) {
      console.error('[Amnesia] Failed to create stub:', error);
      return null;
    }
  }

  /**
   * List stubs for a file
   */
  async listStubs(filePath?: string): Promise<DocDoctorStub[]> {
    if (!this.docDoctorAPI) return [];

    try {
      return await this.docDoctorAPI.stubs.list(filePath);
    } catch (error) {
      console.error('[Amnesia] Failed to list stubs:', error);
      return [];
    }
  }

  /**
   * Subscribe to bridge events
   */
  on<K extends keyof BridgeEventMap>(
    event: K,
    handler: (data: BridgeEventMap[K]) => void
  ): Disposable {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    return {
      dispose: () => {
        this.listeners.get(event)?.delete(handler);
      },
    };
  }

  /**
   * Emit a bridge event
   */
  private emit<K extends keyof BridgeEventMap>(event: K, data: BridgeEventMap[K]): void {
    this.listeners.get(event)?.forEach(handler => handler(data));
  }

  /**
   * Set status and emit change event
   */
  private setStatus(status: BridgeStatus, error?: Error): void {
    this.status = status;
    this.emit('status-changed', { status, error });
  }

  /**
   * Disconnect from Doc Doctor
   */
  disconnect(): void {
    // Clean up window event listener (memory leak fix)
    this.cleanupWindowHandler();

    // Clean up event refs
    for (const ref of this.eventRefs) {
      this.app.workspace.offref(ref);
    }
    this.eventRefs = [];

    // Clean up disposables
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];

    // Clear listeners
    this.listeners.clear();

    this.docDoctorAPI = null;
    this.setStatus('disconnected');

    console.log('[Amnesia] Disconnected from Doc Doctor');
  }
}

/**
 * Create and initialize the Doc Doctor bridge
 */
export function createDocDoctorBridge(plugin: AmnesiaPlugin): DocDoctorBridge {
  return new DocDoctorBridge(plugin, plugin.app);
}
