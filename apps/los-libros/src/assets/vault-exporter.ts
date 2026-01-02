/**
 * Vault Exporter
 *
 * Exports extracted assets to Obsidian vault files.
 * Supports exporting images, fonts, and other resources
 * to the user's vault for use in notes.
 *
 * Features:
 * - Export single assets or batches
 * - Configurable naming strategies
 * - Folder organization by type
 * - Metadata in frontmatter (optional)
 * - Deduplication via content hash
 *
 * @see docs/specifications/file-system-architecture.md
 */

import type { App, TFile, TFolder } from 'obsidian';
import type {
  ExtractedAsset,
  ExtractedImage,
  VaultExportOptions,
  VaultExportResult,
  NamingStrategy,
  MediaCategory,
} from './types';
import { formatFileSize, getFilename, getExtension } from './types';

// ============================================================================
// Default Options
// ============================================================================

export const DEFAULT_EXPORT_OPTIONS: VaultExportOptions = {
  folder: 'los-libros/assets',
  naming: 'original',
  organizeByType: true,
  overwrite: false,
  includeMetadata: false,
  maxFileSize: 50 * 1024 * 1024, // 50MB
};

// ============================================================================
// Vault Exporter
// ============================================================================

export class VaultExporter {
  private app: App;
  private bookTitle: string;
  private exportCount: Map<string, number> = new Map();

  constructor(app: App, bookTitle: string = 'book') {
    this.app = app;
    this.bookTitle = this.sanitizeFilename(bookTitle);
  }

  // ==========================================================================
  // Single Asset Export
  // ==========================================================================

  /**
   * Export a single asset to the vault
   */
  async exportAsset(
    asset: ExtractedAsset,
    options: Partial<VaultExportOptions> = {}
  ): Promise<VaultExportResult> {
    const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options };

    // Check size limit
    if (opts.maxFileSize && asset.size > opts.maxFileSize) {
      return {
        href: asset.href,
        vaultPath: '',
        created: false,
        size: asset.size,
        error: `Asset exceeds size limit: ${formatFileSize(asset.size)} > ${formatFileSize(opts.maxFileSize)}`,
      };
    }

    try {
      // Generate the target path
      const targetPath = this.generatePath(asset, opts);

      // Ensure folder exists
      await this.ensureFolder(targetPath);

      // Check if file exists
      const existingFile = this.app.vault.getAbstractFileByPath(targetPath);

      if (existingFile && !opts.overwrite) {
        return {
          href: asset.href,
          vaultPath: targetPath,
          created: false,
          size: asset.size,
        };
      }

      // Create or overwrite the file
      const data = new Uint8Array(asset.data);
      if (existingFile) {
        await this.app.vault.modifyBinary(existingFile as TFile, data.buffer as ArrayBuffer);
      } else {
        await this.app.vault.createBinary(targetPath, data.buffer as ArrayBuffer);
      }

      return {
        href: asset.href,
        vaultPath: targetPath,
        created: true,
        size: asset.size,
      };
    } catch (error) {
      return {
        href: asset.href,
        vaultPath: '',
        created: false,
        size: asset.size,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Export an image and optionally create a markdown file with metadata
   */
  async exportImage(
    image: ExtractedImage,
    options: Partial<VaultExportOptions> = {}
  ): Promise<VaultExportResult> {
    const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options };

    // Export the image file
    const result = await this.exportAsset(image, opts);

    if (!result.created || !opts.includeMetadata) {
      return result;
    }

    // Create companion markdown file with metadata
    try {
      const mdPath = result.vaultPath.replace(/\.[^.]+$/, '.md');
      const mdContent = this.generateImageMarkdown(image, result.vaultPath);

      const existingMd = this.app.vault.getAbstractFileByPath(mdPath);
      if (!existingMd || opts.overwrite) {
        if (existingMd) {
          await this.app.vault.modify(existingMd as TFile, mdContent);
        } else {
          await this.app.vault.create(mdPath, mdContent);
        }
      }
    } catch (error) {
      console.warn('[VaultExporter] Failed to create metadata file:', error);
    }

    return result;
  }

  // ==========================================================================
  // Bulk Export
  // ==========================================================================

  /**
   * Export multiple assets to the vault
   */
  async exportAll(
    assets: ExtractedAsset[],
    options: Partial<VaultExportOptions> = {},
    onProgress?: (current: number, total: number, result: VaultExportResult) => void
  ): Promise<VaultExportResult[]> {
    const results: VaultExportResult[] = [];

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      const result = await this.exportAsset(asset, options);
      results.push(result);

      if (onProgress) {
        onProgress(i + 1, assets.length, result);
      }
    }

    return results;
  }

  /**
   * Export all images with optional metadata
   */
  async exportAllImages(
    images: ExtractedImage[],
    options: Partial<VaultExportOptions> = {},
    onProgress?: (current: number, total: number, result: VaultExportResult) => void
  ): Promise<VaultExportResult[]> {
    const results: VaultExportResult[] = [];

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const result = await this.exportImage(image, options);
      results.push(result);

      if (onProgress) {
        onProgress(i + 1, images.length, result);
      }
    }

    return results;
  }

  // ==========================================================================
  // Path Generation
  // ==========================================================================

  /**
   * Generate the target path for an asset
   */
  private generatePath(asset: ExtractedAsset, options: VaultExportOptions): string {
    const filename = this.generateFilename(asset, options.naming);
    const subfolder = options.organizeByType ? this.getCategoryFolder(asset.category) : '';

    const parts = [options.folder];
    if (subfolder) {
      parts.push(subfolder);
    }
    parts.push(filename);

    return parts.join('/');
  }

  /**
   * Generate filename based on strategy
   */
  private generateFilename(asset: ExtractedAsset, strategy: NamingStrategy): string {
    const ext = getExtension(asset.href);
    const originalName = getFilename(asset.href);

    switch (strategy) {
      case 'original':
        return this.sanitizeFilename(originalName);

      case 'sequential': {
        const key = `${asset.bookId}:${asset.category}`;
        const count = (this.exportCount.get(key) || 0) + 1;
        this.exportCount.set(key, count);
        return `${this.bookTitle}-${String(count).padStart(3, '0')}.${ext}`;
      }

      case 'descriptive': {
        const role = (asset as ExtractedImage).metadata?.role || asset.category;
        const key = `${asset.bookId}:${role}`;
        const count = (this.exportCount.get(key) || 0) + 1;
        this.exportCount.set(key, count);
        return this.sanitizeFilename(`${this.bookTitle}-${role}-${count}.${ext}`);
      }

      case 'hash': {
        // Use first 8 chars of a simple hash
        const hash = this.simpleHash(new Uint8Array(asset.data));
        return `${hash.substring(0, 8)}.${ext}`;
      }

      default:
        return this.sanitizeFilename(originalName);
    }
  }

  /**
   * Get subfolder for category
   */
  private getCategoryFolder(category: MediaCategory): string {
    switch (category) {
      case 'image':
        return 'images';
      case 'audio':
        return 'audio';
      case 'video':
        return 'video';
      case 'font':
        return 'fonts';
      case 'style':
        return 'styles';
      default:
        return 'other';
    }
  }

  // ==========================================================================
  // Folder Management
  // ==========================================================================

  /**
   * Ensure the folder path exists
   */
  private async ensureFolder(filePath: string): Promise<void> {
    const folderPath = filePath.split('/').slice(0, -1).join('/');

    if (!folderPath) {
      return;
    }

    const existing = this.app.vault.getAbstractFileByPath(folderPath);
    if (existing) {
      return;
    }

    // Create folders recursively
    const parts = folderPath.split('/');
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const folder = this.app.vault.getAbstractFileByPath(currentPath);

      if (!folder) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  // ==========================================================================
  // Markdown Generation
  // ==========================================================================

  /**
   * Generate markdown content for an image with metadata
   */
  private generateImageMarkdown(image: ExtractedImage, vaultPath: string): string {
    const meta = image.metadata;
    const relativePath = vaultPath.split('/').pop() || vaultPath;

    const frontmatter = [
      '---',
      `title: "${meta.filename}"`,
      `source: "${image.href}"`,
      `type: image`,
    ];

    if (meta.width && meta.height) {
      frontmatter.push(`width: ${meta.width}`);
      frontmatter.push(`height: ${meta.height}`);
    }

    if (meta.role) {
      frontmatter.push(`role: ${meta.role}`);
    }

    if (meta.altText) {
      frontmatter.push(`alt: "${meta.altText}"`);
    }

    frontmatter.push(`size: ${image.size}`);
    frontmatter.push(`extracted: ${new Date(image.extractedAt).toISOString()}`);
    frontmatter.push('---');
    frontmatter.push('');
    frontmatter.push(`![[${relativePath}]]`);

    if (meta.caption) {
      frontmatter.push('');
      frontmatter.push(`*${meta.caption}*`);
    }

    return frontmatter.join('\n');
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Sanitize a filename for use in the vault
   */
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 200);
  }

  /**
   * Simple hash function for content-based naming
   */
  private simpleHash(data: Uint8Array): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Reset export counters
   */
  resetCounters(): void {
    this.exportCount.clear();
  }

  /**
   * Update book title for naming
   */
  setBookTitle(title: string): void {
    this.bookTitle = this.sanitizeFilename(title);
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a vault exporter
 */
export function createVaultExporter(app: App, bookTitle?: string): VaultExporter {
  return new VaultExporter(app, bookTitle);
}
