/**
 * Los Libros Server Client
 *
 * Extends OPDS client with reading progress and highlights sync.
 * Used for bidirectional sync with the Los Libros Server.
 */
import { App, requestUrl } from 'obsidian';
import { OPDSClient } from '../opds/opds-client';
import type { OPDSFeed } from '../opds/opds-types';

/**
 * Reading progress data from server
 */
export interface ReadingProgress {
  bookId: string;
  userId?: string;
  progress: number; // 0-100
  currentCfi?: string;
  currentChapter?: string;
  totalPages?: number;
  currentPage?: number;
  lastReadAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Highlight data from server
 */
export interface ServerHighlight {
  id: string;
  bookId: string;
  userId?: string;
  cfiRange: string;
  text: string;
  annotation?: string;
  color: string;
  chapter?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Server health response
 */
export interface HealthResponse {
  status: 'ok' | 'error';
  version?: string;
  uptime?: number;
}

/**
 * Los Libros Server client with progress and highlights sync
 */
export class LosLibrosClient extends OPDSClient {
  private serverUrl: string;

  constructor(app: App, serverUrl: string) {
    super(app);
    this.serverUrl = serverUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Update the server URL
   */
  setServerUrl(url: string): void {
    this.serverUrl = url.replace(/\/$/, '');
    this.clearCache();
  }

  /**
   * Get the OPDS root catalog URL
   */
  getOpdsUrl(): string {
    return `${this.serverUrl}/opds`;
  }

  // ==========================================================================
  // Health & Connection
  // ==========================================================================

  /**
   * Check server health
   */
  async checkHealth(): Promise<HealthResponse> {
    try {
      const response = await requestUrl({
        url: `${this.serverUrl}/health`,
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (response.status !== 200) {
        return { status: 'error' };
      }

      return response.json;
    } catch (error) {
      console.error('Server health check failed:', error);
      return { status: 'error' };
    }
  }

  /**
   * Test connection to the server
   */
  async testConnection(): Promise<boolean> {
    const health = await this.checkHealth();
    return health.status === 'ok';
  }

  // ==========================================================================
  // OPDS Integration
  // ==========================================================================

  /**
   * Fetch the root OPDS catalog
   */
  async fetchRootCatalog(): Promise<OPDSFeed> {
    return this.fetchFeed(this.getOpdsUrl());
  }

  /**
   * Fetch authors catalog
   */
  async fetchAuthors(): Promise<OPDSFeed> {
    return this.fetchFeed(`${this.serverUrl}/opds/authors`);
  }

  /**
   * Fetch series catalog
   */
  async fetchSeries(): Promise<OPDSFeed> {
    return this.fetchFeed(`${this.serverUrl}/opds/series`);
  }

  /**
   * Fetch recent books
   */
  async fetchRecent(): Promise<OPDSFeed> {
    return this.fetchFeed(`${this.serverUrl}/opds/recent`);
  }

  /**
   * Search the catalog
   */
  async searchCatalog(query: string): Promise<OPDSFeed> {
    const url = `${this.serverUrl}/opds/search?q=${encodeURIComponent(query)}`;
    return this.fetchFeed(url);
  }

  // ==========================================================================
  // Reading Progress
  // ==========================================================================

  /**
   * Get reading progress for a book
   */
  async getProgress(bookId: string): Promise<ReadingProgress | null> {
    try {
      const response = await requestUrl({
        url: `${this.serverUrl}/api/progress/${encodeURIComponent(bookId)}`,
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (response.status === 404) {
        return null;
      }

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = response.json;
      return {
        ...data,
        lastReadAt: new Date(data.lastReadAt || data.last_read_at),
        createdAt: new Date(data.createdAt || data.created_at),
        updatedAt: new Date(data.updatedAt || data.updated_at),
      };
    } catch (error) {
      console.error('Failed to get reading progress:', error);
      return null;
    }
  }

  /**
   * Update reading progress for a book
   */
  async updateProgress(
    bookId: string,
    progress: Partial<Omit<ReadingProgress, 'bookId' | 'createdAt' | 'updatedAt'>>
  ): Promise<ReadingProgress | null> {
    try {
      const response = await requestUrl({
        url: `${this.serverUrl}/api/progress/${encodeURIComponent(bookId)}`,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          progress: progress.progress,
          current_cfi: progress.currentCfi,
          current_chapter: progress.currentChapter,
          total_pages: progress.totalPages,
          current_page: progress.currentPage,
        }),
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = response.json;
      return {
        ...data,
        lastReadAt: new Date(data.lastReadAt || data.last_read_at),
        createdAt: new Date(data.createdAt || data.created_at),
        updatedAt: new Date(data.updatedAt || data.updated_at),
      };
    } catch (error) {
      console.error('Failed to update reading progress:', error);
      return null;
    }
  }

  // ==========================================================================
  // Highlights
  // ==========================================================================

  /**
   * Get all highlights for a book
   */
  async getHighlights(bookId: string): Promise<ServerHighlight[]> {
    try {
      const response = await requestUrl({
        url: `${this.serverUrl}/api/highlights/${encodeURIComponent(bookId)}`,
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = response.json;
      return (data.highlights || data || []).map((h: Record<string, unknown>) => ({
        ...h,
        createdAt: new Date((h.createdAt || h.created_at) as string),
        updatedAt: new Date((h.updatedAt || h.updated_at) as string),
      }));
    } catch (error) {
      console.error('Failed to get highlights:', error);
      return [];
    }
  }

  /**
   * Create a new highlight
   */
  async createHighlight(
    highlight: Omit<ServerHighlight, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ServerHighlight | null> {
    try {
      const response = await requestUrl({
        url: `${this.serverUrl}/api/highlights`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          book_id: highlight.bookId,
          user_id: highlight.userId,
          cfi_range: highlight.cfiRange,
          text: highlight.text,
          annotation: highlight.annotation,
          color: highlight.color,
          chapter: highlight.chapter,
        }),
      });

      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = response.json;
      return {
        ...data,
        createdAt: new Date(data.createdAt || data.created_at),
        updatedAt: new Date(data.updatedAt || data.updated_at),
      };
    } catch (error) {
      console.error('Failed to create highlight:', error);
      return null;
    }
  }

  /**
   * Delete a highlight
   */
  async deleteHighlight(highlightId: string): Promise<boolean> {
    try {
      const response = await requestUrl({
        url: `${this.serverUrl}/api/highlights/${encodeURIComponent(highlightId)}`,
        method: 'DELETE',
      });

      return response.status === 200 || response.status === 204;
    } catch (error) {
      console.error('Failed to delete highlight:', error);
      return false;
    }
  }

  // ==========================================================================
  // File Downloads
  // ==========================================================================

  /**
   * Get the download URL for a book file
   */
  getFileDownloadUrl(filePath: string): string {
    return `${this.serverUrl}/files/${filePath}`;
  }

  /**
   * Download a book file to the vault
   */
  async downloadFile(filePath: string, targetPath: string): Promise<string> {
    try {
      const response = await requestUrl({
        url: this.getFileDownloadUrl(filePath),
        method: 'GET',
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Ensure folder exists
      const folder = targetPath.substring(0, targetPath.lastIndexOf('/'));
      if (folder) {
        const folderFile = this.app.vault.getAbstractFileByPath(folder);
        if (!folderFile) {
          await this.app.vault.createFolder(folder);
        }
      }

      // Write the file
      await this.app.vault.adapter.writeBinary(targetPath, response.arrayBuffer);

      return targetPath;
    } catch (error) {
      console.error('Failed to download file:', error);
      throw new Error(`Failed to download file: ${error}`);
    }
  }
}
