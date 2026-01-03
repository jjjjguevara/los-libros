# Los Libros API - Expansion Points Specification

## Overview

This document defines placeholders and integration points for future ecosystem expansions. These APIs are **not implemented** in v1.0 but are designed to ensure forward compatibility.

## Shadow Notes Integration

### Concept

Shadow Notes are Markdown sidecar files that mirror book metadata and annotations, enabling vault-wide search and linking.

### Planned API

```typescript
interface ShadowNotesAPI {
  /** Generate a shadow note for a book */
  generateNote(bookId: string, options?: ShadowNoteOptions): Promise<TFile>;

  /** Update an existing shadow note */
  updateNote(bookId: string): Promise<TFile>;

  /** Get the shadow note path for a book */
  getNotePath(bookId: string): string | null;

  /** Check if a book has a shadow note */
  hasNote(bookId: string): boolean;

  /** Configure shadow note template */
  setTemplate(template: string): void;
}

interface ShadowNoteOptions {
  /** Include highlights in the note */
  includeHighlights?: boolean;

  /** Include bookmarks in the note */
  includeBookmarks?: boolean;

  /** Include reading progress */
  includeProgress?: boolean;

  /** Custom frontmatter fields */
  frontmatter?: Record<string, unknown>;

  /** Output folder (relative to vault root) */
  folder?: string;
}
```

### Shadow Note Format

```markdown
---
title: "{{book.title}}"
author: "{{book.author}}"
isbn: "{{book.isbn}}"
progress: {{book.progress}}
los-libros-id: "{{book.id}}"
---

# {{book.title}}

## Metadata
- **Author**: {{book.author}}
- **Progress**: {{book.progress}}%
- **Last Read**: {{book.lastRead}}

## Highlights

{{#each highlights}}
> {{this.text}}
> — Chapter {{this.chapter}}, {{this.pagePercent}}%

{{#if this.annotation}}
Note: {{this.annotation}}
{{/if}}

{{/each}}

## Bookmarks

{{#each bookmarks}}
- [[#{{this.id}}|{{this.title}}]] - Chapter {{this.chapter}}
{{/each}}
```

### Events

```typescript
interface ShadowNoteEvents {
  'shadow-note-created': { bookId: string; path: string };
  'shadow-note-updated': { bookId: string; path: string };
  'shadow-note-deleted': { bookId: string; path: string };
}
```

---

## Dataview Integration

### Concept

Expose book metadata in a format compatible with Dataview queries, enabling users to create reading dashboards and statistics.

### Planned API

```typescript
interface DataviewAPI {
  /** Get all books as Dataview-compatible objects */
  getBooks(): DataviewBook[];

  /** Get highlights as Dataview-compatible objects */
  getHighlights(bookId?: string): DataviewHighlight[];

  /** Get reading sessions for analytics */
  getReadingSessions(bookId?: string): ReadingSession[];

  /** Register a virtual folder for Dataview */
  registerVirtualFolder(path: string): Disposable;
}

interface DataviewBook {
  file: { path: string; name: string };
  title: string;
  author: string;
  progress: number;
  status: 'unread' | 'reading' | 'completed';
  dateAdded: string;
  lastRead: string | null;
  highlightCount: number;
  bookmarkCount: number;
  tags: string[];
  // All custom metadata
  [key: string]: unknown;
}

interface DataviewHighlight {
  file: { path: string; name: string };
  bookTitle: string;
  text: string;
  color: string;
  chapter: string;
  createdAt: string;
  annotation: string | null;
}

interface ReadingSession {
  bookId: string;
  startTime: string;
  endTime: string;
  pagesRead: number;
  duration: number; // minutes
}
```

### Example Dataview Queries

```dataview
TABLE
  title as "Title",
  author as "Author",
  progress + "%" as "Progress",
  highlightCount as "Highlights"
FROM "los-libros"
WHERE status = "reading"
SORT lastRead DESC
```

```dataview
LIST
FROM "los-libros/highlights"
WHERE bookTitle = "Moby Dick"
SORT createdAt DESC
```

### Virtual File Provider

Los Libros can expose virtual files that Dataview can query:

```
vault/
├── los-libros/           # Virtual folder
│   ├── books/
│   │   ├── moby-dick.md
│   │   └── war-and-peace.md
│   └── highlights/
│       ├── moby-dick-highlights.md
│       └── war-and-peace-highlights.md
```

---

## Templater Integration

### Concept

Provide helper functions accessible from Templater templates for generating reading notes, quotes, and bibliographies.

### Planned API

```typescript
// Accessible via tp.user.losLibros or window.LosLibros.helpers
interface TemplaterHelpers {
  /** Get current book (if reader is open) */
  getCurrentBook(): Book | null;

  /** Get current location */
  getCurrentLocation(): Locator | null;

  /** Get current selection */
  getCurrentSelection(): PendingSelection | null;

  /** Format a citation */
  formatCitation(style: CitationStyle): string;

  /** Get book by ID or title */
  getBook(idOrTitle: string): Book | null;

  /** Get all highlights for current book */
  getHighlights(): Highlight[];

  /** Get a random highlight */
  getRandomHighlight(bookId?: string): Highlight | null;

  /** Format book metadata */
  formatMetadata(format: string): string;

  /** Prompt user to select a book */
  promptBook(): Promise<Book | null>;

  /** Prompt user to select a highlight */
  promptHighlight(bookId?: string): Promise<Highlight | null>;
}

type CitationStyle = 'apa' | 'mla' | 'chicago' | 'bibtex';
```

### Example Templater Template

```markdown
<%*
const ll = tp.user.losLibros;
const book = await ll.promptBook();
if (!book) return;
const highlights = ll.getHighlights(book.id);
-%>
# Reading Notes: <% book.title %>

**Author**: <% book.author %>
**Progress**: <% book.progress %>%

## Key Highlights

<% for (const h of highlights) { %>
> <% h.text %>
> — <% h.chapter %>, p. <% h.pagePercent %>%

<% if (h.annotation) { %>
*Note: <% h.annotation %>*
<% } %>

<% } %>

## Citation

<% ll.formatCitation('apa') %>
```

### Registration

```typescript
// In main.ts
this.registerTemplaterHelpers = () => {
  const tp = this.app.plugins.plugins['templater-obsidian'];
  if (tp) {
    tp.templater.user_functions.losLibros = this.api.helpers;
  }
};
```

---

## QuickAdd Integration

### Concept

Provide macros and captures for QuickAdd that interact with the reading library.

### Planned API

```typescript
interface QuickAddAPI {
  /** Register a capture for new highlights */
  registerHighlightCapture(): Disposable;

  /** Register a capture for reading notes */
  registerReadingNoteCapture(): Disposable;

  /** Get QuickAdd-compatible choices */
  getBookChoices(): QuickAddChoice[];
}

interface QuickAddChoice {
  name: string;
  value: string;
}
```

### Example QuickAdd Macro

```javascript
module.exports = async (params) => {
  const { quickAddApi } = params;
  const ll = window.LosLibros;

  // Get current book
  const book = ll.helpers.getCurrentBook();
  if (!book) {
    new Notice('No book open');
    return;
  }

  // Get selection
  const selection = ll.helpers.getCurrentSelection();
  if (!selection) {
    new Notice('No text selected');
    return;
  }

  // Create highlight
  await ll.commands.highlights.create(
    book.id,
    selection.text,
    selection.cfi,
    'yellow'
  );

  new Notice('Highlight created!');
};
```

---

## Calibre Integration

### Concept

Full synchronization with Calibre library databases.

### Planned API (Stub)

```typescript
interface CalibreAPI {
  /** Connect to a Calibre library */
  connect(libraryPath: string): Promise<void>;

  /** Sync metadata from Calibre */
  syncMetadata(): Promise<SyncResult>;

  /** Import books from Calibre */
  importBooks(bookIds: string[]): Promise<ImportResult>;

  /** Export highlights to Calibre */
  exportHighlights(bookId: string): Promise<void>;

  /** Get Calibre library status */
  getStatus(): CalibreStatus;
}

interface CalibreStatus {
  connected: boolean;
  libraryPath: string | null;
  bookCount: number;
  lastSync: string | null;
}

interface SyncResult {
  updated: number;
  added: number;
  errors: string[];
}
```

### Events

```typescript
interface CalibreEvents {
  'calibre-connected': { libraryPath: string };
  'calibre-disconnected': {};
  'calibre-sync-started': {};
  'calibre-sync-completed': { result: SyncResult };
  'calibre-sync-failed': { error: Error };
}
```

---

## OPDS Integration

### Concept

Browse and download books from OPDS catalogs.

### Planned API (Stub)

```typescript
interface OPDSAPI {
  /** List configured OPDS feeds */
  getFeeds(): OPDSFeed[];

  /** Add an OPDS feed */
  addFeed(url: string, name?: string): Promise<OPDSFeed>;

  /** Remove an OPDS feed */
  removeFeed(feedId: string): void;

  /** Browse a feed */
  browse(feedId: string, path?: string): Promise<OPDSEntry[]>;

  /** Search a feed */
  search(feedId: string, query: string): Promise<OPDSEntry[]>;

  /** Download a book from feed */
  download(feedId: string, entryId: string): Promise<Book>;
}

interface OPDSFeed {
  id: string;
  name: string;
  url: string;
  type: 'opds1' | 'opds2';
}

interface OPDSEntry {
  id: string;
  title: string;
  author: string;
  summary: string;
  coverUrl: string | null;
  downloadLinks: OPDSLink[];
}

interface OPDSLink {
  type: 'epub' | 'pdf' | 'mobi';
  url: string;
}
```

---

## Reading Statistics

### Concept

Track and expose reading analytics.

### Planned API (Stub)

```typescript
interface StatisticsAPI {
  /** Get reading stats for a time period */
  getStats(period: 'day' | 'week' | 'month' | 'year'): ReadingStats;

  /** Get stats for a specific book */
  getBookStats(bookId: string): BookStats;

  /** Get reading streaks */
  getStreaks(): StreakInfo;

  /** Export stats as CSV */
  exportStats(format: 'csv' | 'json'): Promise<string>;
}

interface ReadingStats {
  totalMinutes: number;
  totalPages: number;
  booksStarted: number;
  booksCompleted: number;
  highlightsCreated: number;
  averageSessionLength: number;
  longestSession: number;
  dailyBreakdown: DailyStats[];
}

interface BookStats {
  bookId: string;
  totalMinutes: number;
  sessionsCount: number;
  averageSessionLength: number;
  completionDate: string | null;
  readingSpeed: number; // pages per hour
}

interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  lastReadDate: string;
}

interface DailyStats {
  date: string;
  minutes: number;
  pages: number;
}
```

---

## PDF Annotations

### Concept

Extended support for PDF-specific annotations.

### Planned API (Stub)

```typescript
interface PDFAnnotationsAPI {
  /** Get PDF-specific annotations */
  getAnnotations(bookId: string): PDFAnnotation[];

  /** Create a PDF annotation */
  createAnnotation(
    bookId: string,
    type: PDFAnnotationType,
    rect: PDFRect,
    options?: PDFAnnotationOptions
  ): Promise<PDFAnnotation>;

  /** Import annotations from PDF */
  importFromPDF(bookId: string): Promise<PDFAnnotation[]>;

  /** Export annotations to PDF */
  exportToPDF(bookId: string): Promise<ArrayBuffer>;
}

type PDFAnnotationType =
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'squiggly'
  | 'freetext'
  | 'note'
  | 'ink'
  | 'rectangle'
  | 'ellipse';

interface PDFRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PDFAnnotation {
  id: string;
  type: PDFAnnotationType;
  rect: PDFRect;
  contents: string;
  color: string;
  createdAt: string;
}
```

---

## Collections & Tags

### Concept

Organize books into collections and apply tags.

### Planned API (Stub)

```typescript
interface CollectionsAPI {
  /** Get all collections */
  getCollections(): Collection[];

  /** Create a collection */
  createCollection(name: string, icon?: string): Promise<Collection>;

  /** Add book to collection */
  addToCollection(collectionId: string, bookId: string): Promise<void>;

  /** Remove book from collection */
  removeFromCollection(collectionId: string, bookId: string): Promise<void>;

  /** Get books in collection */
  getBooksInCollection(collectionId: string): Book[];
}

interface TagsAPI {
  /** Get all tags */
  getTags(): string[];

  /** Add tag to book */
  addTag(bookId: string, tag: string): Promise<void>;

  /** Remove tag from book */
  removeTag(bookId: string, tag: string): Promise<void>;

  /** Get books by tag */
  getBooksByTag(tag: string): Book[];
}

interface Collection {
  id: string;
  name: string;
  icon: string;
  bookCount: number;
  createdAt: string;
}
```

---

## Implementation Priority

| API | Priority | Complexity | Dependencies |
|-----|----------|------------|--------------|
| Shadow Notes | High | Medium | Core APIs |
| Templater Helpers | High | Low | Core APIs |
| Dataview Integration | Medium | High | Shadow Notes |
| QuickAdd Integration | Medium | Low | Templater Helpers |
| Reading Statistics | Medium | Medium | Core APIs |
| Collections & Tags | Medium | Medium | Library API |
| Calibre Integration | Low | High | External library |
| OPDS Integration | Low | High | Network, parsing |
| PDF Annotations | Low | High | PDF.js |

---

## Extension Development Guide

### Creating a Los Libros Extension

```typescript
import { Plugin } from 'obsidian';

export default class MyExtension extends Plugin {
  private api: LosLibrosAPI | null = null;
  private disposables: Disposable[] = [];

  async onload() {
    // Wait for Los Libros to load
    this.app.workspace.onLayoutReady(async () => {
      await this.initializeAPI();
    });
  }

  async initializeAPI() {
    const losLibros = this.app.plugins.plugins['los-libros'];
    if (!losLibros) {
      console.warn('Los Libros not installed');
      return;
    }

    // Connect with required capabilities
    this.api = await losLibros.api.connect('my-extension', [
      'read-state',
      'write-annotations'
    ]);

    // Register event listeners
    this.disposables.push(
      this.api.events.on('highlight-created', this.onHighlight.bind(this))
    );

    // Register UI components
    this.disposables.push(
      this.api.ui.sidebar.register({
        id: 'my-extension-view',
        title: 'My View',
        icon: 'star',
        mount: this.mountView.bind(this)
      })
    );
  }

  onHighlight(data: { highlight: Highlight }) {
    // Handle new highlights
    console.log('New highlight:', data.highlight.text);
  }

  mountView(container: HTMLElement): () => void {
    container.innerHTML = '<h3>My Extension</h3>';
    return () => container.innerHTML = '';
  }

  onunload() {
    this.disposables.forEach(d => d.dispose());
  }
}
```

### Testing Extensions

```typescript
// Mock API for testing
const mockAPI: Partial<LosLibrosAPI> = {
  state: {
    library: readable({ books: [], loading: false, error: null }),
    reader: readable({ location: null, config: {} }),
    highlights: readable({ highlights: {} })
  },
  events: {
    on: jest.fn().mockReturnValue({ dispose: jest.fn() })
  }
};

// Inject mock
window.LosLibros = mockAPI as LosLibrosAPI;
```

---

## Versioning Strategy

### Semantic Versioning

- **Major**: Breaking changes to existing APIs
- **Minor**: New APIs or non-breaking additions
- **Patch**: Bug fixes

### Deprecation Policy

1. Deprecated APIs marked with `@deprecated` JSDoc
2. Console warnings in development mode
3. Minimum 2 minor versions before removal
4. Migration guide in release notes

### Example Deprecation

```typescript
interface LosLibrosAPI {
  /**
   * @deprecated Use `commands.reader.goTo()` instead. Will be removed in v2.0
   */
  navigateTo(cfi: string): Promise<void>;
}
```

---

*Los Libros Expansion Points Specification v1.0.0*
