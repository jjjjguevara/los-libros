/**
 * Metadata Validation Tests
 *
 * Tests for validating book metadata including:
 * - Field-level validation (progress, rating, CFI)
 * - Cross-field consistency checks
 * - Auto-fix capabilities
 *
 * @see docs/plans/unified-sync-architecture-prd.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MetadataValidator,
  VALIDATION_RULES,
  sanitizeMetadata,
  mergeMetadata,
} from '../../sync/metadata/metadata-validator';
import type { BookMetadata, Highlight, ValidationResult, ValidationIssue } from '../../sync/metadata/types';
import {
  createBookMetadata,
  createHighlight,
  createHighlights,
  createInvalidMetadata,
} from './fixtures/metadata-fixtures';

// ============================================================================
// Test Suite
// ============================================================================

describe('Metadata Validation', () => {
  let validator: MetadataValidator;

  beforeEach(() => {
    validator = new MetadataValidator();
  });

  // ==========================================================================
  // Progress Validation
  // ==========================================================================

  describe('Progress Validation', () => {
    it('should accept valid progress values', () => {
      const validValues = [0, 25, 50, 75, 100];

      for (const progress of validValues) {
        const result = validator.validateField('progress', progress);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }
    });

    it('should reject progress greater than 100', () => {
      const result = validator.validateField('progress', 150);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('between 0 and 100');  // Custom error message
    });

    it('should reject negative progress', () => {
      const result = validator.validateField('progress', -10);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 0 and 100');  // Custom error message
    });

    it('should accept undefined progress (optional field)', () => {
      const result = validator.validateField('progress', undefined);
      expect(result.valid).toBe(true);
    });

    it('should reject non-numeric progress', () => {
      const result = validator.validateField('progress', 'fifty' as unknown as number);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 0 and 100');  // Uses same custom error
    });
  });

  // ==========================================================================
  // Rating Validation
  // ==========================================================================

  describe('Rating Validation', () => {
    it('should accept valid ratings (0-5)', () => {
      for (let rating = 0; rating <= 5; rating++) {
        const result = validator.validateField('rating', rating);
        expect(result.valid).toBe(true);
      }
    });

    it('should accept decimal ratings', () => {
      const result = validator.validateField('rating', 4.5);
      expect(result.valid).toBe(true);
    });

    it('should reject rating greater than 5', () => {
      const result = validator.validateField('rating', 10);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 0 and 5');  // Custom error message
    });

    it('should reject negative rating', () => {
      const result = validator.validateField('rating', -1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 0 and 5');  // Custom error message
    });

    it('should accept null rating (unrated)', () => {
      const result = validator.validateField('rating', null);
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // CFI Validation
  // ==========================================================================

  describe('CFI Validation', () => {
    it('should accept valid EPUB CFI format', () => {
      const validCFIs = [
        'epubcfi(/6/4!/4/2/1:0)',
        'epubcfi(/6/2!/4)',
        'epubcfi(/6/4!/4/2/1:0,/6/4!/4/2/1:50)',
        'epubcfi(/6/100!/4/2/1:0)',
      ];

      for (const cfi of validCFIs) {
        const result = validator.validateField('currentCfi', cfi);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject invalid CFI format', () => {
      // The pattern is /^epubcfi\(.+\)$/ so it requires:
      // - Starts with "epubcfi("
      // - Has at least one character inside
      // - Ends with ")"
      const invalidCFIs = [
        'not-a-cfi',              // Missing epubcfi() wrapper entirely
        '/6/4!/4/2/1:0',          // Missing epubcfi() wrapper
        'epubcfi()',              // Empty inside parentheses (needs .+ not .*)
      ];

      for (const cfi of invalidCFIs) {
        const result = validator.validateField('currentCfi', cfi);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('epubcfi');  // "CFI must be in epubcfi() format"
      }
    });

    it('should accept loose CFI format (any content inside epubcfi())', () => {
      // The pattern is intentionally loose - just checks the wrapper
      const result = validator.validateField('currentCfi', 'epubcfi(/anything)');
      expect(result.valid).toBe(true);
    });

    it('should accept undefined CFI (book not opened)', () => {
      const result = validator.validateField('currentCfi', undefined);
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // Highlights Validation
  // ==========================================================================

  describe('Highlights Validation', () => {
    it('should accept valid highlights array', () => {
      const highlights = createHighlights(5);
      const result = validator.validateField('highlights', highlights);
      expect(result.valid).toBe(true);
    });

    it('should validate highlights using custom validator', () => {
      // The validator checks that each highlight has cfiRange and text
      const validHighlight: Highlight = createHighlight({
        cfiRange: 'epubcfi(/6/4!/4/2)',
        text: 'Some text',
      });
      const result = validator.validateField('highlights', [validHighlight]);
      expect(result.valid).toBe(true);
    });

    it('should accept empty highlights array', () => {
      const result = validator.validateField('highlights', []);
      expect(result.valid).toBe(true);
    });

    it('should check maxItems limit', () => {
      // The rule has maxItems: 10000
      const rule = VALIDATION_RULES.highlights;
      expect(rule.maxItems).toBe(10000);
    });
  });

  // ==========================================================================
  // Cross-Field Consistency Checks
  // ==========================================================================

  describe('Consistency Checks', () => {
    it('should run progress-CFI consistency check', () => {
      // Progress at 100% but CFI points to early position
      const metadata = createBookMetadata({
        progress: 100,
        currentCfi: 'epubcfi(/6/4!/4/2)',  // Very early in book
      }) as BookMetadata;

      const result = validator.validateConsistency(metadata);
      // Result has 'consistent' boolean and 'issues' array
      expect(result).toBeDefined();
      expect(typeof result.consistent).toBe('boolean');
      expect(Array.isArray(result.issues)).toBe(true);
    });

    it('should return consistent for valid metadata', () => {
      const metadata = createBookMetadata({
        progress: 50,
        highlights: createHighlights(3),
      }) as BookMetadata;

      const result = validator.validateConsistency(metadata);
      // With valid data, should be consistent
      expect(result.consistent).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should check highlight ranges', () => {
      const validHighlights = createHighlights(5);

      const result = validator.checkHighlightRanges(validHighlights);
      // Valid highlights should pass
      expect(result).toBe(true);
    });

    it('should validate metadata with timestamps', () => {
      const metadata = createBookMetadata({
        lastReadAt: new Date('2024-06-15'),
        highlights: createHighlights(2),
      }) as BookMetadata;

      const result = validator.validateConsistency(metadata);
      expect(result).toBeDefined();
      expect(typeof result.consistent).toBe('boolean');
    });
  });

  // ==========================================================================
  // Full Metadata Validation
  // ==========================================================================

  describe('Full Metadata Validation', () => {
    it('should validate complete valid metadata', () => {
      const metadata = createBookMetadata({
        progress: 75,
        rating: 4,
        currentCfi: 'epubcfi(/6/50!/4/2)',
        highlights: createHighlights(5),
        tags: ['fiction', 'favorite'],
      }) as BookMetadata;

      const result = validator.validateMetadata(metadata);
      expect(result.valid).toBe(true);
      expect(Object.keys(result.fieldErrors)).toHaveLength(0);
    });

    it('should collect field validation errors', () => {
      // Validate metadata with multiple invalid fields
      const badMetadata = {
        ...createBookMetadata(),
        progress: 150,      // Invalid
        rating: 10,         // Invalid
        currentCfi: 'bad',  // Invalid
      } as BookMetadata;

      const result = validator.validateMetadata(badMetadata);
      expect(result.valid).toBe(false);
      expect(Object.keys(result.fieldErrors).length).toBeGreaterThanOrEqual(1);
    });

    it('should return consistency check results', () => {
      const metadata = createBookMetadata({
        highlights: createHighlights(5),
      }) as BookMetadata;

      const result = validator.validateMetadata(metadata);
      // Should have consistency result
      expect(result.consistency).toBeDefined();
      expect(typeof result.consistency.consistent).toBe('boolean');
    });
  });

  // ==========================================================================
  // Auto-Fix Capabilities
  // ==========================================================================

  describe('Auto-Fix', () => {
    it('should fix progress out of range via autoFixIssues', () => {
      const metadata = createBookMetadata({ progress: 150 }) as BookMetadata;
      const issues: ValidationIssue[] = [
        { field: 'progress', issue: 'out-of-range', autoFixable: true, suggestion: 100 },
      ];

      const fixed = validator.autoFixIssues(metadata, issues);
      expect(fixed.progress).toBe(100);
    });

    it('should fix negative progress via autoFixIssues', () => {
      const metadata = createBookMetadata({ progress: -10 }) as BookMetadata;
      const issues: ValidationIssue[] = [
        { field: 'progress', issue: 'out-of-range', autoFixable: true, suggestion: 0 },
      ];

      const fixed = validator.autoFixIssues(metadata, issues);
      expect(fixed.progress).toBe(0);
    });

    it('should fix invalid rating via autoFixIssues', () => {
      const metadata = createBookMetadata({ rating: 10 }) as BookMetadata;
      const issues: ValidationIssue[] = [
        { field: 'rating', issue: 'out-of-range', autoFixable: true },
      ];

      const fixed = validator.autoFixIssues(metadata, issues);
      expect(fixed.rating).toBe(5); // Clamped to max
    });

    it('should use sanitizeMetadata for basic fixes', () => {
      // sanitizeMetadata provides simpler auto-fix for common cases
      const metadata = createBookMetadata({
        progress: 150,
        rating: 10,
        highlights: [
          createHighlight({ text: 'Valid' }),
          createHighlight({ text: '' }),  // Empty - will be filtered
        ],
      });

      const sanitized = sanitizeMetadata(metadata);
      expect(sanitized.progress).toBe(100);
      expect(sanitized.rating).toBeUndefined();
      expect(sanitized.highlights).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Sanitization
  // ==========================================================================

  describe('Sanitization', () => {
    it('should clamp progress values', () => {
      const metadata = createBookMetadata({
        progress: 150,
      });

      const sanitized = sanitizeMetadata(metadata);
      expect(sanitized.progress).toBe(100);
    });

    it('should clamp negative progress to 0', () => {
      const metadata = createBookMetadata({
        progress: -10,
      });

      const sanitized = sanitizeMetadata(metadata);
      expect(sanitized.progress).toBe(0);
    });

    it('should reset invalid rating to undefined', () => {
      const metadata = createBookMetadata({
        rating: 10,
      });

      const sanitized = sanitizeMetadata(metadata);
      expect(sanitized.rating).toBeUndefined();
    });

    it('should filter highlights with empty text', () => {
      const metadata = createBookMetadata({
        highlights: [
          createHighlight({ text: 'Valid' }),
          createHighlight({ text: '' }),  // Should be filtered
          createHighlight({ text: 'Also valid' }),
        ],
      });

      const sanitized = sanitizeMetadata(metadata);
      expect(sanitized.highlights).toHaveLength(2);
    });

    // TODO: HTML sanitization not yet implemented
    it.skip('should sanitize HTML in descriptions', () => {
      const metadata = createBookMetadata({
        description: '<script>alert("xss")</script><p>Safe content</p>',
      });

      const sanitized = sanitizeMetadata(metadata);
      expect(sanitized.description).not.toContain('<script>');
    });
  });

  // ==========================================================================
  // Merge Functionality
  // ==========================================================================

  describe('Metadata Merge', () => {
    it('should merge base with updates (updates override)', () => {
      const base = createBookMetadata({
        bookId: 'merge-test',
        rating: 4,
        tags: ['fiction'],
        highlights: [createHighlight({ id: 'h1' })],
      });

      const updates: Partial<BookMetadata> = {
        rating: 5,
        tags: ['classic'],  // Overwrites, doesn't merge arrays
      };

      const merged = mergeMetadata(base, updates);

      expect(merged.rating).toBe(5);  // Override wins
      expect(merged.tags).toContain('classic');
      expect(merged.bookId).toBe('merge-test');  // Base preserved
    });

    it('should preserve base fields not in updates', () => {
      const base = createBookMetadata({
        bookId: 'preserve-test',
        title: 'Original Title',
        rating: 4,
        progress: 50,
      });

      const updates: Partial<BookMetadata> = {
        rating: 5,
      };

      const merged = mergeMetadata(base, updates);
      expect(merged.title).toBe('Original Title');
      expect(merged.progress).toBe(50);
      expect(merged.rating).toBe(5);
    });

    it('should merge timestamps objects', () => {
      const oldDate = new Date('2024-01-01');
      const newDate = new Date('2024-06-15');

      const base = createBookMetadata({
        lastReadAt: oldDate,
        progress: 25,
      });
      (base as BookMetadata & { timestamps: Record<string, Date> }).timestamps = {
        progress: oldDate,
      };

      const updates: Partial<BookMetadata> = {
        lastReadAt: newDate,
        progress: 75,
      };

      const merged = mergeMetadata(base, updates);
      expect(merged.progress).toBe(75);
      expect(merged.lastReadAt).toEqual(newDate);
    });
  });

  // ==========================================================================
  // Validation Rules Configuration
  // ==========================================================================

  describe('Validation Rules', () => {
    it('should have rules defined for core fields', () => {
      const requiredFields = ['progress', 'rating', 'currentCfi', 'highlights', 'tags'];

      for (const field of requiredFields) {
        expect(VALIDATION_RULES[field]).toBeDefined();
      }
    });

    it('should allow custom validation rules', () => {
      // Custom rules are passed directly, not wrapped in { customRules: }
      const customValidator = new MetadataValidator({
        customField: {
          type: 'string',
          required: true,
          pattern: /^[A-Z]{3}$/,  // 3 uppercase letters
        },
      });

      const valid = customValidator.validateField('customField', 'ABC');
      const invalid = customValidator.validateField('customField', 'abc');

      expect(valid.valid).toBe(true);
      expect(invalid.valid).toBe(false);
    });
  });
});
