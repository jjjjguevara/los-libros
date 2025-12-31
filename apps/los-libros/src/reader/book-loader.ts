/**
 * BookLoader
 *
 * Handles loading EPUB files from either:
 * 1. Obsidian vault (relative paths)
 * 2. Calibre library (absolute filesystem paths)
 */

import { App, Platform } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import type { Book } from '../library/types';
import type { CalibreBookFull } from '../calibre/calibre-types';

/**
 * Source of the book being loaded
 */
export type BookSource = 'vault' | 'calibre' | 'unknown';

/**
 * Loaded book data
 */
export interface LoadedBook {
  source: BookSource;
  arrayBuffer: ArrayBuffer;
  metadata: {
    title: string;
    author?: string;
    calibreId?: number;
    bookId: string;
    epubPath: string;
    currentCfi?: string;
    progress?: number;
  };
}

/**
 * Determine if a path is absolute (Calibre) or relative (vault)
 */
export function isAbsolutePath(bookPath: string): boolean {
  if (Platform.isWin) {
    // Windows: Check for drive letter or UNC path
    return /^[a-zA-Z]:[\\/]/.test(bookPath) || bookPath.startsWith('\\\\');
  } else {
    // Unix: Check for leading slash
    return bookPath.startsWith('/');
  }
}

/**
 * Load a book from the appropriate source
 */
export async function loadBook(
  app: App,
  bookPath: string,
  vaultBooks: Book[],
  calibreBooks?: CalibreBookFull[]
): Promise<LoadedBook> {
  if (isAbsolutePath(bookPath)) {
    // Calibre book - load from filesystem
    return loadCalibreBook(bookPath, calibreBooks);
  } else {
    // Vault book - load from Obsidian
    return loadVaultBook(app, bookPath, vaultBooks);
  }
}

/**
 * Load a book from the Obsidian vault
 */
async function loadVaultBook(
  app: App,
  bookPath: string,
  vaultBooks: Book[]
): Promise<LoadedBook> {
  // Find book in library
  const book = vaultBooks.find((b) => b.localPath === bookPath);

  // Check if file exists
  const file = app.vault.getAbstractFileByPath(bookPath);
  if (!file) {
    throw new Error(`Book not found in vault: ${bookPath}`);
  }

  // Read binary data
  const arrayBuffer = await app.vault.adapter.readBinary(bookPath);

  return {
    source: 'vault',
    arrayBuffer,
    metadata: {
      title: book?.title ?? path.basename(bookPath, '.epub'),
      author: book?.author,
      bookId: book?.id ?? bookPath,
      epubPath: bookPath,
      currentCfi: book?.currentCfi,
      progress: book?.progress,
    },
  };
}

/**
 * Find EPUB file in a Calibre book directory
 * Calibre stores books in directories like: Author/Title (id)/book.epub
 */
function findEpubInDirectory(dirPath: string): { epub: string | null; otherFormats: string[] } {
  const otherFormats: string[] = [];
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const lower = file.toLowerCase();
      if (lower.endsWith('.epub')) {
        return { epub: path.join(dirPath, file), otherFormats: [] };
      } else if (lower.endsWith('.pdf') || lower.endsWith('.mobi') || lower.endsWith('.azw3')) {
        otherFormats.push(file);
      }
    }
  } catch (e) {
    console.warn('[BookLoader] Failed to read directory:', dirPath, e);
  }
  return { epub: null, otherFormats };
}

/**
 * Load a book from Calibre library (filesystem)
 */
async function loadCalibreBook(
  bookPath: string,
  calibreBooks?: CalibreBookFull[]
): Promise<LoadedBook> {
  // Check if path exists
  if (!fs.existsSync(bookPath)) {
    throw new Error(`EPUB file not found: ${bookPath}`);
  }

  let epubPath = bookPath;

  // If it's a directory (Calibre book folder), find the EPUB file inside
  const stats = fs.statSync(bookPath);
  if (stats.isDirectory()) {
    const result = findEpubInDirectory(bookPath);
    if (!result.epub) {
      const formatMsg = result.otherFormats.length > 0
        ? ` Available formats: ${result.otherFormats.join(', ')}`
        : '';
      throw new Error(`No EPUB format available for this book.${formatMsg} Only EPUB files are supported.`);
    }
    epubPath = result.epub;
    console.log('[BookLoader] Resolved EPUB from directory:', epubPath);
  }

  // Read binary data
  const buffer = fs.readFileSync(epubPath);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;

  // Find Calibre book metadata if available
  // Match by either the exact epub path or the directory path
  const calibreBook = calibreBooks?.find((b) =>
    b.epubPath === epubPath ||
    b.epubPath === bookPath ||
    (b.epubPath && path.dirname(b.epubPath) === bookPath)
  );

  if (calibreBook) {
    return {
      source: 'calibre',
      arrayBuffer,
      metadata: {
        title: calibreBook.title,
        author: calibreBook.authors[0]?.name,
        calibreId: calibreBook.id,
        bookId: calibreBook.uuid,
        epubPath,
        // Progress is loaded from frontmatter in ReaderContainer
        currentCfi: undefined,
        progress: undefined,
      },
    };
  }

  // No Calibre metadata found, extract from path
  const filename = path.basename(epubPath, '.epub');

  return {
    source: 'calibre',
    arrayBuffer,
    metadata: {
      title: filename,
      bookId: epubPath,
      epubPath,
    },
  };
}

/**
 * Find a Calibre book by its EPUB path
 */
export function findCalibreBook(
  epubPath: string,
  calibreBooks: CalibreBookFull[]
): CalibreBookFull | undefined {
  return calibreBooks.find((b) => b.epubPath === epubPath);
}

/**
 * Find a Calibre book by its Calibre ID
 */
export function findCalibreBookById(
  calibreId: number,
  calibreBooks: CalibreBookFull[]
): CalibreBookFull | undefined {
  return calibreBooks.find((b) => b.id === calibreId);
}

/**
 * Get the note path for a Calibre book
 */
export function getCalibreBookNotePath(
  book: CalibreBookFull,
  bookNotesFolder: string
): string {
  const sanitizedTitle = book.title
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  return `${bookNotesFolder}/${sanitizedTitle}.md`;
}
