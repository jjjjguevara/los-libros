/**
 * Highlight Parser Unit Tests
 *
 * Tests for parsing highlights and notes from vault markdown content.
 * Covers inline format, atomic notes, section markers, and tombstones.
 *
 * @see src/sync/highlight-parser.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HighlightParser,
  createHighlightParser,
  type ParsedHighlight,
  type ParsedNote,
} from '../../sync/highlight-parser';

// ============================================================================
// Test Fixtures
// ============================================================================

const INLINE_HIGHLIGHT_CONTENT = `---
title: Test Book
---

# Test Book

## Highlights
<!-- AMNESIA:HIGHLIGHTS:START -->
> This is the first highlight %% amnesia:hl-abc123 %%
> This is the second highlight %% amnesia:hl-def456 %%
> This deleted highlight %% amnesia:hl-xyz789:deleted %%
<!-- AMNESIA:HIGHLIGHTS:END -->

## My Notes
Some user content here.
`;

const ATOMIC_HIGHLIGHT_CONTENT = `---
amnesia_highlight_id: hl-atomic001
text: This is an atomic highlight
annotation: My thoughts on this passage
color: yellow
updatedAt: 2025-01-01T12:00:00.000Z
---

> This is an atomic highlight

Notes about this highlight.
`;

const ATOMIC_NOTE_CONTENT = `---
amnesia_note_id: note-atomic001
content: This is my note content
linkedHighlightId: hl-abc123
---

This is my note content.
`;

const BLOCKQUOTE_WITH_ANNOTATION = `---
title: Test Book
---

## Highlights
> This is a highlight with annotation %% amnesia:hl-ann001 %%
> My annotation for this highlight
`;

const NO_SECTION_MARKERS_CONTENT = `---
title: Test Book
---

# Book Content

> Random quote %% amnesia:hl-nosec001 %%

More content here.

> Another highlight %% amnesia:hl-nosec002 %%
`;

const CUSTOM_SECTION_ID_CONTENT = `---
title: Test Book
---

## My Highlights
<!-- AMNESIA:MY_HIGHLIGHTS:START -->
> Custom section highlight %% amnesia:hl-custom001 %%
<!-- AMNESIA:MY_HIGHLIGHTS:END -->
`;

const INLINE_NOTES_CONTENT = `---
title: Test Book
---

## Notes
<!-- AMNESIA:NOTES:START -->
This is a note %% amnesia:note-001 %%
Another note %% amnesia:note-002 %%
Deleted note %% amnesia:note-003:deleted %%
<!-- AMNESIA:NOTES:END -->
`;

// ============================================================================
// Test Suite
// ============================================================================

describe('HighlightParser', () => {
  let parser: HighlightParser;

  beforeEach(() => {
    parser = createHighlightParser();
  });

  // ==========================================================================
  // Inline Highlight Parsing
  // ==========================================================================

  describe('parseHighlightsFromContent - Inline Format', () => {
    it('should parse highlights from section markers', () => {
      const highlights = parser.parseHighlightsFromContent(INLINE_HIGHLIGHT_CONTENT);

      expect(highlights).toHaveLength(3);
      expect(highlights[0].id).toBe('hl-abc123');
      expect(highlights[0].text).toBe('This is the first highlight');
      expect(highlights[0].deleted).toBe(false);
      expect(highlights[0].source).toBe('inline');
    });

    it('should detect tombstoned highlights', () => {
      const highlights = parser.parseHighlightsFromContent(INLINE_HIGHLIGHT_CONTENT);

      const tombstoned = highlights.find(h => h.id === 'hl-xyz789');
      expect(tombstoned).toBeDefined();
      expect(tombstoned?.deleted).toBe(true);
    });

    it('should parse highlights without section markers', () => {
      const highlights = parser.parseHighlightsFromContent(NO_SECTION_MARKERS_CONTENT);

      expect(highlights).toHaveLength(2);
      expect(highlights.map(h => h.id)).toContain('hl-nosec001');
      expect(highlights.map(h => h.id)).toContain('hl-nosec002');
    });

    it('should include line numbers for inline highlights', () => {
      const highlights = parser.parseHighlightsFromContent(INLINE_HIGHLIGHT_CONTENT);

      expect(highlights[0].lineNumber).toBeDefined();
      expect(typeof highlights[0].lineNumber).toBe('number');
    });
  });

  // ==========================================================================
  // Atomic Note Parsing
  // ==========================================================================

  describe('parseHighlightsFromContent - Atomic Format', () => {
    it('should parse atomic highlight from frontmatter', () => {
      const highlights = parser.parseHighlightsFromContent(ATOMIC_HIGHLIGHT_CONTENT);

      expect(highlights).toHaveLength(1);
      expect(highlights[0].id).toBe('hl-atomic001');
      expect(highlights[0].text).toBe('This is an atomic highlight');
      expect(highlights[0].annotation).toBe('My thoughts on this passage');
      expect(highlights[0].color).toBe('yellow');
      expect(highlights[0].source).toBe('atomic');
    });

    it('should parse updatedAt timestamp', () => {
      const highlights = parser.parseHighlightsFromContent(ATOMIC_HIGHLIGHT_CONTENT);

      expect(highlights[0].updatedAt).toBeInstanceOf(Date);
      expect(highlights[0].updatedAt?.toISOString()).toBe('2025-01-01T12:00:00.000Z');
    });

    it('should include frontmatter in parsed result', () => {
      const highlights = parser.parseHighlightsFromContent(ATOMIC_HIGHLIGHT_CONTENT);

      expect(highlights[0].frontmatter).toBeDefined();
      expect(highlights[0].frontmatter?.color).toBe('yellow');
    });
  });

  // ==========================================================================
  // Note Parsing
  // ==========================================================================

  describe('parseNotesFromContent', () => {
    it('should parse inline notes from section', () => {
      const notes = parser.parseNotesFromContent(INLINE_NOTES_CONTENT);

      expect(notes).toHaveLength(3);
      expect(notes[0].id).toBe('note-001');
      expect(notes[0].content).toBe('This is a note');
      expect(notes[0].deleted).toBe(false);
    });

    it('should detect deleted notes', () => {
      const notes = parser.parseNotesFromContent(INLINE_NOTES_CONTENT);

      const deleted = notes.find(n => n.id === 'note-003');
      expect(deleted).toBeDefined();
      expect(deleted?.deleted).toBe(true);
    });

    it('should parse atomic note from frontmatter', () => {
      const notes = parser.parseNotesFromContent(ATOMIC_NOTE_CONTENT);

      expect(notes).toHaveLength(1);
      expect(notes[0].id).toBe('note-atomic001');
      expect(notes[0].content).toBe('This is my note content');
      expect(notes[0].linkedHighlightId).toBe('hl-abc123');
      expect(notes[0].source).toBe('atomic');
    });
  });

  // ==========================================================================
  // Section Extraction
  // ==========================================================================

  describe('extractSection', () => {
    it('should extract content between section markers', () => {
      const content = parser.extractSection(INLINE_HIGHLIGHT_CONTENT, 'HIGHLIGHTS');

      expect(content).toBeDefined();
      expect(content).toContain('hl-abc123');
      expect(content).toContain('hl-def456');
    });

    it('should return null for non-existent section', () => {
      const content = parser.extractSection(INLINE_HIGHLIGHT_CONTENT, 'NONEXISTENT');

      expect(content).toBeNull();
    });

    it('should handle custom section IDs', () => {
      const customParser = createHighlightParser({ highlightsSectionId: 'MY_HIGHLIGHTS' });
      const content = customParser.extractSection(CUSTOM_SECTION_ID_CONTENT, 'MY_HIGHLIGHTS');

      expect(content).toBeDefined();
      expect(content).toContain('hl-custom001');
    });

    it('should detect if section exists', () => {
      expect(parser.hasSection(INLINE_HIGHLIGHT_CONTENT, 'HIGHLIGHTS')).toBe(true);
      expect(parser.hasSection(INLINE_HIGHLIGHT_CONTENT, 'NONEXISTENT')).toBe(false);
    });
  });

  // ==========================================================================
  // Frontmatter Parsing
  // ==========================================================================

  describe('parseFrontmatter', () => {
    it('should parse YAML frontmatter', () => {
      const fm = parser.parseFrontmatter(ATOMIC_HIGHLIGHT_CONTENT);

      expect(fm).toBeDefined();
      expect(fm?.amnesia_highlight_id).toBe('hl-atomic001');
      expect(fm?.text).toBe('This is an atomic highlight');
      expect(fm?.color).toBe('yellow');
    });

    it('should handle missing frontmatter', () => {
      const content = '# No frontmatter\n\nJust content.';
      const fm = parser.parseFrontmatter(content);

      expect(fm).toBeNull();
    });

    it('should parse boolean values', () => {
      const content = `---
enabled: true
disabled: false
---`;
      const fm = parser.parseFrontmatter(content);

      expect(fm?.enabled).toBe(true);
      expect(fm?.disabled).toBe(false);
    });

    it('should parse numeric values', () => {
      const content = `---
rating: 5
progress: 75.5
---`;
      const fm = parser.parseFrontmatter(content);

      expect(fm?.rating).toBe(5);
      expect(fm?.progress).toBe(75.5);
    });
  });

  // ==========================================================================
  // ID Extraction
  // ==========================================================================

  describe('extractHighlightIds', () => {
    it('should extract all highlight IDs', () => {
      const ids = parser.extractHighlightIds(INLINE_HIGHLIGHT_CONTENT);

      expect(ids).toHaveLength(3);
      expect(ids).toContain('hl-abc123');
      expect(ids).toContain('hl-def456');
      expect(ids).toContain('hl-xyz789');
    });

    it('should return unique IDs only', () => {
      const content = `
> Duplicate %% amnesia:hl-dup001 %%
> Same ID %% amnesia:hl-dup001 %%
`;
      const ids = parser.extractHighlightIds(content);

      expect(ids).toHaveLength(1);
      expect(ids[0]).toBe('hl-dup001');
    });
  });

  describe('extractNoteIds', () => {
    it('should extract all note IDs', () => {
      const ids = parser.extractNoteIds(INLINE_NOTES_CONTENT);

      expect(ids).toHaveLength(3);
      expect(ids).toContain('note-001');
      expect(ids).toContain('note-002');
      expect(ids).toContain('note-003');
    });
  });

  // ==========================================================================
  // ID Checking
  // ==========================================================================

  describe('containsHighlightId', () => {
    it('should detect if content contains highlight ID', () => {
      expect(parser.containsHighlightId(INLINE_HIGHLIGHT_CONTENT, 'hl-abc123')).toBe(true);
      expect(parser.containsHighlightId(INLINE_HIGHLIGHT_CONTENT, 'hl-unknown')).toBe(false);
    });
  });

  describe('isHighlightTombstoned', () => {
    it('should detect tombstoned highlights', () => {
      expect(parser.isHighlightTombstoned(INLINE_HIGHLIGHT_CONTENT, 'hl-xyz789')).toBe(true);
      expect(parser.isHighlightTombstoned(INLINE_HIGHLIGHT_CONTENT, 'hl-abc123')).toBe(false);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty content', () => {
      const highlights = parser.parseHighlightsFromContent('');
      const notes = parser.parseNotesFromContent('');

      expect(highlights).toHaveLength(0);
      expect(notes).toHaveLength(0);
    });

    it('should handle content with only frontmatter', () => {
      const content = `---
title: Empty Book
---`;
      const highlights = parser.parseHighlightsFromContent(content);

      expect(highlights).toHaveLength(0);
    });

    it('should handle malformed markers gracefully', () => {
      const content = `
> Incomplete %% amnesia: %%
> Wrong format %% other:hl-bad %%
> Valid %% amnesia:hl-valid001 %%
`;
      const highlights = parser.parseHighlightsFromContent(content);

      expect(highlights).toHaveLength(1);
      expect(highlights[0].id).toBe('hl-valid001');
    });

    it('should clean markdown formatting from highlight text', () => {
      const content = `> **Bold** and *italic* and \`code\` %% amnesia:hl-format001 %%`;
      const highlights = parser.parseHighlightsFromContent(content);

      expect(highlights[0].text).toBe('Bold and italic and code');
    });

    it('should handle highlights with special characters', () => {
      const content = `> Quote with "quotes" and 'apostrophes' %% amnesia:hl-special001 %%`;
      const highlights = parser.parseHighlightsFromContent(content);

      expect(highlights[0].text).toContain('"quotes"');
      expect(highlights[0].text).toContain("'apostrophes'");
    });
  });

  // ==========================================================================
  // Parser Options
  // ==========================================================================

  describe('Parser Options', () => {
    it('should use custom section IDs', () => {
      const customParser = createHighlightParser({
        highlightsSectionId: 'CUSTOM_HL',
        notesSectionId: 'CUSTOM_NOTES',
      });

      const content = `
<!-- AMNESIA:CUSTOM_HL:START -->
> Custom highlight %% amnesia:hl-custom002 %%
<!-- AMNESIA:CUSTOM_HL:END -->
`;
      const highlights = customParser.parseHighlightsFromContent(content);

      expect(highlights).toHaveLength(1);
      expect(highlights[0].id).toBe('hl-custom002');
    });

    it('should allow updating options', () => {
      parser.setOptions({ highlightsSectionId: 'NEW_SECTION' });

      const content = `
<!-- AMNESIA:NEW_SECTION:START -->
> Updated section %% amnesia:hl-updated001 %%
<!-- AMNESIA:NEW_SECTION:END -->
`;
      const highlights = parser.parseHighlightsFromContent(content);

      expect(highlights).toHaveLength(1);
    });
  });
});
