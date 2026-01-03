/**
 * OPDS Catalog Generator
 *
 * Generates OPDS (Open Publication Distribution System) feeds from
 * the book library for interoperability with OPDS-compatible readers.
 *
 * Features:
 * - OPDS 1.2 catalog generation
 * - Navigation and acquisition feeds
 * - Search support
 * - Faceted browsing (author, subject, etc.)
 * - Cover image links
 *
 * @see https://specs.opds.io/opds-1.2
 * @see docs/specifications/file-system-architecture.md
 */

// ============================================================================
// Types
// ============================================================================

/**
 * OPDS feed types
 */
export type OPDSFeedType =
  | 'navigation'
  | 'acquisition'
  | 'search'
  | 'shelf';

/**
 * Book entry for OPDS catalog
 */
export interface OPDSBook {
  /** Unique book ID */
  id: string;
  /** Book title */
  title: string;
  /** Book subtitle */
  subtitle?: string;
  /** Authors */
  authors: OPDSAuthor[];
  /** Publisher */
  publisher?: string;
  /** Publication date */
  published?: string;
  /** Language (ISO 639-1) */
  language?: string;
  /** ISBN */
  isbn?: string;
  /** Description/summary */
  summary?: string;
  /** Subjects/categories */
  subjects?: string[];
  /** Cover image URL */
  coverUrl?: string;
  /** Thumbnail URL */
  thumbnailUrl?: string;
  /** Download URL */
  downloadUrl: string;
  /** File size in bytes */
  fileSize?: number;
  /** MIME type */
  mimeType: string;
  /** Last updated timestamp */
  updated: string;
  /** Reading progress (0-1) */
  progress?: number;
}

/**
 * Author information
 */
export interface OPDSAuthor {
  /** Author name */
  name: string;
  /** Author URI (optional) */
  uri?: string;
}

/**
 * OPDS link
 */
export interface OPDSLink {
  /** Link relation */
  rel: string;
  /** Link URL */
  href: string;
  /** MIME type */
  type: string;
  /** Link title */
  title?: string;
  /** Facet group */
  facetGroup?: string;
  /** Active facet */
  activeFacet?: boolean;
  /** Count (for facets) */
  count?: number;
}

/**
 * OPDS navigation entry
 */
export interface OPDSNavEntry {
  /** Entry title */
  title: string;
  /** Entry ID */
  id: string;
  /** Link to feed */
  href: string;
  /** Content description */
  content?: string;
  /** Entry updated timestamp */
  updated: string;
}

/**
 * Catalog configuration
 */
export interface OPDSCatalogConfig {
  /** Catalog title */
  title: string;
  /** Catalog subtitle */
  subtitle?: string;
  /** Catalog ID (URI) */
  id: string;
  /** Author/owner */
  author: OPDSAuthor;
  /** Base URL for links */
  baseUrl: string;
  /** Icon URL */
  iconUrl?: string;
  /** Items per page */
  pageSize: number;
  /** Enable search */
  enableSearch: boolean;
  /** Search description URL */
  searchDescriptionUrl?: string;
}

/**
 * Default configuration
 */
export const DEFAULT_OPDS_CONFIG: OPDSCatalogConfig = {
  title: 'Amnesia Library',
  id: 'urn:uuid:amnesia-catalog',
  author: {
    name: 'Amnesia',
    uri: 'https://github.com/amnesia',
  },
  baseUrl: '/opds',
  pageSize: 25,
  enableSearch: true,
};

// ============================================================================
// OPDS Generator
// ============================================================================

export class OPDSGenerator {
  private config: OPDSCatalogConfig;

  constructor(config: Partial<OPDSCatalogConfig> = {}) {
    this.config = { ...DEFAULT_OPDS_CONFIG, ...config };
  }

  // ==========================================================================
  // Feed Generation
  // ==========================================================================

  /**
   * Generate root navigation feed
   */
  generateRootFeed(): string {
    const entries: OPDSNavEntry[] = [
      {
        title: 'All Books',
        id: 'all-books',
        href: `${this.config.baseUrl}/all`,
        content: 'Browse all books in the library',
        updated: new Date().toISOString(),
      },
      {
        title: 'Recent Additions',
        id: 'recent',
        href: `${this.config.baseUrl}/recent`,
        content: 'Recently added books',
        updated: new Date().toISOString(),
      },
      {
        title: 'Currently Reading',
        id: 'reading',
        href: `${this.config.baseUrl}/reading`,
        content: 'Books in progress',
        updated: new Date().toISOString(),
      },
      {
        title: 'By Author',
        id: 'authors',
        href: `${this.config.baseUrl}/authors`,
        content: 'Browse by author',
        updated: new Date().toISOString(),
      },
      {
        title: 'By Subject',
        id: 'subjects',
        href: `${this.config.baseUrl}/subjects`,
        content: 'Browse by subject',
        updated: new Date().toISOString(),
      },
    ];

    return this.buildNavigationFeed(entries, {
      title: this.config.title,
      id: this.config.id,
      updated: new Date().toISOString(),
      self: this.config.baseUrl,
    });
  }

  /**
   * Generate acquisition feed from books
   */
  generateAcquisitionFeed(
    books: OPDSBook[],
    options: {
      title: string;
      id: string;
      page?: number;
      totalBooks?: number;
      facets?: OPDSLink[];
    }
  ): string {
    const page = options.page || 1;
    const totalBooks = options.totalBooks || books.length;
    const totalPages = Math.ceil(totalBooks / this.config.pageSize);

    const links: OPDSLink[] = [
      {
        rel: 'self',
        href: `${this.config.baseUrl}/${options.id}?page=${page}`,
        type: 'application/atom+xml;profile=opds-catalog;kind=acquisition',
      },
      {
        rel: 'start',
        href: this.config.baseUrl,
        type: 'application/atom+xml;profile=opds-catalog;kind=navigation',
        title: 'Home',
      },
    ];

    // Pagination links
    if (page > 1) {
      links.push({
        rel: 'previous',
        href: `${this.config.baseUrl}/${options.id}?page=${page - 1}`,
        type: 'application/atom+xml;profile=opds-catalog;kind=acquisition',
      });
      links.push({
        rel: 'first',
        href: `${this.config.baseUrl}/${options.id}?page=1`,
        type: 'application/atom+xml;profile=opds-catalog;kind=acquisition',
      });
    }

    if (page < totalPages) {
      links.push({
        rel: 'next',
        href: `${this.config.baseUrl}/${options.id}?page=${page + 1}`,
        type: 'application/atom+xml;profile=opds-catalog;kind=acquisition',
      });
      links.push({
        rel: 'last',
        href: `${this.config.baseUrl}/${options.id}?page=${totalPages}`,
        type: 'application/atom+xml;profile=opds-catalog;kind=acquisition',
      });
    }

    // Search link
    if (this.config.enableSearch) {
      links.push({
        rel: 'search',
        href: `${this.config.baseUrl}/search?q={searchTerms}`,
        type: 'application/opensearchdescription+xml',
      });
    }

    // Facets
    if (options.facets) {
      links.push(...options.facets);
    }

    return this.buildAcquisitionFeed(books, {
      title: options.title,
      id: `${this.config.id}:${options.id}`,
      updated: new Date().toISOString(),
      links,
      totalResults: totalBooks,
      startIndex: (page - 1) * this.config.pageSize + 1,
      itemsPerPage: this.config.pageSize,
    });
  }

  /**
   * Generate search results feed
   */
  generateSearchResultsFeed(
    query: string,
    books: OPDSBook[],
    totalResults: number
  ): string {
    return this.generateAcquisitionFeed(books, {
      title: `Search: ${query}`,
      id: `search-${encodeURIComponent(query)}`,
      totalBooks: totalResults,
    });
  }

  /**
   * Generate OpenSearch description
   */
  generateOpenSearchDescription(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>${this.escapeXml(this.config.title)}</ShortName>
  <Description>Search ${this.escapeXml(this.config.title)}</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <OutputEncoding>UTF-8</OutputEncoding>
  <Url type="application/atom+xml;profile=opds-catalog;kind=acquisition"
       template="${this.config.baseUrl}/search?q={searchTerms}"/>
  <Url type="text/html"
       template="${this.config.baseUrl}/search?q={searchTerms}&amp;format=html"/>
</OpenSearchDescription>`;
  }

  // ==========================================================================
  // Internal: Feed Building
  // ==========================================================================

  /**
   * Build navigation feed XML
   */
  private buildNavigationFeed(
    entries: OPDSNavEntry[],
    options: {
      title: string;
      id: string;
      updated: string;
      self: string;
    }
  ): string {
    const entriesXml = entries
      .map(
        (entry) => `
  <entry>
    <title>${this.escapeXml(entry.title)}</title>
    <id>${this.escapeXml(entry.id)}</id>
    <updated>${entry.updated}</updated>
    <link rel="subsection"
          href="${this.escapeXml(entry.href)}"
          type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
    ${entry.content ? `<content type="text">${this.escapeXml(entry.content)}</content>` : ''}
  </entry>`
      )
      .join('\n');

    return this.buildFeedWrapper({
      ...options,
      kind: 'navigation',
      entries: entriesXml,
    });
  }

  /**
   * Build acquisition feed XML
   */
  private buildAcquisitionFeed(
    books: OPDSBook[],
    options: {
      title: string;
      id: string;
      updated: string;
      links: OPDSLink[];
      totalResults?: number;
      startIndex?: number;
      itemsPerPage?: number;
    }
  ): string {
    const entriesXml = books.map((book) => this.buildBookEntry(book)).join('\n');

    const linksXml = options.links
      .map(
        (link) =>
          `<link rel="${link.rel}" href="${this.escapeXml(link.href)}" type="${link.type}"` +
          (link.title ? ` title="${this.escapeXml(link.title)}"` : '') +
          (link.facetGroup ? ` opds:facetGroup="${this.escapeXml(link.facetGroup)}"` : '') +
          (link.activeFacet ? ' opds:activeFacet="true"' : '') +
          (link.count !== undefined ? ` thr:count="${link.count}"` : '') +
          '/>'
      )
      .join('\n  ');

    let opensearchXml = '';
    if (options.totalResults !== undefined) {
      opensearchXml = `
  <opensearch:totalResults>${options.totalResults}</opensearch:totalResults>
  <opensearch:startIndex>${options.startIndex || 1}</opensearch:startIndex>
  <opensearch:itemsPerPage>${options.itemsPerPage || this.config.pageSize}</opensearch:itemsPerPage>`;
    }

    return this.buildFeedWrapper({
      title: options.title,
      id: options.id,
      updated: options.updated,
      kind: 'acquisition',
      entries: entriesXml,
      extraLinks: linksXml,
      extraContent: opensearchXml,
    });
  }

  /**
   * Build single book entry XML
   */
  private buildBookEntry(book: OPDSBook): string {
    const authorsXml = book.authors
      .map(
        (author) =>
          `<author>
      <name>${this.escapeXml(author.name)}</name>
      ${author.uri ? `<uri>${this.escapeXml(author.uri)}</uri>` : ''}
    </author>`
      )
      .join('\n    ');

    const categoriesXml = (book.subjects || [])
      .map((subject) => `<category term="${this.escapeXml(subject)}"/>`)
      .join('\n    ');

    const coverLinks = [];
    if (book.coverUrl) {
      coverLinks.push(
        `<link rel="http://opds-spec.org/image" href="${this.escapeXml(book.coverUrl)}" type="image/jpeg"/>`
      );
    }
    if (book.thumbnailUrl) {
      coverLinks.push(
        `<link rel="http://opds-spec.org/image/thumbnail" href="${this.escapeXml(book.thumbnailUrl)}" type="image/jpeg"/>`
      );
    }

    return `
  <entry>
    <title>${this.escapeXml(book.title)}</title>
    ${book.subtitle ? `<subtitle>${this.escapeXml(book.subtitle)}</subtitle>` : ''}
    <id>urn:uuid:${book.id}</id>
    <updated>${book.updated}</updated>
    ${authorsXml}
    ${book.publisher ? `<dc:publisher>${this.escapeXml(book.publisher)}</dc:publisher>` : ''}
    ${book.published ? `<dc:date>${book.published}</dc:date>` : ''}
    ${book.language ? `<dc:language>${book.language}</dc:language>` : ''}
    ${book.isbn ? `<dc:identifier>urn:isbn:${book.isbn}</dc:identifier>` : ''}
    ${categoriesXml}
    ${book.summary ? `<summary type="text">${this.escapeXml(book.summary)}</summary>` : ''}
    ${coverLinks.join('\n    ')}
    <link rel="http://opds-spec.org/acquisition"
          href="${this.escapeXml(book.downloadUrl)}"
          type="${book.mimeType}"
          ${book.fileSize ? `length="${book.fileSize}"` : ''}/>
  </entry>`;
  }

  /**
   * Build feed wrapper with namespaces
   */
  private buildFeedWrapper(options: {
    title: string;
    id: string;
    updated: string;
    kind: 'navigation' | 'acquisition';
    entries: string;
    extraLinks?: string;
    extraContent?: string;
  }): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:dc="http://purl.org/dc/terms/"
      xmlns:opds="http://opds-spec.org/2010/catalog"
      xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:thr="http://purl.org/syndication/thread/1.0">

  <id>${this.escapeXml(options.id)}</id>
  <title>${this.escapeXml(options.title)}</title>
  ${this.config.subtitle ? `<subtitle>${this.escapeXml(this.config.subtitle)}</subtitle>` : ''}
  <updated>${options.updated}</updated>

  <author>
    <name>${this.escapeXml(this.config.author.name)}</name>
    ${this.config.author.uri ? `<uri>${this.escapeXml(this.config.author.uri)}</uri>` : ''}
  </author>

  ${this.config.iconUrl ? `<icon>${this.escapeXml(this.config.iconUrl)}</icon>` : ''}

  ${options.extraLinks || ''}
  ${options.extraContent || ''}

  ${options.entries}
</feed>`;
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * Escape XML special characters
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<OPDSCatalogConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): OPDSCatalogConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an OPDS generator
 */
export function createOPDSGenerator(
  config?: Partial<OPDSCatalogConfig>
): OPDSGenerator {
  return new OPDSGenerator(config);
}
