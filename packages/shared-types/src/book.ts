/**
 * Book-related types shared between server and plugin
 */

export interface Book {
  id: string;
  title: string;
  author?: string;
  isbn?: string;
  publisher?: string;
  publishedDate?: string;
  description?: string;
  language?: string;
  coverUrl?: string;
  formats: BookFormat[];
  metadata?: BookMetadata;
}

export type BookFormat = 'epub' | 'pdf' | 'mobi' | 'cbz' | 'cbr';

export interface BookMetadata {
  // Dublin Core metadata (from metadata.opf)
  dcTitle?: string;
  dcCreator?: string;
  dcSubject?: string[];
  dcDescription?: string;
  dcPublisher?: string;
  dcDate?: string;
  dcLanguage?: string;
  dcIdentifier?: string;
  dcRights?: string;

  // Extended metadata
  series?: string;
  seriesIndex?: number;
  tags?: string[];
}

export interface LibraryBook extends Book {
  localPath?: string;
  serverId?: string;
  status: BookStatus;
  progress: number;
  currentCfi?: string;
  addedAt: Date;
  lastRead?: Date;
  completedAt?: Date;
  highlightCount: number;
  readingSessions: number;
}

export type BookStatus = 'to-read' | 'reading' | 'completed' | 'archived';

export interface CalibreMetadata {
  title: string;
  author?: string;
  authorSort?: string;
  publisher?: string;
  pubdate?: string;
  language?: string;
  identifiers?: Record<string, string>;
  tags?: string[];
  series?: string;
  seriesIndex?: number;
  rating?: number;
  description?: string;
}
