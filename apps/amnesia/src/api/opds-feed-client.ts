/**
 * OPDS Feed Client
 *
 * Client for consuming external OPDS catalogs to discover and
 * download books from remote sources.
 *
 * Features:
 * - Parse OPDS 1.x feeds
 * - Navigation and browsing
 * - Search support
 * - Download acquisition links
 * - Feed caching
 *
 * @see https://specs.opds.io/opds-1.2
 * @see docs/specifications/file-system-architecture.md
 */

import type { OPDSBook, OPDSAuthor, OPDSLink } from './opds-generator';

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed OPDS feed
 */
export interface OPDSFeed {
  /** Feed type */
  type: 'navigation' | 'acquisition' | 'unknown';
  /** Feed ID */
  id: string;
  /** Feed title */
  title: string;
  /** Feed subtitle */
  subtitle?: string;
  /** Last updated */
  updated: string;
  /** Feed author */
  author?: OPDSAuthor;
  /** Feed icon URL */
  icon?: string;
  /** Navigation/content entries */
  entries: OPDSEntry[];
  /** Feed links */
  links: OPDSLink[];
  /** Total results (for paginated feeds) */
  totalResults?: number;
  /** Start index */
  startIndex?: number;
  /** Items per page */
  itemsPerPage?: number;
}

/**
 * OPDS entry (can be navigation or book)
 */
export interface OPDSEntry {
  /** Entry ID */
  id: string;
  /** Entry title */
  title: string;
  /** Entry subtitle */
  subtitle?: string;
  /** Updated timestamp */
  updated: string;
  /** Authors */
  authors: OPDSAuthor[];
  /** Summary/description */
  summary?: string;
  /** Content HTML */
  content?: string;
  /** Publisher */
  publisher?: string;
  /** Publication date */
  published?: string;
  /** Language */
  language?: string;
  /** ISBN */
  isbn?: string;
  /** Categories/subjects */
  categories: string[];
  /** Entry links */
  links: OPDSLink[];
  /** Is this a navigation entry (vs acquisition) */
  isNavigation: boolean;
  /** Cover image URL */
  coverUrl?: string;
  /** Thumbnail URL */
  thumbnailUrl?: string;
  /** Acquisition links */
  acquisitionLinks: AcquisitionLink[];
}

/**
 * Acquisition link for downloading
 */
export interface AcquisitionLink {
  /** Link URL */
  href: string;
  /** MIME type */
  type: string;
  /** Acquisition type */
  rel: 'acquisition' | 'acquisition/buy' | 'acquisition/borrow' | 'acquisition/sample';
  /** Price (if applicable) */
  price?: {
    value: number;
    currency: string;
  };
  /** File size */
  length?: number;
}

/**
 * Saved OPDS source
 */
export interface OPDSSource {
  /** Source ID */
  id: string;
  /** Source name */
  name: string;
  /** Root feed URL */
  url: string;
  /** Icon URL */
  iconUrl?: string;
  /** Authentication required */
  authRequired: boolean;
  /** Username (if auth required) */
  username?: string;
  /** Last accessed */
  lastAccessed: number;
  /** Is enabled */
  enabled: boolean;
}

/**
 * OPDS client configuration
 */
export interface OPDSClientConfig {
  /** Request timeout in ms */
  timeout: number;
  /** Enable caching */
  enableCache: boolean;
  /** Cache TTL in ms */
  cacheTTL: number;
  /** User agent string */
  userAgent: string;
}

/**
 * Default configuration
 */
export const DEFAULT_CLIENT_CONFIG: OPDSClientConfig = {
  timeout: 10000,
  enableCache: true,
  cacheTTL: 300000, // 5 minutes
  userAgent: 'Los-Libros/1.0 OPDS-Client',
};

// ============================================================================
// OPDS Feed Client
// ============================================================================

export class OPDSFeedClient {
  private config: OPDSClientConfig;
  private sources: Map<string, OPDSSource> = new Map();
  private feedCache: Map<string, { feed: OPDSFeed; timestamp: number }> = new Map();

  constructor(config: Partial<OPDSClientConfig> = {}) {
    this.config = { ...DEFAULT_CLIENT_CONFIG, ...config };
  }

  // ==========================================================================
  // Source Management
  // ==========================================================================

  /**
   * Add an OPDS source
   */
  addSource(source: Omit<OPDSSource, 'id' | 'lastAccessed'>): OPDSSource {
    const id = this.generateId();
    const newSource: OPDSSource = {
      ...source,
      id,
      lastAccessed: Date.now(),
    };

    this.sources.set(id, newSource);
    return newSource;
  }

  /**
   * Remove an OPDS source
   */
  removeSource(id: string): void {
    this.sources.delete(id);
  }

  /**
   * Get all sources
   */
  getSources(): OPDSSource[] {
    return Array.from(this.sources.values());
  }

  /**
   * Get a source by ID
   */
  getSource(id: string): OPDSSource | null {
    return this.sources.get(id) || null;
  }

  /**
   * Update a source
   */
  updateSource(id: string, updates: Partial<OPDSSource>): void {
    const source = this.sources.get(id);
    if (source) {
      Object.assign(source, updates);
    }
  }

  // ==========================================================================
  // Feed Operations
  // ==========================================================================

  /**
   * Fetch and parse an OPDS feed
   */
  async fetchFeed(url: string, auth?: { username: string; password: string }): Promise<OPDSFeed> {
    // Check cache
    if (this.config.enableCache) {
      const cached = this.feedCache.get(url);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
        return cached.feed;
      }
    }

    // Fetch feed
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/atom+xml, application/xml, text/xml',
        'User-Agent': this.config.userAgent,
      };

      if (auth) {
        const credentials = btoa(`${auth.username}:${auth.password}`);
        headers['Authorization'] = `Basic ${credentials}`;
      }

      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const xml = await response.text();
      const feed = this.parseFeed(xml, url);

      // Cache result
      if (this.config.enableCache) {
        this.feedCache.set(url, { feed, timestamp: Date.now() });
      }

      return feed;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Follow a navigation link
   */
  async navigate(
    link: OPDSLink,
    auth?: { username: string; password: string }
  ): Promise<OPDSFeed> {
    return this.fetchFeed(link.href, auth);
  }

  /**
   * Search a catalog
   */
  async search(
    searchUrl: string,
    query: string,
    auth?: { username: string; password: string }
  ): Promise<OPDSFeed> {
    const url = searchUrl.replace('{searchTerms}', encodeURIComponent(query));
    return this.fetchFeed(url, auth);
  }

  // ==========================================================================
  // Feed Parsing
  // ==========================================================================

  /**
   * Parse OPDS feed XML
   */
  private parseFeed(xml: string, baseUrl: string): OPDSFeed {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');

    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      throw new Error('Invalid XML: ' + parseError.textContent);
    }

    const feed = doc.querySelector('feed');
    if (!feed) {
      throw new Error('Not a valid OPDS feed: missing <feed> element');
    }

    // Parse basic feed info
    const id = this.getTextContent(feed, 'id') || baseUrl;
    const title = this.getTextContent(feed, 'title') || 'Untitled Feed';
    const subtitle = this.getTextContent(feed, 'subtitle');
    const updated = this.getTextContent(feed, 'updated') || new Date().toISOString();
    const icon = this.getTextContent(feed, 'icon');

    // Parse author
    const authorEl = feed.querySelector('author');
    const author = authorEl
      ? {
          name: this.getTextContent(authorEl, 'name') || 'Unknown',
          uri: this.getTextContent(authorEl, 'uri'),
        }
      : undefined;

    // Parse links
    const links = this.parseLinks(feed, baseUrl);

    // Parse entries
    const entryEls = feed.querySelectorAll('entry');
    const entries = Array.from(entryEls).map((el) => this.parseEntry(el, baseUrl));

    // Determine feed type
    const type = this.determineFeedType(links, entries);

    // Parse OpenSearch info
    const totalResults = this.getNumberContent(feed, 'opensearch\\:totalResults, totalResults');
    const startIndex = this.getNumberContent(feed, 'opensearch\\:startIndex, startIndex');
    const itemsPerPage = this.getNumberContent(feed, 'opensearch\\:itemsPerPage, itemsPerPage');

    return {
      type,
      id,
      title,
      subtitle,
      updated,
      author,
      icon,
      entries,
      links,
      totalResults,
      startIndex,
      itemsPerPage,
    };
  }

  /**
   * Parse entry element
   */
  private parseEntry(entry: Element, baseUrl: string): OPDSEntry {
    const id = this.getTextContent(entry, 'id') || '';
    const title = this.getTextContent(entry, 'title') || 'Untitled';
    const subtitle = this.getTextContent(entry, 'subtitle');
    const updated = this.getTextContent(entry, 'updated') || new Date().toISOString();
    const summary = this.getTextContent(entry, 'summary');
    const contentEl = entry.querySelector('content');
    const content = contentEl?.innerHTML || contentEl?.textContent || undefined;

    // Parse authors
    const authorEls = entry.querySelectorAll('author');
    const authors = Array.from(authorEls).map((el) => ({
      name: this.getTextContent(el, 'name') || 'Unknown',
      uri: this.getTextContent(el, 'uri'),
    }));

    // Parse Dublin Core metadata
    const publisher = this.getTextContent(entry, 'dc\\:publisher, publisher');
    const published = this.getTextContent(entry, 'dc\\:date, date, published');
    const language = this.getTextContent(entry, 'dc\\:language, language');

    // Parse ISBN
    const identifiers = entry.querySelectorAll('dc\\:identifier, identifier');
    let isbn: string | undefined;
    for (const idEl of identifiers) {
      const text = idEl.textContent || '';
      if (text.includes('isbn:')) {
        isbn = text.replace(/^urn:isbn:/i, '');
        break;
      }
    }

    // Parse categories
    const categoryEls = entry.querySelectorAll('category');
    const categories = Array.from(categoryEls)
      .map((el) => el.getAttribute('term') || el.getAttribute('label') || '')
      .filter(Boolean);

    // Parse links
    const links = this.parseLinks(entry, baseUrl);

    // Find cover images
    const coverUrl = links.find(
      (l) => l.rel === 'http://opds-spec.org/image' || l.rel.includes('/image')
    )?.href;
    const thumbnailUrl = links.find(
      (l) => l.rel === 'http://opds-spec.org/image/thumbnail' || l.rel.includes('/thumbnail')
    )?.href;

    // Parse acquisition links
    const acquisitionLinks = this.parseAcquisitionLinks(entry, baseUrl);

    // Determine if navigation entry
    const isNavigation =
      acquisitionLinks.length === 0 &&
      links.some((l) => l.rel === 'subsection' || l.type.includes('opds-catalog'));

    return {
      id,
      title,
      subtitle,
      updated,
      authors,
      summary,
      content,
      publisher,
      published,
      language,
      isbn,
      categories,
      links,
      isNavigation,
      coverUrl,
      thumbnailUrl,
      acquisitionLinks,
    };
  }

  /**
   * Parse link elements
   */
  private parseLinks(parent: Element, baseUrl: string): OPDSLink[] {
    const linkEls = parent.querySelectorAll(':scope > link');
    return Array.from(linkEls).map((el) => {
      const href = el.getAttribute('href') || '';
      const resolvedHref = this.resolveUrl(href, baseUrl);

      return {
        rel: el.getAttribute('rel') || '',
        href: resolvedHref,
        type: el.getAttribute('type') || 'application/atom+xml',
        title: el.getAttribute('title') || undefined,
        facetGroup: el.getAttribute('opds:facetGroup') || undefined,
        activeFacet: el.getAttribute('opds:activeFacet') === 'true',
        count: el.hasAttribute('thr:count')
          ? parseInt(el.getAttribute('thr:count') || '0', 10)
          : undefined,
      };
    });
  }

  /**
   * Parse acquisition links
   */
  private parseAcquisitionLinks(entry: Element, baseUrl: string): AcquisitionLink[] {
    const links: AcquisitionLink[] = [];
    const linkEls = entry.querySelectorAll('link');

    for (const el of linkEls) {
      const rel = el.getAttribute('rel') || '';

      if (rel.includes('acquisition')) {
        const href = this.resolveUrl(el.getAttribute('href') || '', baseUrl);
        const type = el.getAttribute('type') || 'application/epub+zip';
        const length = el.hasAttribute('length')
          ? parseInt(el.getAttribute('length') || '0', 10)
          : undefined;

        // Determine acquisition type
        let acquisitionRel: AcquisitionLink['rel'] = 'acquisition';
        if (rel.includes('/buy')) acquisitionRel = 'acquisition/buy';
        else if (rel.includes('/borrow')) acquisitionRel = 'acquisition/borrow';
        else if (rel.includes('/sample')) acquisitionRel = 'acquisition/sample';

        // Parse price
        const priceEl = el.querySelector('opds\\:price, price');
        const price = priceEl
          ? {
              value: parseFloat(priceEl.textContent || '0'),
              currency: priceEl.getAttribute('currencycode') || 'USD',
            }
          : undefined;

        links.push({
          href,
          type,
          rel: acquisitionRel,
          price,
          length,
        });
      }
    }

    return links;
  }

  /**
   * Determine feed type from content
   */
  private determineFeedType(
    links: OPDSLink[],
    entries: OPDSEntry[]
  ): 'navigation' | 'acquisition' | 'unknown' {
    // Check self link for kind hint
    const selfLink = links.find((l) => l.rel === 'self');
    if (selfLink?.type.includes('kind=navigation')) return 'navigation';
    if (selfLink?.type.includes('kind=acquisition')) return 'acquisition';

    // Infer from entries
    if (entries.length === 0) return 'navigation';
    if (entries.every((e) => e.isNavigation)) return 'navigation';
    if (entries.some((e) => e.acquisitionLinks.length > 0)) return 'acquisition';

    return 'unknown';
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Get text content of child element
   */
  private getTextContent(parent: Element, selector: string): string | undefined {
    const el = parent.querySelector(selector);
    return el?.textContent?.trim() || undefined;
  }

  /**
   * Get number content of child element
   */
  private getNumberContent(parent: Element, selector: string): number | undefined {
    const text = this.getTextContent(parent, selector);
    if (!text) return undefined;
    const num = parseInt(text, 10);
    return isNaN(num) ? undefined : num;
  }

  /**
   * Resolve relative URL
   */
  private resolveUrl(url: string, base: string): string {
    try {
      return new URL(url, base).href;
    } catch {
      return url;
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `opds-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Clear feed cache
   */
  clearCache(): void {
    this.feedCache.clear();
  }

  /**
   * Convert entry to OPDSBook format
   */
  entryToBook(entry: OPDSEntry): OPDSBook | null {
    if (entry.isNavigation || entry.acquisitionLinks.length === 0) {
      return null;
    }

    const acquisition = entry.acquisitionLinks.find(
      (l) => l.type.includes('epub') || l.type.includes('application/epub')
    ) || entry.acquisitionLinks[0];

    return {
      id: entry.id,
      title: entry.title,
      subtitle: entry.subtitle,
      authors: entry.authors,
      publisher: entry.publisher,
      published: entry.published,
      language: entry.language,
      isbn: entry.isbn,
      summary: entry.summary,
      subjects: entry.categories,
      coverUrl: entry.coverUrl,
      thumbnailUrl: entry.thumbnailUrl,
      downloadUrl: acquisition.href,
      fileSize: acquisition.length,
      mimeType: acquisition.type,
      updated: entry.updated,
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an OPDS feed client
 */
export function createOPDSFeedClient(
  config?: Partial<OPDSClientConfig>
): OPDSFeedClient {
  return new OPDSFeedClient(config);
}
