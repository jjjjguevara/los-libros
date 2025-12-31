/**
 * OPDS (Open Publication Distribution System) types
 * Based on OPDS 1.2 and 2.0 specifications
 */

export interface OPDSFeed {
  id: string;
  title: string;
  updated: string;
  links: OPDSLink[];
  entries: OPDSEntry[];

  // Optional metadata
  author?: OPDSAuthor;
  icon?: string;
  subtitle?: string;
}

export interface OPDSEntry {
  id: string;
  title: string;
  updated: string;

  // Links
  links: OPDSLink[];

  // Content
  content?: OPDSContent;
  summary?: string;

  // Authors
  authors?: OPDSAuthor[];

  // Categories/Tags
  categories?: OPDSCategory[];

  // Publication info
  published?: string;
  language?: string;
  identifier?: string;

  // Cover image
  thumbnail?: string;
  cover?: string;
}

export interface OPDSLink {
  href: string;
  type?: string;
  rel?: OPDSLinkRel;
  title?: string;

  // For acquisition links
  price?: OPDSPrice;

  // For indirect acquisition
  indirectAcquisition?: OPDSIndirectAcquisition[];
}

export type OPDSLinkRel =
  | 'self'
  | 'start'
  | 'up'
  | 'subsection'
  | 'related'
  | 'alternate'
  | 'http://opds-spec.org/acquisition'
  | 'http://opds-spec.org/acquisition/open-access'
  | 'http://opds-spec.org/acquisition/borrow'
  | 'http://opds-spec.org/acquisition/buy'
  | 'http://opds-spec.org/acquisition/sample'
  | 'http://opds-spec.org/image'
  | 'http://opds-spec.org/image/thumbnail'
  | 'search'
  | 'next'
  | 'previous';

export interface OPDSAuthor {
  name: string;
  uri?: string;
  email?: string;
}

export interface OPDSCategory {
  term: string;
  label?: string;
  scheme?: string;
}

export interface OPDSContent {
  type: 'text' | 'html' | 'xhtml';
  value: string;
}

export interface OPDSPrice {
  value: number;
  currencyCode: string;
}

export interface OPDSIndirectAcquisition {
  type: string;
  indirectAcquisition?: OPDSIndirectAcquisition[];
}

/**
 * OPDS 2.0 specific types
 */
export interface OPDS2Feed {
  metadata: OPDS2Metadata;
  links: OPDS2Link[];
  publications?: OPDS2Publication[];
  navigation?: OPDS2Link[];
  groups?: OPDS2Group[];
}

export interface OPDS2Metadata {
  title: string;
  subtitle?: string;
  modified?: string;
  description?: string;
  numberOfItems?: number;
  itemsPerPage?: number;
  currentPage?: number;
}

export interface OPDS2Link {
  href: string;
  type?: string;
  rel?: string | string[];
  title?: string;
  templated?: boolean;
}

export interface OPDS2Publication {
  metadata: OPDS2PublicationMetadata;
  links: OPDS2Link[];
  images?: OPDS2Link[];
}

export interface OPDS2PublicationMetadata {
  '@type'?: string;
  title: string;
  author?: string | OPDS2Contributor | OPDS2Contributor[];
  identifier?: string;
  language?: string | string[];
  modified?: string;
  published?: string;
  publisher?: string | OPDS2Contributor;
  description?: string;
  subject?: string | OPDS2Subject | OPDS2Subject[];
}

export interface OPDS2Contributor {
  name: string;
  sortAs?: string;
  identifier?: string;
  links?: OPDS2Link[];
}

export interface OPDS2Subject {
  name: string;
  code?: string;
  scheme?: string;
}

export interface OPDS2Group {
  metadata: OPDS2Metadata;
  publications?: OPDS2Publication[];
  navigation?: OPDS2Link[];
  links?: OPDS2Link[];
}
