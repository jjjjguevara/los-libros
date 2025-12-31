/**
 * Book Source Types
 *
 * Defines the different sources a book can come from:
 * - calibre-local: Local Calibre library folder
 * - calibre-web: Calibre Content Server
 * - opds: Any OPDS server (including Los Libros Server)
 * - vault-copy: Local copy stored in vault
 */

/**
 * Source type identifiers
 */
export type BookSourceType = 'calibre-local' | 'calibre-web' | 'opds' | 'vault-copy';

/**
 * Base interface for all book sources
 */
export interface BookSourceBase {
  /** Source type identifier */
  type: BookSourceType;

  /** When this source was added */
  addedAt: Date;

  /** When this source was last verified to exist */
  lastVerified: Date;

  /** Priority for source resolution (lower = higher priority) */
  priority: number;

  /** Whether this source is currently available */
  available?: boolean;
}

/**
 * Local Calibre library source
 */
export interface CalibreLocalSource extends BookSourceBase {
  type: 'calibre-local';

  /** Path to the Calibre library root */
  libraryPath: string;

  /** Calibre's internal book ID */
  calibreId: number;

  /** Full path to the EPUB file */
  epubPath: string;

  /** Last modification time of the file */
  lastModified: Date;

  /** Calibre's UUID for this book */
  calibreUuid?: string;
}

/**
 * Calibre Content Server source
 */
export interface CalibreWebSource extends BookSourceBase {
  type: 'calibre-web';

  /** URL of the Calibre Content Server */
  serverUrl: string;

  /** Library ID on the server */
  libraryId?: string;

  /** Book ID on the server */
  bookId: number;

  /** Direct download URL for the EPUB */
  downloadUrl: string;
}

/**
 * OPDS server source (Los Libros Server, Kavita, etc.)
 */
export interface OPDSSource extends BookSourceBase {
  type: 'opds';

  /** URL of the OPDS catalog */
  catalogUrl: string;

  /** Entry ID in the OPDS feed */
  entryId: string;

  /** Direct acquisition URL */
  acquisitionUrl: string;

  /** Server name (for display) */
  serverName?: string;

  /** Whether this server supports progress sync */
  supportsProgressSync?: boolean;

  /** Whether this server supports highlights sync */
  supportsHighlightsSync?: boolean;
}

/**
 * Vault copy source (local EPUB in vault)
 */
export interface VaultCopySource extends BookSourceBase {
  type: 'vault-copy';

  /** Path relative to vault root */
  vaultPath: string;

  /** MD5 hash for detecting changes */
  md5Hash?: string;

  /** Original source type this is a copy of */
  twinOf?: BookSourceType;

  /** ID linking to original source */
  twinSourceId?: string;

  /** When the copy was made */
  copiedAt: Date;
}

/**
 * Union type for all source types
 */
export type BookSource = CalibreLocalSource | CalibreWebSource | OPDSSource | VaultCopySource;

/**
 * Serialized source for frontmatter storage
 */
export interface SerializedBookSource {
  type: BookSourceType;
  addedAt: string;
  lastVerified: string;
  priority: number;

  // Calibre Local
  libraryPath?: string;
  calibreId?: number;
  epubPath?: string;
  lastModified?: string;
  calibreUuid?: string;

  // Calibre Web
  serverUrl?: string;
  libraryId?: string;
  bookId?: number;
  downloadUrl?: string;

  // OPDS
  catalogUrl?: string;
  entryId?: string;
  acquisitionUrl?: string;
  serverName?: string;
  supportsProgressSync?: boolean;
  supportsHighlightsSync?: boolean;

  // Vault Copy
  vaultPath?: string;
  md5Hash?: string;
  twinOf?: BookSourceType;
  twinSourceId?: string;
  copiedAt?: string;
}

/**
 * Serialize a BookSource for storage in frontmatter
 */
export function serializeSource(source: BookSource): SerializedBookSource {
  const base: SerializedBookSource = {
    type: source.type,
    addedAt: source.addedAt.toISOString(),
    lastVerified: source.lastVerified.toISOString(),
    priority: source.priority,
  };

  switch (source.type) {
    case 'calibre-local':
      return {
        ...base,
        libraryPath: source.libraryPath,
        calibreId: source.calibreId,
        epubPath: source.epubPath,
        lastModified: source.lastModified.toISOString(),
        calibreUuid: source.calibreUuid,
      };

    case 'calibre-web':
      return {
        ...base,
        serverUrl: source.serverUrl,
        libraryId: source.libraryId,
        bookId: source.bookId,
        downloadUrl: source.downloadUrl,
      };

    case 'opds':
      return {
        ...base,
        catalogUrl: source.catalogUrl,
        entryId: source.entryId,
        acquisitionUrl: source.acquisitionUrl,
        serverName: source.serverName,
        supportsProgressSync: source.supportsProgressSync,
        supportsHighlightsSync: source.supportsHighlightsSync,
      };

    case 'vault-copy':
      return {
        ...base,
        vaultPath: source.vaultPath,
        md5Hash: source.md5Hash,
        twinOf: source.twinOf,
        twinSourceId: source.twinSourceId,
        copiedAt: source.copiedAt.toISOString(),
      };
  }
}

/**
 * Deserialize a BookSource from frontmatter
 */
export function deserializeSource(data: SerializedBookSource): BookSource {
  const base = {
    addedAt: new Date(data.addedAt),
    lastVerified: new Date(data.lastVerified),
    priority: data.priority,
  };

  switch (data.type) {
    case 'calibre-local':
      return {
        ...base,
        type: 'calibre-local',
        libraryPath: data.libraryPath!,
        calibreId: data.calibreId!,
        epubPath: data.epubPath!,
        lastModified: new Date(data.lastModified!),
        calibreUuid: data.calibreUuid,
      };

    case 'calibre-web':
      return {
        ...base,
        type: 'calibre-web',
        serverUrl: data.serverUrl!,
        libraryId: data.libraryId,
        bookId: data.bookId!,
        downloadUrl: data.downloadUrl!,
      };

    case 'opds':
      return {
        ...base,
        type: 'opds',
        catalogUrl: data.catalogUrl!,
        entryId: data.entryId!,
        acquisitionUrl: data.acquisitionUrl!,
        serverName: data.serverName,
        supportsProgressSync: data.supportsProgressSync,
        supportsHighlightsSync: data.supportsHighlightsSync,
      };

    case 'vault-copy':
      return {
        ...base,
        type: 'vault-copy',
        vaultPath: data.vaultPath!,
        md5Hash: data.md5Hash,
        twinOf: data.twinOf,
        twinSourceId: data.twinSourceId,
        copiedAt: new Date(data.copiedAt!),
      };
  }
}

/**
 * Get display name for a source type
 */
export function getSourceTypeName(type: BookSourceType): string {
  switch (type) {
    case 'calibre-local':
      return 'Calibre Library';
    case 'calibre-web':
      return 'Calibre Server';
    case 'opds':
      return 'OPDS Server';
    case 'vault-copy':
      return 'Vault Copy';
  }
}

/**
 * Get icon name for a source type
 */
export function getSourceTypeIcon(type: BookSourceType): string {
  switch (type) {
    case 'calibre-local':
      return 'folder';
    case 'calibre-web':
      return 'globe';
    case 'opds':
      return 'rss';
    case 'vault-copy':
      return 'file';
  }
}
