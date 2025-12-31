/**
 * Los Libros plugin settings
 */
import { DEFAULT_BOOK_NOTE_TEMPLATE, DEFAULT_HIGHLIGHT_NOTE_TEMPLATE, DEFAULT_TEMPLATE_SETTINGS } from '../templates/default-templates';
import type { SyncDirection, ConflictResolution, SyncableField } from '../calibre/calibre-types';
import type { TemplateSettings } from '../templates/template-types';
import type { BookSettingsRecord } from '../reader/book-settings-store';

export interface LibrosSettings {
  // Server connection
  serverUrl: string;
  serverEnabled: boolean;

  // Local library
  localBooksFolder: string;

  // Reading preferences
  defaultFontSize: number;
  defaultTheme: 'system' | 'light' | 'dark' | 'sepia';
  paginated: boolean;

  // Sync settings
  syncProgress: boolean;
  syncHighlights: boolean;
  syncInterval: number; // in minutes, 0 = manual only

  // Highlight settings
  highlightFolder: string;
  highlightTemplate: string;
  atomicHighlights: boolean; // Each highlight as separate file

  // Book note settings
  bookNoteFolder: string;
  bookNoteTemplate: string;
  autoCreateBookNotes: boolean;

  // Cache settings
  maxCachedBooks: number;
  maxCacheSize: number; // in MB

  // ==========================================================================
  // Calibre Integration
  // ==========================================================================

  // Connection
  calibreEnabled: boolean;
  calibreLibraryPath: string;              // e.g., /Users/.../Libros
  calibreContentServerUrl: string;         // e.g., http://localhost:8080
  calibreContentServerEnabled: boolean;
  calibreContentServerUsername: string;    // Optional authentication
  calibreContentServerPassword: string;

  // Sync
  calibreSyncDirection: SyncDirection;
  calibreConflictResolution: ConflictResolution;
  calibreSyncableFields: SyncableField[];

  // Folders (vault paths for generated notes)
  calibreBookNotesFolder: string;          // Florilegios
  calibreAuthorIndexFolder: string;        // Autores
  calibreSeriesIndexFolder: string;        // Series
  calibreShelfIndexFolder: string;         // Estanterias
  calibreHighlightsFolder: string;         // Subrayados
  calibreBaseFilesFolder: string;          // Indices
  calibreCoversFolder: string;             // Attachments/covers

  // ==========================================================================
  // Template Settings
  // ==========================================================================
  templates: TemplateSettings;
  templatesFolder: string;                 // Vault folder for custom templates

  // ==========================================================================
  // Per-Book Settings Storage
  // ==========================================================================
  perBookSettings: Record<string, BookSettingsRecord>;
}

export const DEFAULT_SETTINGS: LibrosSettings = {
  // Server connection
  serverUrl: '',
  serverEnabled: false,

  // Local library
  localBooksFolder: 'Books',

  // Reading preferences
  defaultFontSize: 16,
  defaultTheme: 'system',
  paginated: true,

  // Sync settings
  syncProgress: true,
  syncHighlights: true,
  syncInterval: 0,

  // Highlight settings
  highlightFolder: 'Highlights',
  highlightTemplate: DEFAULT_HIGHLIGHT_NOTE_TEMPLATE,
  atomicHighlights: true,

  // Book note settings
  bookNoteFolder: 'Books',
  bookNoteTemplate: DEFAULT_BOOK_NOTE_TEMPLATE,
  autoCreateBookNotes: true,

  // Cache settings
  maxCachedBooks: 10,
  maxCacheSize: 200,

  // Calibre Integration
  calibreEnabled: false,
  calibreLibraryPath: '',
  calibreContentServerUrl: 'http://localhost:8080',
  calibreContentServerEnabled: false,
  calibreContentServerUsername: '',
  calibreContentServerPassword: '',

  // Sync
  calibreSyncDirection: 'bidirectional',
  calibreConflictResolution: 'last-write',
  calibreSyncableFields: ['status', 'rating', 'tags', 'progress'],

  // Folders (vault paths matching BookFusion pattern)
  calibreBookNotesFolder: 'Florilegios',
  calibreAuthorIndexFolder: 'Autores',
  calibreSeriesIndexFolder: 'Series',
  calibreShelfIndexFolder: 'Estanterias',
  calibreHighlightsFolder: 'Subrayados',
  calibreBaseFilesFolder: 'Indices',
  calibreCoversFolder: 'Attachments/covers',

  // Template Settings
  templates: DEFAULT_TEMPLATE_SETTINGS,
  templatesFolder: 'Templates/Los Libros',

  // Per-Book Settings Storage
  perBookSettings: {},
};
