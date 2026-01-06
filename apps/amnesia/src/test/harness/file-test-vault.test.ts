/**
 * File Test Vault Tests
 *
 * Tests for the file-based test vault helper.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { FileTestVault, createFileTestVault } from './file-test-vault';

const TEST_VAULT_PATH = path.join(process.cwd(), 'temp', 'file-vault-test');

describe('FileTestVault', () => {
  let vault: FileTestVault;

  beforeEach(async () => {
    vault = createFileTestVault(TEST_VAULT_PATH);
    await vault.init();
    await vault.clear();
  });

  afterEach(async () => {
    await vault.clear();
  });

  describe('Note Creation', () => {
    it('should create a note with frontmatter', async () => {
      const notePath = await vault.createNote({
        bookId: 'test-1',
        calibreId: 123,
        title: 'Test Book',
        rating: 5,
        tags: ['fiction', 'favorite'],
      });

      expect(fs.existsSync(notePath)).toBe(true);

      // Check raw file content
      const raw = fs.readFileSync(notePath, 'utf-8');
      console.log('RAW FILE CONTENT:');
      console.log(raw);
      console.log('---');

      expect(raw).toContain('---');
      expect(raw).toContain('bookId: test-1');
      expect(raw).toContain('calibreId: 123');
      expect(raw).toContain('title: Test Book');
      expect(raw).toContain('rating: 5');
    });

    it('should read back created note correctly', async () => {
      const notePath = await vault.createNote({
        bookId: 'test-2',
        calibreId: 456,
        title: 'Another Book',
        rating: 4,
        tags: ['fiction', 'classic'],
      });

      const note = await vault.readNote(notePath);

      expect(note).not.toBeNull();
      expect(note!.frontmatter.bookId).toBe('test-2');
      expect(note!.frontmatter.calibreId).toBe(456);
      expect(note!.frontmatter.title).toBe('Another Book');
      expect(note!.frontmatter.rating).toBe(4);
      expect(note!.frontmatter.tags).toEqual(['fiction', 'classic']);
    });

    it('should handle special characters in title', async () => {
      const specialTitle = 'Test: A Book/With "Special" Characters?';

      const notePath = await vault.createNote({
        bookId: 'special-1',
        title: specialTitle,
      });

      const note = await vault.readNote(notePath);
      expect(note!.frontmatter.title).toBe(specialTitle);
    });
  });

  describe('Frontmatter Update', () => {
    it('should update frontmatter correctly', async () => {
      const notePath = await vault.createNote({
        bookId: 'update-1',
        calibreId: 100,
        title: 'Update Test',
        rating: 3,
      });

      // Update rating
      await vault.updateFrontmatter(notePath, { rating: 5 });

      const note = await vault.readNote(notePath);
      expect(note!.frontmatter.rating).toBe(5);
      expect(note!.frontmatter.calibreId).toBe(100); // Should preserve
    });

    it('should merge arrays correctly', async () => {
      const notePath = await vault.createNote({
        bookId: 'merge-1',
        title: 'Merge Test',
        tags: ['fiction', 'favorite'],
      });

      // Read, merge, update
      const note = await vault.readNote(notePath);
      const existingTags = (note!.frontmatter.tags as string[]) || [];
      const newTags = ['classic', 'must-read'];
      const mergedTags = [...new Set([...existingTags, ...newTags])];

      await vault.updateFrontmatter(notePath, { tags: mergedTags });

      const updated = await vault.readNote(notePath);
      expect(updated!.frontmatter.tags).toEqual(['fiction', 'favorite', 'classic', 'must-read']);
    });
  });

  describe('Find Notes', () => {
    it('should find note by calibreId', async () => {
      await vault.createNote({
        bookId: 'find-1',
        calibreId: 999,
        title: 'Find Me',
      });

      const note = await vault.findNoteByCalibreId(999);
      expect(note).not.toBeNull();
      expect(note!.frontmatter.title).toBe('Find Me');
    });

    it('should return null for non-existent calibreId', async () => {
      const note = await vault.findNoteByCalibreId(99999);
      expect(note).toBeNull();
    });
  });
});
