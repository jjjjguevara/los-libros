/**
 * OPDS 1.2 Types
 */

export interface OPDSCatalog {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastFetched?: Date;
}

export interface OPDSFeed {
  id: string;
  title: string;
  updated: Date;
  links: OPDSLink[];
  entries: OPDSEntry[];
  totalResults?: number;
  startIndex?: number;
  itemsPerPage?: number;
}

export interface OPDSLink {
  href: string;
  rel: string;
  type?: string;
  title?: string;
}

export interface OPDSEntry {
  id: string;
  title: string;
  author?: string;
  summary?: string;
  published?: Date;
  updated?: Date;
  language?: string;
  rights?: string;
  publisher?: string;
  categories: string[];
  links: OPDSLink[];
  coverUrl?: string;
  thumbnailUrl?: string;
}

export interface OPDSNavigationEntry extends OPDSEntry {
  isNavigation: true;
  navigationUrl: string;
}

export interface OPDSAcquisitionEntry extends OPDSEntry {
  isNavigation: false;
  formats: OPDSFormat[];
}

export interface OPDSFormat {
  type: string;
  url: string;
  size?: number;
}

export type OPDSEntryType = OPDSNavigationEntry | OPDSAcquisitionEntry;

// Link relation types
export const OPDS_REL = {
  // Navigation
  START: 'start',
  SELF: 'self',
  NEXT: 'next',
  PREVIOUS: 'previous',
  FIRST: 'first',
  LAST: 'last',
  UP: 'up',
  SEARCH: 'search',

  // Facets
  FACET: 'http://opds-spec.org/facet',

  // Acquisition
  ACQUISITION: 'http://opds-spec.org/acquisition',
  ACQUISITION_OPEN_ACCESS: 'http://opds-spec.org/acquisition/open-access',
  ACQUISITION_BORROW: 'http://opds-spec.org/acquisition/borrow',
  ACQUISITION_BUY: 'http://opds-spec.org/acquisition/buy',
  ACQUISITION_SAMPLE: 'http://opds-spec.org/acquisition/sample',

  // Images
  IMAGE: 'http://opds-spec.org/image',
  IMAGE_THUMBNAIL: 'http://opds-spec.org/image/thumbnail',
  COVER: 'http://opds-spec.org/cover',
  THUMBNAIL: 'http://opds-spec.org/thumbnail',
} as const;

// Media types
export const OPDS_MEDIA_TYPES = {
  ATOM: 'application/atom+xml',
  OPDS_CATALOG: 'application/atom+xml;profile=opds-catalog',
  OPDS_CATALOG_KIND_NAVIGATION: 'application/atom+xml;profile=opds-catalog;kind=navigation',
  OPDS_CATALOG_KIND_ACQUISITION: 'application/atom+xml;profile=opds-catalog;kind=acquisition',
  EPUB: 'application/epub+zip',
  PDF: 'application/pdf',
  MOBI: 'application/x-mobipocket-ebook',
} as const;

/**
 * Server capabilities for bidirectional sync
 */
export interface OPDSServerCapabilities {
  /** Server supports reading progress sync */
  supportsProgressSync: boolean;
  /** Server supports highlights/annotations sync */
  supportsHighlightsSync: boolean;
  /** Server supports user authentication */
  supportsAuth: boolean;
  /** Server type (for capability detection) */
  serverType: 'amnesia' | 'calibre' | 'kavita' | 'opds-generic';
  /** API base URL for extended features */
  apiBaseUrl?: string;
  /** API version */
  apiVersion?: string;
}

/**
 * OPDS server configuration
 */
export interface OPDSServerConfig {
  id: string;
  name: string;
  type: 'amnesia' | 'calibre' | 'kavita' | 'opds-generic';
  catalogUrl: string;
  authType: 'none' | 'basic' | 'api-key';
  credentials?: {
    username?: string;
    password?: string;
    apiKey?: string;
  };
  capabilities: OPDSServerCapabilities;
  enabled: boolean;
  lastConnected?: Date;
}
