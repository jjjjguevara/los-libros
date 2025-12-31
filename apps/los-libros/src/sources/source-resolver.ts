/**
 * Source Resolution Engine
 *
 * Determines the best source to use for reading a book based on:
 * - Priority settings
 * - Source availability
 * - Platform (desktop vs mobile)
 * - Network connectivity
 */

import { App, Platform } from 'obsidian';
import type { BookSource, BookSourceType } from '../types/book-source';
import type { UnifiedBook } from '../types/unified-book';

/**
 * Resolution result
 */
export interface SourceResolution {
  /** The resolved source to use */
  source: BookSource;

  /** Path or URL to access the book */
  accessPath: string;

  /** Whether the source is available locally (no network needed) */
  isLocal: boolean;

  /** Why this source was chosen */
  reason: string;
}

/**
 * Resolution options
 */
export interface ResolutionOptions {
  /** Prefer offline sources even if online sources are available */
  preferOffline?: boolean;

  /** Preferred source type (overrides priority) */
  preferredType?: BookSourceType;

  /** Skip availability checks (faster but may fail) */
  skipAvailabilityCheck?: boolean;
}

/**
 * Default source priority (lower = higher priority)
 */
export const DEFAULT_PRIORITY: Record<BookSourceType, number> = {
  'vault-copy': 1,
  'calibre-local': 2,
  'calibre-web': 3,
  opds: 4,
};

/**
 * Source resolution engine
 */
export class SourceResolver {
  private app: App;
  private calibreLibraryPath?: string;

  constructor(app: App, calibreLibraryPath?: string) {
    this.app = app;
    this.calibreLibraryPath = calibreLibraryPath;
  }

  /**
   * Update the Calibre library path
   */
  setCalibreLibraryPath(path: string): void {
    this.calibreLibraryPath = path;
  }

  /**
   * Resolve the best source for a book
   */
  async resolve(
    book: UnifiedBook,
    options: ResolutionOptions = {}
  ): Promise<SourceResolution | null> {
    if (book.sources.length === 0) {
      return null;
    }

    // Get sorted sources by priority
    const sortedSources = this.getSortedSources(book.sources, options);

    // Try each source in order
    for (const source of sortedSources) {
      const resolution = await this.tryResolveSource(source, options);
      if (resolution) {
        return resolution;
      }
    }

    return null;
  }

  /**
   * Get sources sorted by resolution priority
   */
  private getSortedSources(
    sources: BookSource[],
    options: ResolutionOptions
  ): BookSource[] {
    const sorted = [...sources].sort((a, b) => {
      // If preferred type is specified, prioritize it
      if (options.preferredType) {
        if (a.type === options.preferredType && b.type !== options.preferredType) {
          return -1;
        }
        if (b.type === options.preferredType && a.type !== options.preferredType) {
          return 1;
        }
      }

      // If preferOffline, prioritize local sources
      if (options.preferOffline) {
        const aLocal = this.isLocalSource(a);
        const bLocal = this.isLocalSource(b);
        if (aLocal && !bLocal) return -1;
        if (bLocal && !aLocal) return 1;
      }

      // On mobile, prioritize vault copies (Calibre local typically not available)
      if (Platform.isMobile) {
        if (a.type === 'vault-copy' && b.type !== 'vault-copy') return -1;
        if (b.type === 'vault-copy' && a.type !== 'vault-copy') return 1;
        // Skip calibre-local on mobile
        if (a.type === 'calibre-local') return 1;
        if (b.type === 'calibre-local') return -1;
      }

      // Fall back to priority
      return (a.priority || DEFAULT_PRIORITY[a.type]) - (b.priority || DEFAULT_PRIORITY[b.type]);
    });

    return sorted;
  }

  /**
   * Check if a source is local (doesn't require network)
   */
  private isLocalSource(source: BookSource): boolean {
    return source.type === 'vault-copy' || source.type === 'calibre-local';
  }

  /**
   * Try to resolve a specific source
   */
  private async tryResolveSource(
    source: BookSource,
    options: ResolutionOptions
  ): Promise<SourceResolution | null> {
    // Skip availability check if requested
    if (!options.skipAvailabilityCheck) {
      const available = await this.checkSourceAvailability(source);
      if (!available) {
        return null;
      }
    }

    switch (source.type) {
      case 'vault-copy':
        return this.resolveVaultCopy(source);

      case 'calibre-local':
        return this.resolveCalibreLocal(source);

      case 'calibre-web':
        return this.resolveCalibreWeb(source);

      case 'opds':
        return this.resolveOpds(source);
    }
  }

  /**
   * Check if a source is available
   */
  async checkSourceAvailability(source: BookSource): Promise<boolean> {
    switch (source.type) {
      case 'vault-copy':
        return this.checkVaultCopyAvailable(source);

      case 'calibre-local':
        return this.checkCalibreLocalAvailable(source);

      case 'calibre-web':
        return this.checkCalibreWebAvailable(source);

      case 'opds':
        return this.checkOpdsAvailable(source);
    }
  }

  // ==========================================================================
  // Vault Copy Resolution
  // ==========================================================================

  private async resolveVaultCopy(source: BookSource): Promise<SourceResolution | null> {
    if (source.type !== 'vault-copy') return null;

    const file = this.app.vault.getAbstractFileByPath(source.vaultPath);
    if (!file) return null;

    return {
      source,
      accessPath: source.vaultPath,
      isLocal: true,
      reason: 'Using vault copy',
    };
  }

  private async checkVaultCopyAvailable(source: BookSource): Promise<boolean> {
    if (source.type !== 'vault-copy') return false;
    const file = this.app.vault.getAbstractFileByPath(source.vaultPath);
    return file !== null;
  }

  // ==========================================================================
  // Calibre Local Resolution
  // ==========================================================================

  private async resolveCalibreLocal(source: BookSource): Promise<SourceResolution | null> {
    if (source.type !== 'calibre-local') return null;

    // On mobile, Calibre local is typically not available
    if (Platform.isMobile) return null;

    // Check if the file exists
    try {
      const fs = require('fs');
      if (!fs.existsSync(source.epubPath)) {
        return null;
      }

      return {
        source,
        accessPath: source.epubPath,
        isLocal: true,
        reason: 'Using Calibre library',
      };
    } catch {
      return null;
    }
  }

  private async checkCalibreLocalAvailable(source: BookSource): Promise<boolean> {
    if (source.type !== 'calibre-local') return false;
    if (Platform.isMobile) return false;

    try {
      const fs = require('fs');
      return fs.existsSync(source.epubPath);
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Calibre Web Resolution
  // ==========================================================================

  private resolveCalibreWeb(source: BookSource): SourceResolution | null {
    if (source.type !== 'calibre-web') return null;

    return {
      source,
      accessPath: source.downloadUrl,
      isLocal: false,
      reason: 'Using Calibre Content Server',
    };
  }

  private async checkCalibreWebAvailable(source: BookSource): Promise<boolean> {
    if (source.type !== 'calibre-web') return false;

    try {
      // Just check if we can reach the server (HEAD request to server URL)
      const response = await fetch(source.serverUrl, {
        method: 'HEAD',
        mode: 'no-cors',
      });
      return response.ok || response.type === 'opaque';
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // OPDS Resolution
  // ==========================================================================

  private resolveOpds(source: BookSource): SourceResolution | null {
    if (source.type !== 'opds') return null;

    return {
      source,
      accessPath: source.acquisitionUrl,
      isLocal: false,
      reason: source.serverName ? `Using ${source.serverName}` : 'Using OPDS server',
    };
  }

  private async checkOpdsAvailable(source: BookSource): Promise<boolean> {
    if (source.type !== 'opds') return false;

    try {
      const response = await fetch(source.catalogUrl, {
        method: 'HEAD',
        mode: 'no-cors',
      });
      return response.ok || response.type === 'opaque';
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  /**
   * Check availability of all sources for a book
   */
  async checkAllSourcesAvailability(
    book: UnifiedBook
  ): Promise<Map<BookSource, boolean>> {
    const results = new Map<BookSource, boolean>();

    await Promise.all(
      book.sources.map(async source => {
        const available = await this.checkSourceAvailability(source);
        results.set(source, available);
      })
    );

    return results;
  }

  /**
   * Get all available sources for a book
   */
  async getAvailableSources(book: UnifiedBook): Promise<BookSource[]> {
    const availability = await this.checkAllSourcesAvailability(book);
    return book.sources.filter(source => availability.get(source) === true);
  }

  /**
   * Check if any source is available for offline reading
   */
  async hasOfflineSource(book: UnifiedBook): Promise<boolean> {
    for (const source of book.sources) {
      if (this.isLocalSource(source)) {
        const available = await this.checkSourceAvailability(source);
        if (available) return true;
      }
    }
    return false;
  }
}
