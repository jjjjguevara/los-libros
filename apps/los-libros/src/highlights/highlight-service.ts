/**
 * Highlight service for CRUD operations
 */
import { App } from 'obsidian';
import { v4 as uuidv4 } from 'uuid';
import { Store } from '../helpers/store';
import { HighlightState, HighlightAction, PendingSelection } from './highlight-store';
import { NoteGenerator } from '../templates/note-generator';
import type { Highlight, HighlightColor, HighlightSelector, Book } from '../library/types';

interface HighlightIndex {
  version: number;
  highlights: Record<string, Highlight[]>; // bookId -> highlights
}

const HIGHLIGHT_INDEX_VERSION = 1;

export class HighlightService {
  private index: HighlightIndex;

  constructor(
    private app: App,
    private store: Store<HighlightState, HighlightAction>,
    private loadData: () => Promise<unknown>,
    private saveData: (data: unknown) => Promise<void>,
    private noteGenerator?: NoteGenerator
  ) {
    this.index = {
      version: HIGHLIGHT_INDEX_VERSION,
      highlights: {},
    };
  }

  /**
   * Initialize the highlight service
   */
  async initialize(): Promise<void> {
    await this.loadIndex();
  }

  /**
   * Load the highlight index from plugin data
   */
  private async loadIndex(): Promise<void> {
    try {
      const data = await this.loadData() as { highlightIndex?: HighlightIndex };
      if (data?.highlightIndex) {
        this.index = data.highlightIndex;

        // Restore highlights to store, converting date strings back to Date objects
        for (const [bookId, highlights] of Object.entries(this.index.highlights)) {
          const restoredHighlights = highlights.map(h => ({
            ...h,
            createdAt: new Date(h.createdAt),
            updatedAt: new Date(h.updatedAt),
          }));
          this.store.dispatch({
            type: 'SET_HIGHLIGHTS',
            payload: { bookId, highlights: restoredHighlights },
          });
        }
      }
    } catch (e) {
      console.warn('Failed to load highlight index:', e);
    }
  }

  /**
   * Save the highlight index to plugin data
   */
  private async saveIndex(): Promise<void> {
    try {
      const data = await this.loadData() as Record<string, unknown> | null;
      console.log('[Los Libros] Saving highlight index, current data keys:', data ? Object.keys(data) : 'none');
      await this.saveData({
        ...data,
        highlightIndex: this.index,
      });
      console.log('[Los Libros] Highlight index saved successfully');
    } catch (e) {
      console.error('[Los Libros] Failed to save highlight index:', e);
    }
  }

  /**
   * Get highlights for a book
   */
  getHighlights(bookId: string): Highlight[] {
    return this.store.getValue().highlights[bookId] || [];
  }

  /**
   * Get the underlying store for reactive subscriptions
   */
  getStore(): Store<HighlightState, HighlightAction> {
    return this.store;
  }

  /**
   * Create a new highlight
   */
  async createHighlight(
    bookId: string,
    text: string,
    cfi: string,
    color: HighlightColor = 'yellow',
    options?: {
      chapter?: string;
      pagePercent?: number;
      annotation?: string;
      // NEW: Robust anchoring fields
      spineIndex?: number;
      textQuote?: {
        exact: string;
        prefix?: string;
        suffix?: string;
      };
      textPosition?: {
        start: number;
        end: number;
      };
    }
  ): Promise<Highlight> {
    const now = new Date();

    // Build the W3C-aligned selector for robust re-anchoring
    const selector: HighlightSelector = {
      primary: { type: 'CfiSelector', cfi },
      fallback: {
        type: 'TextQuoteSelector',
        exact: options?.textQuote?.exact ?? text,
        prefix: options?.textQuote?.prefix,
        suffix: options?.textQuote?.suffix,
      },
      ...(options?.textPosition && {
        position: {
          type: 'TextPositionSelector',
          start: options.textPosition.start,
          end: options.textPosition.end,
        },
      }),
    };

    const highlight: Highlight = {
      id: uuidv4(),
      bookId,
      text,
      cfi,
      color,
      chapter: options?.chapter,
      pagePercent: options?.pagePercent,
      annotation: options?.annotation,
      // NEW: Robust anchoring
      spineIndex: options?.spineIndex ?? 0,
      selector,
      createdAt: now,
      updatedAt: now,
      synced: false,
    };

    // Update index
    if (!this.index.highlights[bookId]) {
      this.index.highlights[bookId] = [];
    }
    this.index.highlights[bookId].push(highlight);
    console.log('[Los Libros] Saving highlight to index:', { bookId, highlightId: highlight.id });
    await this.saveIndex();
    console.log('[Los Libros] Highlight saved to index, total for book:', this.index.highlights[bookId].length);

    // Update store
    this.store.dispatch({ type: 'ADD_HIGHLIGHT', payload: highlight });

    return highlight;
  }

  /**
   * Create a highlight from pending selection
   */
  async createFromSelection(
    selection: PendingSelection,
    color: HighlightColor = 'yellow',
    annotation?: string
  ): Promise<Highlight> {
    return this.createHighlight(
      selection.bookId,
      selection.text,
      selection.cfi,
      color,
      {
        chapter: selection.chapter,
        pagePercent: selection.pagePercent,
        annotation,
      }
    );
  }

  /**
   * Add a pre-built highlight object directly
   * Used when the caller has already constructed the Highlight
   */
  async addHighlight(highlight: Highlight): Promise<void> {
    const bookId = highlight.bookId;

    if (!highlight.id || !bookId || !highlight.text || !highlight.cfi) {
      console.error('[HighlightService] Invalid highlight - missing required fields', highlight);
      throw new Error('Invalid highlight: missing required fields');
    }

    if (!this.index.highlights[bookId]) {
      this.index.highlights[bookId] = [];
    }

    this.index.highlights[bookId].push(highlight);
    console.log('[HighlightService] addHighlight', { bookId, id: highlight.id });

    await this.saveIndex();
    this.store.dispatch({ type: 'ADD_HIGHLIGHT', payload: highlight });
  }

  /**
   * Update a highlight
   */
  async updateHighlight(
    bookId: string,
    highlightId: string,
    updates: Partial<Pick<Highlight, 'color' | 'annotation'>>
  ): Promise<Highlight | undefined> {
    const highlights = this.getHighlights(bookId);
    const highlight = highlights.find(h => h.id === highlightId);

    if (!highlight) {
      return undefined;
    }

    const updatedHighlight: Highlight = {
      ...highlight,
      ...updates,
      updatedAt: new Date(),
      synced: false,
    };

    // Update index
    const indexHighlights = this.index.highlights[bookId] || [];
    const indexIdx = indexHighlights.findIndex(h => h.id === highlightId);
    if (indexIdx >= 0) {
      indexHighlights[indexIdx] = updatedHighlight;
      await this.saveIndex();
    }

    // Update store
    this.store.dispatch({ type: 'UPDATE_HIGHLIGHT', payload: updatedHighlight });

    return updatedHighlight;
  }

  /**
   * Delete a highlight
   */
  async deleteHighlight(bookId: string, highlightId: string): Promise<boolean> {
    const highlights = this.getHighlights(bookId);
    const highlight = highlights.find(h => h.id === highlightId);

    if (!highlight) {
      return false;
    }

    // Update index
    if (this.index.highlights[bookId]) {
      this.index.highlights[bookId] = this.index.highlights[bookId].filter(
        h => h.id !== highlightId
      );
      await this.saveIndex();
    }

    // Update store
    this.store.dispatch({
      type: 'REMOVE_HIGHLIGHT',
      payload: { bookId, highlightId },
    });

    return true;
  }

  /**
   * Generate atomic note for a highlight
   */
  async generateHighlightNote(book: Book, highlight: Highlight): Promise<void> {
    if (!this.noteGenerator) {
      console.warn('Note generator not available');
      return;
    }

    const file = await this.noteGenerator.generateHighlightNote(book, highlight);

    // Update highlight with note path
    await this.updateHighlight(book.id, highlight.id, {
      ...highlight,
    });

    // Store the atomic note path
    const updatedHighlight = this.getHighlights(book.id).find(h => h.id === highlight.id);
    if (updatedHighlight) {
      updatedHighlight.atomicNotePath = file.path;

      // Save to index
      const indexHighlights = this.index.highlights[book.id] || [];
      const indexIdx = indexHighlights.findIndex(h => h.id === highlight.id);
      if (indexIdx >= 0) {
        indexHighlights[indexIdx].atomicNotePath = file.path;
        await this.saveIndex();
      }
    }
  }

  /**
   * Set pending selection (from text selection in reader)
   */
  setPendingSelection(selection: PendingSelection | null): void {
    this.store.dispatch({ type: 'SET_PENDING_SELECTION', payload: selection });
  }

  /**
   * Get pending selection
   */
  getPendingSelection(): PendingSelection | null {
    return this.store.getValue().pendingSelection;
  }

  /**
   * Search highlights across all books
   */
  searchHighlights(query: string): Highlight[] {
    const allHighlights = this.store.getValue().highlights;
    const results: Highlight[] = [];
    const q = query.toLowerCase();

    for (const highlights of Object.values(allHighlights)) {
      for (const h of highlights) {
        if (
          h.text.toLowerCase().includes(q) ||
          h.annotation?.toLowerCase().includes(q)
        ) {
          results.push(h);
        }
      }
    }

    return results;
  }

  /**
   * Get highlight count for a book
   */
  getHighlightCount(bookId: string): number {
    return this.getHighlights(bookId).length;
  }

  /**
   * Update note generator reference
   */
  setNoteGenerator(noteGenerator: NoteGenerator): void {
    this.noteGenerator = noteGenerator;
  }
}
