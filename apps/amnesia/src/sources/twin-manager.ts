/**
 * Twin Manager
 *
 * Handles vault copies ("twins") of books from remote sources.
 * A twin is a local copy of a book stored in the vault for offline reading.
 */

import { App, TFile, requestUrl, normalizePath } from 'obsidian';
import type {
  BookSource,
  VaultCopySource,
  CalibreLocalSource,
  CalibreWebSource,
  OPDSSource,
} from '../types/book-source';
import type { UnifiedBook } from '../types/unified-book';

/**
 * Twin creation options
 */
export interface TwinOptions {
  /** Target folder in vault */
  targetFolder: string;

  /** Filename (without extension) */
  filename?: string;

  /** Preserve original filename */
  preserveFilename?: boolean;

  /** Overwrite if exists */
  overwrite?: boolean;
}

/**
 * Twin creation result
 */
export interface TwinResult {
  success: boolean;
  source?: VaultCopySource;
  error?: string;
  vaultPath?: string;
}

/**
 * Twin synchronization result
 */
export interface TwinSyncResult {
  twinPath: string;
  originalUpdated: boolean;
  twinUpdated: boolean;
  error?: string;
}

/**
 * Twin Manager
 *
 * Manages the lifecycle of vault copies:
 * - Creating twins from remote sources
 * - Detecting if a vault file is a twin
 * - Syncing twin state with original
 * - Deleting twins
 */
export class TwinManager {
  private app: App;
  private defaultFolder: string;

  constructor(app: App, defaultFolder: string = 'Biblioteca/Libros') {
    this.app = app;
    this.defaultFolder = defaultFolder;
  }

  /**
   * Set the default folder for storing twins
   */
  setDefaultFolder(folder: string): void {
    this.defaultFolder = folder;
  }

  // ==========================================================================
  // Twin Creation
  // ==========================================================================

  /**
   * Create a vault copy (twin) from a source
   */
  async createTwin(
    book: UnifiedBook,
    source: BookSource,
    options?: Partial<TwinOptions>
  ): Promise<TwinResult> {
    const opts: TwinOptions = {
      targetFolder: options?.targetFolder || this.defaultFolder,
      filename: options?.filename || this.sanitizeFilename(book.title),
      preserveFilename: options?.preserveFilename ?? false,
      overwrite: options?.overwrite ?? false,
    };

    switch (source.type) {
      case 'calibre-local':
        return this.createTwinFromCalibreLocal(source, opts);

      case 'calibre-web':
        return this.createTwinFromCalibreWeb(source, opts);

      case 'opds':
        return this.createTwinFromOpds(source, opts);

      case 'vault-copy':
        return { success: false, error: 'Source is already a vault copy' };
    }
  }

  /**
   * Create twin from Calibre local source
   */
  private async createTwinFromCalibreLocal(
    source: CalibreLocalSource,
    options: TwinOptions
  ): Promise<TwinResult> {
    try {
      // Read the file from filesystem
      const fs = require('fs');
      const path = require('path');

      if (!fs.existsSync(source.epubPath)) {
        return { success: false, error: 'Source file not found' };
      }

      const data = fs.readFileSync(source.epubPath);
      const extension = path.extname(source.epubPath) || '.epub';
      const filename = options.preserveFilename
        ? path.basename(source.epubPath, extension)
        : options.filename;

      const vaultPath = await this.writeToVault(
        data,
        options.targetFolder,
        filename!,
        extension,
        options.overwrite ?? false
      );

      const twinSource: VaultCopySource = {
        type: 'vault-copy',
        vaultPath,
        addedAt: new Date(),
        lastVerified: new Date(),
        priority: 1,
        copiedAt: new Date(),
        twinOf: 'calibre-local',
        twinSourceId: `calibre:${source.calibreId}`,
        md5Hash: await this.computeHash(data),
      };

      return { success: true, source: twinSource, vaultPath };
    } catch (error) {
      return { success: false, error: `Failed to create twin: ${error}` };
    }
  }

  /**
   * Create twin from Calibre Web source
   */
  private async createTwinFromCalibreWeb(
    source: CalibreWebSource,
    options: TwinOptions
  ): Promise<TwinResult> {
    try {
      const response = await requestUrl({
        url: source.downloadUrl,
        method: 'GET',
      });

      if (response.status !== 200) {
        return { success: false, error: `Download failed: HTTP ${response.status}` };
      }

      const data = new Uint8Array(response.arrayBuffer);
      const extension = this.getExtensionFromUrl(source.downloadUrl) || '.epub';

      const vaultPath = await this.writeToVault(
        data,
        options.targetFolder,
        options.filename!,
        extension,
        options.overwrite ?? false
      );

      const twinSource: VaultCopySource = {
        type: 'vault-copy',
        vaultPath,
        addedAt: new Date(),
        lastVerified: new Date(),
        priority: 1,
        copiedAt: new Date(),
        twinOf: 'calibre-web',
        twinSourceId: `calibre-web:${source.bookId}`,
        md5Hash: await this.computeHash(data),
      };

      return { success: true, source: twinSource, vaultPath };
    } catch (error) {
      return { success: false, error: `Failed to download: ${error}` };
    }
  }

  /**
   * Create twin from OPDS source
   */
  private async createTwinFromOpds(
    source: OPDSSource,
    options: TwinOptions
  ): Promise<TwinResult> {
    try {
      const response = await requestUrl({
        url: source.acquisitionUrl,
        method: 'GET',
      });

      if (response.status !== 200) {
        return { success: false, error: `Download failed: HTTP ${response.status}` };
      }

      const data = new Uint8Array(response.arrayBuffer);
      const extension = this.getExtensionFromUrl(source.acquisitionUrl) || '.epub';

      const vaultPath = await this.writeToVault(
        data,
        options.targetFolder,
        options.filename!,
        extension,
        options.overwrite ?? false
      );

      const twinSource: VaultCopySource = {
        type: 'vault-copy',
        vaultPath,
        addedAt: new Date(),
        lastVerified: new Date(),
        priority: 1,
        copiedAt: new Date(),
        twinOf: 'opds',
        twinSourceId: source.entryId,
        md5Hash: await this.computeHash(data),
      };

      return { success: true, source: twinSource, vaultPath };
    } catch (error) {
      return { success: false, error: `Failed to download: ${error}` };
    }
  }

  // ==========================================================================
  // Twin Management
  // ==========================================================================

  /**
   * Check if a twin needs updating (original has changed)
   */
  async checkTwinNeedsUpdate(
    twin: VaultCopySource,
    original: BookSource
  ): Promise<boolean> {
    if (!twin.md5Hash) return true;

    // For Calibre local, check file modification time
    if (original.type === 'calibre-local') {
      try {
        const fs = require('fs');
        const stats = fs.statSync(original.epubPath);
        return stats.mtime > twin.copiedAt;
      } catch {
        return false;
      }
    }

    // For remote sources, we can't easily check without downloading
    return false;
  }

  /**
   * Update a twin from its original source
   */
  async updateTwin(
    book: UnifiedBook,
    twin: VaultCopySource
  ): Promise<TwinResult> {
    // Find the original source
    const original = book.sources.find(
      s => s.type === twin.twinOf && this.getSourceId(s) === twin.twinSourceId
    );

    if (!original) {
      return { success: false, error: 'Original source not found' };
    }

    // Delete the old twin file
    try {
      const file = this.app.vault.getAbstractFileByPath(twin.vaultPath);
      if (file instanceof TFile) {
        await this.app.vault.delete(file);
      }
    } catch {
      // Ignore delete errors
    }

    // Create a new twin
    const folder = twin.vaultPath.substring(0, twin.vaultPath.lastIndexOf('/'));
    const filename = twin.vaultPath.substring(twin.vaultPath.lastIndexOf('/') + 1);
    const name = filename.substring(0, filename.lastIndexOf('.'));

    return this.createTwin(book, original, {
      targetFolder: folder,
      filename: name,
      overwrite: true,
    });
  }

  /**
   * Delete a twin from the vault
   */
  async deleteTwin(twin: VaultCopySource): Promise<boolean> {
    try {
      const file = this.app.vault.getAbstractFileByPath(twin.vaultPath);
      if (file instanceof TFile) {
        await this.app.vault.delete(file);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Find the original source for a twin
   */
  findOriginalSource(book: UnifiedBook, twin: VaultCopySource): BookSource | undefined {
    return book.sources.find(
      s => s.type === twin.twinOf && this.getSourceId(s) === twin.twinSourceId
    );
  }

  /**
   * Check if a book has a valid twin
   */
  async hasValidTwin(book: UnifiedBook): Promise<boolean> {
    const twin = book.sources.find(s => s.type === 'vault-copy') as VaultCopySource | undefined;
    if (!twin) return false;

    const file = this.app.vault.getAbstractFileByPath(twin.vaultPath);
    return file instanceof TFile;
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Write data to a file in the vault
   */
  private async writeToVault(
    data: Uint8Array | Buffer,
    folder: string,
    filename: string,
    extension: string,
    overwrite: boolean
  ): Promise<string> {
    // Ensure folder exists
    const normalizedFolder = normalizePath(folder);
    const folderFile = this.app.vault.getAbstractFileByPath(normalizedFolder);
    if (!folderFile) {
      await this.app.vault.createFolder(normalizedFolder);
    }

    // Build file path
    let vaultPath = normalizePath(`${folder}/${filename}${extension}`);

    // Handle naming conflicts
    if (!overwrite) {
      let counter = 1;
      while (this.app.vault.getAbstractFileByPath(vaultPath)) {
        vaultPath = normalizePath(`${folder}/${filename} (${counter})${extension}`);
        counter++;
      }
    }

    // Write the file
    // Create a new ArrayBuffer to ensure compatibility
    const arrayBuffer = new ArrayBuffer(data.length);
    const view = new Uint8Array(arrayBuffer);
    view.set(data);

    await this.app.vault.adapter.writeBinary(vaultPath, arrayBuffer);

    return vaultPath;
  }

  /**
   * Compute MD5 hash of data
   */
  private async computeHash(data: Uint8Array | Buffer): Promise<string> {
    const crypto = require('crypto');
    const hash = crypto.createHash('md5');
    hash.update(data);
    return hash.digest('hex');
  }

  /**
   * Get file extension from URL
   */
  private getExtensionFromUrl(url: string): string {
    const path = new URL(url).pathname;
    const ext = path.substring(path.lastIndexOf('.'));
    if (['.epub', '.pdf', '.mobi', '.azw3'].includes(ext.toLowerCase())) {
      return ext;
    }
    return '.epub';
  }

  /**
   * Sanitize a filename
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  /**
   * Get a unique ID for a source
   */
  private getSourceId(source: BookSource): string {
    switch (source.type) {
      case 'calibre-local':
        return `calibre:${source.calibreId}`;
      case 'calibre-web':
        return `calibre-web:${source.bookId}`;
      case 'opds':
        return source.entryId;
      case 'vault-copy':
        return source.vaultPath;
    }
  }
}
