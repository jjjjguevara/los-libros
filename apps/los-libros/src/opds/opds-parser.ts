/**
 * OPDS 1.2 XML Parser
 */
import type {
  OPDSFeed,
  OPDSEntry,
  OPDSLink,
  OPDSFormat,
  OPDSEntryType,
  OPDSNavigationEntry,
  OPDSAcquisitionEntry,
} from './opds-types';
import { OPDS_REL, OPDS_MEDIA_TYPES } from './opds-types';

export class OPDSParser {
  private parser: DOMParser;

  constructor() {
    this.parser = new DOMParser();
  }

  /**
   * Parse an OPDS feed from XML string
   */
  parseFeed(xml: string, baseUrl: string): OPDSFeed {
    const doc = this.parser.parseFromString(xml, 'application/xml');

    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      throw new Error(`Failed to parse OPDS feed: ${parseError.textContent}`);
    }

    const feed = doc.querySelector('feed');
    if (!feed) {
      throw new Error('Invalid OPDS feed: no feed element');
    }

    return {
      id: this.getText(feed, 'id') || baseUrl,
      title: this.getText(feed, 'title') || 'Untitled',
      updated: this.getDate(feed, 'updated') || new Date(),
      links: this.parseLinks(feed, baseUrl),
      entries: this.parseEntries(feed, baseUrl),
      totalResults: this.getNumber(feed, 'opensearch\\:totalResults'),
      startIndex: this.getNumber(feed, 'opensearch\\:startIndex'),
      itemsPerPage: this.getNumber(feed, 'opensearch\\:itemsPerPage'),
    };
  }

  /**
   * Parse link elements
   */
  private parseLinks(parent: Element, baseUrl: string): OPDSLink[] {
    const links: OPDSLink[] = [];
    const linkElements = parent.querySelectorAll(':scope > link');

    for (const link of linkElements) {
      const href = link.getAttribute('href');
      const rel = link.getAttribute('rel');

      if (href) {
        links.push({
          href: this.resolveUrl(href, baseUrl),
          rel: rel || 'alternate',
          type: link.getAttribute('type') || undefined,
          title: link.getAttribute('title') || undefined,
        });
      }
    }

    return links;
  }

  /**
   * Parse entry elements
   */
  private parseEntries(feed: Element, baseUrl: string): OPDSEntry[] {
    const entries: OPDSEntry[] = [];
    const entryElements = feed.querySelectorAll(':scope > entry');

    for (const entry of entryElements) {
      entries.push(this.parseEntry(entry, baseUrl));
    }

    return entries;
  }

  /**
   * Parse a single entry
   */
  private parseEntry(entry: Element, baseUrl: string): OPDSEntry {
    const links = this.parseLinks(entry, baseUrl);

    // Extract cover/thumbnail from links
    let coverUrl: string | undefined;
    let thumbnailUrl: string | undefined;

    for (const link of links) {
      if (
        link.rel === OPDS_REL.IMAGE ||
        link.rel === OPDS_REL.COVER ||
        link.rel.includes('image')
      ) {
        coverUrl = link.href;
      }
      if (
        link.rel === OPDS_REL.IMAGE_THUMBNAIL ||
        link.rel === OPDS_REL.THUMBNAIL ||
        link.rel.includes('thumbnail')
      ) {
        thumbnailUrl = link.href;
      }
    }

    // Fall back to cover if no thumbnail
    if (!thumbnailUrl) {
      thumbnailUrl = coverUrl;
    }

    // Parse categories/tags
    const categories: string[] = [];
    const categoryElements = entry.querySelectorAll('category');
    for (const cat of categoryElements) {
      const term = cat.getAttribute('term') || cat.getAttribute('label');
      if (term) {
        categories.push(term);
      }
    }

    return {
      id: this.getText(entry, 'id') || '',
      title: this.getText(entry, 'title') || 'Untitled',
      author: this.getAuthor(entry),
      summary: this.getText(entry, 'summary') || this.getText(entry, 'content'),
      published: this.getDate(entry, 'published'),
      updated: this.getDate(entry, 'updated'),
      language: this.getText(entry, 'dc\\:language') || this.getText(entry, 'dcterms\\:language'),
      rights: this.getText(entry, 'rights'),
      publisher: this.getText(entry, 'dc\\:publisher') || this.getText(entry, 'dcterms\\:publisher'),
      categories,
      links,
      coverUrl,
      thumbnailUrl,
    };
  }

  /**
   * Classify entry as navigation or acquisition
   */
  classifyEntry(entry: OPDSEntry): OPDSEntryType {
    // Check for acquisition links
    const acquisitionLinks = entry.links.filter(
      l =>
        l.rel.startsWith('http://opds-spec.org/acquisition') ||
        l.type === OPDS_MEDIA_TYPES.EPUB ||
        l.type === OPDS_MEDIA_TYPES.PDF ||
        l.type === OPDS_MEDIA_TYPES.MOBI
    );

    if (acquisitionLinks.length > 0) {
      // This is a book entry
      const formats: OPDSFormat[] = acquisitionLinks.map(link => ({
        type: link.type || 'application/octet-stream',
        url: link.href,
      }));

      return {
        ...entry,
        isNavigation: false,
        formats,
      } as OPDSAcquisitionEntry;
    } else {
      // This is a navigation entry
      const navigationLink = entry.links.find(
        l =>
          l.rel === 'subsection' ||
          l.rel === 'alternate' ||
          l.type?.includes('atom+xml')
      );

      return {
        ...entry,
        isNavigation: true,
        navigationUrl: navigationLink?.href || '',
      } as OPDSNavigationEntry;
    }
  }

  /**
   * Get text content of an element
   */
  private getText(parent: Element, selector: string): string | undefined {
    const element = parent.querySelector(selector);
    return element?.textContent?.trim() || undefined;
  }

  /**
   * Get numeric content
   */
  private getNumber(parent: Element, selector: string): number | undefined {
    const text = this.getText(parent, selector);
    if (text) {
      const num = parseInt(text, 10);
      return isNaN(num) ? undefined : num;
    }
    return undefined;
  }

  /**
   * Get date content
   */
  private getDate(parent: Element, selector: string): Date | undefined {
    const text = this.getText(parent, selector);
    if (text) {
      const date = new Date(text);
      return isNaN(date.getTime()) ? undefined : date;
    }
    return undefined;
  }

  /**
   * Get author name
   */
  private getAuthor(entry: Element): string | undefined {
    const author = entry.querySelector('author');
    if (author) {
      const name = author.querySelector('name');
      return name?.textContent?.trim();
    }
    return undefined;
  }

  /**
   * Resolve relative URL against base
   */
  private resolveUrl(href: string, baseUrl: string): string {
    try {
      return new URL(href, baseUrl).href;
    } catch {
      return href;
    }
  }
}
