/**
 * BookLoader
 *
 * Handles loading EPUB and PDF files from either:
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
 * Format of the book being loaded
 */
export type BookFormat = 'epub' | 'pdf';

/**
 * Loaded book data
 */
export interface LoadedBook {
  source: BookSource;
  format: BookFormat;
  arrayBuffer: ArrayBuffer;
  metadata: {
    title: string;
    author?: string;
    calibreId?: number;
    bookId: string;
    filePath: string;
    /** @deprecated Use filePath instead */
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
 * Detect book format from file path
 */
export function detectBookFormat(filePath: string): BookFormat {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return 'pdf';
  }
  return 'epub';
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

  // Detect format
  const format = detectBookFormat(bookPath);
  const ext = format === 'pdf' ? '.pdf' : '.epub';

  // Read binary data
  const arrayBuffer = await app.vault.adapter.readBinary(bookPath);

  return {
    source: 'vault',
    format,
    arrayBuffer,
    metadata: {
      title: book?.title ?? path.basename(bookPath, ext),
      author: book?.author,
      bookId: book?.id ?? bookPath,
      filePath: bookPath,
      epubPath: bookPath, // Deprecated, kept for backwards compatibility
      currentCfi: book?.currentCfi,
      progress: book?.progress,
    },
  };
}

/**
 * Find supported book file in a Calibre book directory
 * Calibre stores books in directories like: Author/Title (id)/book.epub
 * Supports EPUB (preferred) and PDF formats
 */
function findBookInDirectory(dirPath: string): {
  filePath: string | null;
  format: BookFormat | null;
  otherFormats: string[]
} {
  const otherFormats: string[] = [];
  let pdfPath: string | null = null;

  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const lower = file.toLowerCase();
      if (lower.endsWith('.epub')) {
        // EPUB is preferred, return immediately
        return { filePath: path.join(dirPath, file), format: 'epub', otherFormats: [] };
      } else if (lower.endsWith('.pdf')) {
        // Store PDF path in case no EPUB is found
        pdfPath = path.join(dirPath, file);
      } else if (lower.endsWith('.mobi') || lower.endsWith('.azw3')) {
        otherFormats.push(file);
      }
    }
  } catch (e) {
    console.warn('[BookLoader] Failed to read directory:', dirPath, e);
  }

  // If no EPUB found, use PDF
  if (pdfPath) {
    return { filePath: pdfPath, format: 'pdf', otherFormats };
  }

  return { filePath: null, format: null, otherFormats };
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
    throw new Error(`Book file not found: ${bookPath}`);
  }

  let filePath = bookPath;
  let format = detectBookFormat(bookPath);

  // If it's a directory (Calibre book folder), find a supported book file inside
  const stats = fs.statSync(bookPath);
  if (stats.isDirectory()) {
    const result = findBookInDirectory(bookPath);
    if (!result.filePath || !result.format) {
      const formatMsg = result.otherFormats.length > 0
        ? ` Available formats: ${result.otherFormats.join(', ')}`
        : '';
      throw new Error(`No supported format available for this book.${formatMsg} Only EPUB and PDF files are supported.`);
    }
    filePath = result.filePath;
    format = result.format;
    console.log(`[BookLoader] Resolved ${format.toUpperCase()} from directory:`, filePath);
  }

  // Read binary data
  // Note: Node's Buffer.buffer returns a shared ArrayBuffer pool which can cause
  // issues with XHR/fetch uploads in Electron. We need to copy to a fresh ArrayBuffer.
  const buffer = fs.readFileSync(filePath);
  const arrayBuffer = new Uint8Array(buffer).buffer;

  // Find Calibre book metadata if available
  // Match by either the exact file path or the directory path
  const calibreBook = calibreBooks?.find((b) =>
    b.epubPath === filePath ||
    b.epubPath === bookPath ||
    (b.epubPath && path.dirname(b.epubPath) === bookPath)
  );

  const ext = format === 'pdf' ? '.pdf' : '.epub';

  if (calibreBook) {
    return {
      source: 'calibre',
      format,
      arrayBuffer,
      metadata: {
        title: calibreBook.title,
        author: calibreBook.authors[0]?.name,
        calibreId: calibreBook.id,
        bookId: calibreBook.uuid,
        filePath,
        epubPath: filePath, // Deprecated, kept for backwards compatibility
        // Progress is loaded from frontmatter in ReaderContainer
        currentCfi: undefined,
        progress: undefined,
      },
    };
  }

  // No Calibre metadata found, extract from path
  const filename = path.basename(filePath, ext);

  return {
    source: 'calibre',
    format,
    arrayBuffer,
    metadata: {
      title: filename,
      bookId: filePath,
      filePath,
      epubPath: filePath, // Deprecated, kept for backwards compatibility
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
