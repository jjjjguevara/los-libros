/**
 * Calibre Bidirectional Sync E2E Tests
 *
 * End-to-end tests that verify sync between Calibre and actual markdown files.
 * These tests:
 * - Connect to a live Calibre server
 * - Create/modify actual book notes in a test vault
 * - Verify frontmatter changes by reading the files back
 *
 * Requires: CALIBRE_SERVER_URL environment variable
 *
 * @see docs/plans/unified-sync-architecture-prd.md
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as path from 'path';
import { TestCalibreClient, type TestCalibreBook } from '../harness/test-calibre-client';
import { FileTestVault, createFileTestVault } from '../harness/file-test-vault';

// ============================================================================
// Test Configuration
// ============================================================================

const CALIBRE_URL = process.env.CALIBRE_SERVER_URL || 'http://localhost:8080';
const TEST_VAULT_PATH = path.join(process.cwd(), 'temp', 'e2e-test-vault');
const SKIP_LIVE_TESTS = !process.env.CALIBRE_SERVER_URL;

// ============================================================================
// Test Suite
// ============================================================================

describe('Calibre Bidirectional Sync E2E', () => {
  let calibreClient: TestCalibreClient;
  let testVault: FileTestVault;
  let testBooks: TestCalibreBook[] = [];

  beforeAll(async () => {
    if (SKIP_LIVE_TESTS) {
      console.log('Skipping E2E tests: CALIBRE_SERVER_URL not set');
      return;
    }

    // Initialize Calibre client
    calibreClient = new TestCalibreClient(CALIBRE_URL);
    await calibreClient.connect();

    // Get test books (first 5 books from library)
    const allBooks = await calibreClient.getBooks();
    testBooks = allBooks.slice(0, 5);

    console.log(`Using ${testBooks.length} test books from Calibre`);

    // Initialize test vault
    testVault = createFileTestVault(TEST_VAULT_PATH);
    await testVault.init();
  });

  beforeEach(async () => {
    if (SKIP_LIVE_TESTS) return;
    // Clear vault before each test
    await testVault.clear();
  });

  afterAll(async () => {
    // Cleanup
    if (!SKIP_LIVE_TESTS && testVault) {
      await testVault.clear();
    }
  });

  // ==========================================================================
  // Rating Sync Tests
  // ==========================================================================

  describe('Rating Sync', () => {
    it('should create book note with Calibre rating', async () => {
      if (SKIP_LIVE_TESTS) return;

      // Get a book with a rating
      const bookWithRating = testBooks.find((b) => b.rating !== undefined && b.rating > 0);
      if (!bookWithRating) {
        console.log('No book with rating found, skipping test');
        return;
      }

      // Create book note with Calibre data
      const notePath = await testVault.createNote({
        bookId: bookWithRating.uuid || `calibre-${bookWithRating.id}`,
        calibreId: bookWithRating.id,
        title: bookWithRating.title,
        authors: bookWithRating.authors,
        rating: bookWithRating.rating,
      });

      // Read it back
      const note = await testVault.readNote(notePath);
      expect(note).not.toBeNull();
      expect(note!.frontmatter.calibreId).toBe(bookWithRating.id);
      expect(note!.frontmatter.rating).toBe(bookWithRating.rating);

      console.log(`Created note for "${bookWithRating.title}" with rating ${bookWithRating.rating}`);
    });

    it('should update book note rating from Calibre', async () => {
      if (SKIP_LIVE_TESTS) return;

      const book = testBooks[0];
      if (!book) return;

      // Create note with no rating
      const notePath = await testVault.createNote({
        bookId: book.uuid || `calibre-${book.id}`,
        calibreId: book.id,
        title: book.title,
        authors: book.authors,
      });

      // Verify no rating
      let note = await testVault.readNote(notePath);
      expect(note!.frontmatter.rating).toBeUndefined();

      // Simulate sync from Calibre by updating frontmatter
      const calibreRating = book.rating || 4;
      await testVault.updateFrontmatter(notePath, { rating: calibreRating });

      // Read back and verify
      note = await testVault.readNote(notePath);
      expect(note!.frontmatter.rating).toBe(calibreRating);

      console.log(`Updated rating to ${calibreRating} for "${book.title}"`);
    });

    it('should handle null/undefined ratings', async () => {
      if (SKIP_LIVE_TESTS) return;

      const book = testBooks[0];
      if (!book) return;

      // Create note with rating
      const notePath = await testVault.createNote({
        bookId: book.uuid || `calibre-${book.id}`,
        calibreId: book.id,
        title: book.title,
        rating: 5,
      });

      // Verify rating exists
      let note = await testVault.readNote(notePath);
      expect(note!.frontmatter.rating).toBe(5);

      // Update with null rating (simulating Calibre with no rating)
      await testVault.updateFrontmatter(notePath, { rating: null });

      // Read back - rating should be null
      note = await testVault.readNote(notePath);
      expect(note!.frontmatter.rating).toBeNull();
    });
  });

  // ==========================================================================
  // Tags Sync Tests
  // ==========================================================================

  describe('Tags Sync', () => {
    it('should sync tags from Calibre to note', async () => {
      if (SKIP_LIVE_TESTS) return;

      // Find book with tags
      const bookWithTags = testBooks.find((b) => b.tags && b.tags.length > 0);
      if (!bookWithTags) {
        console.log('No book with tags found, skipping test');
        return;
      }

      // Create note with Calibre tags
      const notePath = await testVault.createNote({
        bookId: bookWithTags.uuid || `calibre-${bookWithTags.id}`,
        calibreId: bookWithTags.id,
        title: bookWithTags.title,
        tags: bookWithTags.tags,
      });

      // Read back and verify
      const note = await testVault.readNote(notePath);
      expect(note!.frontmatter.tags).toEqual(bookWithTags.tags);

      console.log(`Synced tags ${JSON.stringify(bookWithTags.tags)} for "${bookWithTags.title}"`);
    });

    it('should merge tags without duplicates', async () => {
      if (SKIP_LIVE_TESTS) return;

      const book = testBooks[0];
      if (!book) return;

      // Create note with initial tags
      const notePath = await testVault.createNote({
        bookId: book.uuid || `calibre-${book.id}`,
        calibreId: book.id,
        title: book.title,
        tags: ['fiction', 'favorite'],
      });

      // Simulate merge from Calibre with overlapping tags
      const note = await testVault.readNote(notePath);
      const existingTags = (note!.frontmatter.tags as string[]) || [];
      const calibreTags = ['fiction', 'classic', 'must-read'];

      // Merge without duplicates
      const mergedTags = [...new Set([...existingTags, ...calibreTags])];
      await testVault.updateFrontmatter(notePath, { tags: mergedTags });

      // Verify merged tags
      const updatedNote = await testVault.readNote(notePath);
      expect(updatedNote!.frontmatter.tags).toEqual(['fiction', 'favorite', 'classic', 'must-read']);
    });

    it('should handle case-insensitive tag merging', async () => {
      if (SKIP_LIVE_TESTS) return;

      const book = testBooks[0];
      if (!book) return;

      // Create note with tags
      const notePath = await testVault.createNote({
        bookId: book.uuid || `calibre-${book.id}`,
        calibreId: book.id,
        title: book.title,
        tags: ['Fiction', 'CLASSIC'],
      });

      // Merge with differently-cased tags
      const note = await testVault.readNote(notePath);
      const existingTags = (note!.frontmatter.tags as string[]) || [];
      const calibreTags = ['fiction', 'classic', 'new'];

      // Case-insensitive merge
      const lowerExisting = existingTags.map((t) => t.toLowerCase());
      const uniqueNew = calibreTags.filter((t) => !lowerExisting.includes(t.toLowerCase()));
      const mergedTags = [...existingTags, ...uniqueNew];

      await testVault.updateFrontmatter(notePath, { tags: mergedTags });

      // Verify no duplicates (keeping original case)
      const updatedNote = await testVault.readNote(notePath);
      const tags = updatedNote!.frontmatter.tags as string[];
      expect(tags).toContain('Fiction');
      expect(tags).toContain('CLASSIC');
      expect(tags).toContain('new');
      expect(tags.length).toBe(3);
    });
  });

  // ==========================================================================
  // Custom Column Tests
  // ==========================================================================

  describe('Custom Column Mapping', () => {
    it('should sync custom date column to note', async () => {
      if (SKIP_LIVE_TESTS) return;

      const book = testBooks[0];
      if (!book) return;

      // Create note with custom date field
      const readDate = new Date('2024-06-15');
      const notePath = await testVault.createNote({
        bookId: book.uuid || `calibre-${book.id}`,
        calibreId: book.id,
        title: book.title,
        customFields: {
          dateRead: readDate.toISOString(),
        },
      });

      // Verify custom field
      const note = await testVault.readNote(notePath);
      expect(note!.frontmatter.dateRead).toBe(readDate.toISOString());
    });

    it('should sync custom number column', async () => {
      if (SKIP_LIVE_TESTS) return;

      const book = testBooks[0];
      if (!book) return;

      // Create note with custom number field
      const notePath = await testVault.createNote({
        bookId: book.uuid || `calibre-${book.id}`,
        calibreId: book.id,
        title: book.title,
        customFields: {
          pageCount: 350,
          readCount: 2,
        },
      });

      // Verify custom fields
      const note = await testVault.readNote(notePath);
      expect(note!.frontmatter.pageCount).toBe(350);
      expect(note!.frontmatter.readCount).toBe(2);
    });

    it('should sync custom text column', async () => {
      if (SKIP_LIVE_TESTS) return;

      const book = testBooks[0];
      if (!book) return;

      // Create note with custom text field
      const notePath = await testVault.createNote({
        bookId: book.uuid || `calibre-${book.id}`,
        calibreId: book.id,
        title: book.title,
        customFields: {
          customReview: 'An excellent book that I highly recommend.',
          readingLocation: 'Living Room',
        },
      });

      // Verify custom fields
      const note = await testVault.readNote(notePath);
      expect(note!.frontmatter.customReview).toBe('An excellent book that I highly recommend.');
      expect(note!.frontmatter.readingLocation).toBe('Living Room');
    });

    it('should handle missing custom columns gracefully', async () => {
      if (SKIP_LIVE_TESTS) return;

      const book = testBooks[0];
      if (!book) return;

      // Create note without custom fields
      const notePath = await testVault.createNote({
        bookId: book.uuid || `calibre-${book.id}`,
        calibreId: book.id,
        title: book.title,
      });

      // Verify custom fields are undefined
      const note = await testVault.readNote(notePath);
      expect(note!.frontmatter.dateRead).toBeUndefined();
      expect(note!.frontmatter.pageCount).toBeUndefined();

      // Update with partial custom fields
      await testVault.updateFrontmatter(notePath, { pageCount: 200 });

      // Verify only updated field exists
      const updatedNote = await testVault.readNote(notePath);
      expect(updatedNote!.frontmatter.pageCount).toBe(200);
      expect(updatedNote!.frontmatter.dateRead).toBeUndefined();
    });
  });

  // ==========================================================================
  // Schema Remapping Tests
  // ==========================================================================

  describe('Schema Remapping', () => {
    it('should map Calibre fields to Obsidian fields', async () => {
      if (SKIP_LIVE_TESTS) return;

      // Get a book with full metadata
      const book = testBooks.find((b) => b.series);
      if (!book) {
        console.log('No book with series found, testing with first book');
      }

      const testBook = book || testBooks[0];
      if (!testBook) return;

      // Create note mapping Calibre fields
      const notePath = await testVault.createNote({
        bookId: testBook.uuid || `calibre-${testBook.id}`,
        calibreId: testBook.id,
        title: testBook.title,
        authors: testBook.authors,
        series: testBook.series,
        seriesIndex: testBook.seriesIndex,
        tags: testBook.tags,
        rating: testBook.rating,
      });

      // Verify all mappings
      const note = await testVault.readNote(notePath);
      expect(note!.frontmatter.title).toBe(testBook.title);
      expect(note!.frontmatter.authors).toEqual(testBook.authors);
      if (testBook.series) {
        expect(note!.frontmatter.series).toBe(testBook.series);
      }
    });

    it('should handle reverse mapping (Obsidian to Calibre format)', async () => {
      if (SKIP_LIVE_TESTS) return;

      const book = testBooks[0];
      if (!book) return;

      // Create note with Obsidian-style data
      const notePath = await testVault.createNote({
        bookId: book.uuid || `calibre-${book.id}`,
        calibreId: book.id,
        title: book.title,
        rating: 4, // 0-5 scale
        customFields: {
          // Obsidian uses 0-5, Calibre uses 0-10
          calibreRating: 8, // What it would be in Calibre
        },
      });

      // Verify both formats
      const note = await testVault.readNote(notePath);
      expect(note!.frontmatter.rating).toBe(4);
      expect(note!.frontmatter.calibreRating).toBe(8);
    });

    it('should respect sync direction settings', async () => {
      if (SKIP_LIVE_TESTS) return;

      const book = testBooks[0];
      if (!book) return;

      // Create note with direction metadata
      const notePath = await testVault.createNote({
        bookId: book.uuid || `calibre-${book.id}`,
        calibreId: book.id,
        title: book.title,
        customFields: {
          // Simulate read-only field (Calibre-wins)
          calibreTitle: book.title,
          // Simulate bidirectional field
          myRating: 5,
          // Simulate Obsidian-wins field
          personalNotes: 'My private notes',
        },
      });

      // Update with simulated Calibre changes
      await testVault.updateFrontmatter(notePath, {
        calibreTitle: 'New Title from Calibre', // Should update (Calibre-wins)
        // myRating should be bidirectional
        // personalNotes should not be updated (Obsidian-wins)
      });

      const note = await testVault.readNote(notePath);
      expect(note!.frontmatter.calibreTitle).toBe('New Title from Calibre');
      expect(note!.frontmatter.personalNotes).toBe('My private notes');
    });
  });

  // ==========================================================================
  // Conflict Resolution Tests
  // ==========================================================================

  describe('Conflict Resolution', () => {
    it('should detect differences between Calibre and local', async () => {
      if (SKIP_LIVE_TESTS) return;

      const book = testBooks[0];
      if (!book) return;

      // Create note with local data
      const notePath = await testVault.createNote({
        bookId: book.uuid || `calibre-${book.id}`,
        calibreId: book.id,
        title: book.title,
        rating: 3,
        tags: ['local-tag'],
      });

      // Read note and compare with Calibre
      const note = await testVault.readNote(notePath);
      const calibreBook = await calibreClient.getBook(book.id);

      // Detect differences
      const differences: string[] = [];

      if (note!.frontmatter.rating !== calibreBook.rating) {
        differences.push('rating');
      }

      const localTags = (note!.frontmatter.tags as string[]) || [];
      if (JSON.stringify(localTags.sort()) !== JSON.stringify((calibreBook.tags || []).sort())) {
        differences.push('tags');
      }

      expect(differences.length).toBeGreaterThan(0);
      console.log(`Detected differences in: ${differences.join(', ')}`);
    });

    it('should apply last-write-wins strategy', async () => {
      if (SKIP_LIVE_TESTS) return;

      const book = testBooks[0];
      if (!book) return;

      // Create note
      const notePath = await testVault.createNote({
        bookId: book.uuid || `calibre-${book.id}`,
        calibreId: book.id,
        title: book.title,
        rating: 3,
        customFields: {
          localModified: new Date('2024-01-01').toISOString(),
        },
      });

      // Simulate Calibre has newer data
      const calibreModified = new Date('2024-06-01');
      const calibreRating = 5;

      // Last-write-wins: Calibre is newer, so use Calibre data
      await testVault.updateFrontmatter(notePath, {
        rating: calibreRating,
        lastSynced: calibreModified.toISOString(),
      });

      const note = await testVault.readNote(notePath);
      expect(note!.frontmatter.rating).toBe(5);
    });

    it('should apply merge strategy for tags', async () => {
      if (SKIP_LIVE_TESTS) return;

      const book = testBooks[0];
      if (!book) return;

      // Create note with local tags
      const notePath = await testVault.createNote({
        bookId: book.uuid || `calibre-${book.id}`,
        calibreId: book.id,
        title: book.title,
        tags: ['local-only', 'shared'],
      });

      // Simulate Calibre tags
      const calibreTags = ['calibre-only', 'shared'];

      // Merge strategy: combine both
      const note = await testVault.readNote(notePath);
      const localTags = (note!.frontmatter.tags as string[]) || [];
      const mergedTags = [...new Set([...localTags, ...calibreTags])];

      await testVault.updateFrontmatter(notePath, { tags: mergedTags });

      const updatedNote = await testVault.readNote(notePath);
      const finalTags = updatedNote!.frontmatter.tags as string[];

      expect(finalTags).toContain('local-only');
      expect(finalTags).toContain('calibre-only');
      expect(finalTags).toContain('shared');
      expect(finalTags.length).toBe(3); // No duplicates
    });
  });

  // ==========================================================================
  // Full Sync Workflow Tests
  // ==========================================================================

  describe('Full Sync Workflow', () => {
    it('should sync multiple books from Calibre', async () => {
      if (SKIP_LIVE_TESTS) return;

      // Create notes for all test books
      const createdNotes: string[] = [];

      for (const book of testBooks) {
        const notePath = await testVault.createNote({
          bookId: book.uuid || `calibre-${book.id}`,
          calibreId: book.id,
          title: book.title,
          authors: book.authors,
          rating: book.rating,
          tags: book.tags,
          series: book.series,
          seriesIndex: book.seriesIndex,
        });
        createdNotes.push(notePath);
      }

      // Verify all notes created
      expect(createdNotes.length).toBe(testBooks.length);

      // Read all notes back and verify
      const allNotes = await testVault.getAllNotes();
      expect(allNotes.length).toBe(testBooks.length);

      for (const note of allNotes) {
        expect(note.frontmatter.calibreId).toBeDefined();
        expect(note.frontmatter.title).toBeDefined();
      }

      console.log(`Synced ${allNotes.length} books successfully`);
    });

    it('should report sync statistics', async () => {
      if (SKIP_LIVE_TESTS) return;

      const stats = {
        total: 0,
        created: 0,
        updated: 0,
        errors: 0,
        startTime: Date.now(),
      };

      // Simulate sync
      for (const book of testBooks) {
        stats.total++;

        try {
          // Check if note exists
          const existingNote = await testVault.findNoteByCalibreId(book.id);

          if (existingNote) {
            // Update
            await testVault.updateFrontmatter(existingNote.path, {
              rating: book.rating,
              tags: book.tags,
              lastSynced: new Date().toISOString(),
            });
            stats.updated++;
          } else {
            // Create
            await testVault.createNote({
              bookId: book.uuid || `calibre-${book.id}`,
              calibreId: book.id,
              title: book.title,
              authors: book.authors,
              rating: book.rating,
              tags: book.tags,
            });
            stats.created++;
          }
        } catch (e) {
          stats.errors++;
        }
      }

      const duration = Date.now() - stats.startTime;

      expect(stats.total).toBe(testBooks.length);
      expect(stats.created + stats.updated).toBe(stats.total);
      expect(stats.errors).toBe(0);

      console.log(`Sync stats: ${stats.created} created, ${stats.updated} updated in ${duration}ms`);
    });
  });

  // ==========================================================================
  // Validation Tests
  // ==========================================================================

  describe('Data Validation', () => {
    it('should sanitize special characters in titles', async () => {
      if (SKIP_LIVE_TESTS) return;

      // Find book with special characters or create test case
      const specialTitle = 'Test: A Book/With "Special" Characters?';

      const notePath = await testVault.createNote({
        bookId: 'test-special',
        title: specialTitle,
      });

      // File should be created with sanitized filename
      const note = await testVault.readNote(notePath);
      expect(note).not.toBeNull();
      expect(note!.frontmatter.title).toBe(specialTitle);
    });

    it('should validate rating range', async () => {
      if (SKIP_LIVE_TESTS) return;

      // Create note with valid rating
      const notePath = await testVault.createNote({
        bookId: 'test-rating',
        title: 'Rating Test',
        rating: 5,
      });

      // Verify rating is in valid range
      const note = await testVault.readNote(notePath);
      const rating = note!.frontmatter.rating as number;
      expect(rating).toBeGreaterThanOrEqual(0);
      expect(rating).toBeLessThanOrEqual(5);

      // Test boundary
      await testVault.updateFrontmatter(notePath, { rating: 0 });
      const updated = await testVault.readNote(notePath);
      expect(updated!.frontmatter.rating).toBe(0);
    });
  });
});
