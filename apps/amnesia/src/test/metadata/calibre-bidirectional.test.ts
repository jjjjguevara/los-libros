/**
 * Calibre Bidirectional Sync Unit Tests
 *
 * Unit tests for Liquid template transformations and schema mapping validation.
 *
 * For E2E tests that verify actual sync operations with real files and Calibre:
 * @see src/test/integration/calibre-bidirectional-e2e.test.ts
 *
 * @see docs/plans/unified-sync-architecture-prd.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CalibreBidirectionalSync } from '../../sync/metadata/calibre-bidirectional';
import { LiquidTemplateService } from '../../sync/metadata/liquid-template-service';
import { FieldMappingManager, DEFAULT_SCHEMA_MAPPING } from '../../sync/metadata/field-mapping';
import type { BookMetadata } from '../../sync/metadata/types';
import {
  createBookMetadata,
  createHighlights,
} from './fixtures/metadata-fixtures';

// ============================================================================
// Test Suite
// ============================================================================

describe('Calibre Bidirectional Sync', () => {
  let templateService: LiquidTemplateService;
  let fieldMapper: FieldMappingManager;

  beforeEach(() => {
    templateService = new LiquidTemplateService();
    fieldMapper = new FieldMappingManager(DEFAULT_SCHEMA_MAPPING);
  });

  // ==========================================================================
  // Liquid Template Transformations
  // ==========================================================================

  describe('Liquid Templates', () => {
    it('should render author wikilinks correctly', () => {
      const metadata = createBookMetadata({
        authors: ['John Doe', 'Jane Smith'],
      });

      const template = '{% for author in book.authors %}[[Autores/{{ author }}|{{ author }}]]{% unless forloop.last %}, {% endunless %}{% endfor %}';
      const rendered = templateService.renderWithTemplate(metadata as BookMetadata, template);

      expect(rendered).toContain('[[Autores/John Doe|John Doe]]');
      expect(rendered).toContain('[[Autores/Jane Smith|Jane Smith]]');
    });

    it('should render series wikilinks correctly', () => {
      const metadata = createBookMetadata({
        series: 'The Dark Tower',
        seriesIndex: 3,
      });

      const template = '{% if book.series %}[[Series/{{ book.series }}|{{ book.series }}]] #{{ book.seriesIndex }}{% endif %}';
      const rendered = templateService.renderWithTemplate(metadata as BookMetadata, template);

      expect(rendered).toContain('[[Series/The Dark Tower|The Dark Tower]]');
      expect(rendered).toContain('#3');
    });

    it('should render rating correctly', () => {
      const metadata = createBookMetadata({ rating: 4 });

      const template = '{{ book.rating }}/5 stars';
      const rendered = templateService.renderWithTemplate(metadata as BookMetadata, template);

      expect(rendered).toContain('4/5 stars');
    });

    it('should render bookshelf tags correctly', () => {
      const metadata = createBookMetadata({
        tags: ['fiction', 'classic', 'favorite'],
      });

      const template = `bookshelves:
{% for tag in book.tags %}  - "[[Estanterias/{{ tag }}|{{ tag }}]]"
{% endfor %}`;
      const rendered = templateService.renderWithTemplate(metadata as BookMetadata, template);

      expect(rendered).toContain('[[Estanterias/fiction|fiction]]');
      expect(rendered).toContain('[[Estanterias/classic|classic]]');
      expect(rendered).toContain('[[Estanterias/favorite|favorite]]');
    });

    it('should handle missing optional fields', () => {
      const metadata = createBookMetadata({
        series: undefined,
      });

      const template = '{% if book.series %}Series: {{ book.series }}{% else %}No series{% endif %}';
      const rendered = templateService.renderWithTemplate(metadata as BookMetadata, template);

      expect(rendered).toContain('No series');
    });

    it('should render highlights correctly', () => {
      const metadata = createBookMetadata({
        highlights: createHighlights(3),
      });

      const template = `{% for h in book.highlights %}
> {{ h.text }}
{% if h.note %}> -- *{{ h.note }}*{% endif %}
{% endfor %}`;
      const rendered = templateService.renderWithTemplate(metadata as BookMetadata, template);

      expect(rendered).toContain('>');
      expect(rendered.match(/>/g)!.length).toBeGreaterThanOrEqual(3);
    });

    it('should render dates in correct format', () => {
      const metadata = createBookMetadata({
        lastReadAt: new Date('2024-01-15T12:00:00Z'),
      });

      const template = 'Last read: {{ book.lastReadAt | date: "%Y-%m-%d" }}';
      const rendered = templateService.renderWithTemplate(metadata as BookMetadata, template);

      // Check year-month pattern to be timezone-agnostic
      expect(rendered).toMatch(/Last read: 2024-01-1[45]/);
    });
  });

  // ==========================================================================
  // Schema Mapping Validation
  // ==========================================================================

  describe('Schema Mapping', () => {
    it('should have default schema mapping defined', () => {
      expect(DEFAULT_SCHEMA_MAPPING).toBeDefined();
      expect(DEFAULT_SCHEMA_MAPPING.standardFields).toBeDefined();
      expect(DEFAULT_SCHEMA_MAPPING.customColumns).toBeDefined();
    });

    it('should provide field mapping configuration', () => {
      const mapping = fieldMapper.exportSchema();
      expect(mapping).toBeDefined();
      expect(mapping.standardFields).toBeDefined();
    });

    it('should include standard Calibre fields', () => {
      const mapping = fieldMapper.exportSchema();
      const standardFields = Object.keys(mapping.standardFields);

      expect(standardFields).toContain('title');
      expect(standardFields).toContain('authors');
      expect(standardFields).toContain('rating');
      expect(standardFields).toContain('tags');
    });

    it('should define sync directions for fields', () => {
      const mapping = fieldMapper.exportSchema();

      for (const [field, config] of Object.entries(mapping.standardFields)) {
        expect(config.direction).toBeDefined();
        expect(['bidirectional', 'calibre-wins', 'obsidian-wins', 'read-only']).toContain(
          config.direction
        );
      }
    });

    it('should get bidirectional fields', () => {
      const bidirectionalFields = fieldMapper.getBidirectionalFields();

      expect(Array.isArray(bidirectionalFields)).toBe(true);
      // Rating and tags should be bidirectional by default
      expect(bidirectionalFields).toContain('rating');
    });
  });
});
