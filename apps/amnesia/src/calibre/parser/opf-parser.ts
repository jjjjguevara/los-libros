/**
 * OPF Metadata Parser
 *
 * Parses metadata.opf files in Calibre book directories.
 * These files contain Dublin Core metadata plus Calibre-specific extensions.
 *
 * Example metadata.opf structure:
 *
 * <?xml version='1.0' encoding='utf-8'?>
 * <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
 *   <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"
 *             xmlns:opf="http://www.idpf.org/2007/opf">
 *     <dc:title>Book Title</dc:title>
 *     <dc:creator opf:role="aut" opf:file-as="Author, Name">Name Author</dc:creator>
 *     <dc:description>...</dc:description>
 *     <dc:publisher>Publisher</dc:publisher>
 *     <dc:date>2020-01-15</dc:date>
 *     <dc:language>eng</dc:language>
 *     <dc:subject>Fiction</dc:subject>
 *     <dc:identifier scheme="calibre">uuid</dc:identifier>
 *     <dc:identifier scheme="ISBN">9781234567890</dc:identifier>
 *     <meta name="calibre:series" content="Series Name"/>
 *     <meta name="calibre:series_index" content="1"/>
 *     <meta name="calibre:rating" content="8"/>
 *     <meta name="calibre:timestamp" content="2020-01-15T10:00:00+00:00"/>
 *   </metadata>
 * </package>
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { XmlBuilderOptions } from 'fast-xml-parser';
import * as fs from 'fs';
import type { OPFMetadata, OPFCreator, OPFIdentifier } from '../calibre-types';

/**
 * Parser options for fast-xml-parser
 */
const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
  isArray: (name: string) => {
    // Elements that should always be arrays
    return ['dc:creator', 'dc:subject', 'dc:identifier', 'meta', 'dc:language'].includes(name);
  },
};

/**
 * Builder options for generating XML
 */
const BUILDER_OPTIONS: Partial<XmlBuilderOptions> = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
};

/**
 * Parse a metadata.opf file
 */
export function parseOPF(filePath: string): OPFMetadata {
  const xml = fs.readFileSync(filePath, 'utf-8');
  return parseOPFString(xml);
}

/**
 * Parse OPF XML string
 */
export function parseOPFString(xml: string): OPFMetadata {
  const parser = new XMLParser(PARSER_OPTIONS);
  const doc = parser.parse(xml);

  const metadata = doc.package?.metadata || doc.metadata || {};

  // Extract Dublin Core elements
  const title = extractText(metadata['dc:title']);
  const description = extractText(metadata['dc:description']);
  const publisher = extractText(metadata['dc:publisher']);
  const date = extractText(metadata['dc:date']);
  const language = extractFirstLanguage(metadata['dc:language']);

  // Extract creators (authors/editors)
  const creators = extractCreators(metadata['dc:creator']);

  // Extract subjects (tags)
  const subjects = extractSubjects(metadata['dc:subject']);

  // Extract identifiers
  const identifiers = extractIdentifiers(metadata['dc:identifier']);

  // Extract Calibre-specific metadata from <meta> tags
  const metaTags = ensureArray(metadata.meta);
  const calibreMeta = extractCalibreMeta(metaTags);

  return {
    title: title || 'Unknown',
    titleSort: calibreMeta.titleSort,
    creators,
    description: description || undefined,
    publisher: publisher || undefined,
    date: date || undefined,
    language,
    subjects,
    identifiers,
    series: calibreMeta.series,
    calibreTimestamp: calibreMeta.timestamp,
    calibreRating: calibreMeta.rating,
    calibreAuthorLinkMap: calibreMeta.authorLinkMap,
    customColumns: calibreMeta.customColumns,
  };
}

/**
 * Write metadata to an OPF file
 */
export function writeOPF(filePath: string, metadata: OPFMetadata): void {
  const xml = buildOPFString(metadata);

  // Read existing file to preserve guide and spine sections
  let existingDoc: Record<string, unknown> | null = null;
  try {
    const existingXml = fs.readFileSync(filePath, 'utf-8');
    const parser = new XMLParser(PARSER_OPTIONS);
    existingDoc = parser.parse(existingXml);
  } catch {
    // File doesn't exist or can't be parsed
  }

  fs.writeFileSync(filePath, xml, 'utf-8');
}

/**
 * Build OPF XML string from metadata
 */
export function buildOPFString(metadata: OPFMetadata): string {
  const doc = {
    '?xml': { '@_version': '1.0', '@_encoding': 'utf-8' },
    package: {
      '@_xmlns': 'http://www.idpf.org/2007/opf',
      '@_version': '2.0',
      metadata: {
        '@_xmlns:dc': 'http://purl.org/dc/elements/1.1/',
        '@_xmlns:opf': 'http://www.idpf.org/2007/opf',
        'dc:title': metadata.title,
        'dc:creator': metadata.creators.map((c) => ({
          '#text': c.name,
          '@_opf:role': c.role || 'aut',
          '@_opf:file-as': c.fileAs || c.name,
        })),
        ...(metadata.description && { 'dc:description': metadata.description }),
        ...(metadata.publisher && { 'dc:publisher': metadata.publisher }),
        ...(metadata.date && { 'dc:date': metadata.date }),
        ...(metadata.language && { 'dc:language': metadata.language }),
        'dc:subject': metadata.subjects,
        'dc:identifier': metadata.identifiers.map((id) => ({
          '#text': id.value,
          '@_opf:scheme': id.scheme,
        })),
        meta: buildMetaTags(metadata),
      },
    },
  };

  const builder = new XMLBuilder(BUILDER_OPTIONS);
  return builder.build(doc);
}

/**
 * Update specific fields in an OPF file
 */
export function updateOPFField(
  filePath: string,
  field: keyof OPFMetadata,
  value: unknown
): void {
  const current = parseOPF(filePath);
  const updated = { ...current, [field]: value };
  writeOPF(filePath, updated);
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Ensure a value is an array
 */
function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Extract text from a Dublin Core element
 */
function extractText(element: unknown): string | null {
  if (!element) return null;
  if (typeof element === 'string') return element;
  if (typeof element === 'object' && element !== null) {
    return (element as Record<string, unknown>)['#text'] as string || null;
  }
  return null;
}

/**
 * Extract first language from dc:language
 */
function extractFirstLanguage(element: unknown): string | undefined {
  const langs = ensureArray(element);
  if (langs.length === 0) return undefined;
  return extractText(langs[0]) || undefined;
}

/**
 * Extract creators from dc:creator elements
 */
function extractCreators(elements: unknown): OPFCreator[] {
  const items = ensureArray(elements);
  return items.map((item) => {
    if (typeof item === 'string') {
      return { name: item };
    }
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      return {
        name: (obj['#text'] as string) || 'Unknown',
        role: obj['@_opf:role'] as string | undefined,
        fileAs: obj['@_opf:file-as'] as string | undefined,
      };
    }
    return { name: 'Unknown' };
  });
}

/**
 * Extract subjects from dc:subject elements
 */
function extractSubjects(elements: unknown): string[] {
  const items = ensureArray(elements);
  return items
    .map((item) => extractText(item))
    .filter((s): s is string => s !== null);
}

/**
 * Extract identifiers from dc:identifier elements
 */
function extractIdentifiers(elements: unknown): OPFIdentifier[] {
  const items = ensureArray(elements);
  return items.map((item) => {
    if (typeof item === 'string') {
      return { scheme: 'unknown', value: item };
    }
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      return {
        scheme:
          (obj['@_opf:scheme'] as string) ||
          (obj['@_scheme'] as string) ||
          'unknown',
        value: (obj['#text'] as string) || '',
      };
    }
    return { scheme: 'unknown', value: '' };
  });
}

/**
 * Extract Calibre-specific metadata from <meta> tags
 */
function extractCalibreMeta(metaTags: Record<string, unknown>[]): {
  titleSort?: string;
  series?: { name: string; index: number };
  rating?: number;
  timestamp?: string;
  authorLinkMap?: Record<string, string>;
  customColumns?: Record<string, unknown>;
} {
  const result: {
    titleSort?: string;
    series?: { name: string; index: number };
    rating?: number;
    timestamp?: string;
    authorLinkMap?: Record<string, string>;
    customColumns?: Record<string, unknown>;
  } = {};

  let seriesName: string | undefined;
  let seriesIndex: number | undefined;

  for (const meta of metaTags) {
    const name = meta['@_name'] as string;
    const content = meta['@_content'];

    if (!name) continue;

    switch (name) {
      case 'calibre:title_sort':
        result.titleSort = content as string;
        break;
      case 'calibre:series':
        seriesName = content as string;
        break;
      case 'calibre:series_index':
        seriesIndex = parseFloat(content as string) || 1;
        break;
      case 'calibre:rating':
        // Calibre stores 0-10, we normalize to 0-5
        result.rating = (parseFloat(content as string) || 0) / 2;
        break;
      case 'calibre:timestamp':
        result.timestamp = content as string;
        break;
      case 'calibre:author_link_map':
        try {
          result.authorLinkMap = JSON.parse(content as string);
        } catch {
          // Invalid JSON
        }
        break;
      default:
        // Custom columns start with calibre:user_metadata
        if (name.startsWith('calibre:user_metadata:')) {
          const columnName = name.replace('calibre:user_metadata:', '');
          if (!result.customColumns) {
            result.customColumns = {};
          }
          try {
            result.customColumns[columnName] = JSON.parse(content as string);
          } catch {
            result.customColumns[columnName] = content;
          }
        }
    }
  }

  if (seriesName) {
    result.series = {
      name: seriesName,
      index: seriesIndex || 1,
    };
  }

  return result;
}

/**
 * Build <meta> tags for Calibre-specific metadata
 */
function buildMetaTags(metadata: OPFMetadata): Record<string, unknown>[] {
  const metas: Record<string, unknown>[] = [];

  if (metadata.titleSort) {
    metas.push({
      '@_name': 'calibre:title_sort',
      '@_content': metadata.titleSort,
    });
  }

  if (metadata.series) {
    metas.push({
      '@_name': 'calibre:series',
      '@_content': metadata.series.name,
    });
    metas.push({
      '@_name': 'calibre:series_index',
      '@_content': String(metadata.series.index),
    });
  }

  if (metadata.calibreRating !== undefined) {
    // Convert 0-5 back to 0-10
    metas.push({
      '@_name': 'calibre:rating',
      '@_content': String(metadata.calibreRating * 2),
    });
  }

  if (metadata.calibreTimestamp) {
    metas.push({
      '@_name': 'calibre:timestamp',
      '@_content': metadata.calibreTimestamp,
    });
  }

  if (metadata.calibreAuthorLinkMap) {
    metas.push({
      '@_name': 'calibre:author_link_map',
      '@_content': JSON.stringify(metadata.calibreAuthorLinkMap),
    });
  }

  if (metadata.customColumns) {
    for (const [key, value] of Object.entries(metadata.customColumns)) {
      metas.push({
        '@_name': `calibre:user_metadata:${key}`,
        '@_content':
          typeof value === 'string' ? value : JSON.stringify(value),
      });
    }
  }

  return metas;
}
