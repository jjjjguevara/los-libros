/**
 * OPDS HTTP Client
 */
import { App, requestUrl } from 'obsidian';
import { OPDSParser } from './opds-parser';
import type {
  OPDSCatalog,
  OPDSFeed,
  OPDSEntry,
  OPDSEntryType,
  OPDSAcquisitionEntry,
} from './opds-types';
import { OPDS_REL } from './opds-types';

export class OPDSClient {
  private parser: OPDSParser;
  private cache: Map<string, { feed: OPDSFeed; timestamp: number }>;
  private cacheTimeout: number = 5 * 60 * 1000; // 5 minutes
  protected app: App;

  constructor(app: App) {
    this.app = app;
    this.parser = new OPDSParser();
    this.cache = new Map();
  }

  /**
   * Fetch an OPDS feed
   */
  async fetchFeed(url: string, options?: { noCache?: boolean }): Promise<OPDSFeed> {
    // Check cache
    if (!options?.noCache) {
      const cached = this.cache.get(url);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.feed;
      }
    }

    try {
      const response = await requestUrl({
        url,
        method: 'GET',
        headers: {
          'Accept': 'application/atom+xml, application/xml, text/xml, */*',
        },
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: ${response.text}`);
      }

      const feed = this.parser.parseFeed(response.text, url);

      // Cache the result
      this.cache.set(url, { feed, timestamp: Date.now() });

      return feed;
    } catch (error) {
      console.error('Failed to fetch OPDS feed:', error);
      throw new Error(`Failed to fetch OPDS feed: ${error}`);
    }
  }

  /**
   * Get classified entries from a feed
   */
  getClassifiedEntries(feed: OPDSFeed): OPDSEntryType[] {
    return feed.entries.map(entry => this.parser.classifyEntry(entry));
  }

  /**
   * Navigate to a link in the feed
   */
  async navigate(feed: OPDSFeed, rel: string): Promise<OPDSFeed | null> {
    const link = feed.links.find(l => l.rel === rel);
    if (!link) {
      return null;
    }
    return this.fetchFeed(link.href);
  }

  /**
   * Get the next page of results
   */
  async getNextPage(feed: OPDSFeed): Promise<OPDSFeed | null> {
    return this.navigate(feed, OPDS_REL.NEXT);
  }

  /**
   * Get the previous page of results
   */
  async getPreviousPage(feed: OPDSFeed): Promise<OPDSFeed | null> {
    return this.navigate(feed, OPDS_REL.PREVIOUS);
  }

  /**
   * Search the catalog
   */
  async search(feed: OPDSFeed, query: string): Promise<OPDSFeed | null> {
    const searchLink = feed.links.find(l => l.rel === OPDS_REL.SEARCH);
    if (!searchLink) {
      return null;
    }

    // Replace {searchTerms} in URL template
    const searchUrl = searchLink.href.replace('{searchTerms}', encodeURIComponent(query));
    return this.fetchFeed(searchUrl);
  }

  /**
   * Download a book to the vault
   */
  async downloadBook(
    entry: OPDSAcquisitionEntry,
    targetFolder: string,
    preferredFormat: string = 'application/epub+zip'
  ): Promise<string> {
    // Find the preferred format, or fall back to first available
    const format = entry.formats.find(f => f.type === preferredFormat) || entry.formats[0];

    if (!format) {
      throw new Error('No downloadable format available');
    }

    try {
      const response = await requestUrl({
        url: format.url,
        method: 'GET',
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Determine filename
      const filename = this.sanitizeFilename(entry.title);
      const extension = this.getExtension(format.type);
      const filePath = `${targetFolder}/${filename}.${extension}`;

      // Ensure folder exists
      const folder = this.app.vault.getAbstractFileByPath(targetFolder);
      if (!folder) {
        await this.app.vault.createFolder(targetFolder);
      }

      // Write the file
      await this.app.vault.adapter.writeBinary(
        filePath,
        response.arrayBuffer
      );

      return filePath;
    } catch (error) {
      console.error('Failed to download book:', error);
      throw new Error(`Failed to download book: ${error}`);
    }
  }

  /**
   * Get file extension from media type
   */
  private getExtension(mediaType: string): string {
    const extensions: Record<string, string> = {
      'application/epub+zip': 'epub',
      'application/pdf': 'pdf',
      'application/x-mobipocket-ebook': 'mobi',
      'application/x-mobi8-ebook': 'azw3',
    };
    return extensions[mediaType] || 'epub';
  }

  /**
   * Sanitize filename
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Test if a URL is a valid OPDS feed
   */
  async testConnection(url: string): Promise<boolean> {
    try {
      await this.fetchFeed(url, { noCache: true });
      return true;
    } catch {
      return false;
    }
  }
}
