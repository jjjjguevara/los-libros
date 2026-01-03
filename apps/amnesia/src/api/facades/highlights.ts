/**
 * Highlights API Facade
 * @module api/facades/highlights
 */

import type { Readable } from 'svelte/store';
import type {
  HighlightState,
  HighlightCommands,
  Highlight,
  HighlightColor,
  Capability
} from '../types';
import type { HighlightService } from '../../highlights/highlight-service';
import type { Store } from '../../helpers/store';
import { createReactiveStore } from '../reactive-selector';
import { requireCapability } from '../security/capabilities';
import { validateCreateHighlight, validateUpdateHighlight, validate } from '../security/validation';
import { TypedEventEmitter } from '../events/emitter';

/**
 * Highlights API implementation
 */
export class HighlightsAPI implements HighlightCommands {
  private stateStore: Readable<HighlightState>;

  constructor(
    private service: HighlightService,
    private store: Store<any, any>,
    private capabilities: Set<Capability>,
    private events: TypedEventEmitter
  ) {
    this.stateStore = createReactiveStore(store);
  }

  /**
   * Get reactive state store
   */
  getState(): Readable<HighlightState> {
    return this.stateStore;
  }

  /**
   * Create a new highlight
   */
  async create(
    bookId: string,
    text: string,
    cfi: string,
    color: HighlightColor,
    annotation?: string
  ): Promise<Highlight> {
    requireCapability(this.capabilities, 'write-annotations', 'create highlight');

    // Validate input
    validate(validateCreateHighlight, { bookId, text, cfi, color, annotation });

    const highlight = await this.service.createHighlight(bookId, text, cfi, color, {
      annotation
    });

    const publicHighlight = this.toPublicHighlight(highlight);

    // Emit event
    this.events.emit('highlight-created', { highlight: publicHighlight });

    return publicHighlight;
  }

  /**
   * Update a highlight
   */
  async update(highlightId: string, updates: Partial<Highlight>): Promise<Highlight> {
    requireCapability(this.capabilities, 'write-annotations', 'update highlight');

    // Validate input
    validate(validateUpdateHighlight, updates);

    // Find the highlight to get bookId
    const state = this.store.getValue();
    let bookId: string | null = null;

    for (const [bId, highlights] of Object.entries(state.highlights) as [string, any[]][]) {
      if (highlights.some((h: any) => h.id === highlightId)) {
        bookId = bId;
        break;
      }
    }

    if (!bookId) {
      throw new Error(`Highlight ${highlightId} not found`);
    }

    const updated = await this.service.updateHighlight(bookId, highlightId, {
      color: updates.color,
      annotation: updates.annotation
    });

    if (!updated) {
      throw new Error(`Failed to update highlight ${highlightId}`);
    }

    const publicHighlight = this.toPublicHighlight(updated);

    // Emit event
    this.events.emit('highlight-updated', { highlight: publicHighlight });

    return publicHighlight;
  }

  /**
   * Delete a highlight
   */
  async delete(bookId: string, highlightId: string): Promise<void> {
    requireCapability(this.capabilities, 'write-annotations', 'delete highlight');

    const success = await this.service.deleteHighlight(bookId, highlightId);

    if (!success) {
      throw new Error(`Failed to delete highlight ${highlightId}`);
    }

    // Emit event
    this.events.emit('highlight-deleted', { bookId, highlightId });
  }

  /**
   * Get highlights for a book
   */
  getHighlights(bookId: string): Highlight[] {
    return this.service.getHighlights(bookId).map(h => this.toPublicHighlight(h));
  }

  /**
   * Search highlights
   */
  searchHighlights(query: string, bookId?: string): Highlight[] {
    let results = this.service.searchHighlights(query);

    if (bookId) {
      results = results.filter(h => h.bookId === bookId);
    }

    return results.map(h => this.toPublicHighlight(h));
  }

  /**
   * Get highlight count for a book
   */
  getHighlightCount(bookId: string): number {
    return this.service.getHighlightCount(bookId);
  }

  /**
   * Convert internal Highlight to public API Highlight
   */
  private toPublicHighlight(highlight: any): Highlight {
    return {
      id: highlight.id,
      bookId: highlight.bookId,
      text: highlight.text,
      cfi: highlight.cfi,
      color: highlight.color,
      annotation: highlight.annotation,
      chapter: highlight.chapter,
      pagePercent: highlight.pagePercent,
      spineIndex: highlight.spineIndex,
      createdAt: highlight.createdAt?.toISOString?.() || highlight.createdAt,
      updatedAt: highlight.updatedAt?.toISOString?.() || highlight.updatedAt
    };
  }
}

/**
 * Create highlights API
 */
export function createHighlightsAPI(
  service: HighlightService,
  store: Store<any, any>,
  capabilities: Set<Capability>,
  events: TypedEventEmitter
): { state: Readable<HighlightState>; commands: HighlightCommands } {
  const api = new HighlightsAPI(service, store, capabilities, events);
  return {
    state: api.getState(),
    commands: api
  };
}
