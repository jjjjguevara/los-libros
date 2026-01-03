# Los Libros Public API v1.0 Specification

## 1. Overview & Philosophy

Los Libros exposes a comprehensive public API following the **Headless Engine Paradigm**:

- **Core Engine**: Singleton services (LibraryService, HighlightService) with zero DOM dependency
- **Reactive State**: All state exposed as Svelte `readable()` stores for framework-agnostic reactivity
- **Command-Based Mutations**: No direct state manipulation; all writes via `api.commands.*` methods
- **Event-Driven**: Rich event system with typed payloads and hook middleware
- **Security**: Capability-based permissions with input validation

### Design Principles

1. **Backwards Compatibility**: Semantic versioning with deprecation warnings
2. **Type Safety**: Full TypeScript coverage with runtime Zod validation
3. **Framework Agnostic**: DOM-based UI injection, no framework lock-in
4. **Resource Management**: Disposable pattern for all registrations
5. **Performance**: Event throttling, lazy activation, minimal overhead

### Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                      External Plugins                            │
├─────────────────────────────────────────────────────────────────┤
│                    Los Libros Public API                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │  State   │  │ Commands │  │  Events  │  │    UI    │         │
│  │ (Svelte) │  │  (Async) │  │ (Typed)  │  │(Registry)│         │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘         │
├───────┼─────────────┼─────────────┼─────────────┼───────────────┤
│       │             │             │             │                │
│  ┌────▼─────────────▼─────────────▼─────────────▼────┐          │
│  │              Headless Core Engine                  │          │
│  │  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │          │
│  │  │LibraryStore │  │HighlightSvc │  │ Navigator │  │          │
│  │  └─────────────┘  └─────────────┘  └───────────┘  │          │
│  └───────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. API Access Patterns

### Pattern 1: Plugin Developers

```typescript
// In your plugin's onload()
const losLibrosPlugin = this.app.plugins.plugins['los-libros'];
if (!losLibrosPlugin) {
  console.error('Los Libros not installed');
  return;
}

const api = losLibrosPlugin.api as LosLibrosAPI;
console.log('API version:', api.version);
```

### Pattern 2: Templater/QuickAdd Scripts

```typescript
// Direct global access
const api = window.LosLibros;

// Get current book
import { get } from 'svelte/store';
const books = get(api.state.library).books;
const currentBook = books.find(b => b.status === 'reading');

// Use in template
return currentBook?.title || 'No active book';
```

### Pattern 3: Capability-Based Handshake

```typescript
// Request specific capabilities
const api = await window.LosLibros.connect('my-plugin-id', [
  'read-state',
  'write-annotations'
]);

// API methods validate permissions at runtime
try {
  await api.commands.highlights.create(...); // Allowed
  await api.commands.library.deleteAllBooks(); // Throws PermissionError
} catch (e) {
  if (e instanceof PermissionError) {
    console.error('Insufficient permissions:', e.required);
  }
}
```

### The `reset()` Pattern

Following the ExcalidrawAutomate pattern, always reset before scripts:

```typescript
const api = window.LosLibros;
api.reset(); // Reset to defaults

// Now run your automation
const highlights = api.commands.highlights.getHighlights(bookId);
```

---

## 3. Core APIs - Full Specification

### 3.1 Reader API

#### State: `api.state.reader`

Reactive Svelte store exposing current reading state.

**Type**: `Readable<ReaderState>`

**Properties**:
| Property | Type | Description |
|----------|------|-------------|
| `currentLocation` | `Locator \| null` | Readium locator with CFI, progression, text context |
| `paginationInfo` | `PaginationInfo \| null` | Current/total pages, chapter info, book progression |
| `config` | `NavigatorConfig` | Display settings (mode, fontSize, theme, etc.) |
| `isReady` | `boolean` | Whether navigator is initialized |
| `loading` | `boolean` | Loading state |

**Usage**:

```typescript
import { get } from 'svelte/store';

// One-time read
const location = get(api.state.reader).currentLocation;

// Reactive subscription
const unsubscribe = api.state.reader.subscribe(state => {
  console.log('Current page:', state.paginationInfo?.currentPage);
  console.log('Book progress:', state.paginationInfo?.bookProgression);
  console.log('CFI:', state.currentLocation?.locations.cfi);
});

// Cleanup
unsubscribe();
```

#### Commands: `api.commands.reader`

##### `goTo(target, options?): Promise<boolean>`

Navigate to a specific location in the book.

**Parameters**:
- `target: NavigationTarget` - One of:
  - `{ type: 'locator', locator: Locator }` - Navigate to Readium locator
  - `{ type: 'cfi', cfi: string }` - Navigate to EPUB CFI
  - `{ type: 'href', href: string, fragment?: string }` - Navigate to chapter
  - `{ type: 'progression', progression: number }` - Navigate to percentage (0-1)
  - `{ type: 'position', position: number }` - Navigate to spine index
- `options?: NavigationOptions` - Optional settings:
  - `instant?: boolean` - Skip page turn animation
  - `direction?: 'forward' | 'backward'` - Animation direction hint
  - `skipHistory?: boolean` - Don't add to navigation history

**Returns**: `Promise<boolean>` - `true` if navigation succeeded

**Examples**:

```typescript
// Navigate to saved CFI
const book = api.commands.library.getBook(bookId);
if (book?.currentCfi) {
  await api.commands.reader.goTo({ type: 'cfi', cfi: book.currentCfi });
}

// Navigate to 50% of book
await api.commands.reader.goTo({
  type: 'progression',
  progression: 0.5
});

// Navigate to chapter by href
await api.commands.reader.goTo({
  type: 'href',
  href: 'chapter3.xhtml',
  fragment: 'section-2'
});

// Navigate instantly (no animation)
await api.commands.reader.goTo(
  { type: 'position', position: 10 },
  { instant: true }
);
```

##### `next(): Promise<boolean>`

Navigate forward (next page in paginated mode, scroll distance in scrolled mode).

**Returns**: `Promise<boolean>` - `true` if navigated (not at end)

##### `prev(): Promise<boolean>`

Navigate backward (previous page in paginated mode, scroll distance in scrolled mode).

**Returns**: `Promise<boolean>` - `true` if navigated (not at start)

##### `nextChapter(): Promise<boolean>`

Navigate to the next chapter (spine item).

##### `prevChapter(): Promise<boolean>`

Navigate to the previous chapter.

##### `updateConfig(config): void`

Update reader display configuration.

**Parameters**:
- `config: Partial<NavigatorConfig>` - Partial configuration to update

**Example**:

```typescript
// Increase font size
api.commands.reader.updateConfig({ fontSize: 18 });

// Switch to dark theme
api.commands.reader.updateConfig({
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    linkColor: '#569cd6',
    highlightColor: '#ffeb3b'
  }
});

// Switch to scrolled mode
api.commands.reader.updateConfig({ mode: 'scrolled' });
```

##### `getVisibleText(): string`

Extract currently visible text content (useful for AI/summarization).

##### `getCfiForRange(range): string | null`

Generate EPUB CFI for a DOM Range.

##### `getRangeForCfi(cfi): Range | null`

Get DOM Range for an EPUB CFI.

---

### 3.2 Library API

#### State: `api.state.library`

**Type**: `Readable<LibraryState>`

**Properties**:
| Property | Type | Description |
|----------|------|-------------|
| `books` | `Book[]` | All books in library |
| `selectedBookId` | `string \| null` | Currently selected book |
| `loading` | `boolean` | Scan in progress |
| `error` | `string \| null` | Last error message |

**Usage**:

```typescript
// Get all reading books
const reading = get(api.state.library).books.filter(
  b => b.status === 'reading'
);

// Subscribe to library changes
api.state.library.subscribe(state => {
  console.log('Total books:', state.books.length);
  console.log('Currently reading:', state.books.filter(b => b.status === 'reading').length);
});
```

#### Commands: `api.commands.library`

##### `getBook(id): Book | undefined`

Get a book by ID.

##### `search(query): Book[]`

Search books by title or author.

##### `filterByStatus(status): Book[]`

Filter books by reading status.

**Parameters**:
- `status: 'to-read' | 'reading' | 'completed' | 'archived'`

##### `getRecentBooks(limit?): Book[]`

Get recently read books.

**Parameters**:
- `limit?: number` - Maximum number of books (default: 10)

##### `updateProgress(bookId, progress, cfi?): Promise<void>`

Update reading progress for a book.

**Parameters**:
- `bookId: string` - Book ID
- `progress: number` - Progress percentage (0-100)
- `cfi?: string` - Optional EPUB CFI

##### `updateStatus(bookId, status): Promise<void>`

Update book reading status.

##### `scan(folderPath): Promise<ScanResult>`

Scan a vault folder for EPUB/PDF files.

**Returns**: `Promise<ScanResult>` with `books` and `errors`

---

### 3.3 Highlights API

#### State: `api.state.highlights`

**Type**: `Readable<HighlightState>`

**Properties**:
| Property | Type | Description |
|----------|------|-------------|
| `highlights` | `Record<string, Highlight[]>` | Highlights by bookId |
| `pendingSelection` | `PendingSelection \| null` | Current text selection |
| `loading` | `boolean` | Operation in progress |
| `error` | `string \| null` | Last error message |

#### Commands: `api.commands.highlights`

##### `create(bookId, text, cfi, color, options?): Promise<Highlight>`

Create a new highlight.

**Parameters**:
- `bookId: string` - Book ID
- `text: string` - Selected text
- `cfi: string` - EPUB CFI
- `color: HighlightColor` - `'yellow' | 'green' | 'blue' | 'pink' | 'purple' | 'orange'`
- `options?: CreateHighlightOptions` - Additional options:
  - `chapter?: string` - Chapter title
  - `pagePercent?: number` - Page percentage
  - `annotation?: string` - User note
  - `spineIndex?: number` - Chapter index
  - `textQuote?: { exact, prefix, suffix }` - Text quote selector
  - `textPosition?: { start, end }` - Character offsets

**Example**:

```typescript
// Create from pending selection
const selection = get(api.state.highlights).pendingSelection;
if (selection) {
  const highlight = await api.commands.highlights.create(
    selection.bookId,
    selection.text,
    selection.cfi,
    'yellow',
    { annotation: 'Important insight!' }
  );
  console.log('Highlight created:', highlight.id);
}

// Create with full W3C selector for robust re-anchoring
const highlight = await api.commands.highlights.create(
  bookId,
  'This is important text',
  'epubcfi(/6/4!/4/2,/1:0,/1:20)',
  'yellow',
  {
    spineIndex: 5,
    textQuote: {
      exact: 'This is important text',
      prefix: 'preceding text ',
      suffix: ' following text'
    },
    textPosition: { start: 1234, end: 1256 }
  }
);
```

##### `update(bookId, highlightId, updates): Promise<Highlight | undefined>`

Update an existing highlight.

##### `delete(bookId, highlightId): Promise<boolean>`

Delete a highlight.

##### `getHighlights(bookId): Highlight[]`

Get all highlights for a book.

##### `searchHighlights(query): Highlight[]`

Search highlights across all books.

##### `getHighlightCount(bookId): number`

Get highlight count for a book.

---

## 4. Stub APIs (v1.0 Placeholders)

These APIs have minimal interfaces in v1.0 and will be fully implemented in future versions.

### 4.1 Calibre API (`api.calibre`)

```typescript
interface CalibreAPI {
  scan(): Promise<void>;      // Scan Calibre library
  sync(): Promise<void>;      // Sync reading progress
  getBooks(): Book[];         // Get all Calibre books
}
```

### 4.2 OPDS API (`api.opds`)

```typescript
interface OPDSAPI {
  browse(catalogUrl: string): Promise<void>;  // Browse catalog
  download(bookId: string): Promise<void>;    // Download book
}
```

### 4.3 Bookmarks API (`api.bookmarks`)

```typescript
interface BookmarkAPI {
  create(bookId, cfi, name): Promise<Bookmark>;
  delete(bookId, bookmarkId): Promise<void>;
  getBookmarks(bookId): Bookmark[];
}
```

### 4.4 Navigation API (`api.navigation`)

```typescript
interface NavigationAPI {
  getTOC(): TocEntry[];
  navigateToChapter(index): Promise<void>;
}
```

### 4.5 Templates API (`api.templates`)

```typescript
interface TemplateAPI {
  generate(type, data): Promise<string>;
  setTemplate(type, template): void;
}
```

---

## 5. State Management Patterns

### 5.1 Redux-to-Svelte Bridge

Los Libros uses a custom bridge to expose Redux state as Svelte reactive stores.

**Internal Implementation**:

```typescript
import { readable } from 'svelte/store';
import type { Store } from './helpers/store';

function createReactiveSelector<T>(
  store: Store<any, any>,
  selector: (state: any) => T
): Readable<T> {
  const initialValue = selector(store.getValue());

  return readable(initialValue, (set) => {
    const unsubscribe = store.subscribe(() => {
      const nextValue = selector(store.getValue());
      set(nextValue);
    });
    return unsubscribe;
  });
}
```

### 5.2 Command-Based Mutations

All state changes go through command methods that dispatch Redux actions:

```typescript
class HighlightCommandsImpl {
  constructor(private service: HighlightService) {}

  async create(
    bookId: string,
    text: string,
    cfi: string,
    color: HighlightColor,
    options?: CreateHighlightOptions
  ): Promise<Highlight> {
    // 1. Validate inputs (Zod schema)
    const validated = CreateHighlightSchema.parse({
      bookId, text, cfi, color, ...options
    });

    // 2. Dispatch to service (which dispatches Redux action)
    return this.service.createHighlight(
      validated.bookId,
      validated.text,
      validated.cfi,
      validated.color,
      validated
    );
  }
}
```

---

## 6. Examples

### Example 1: Auto-Save Progress Script

```typescript
// Templater script to save current position
const api = window.LosLibros;
import { get } from 'svelte/store';

const reader = get(api.state.reader);
if (!reader.currentLocation) {
  return 'No book open';
}

const library = get(api.state.library);
const currentBook = library.books.find(b => b.status === 'reading');

if (currentBook && reader.currentLocation.locations.cfi) {
  await api.commands.library.updateProgress(
    currentBook.id,
    Math.round((reader.paginationInfo?.bookProgression || 0) * 100),
    reader.currentLocation.locations.cfi
  );
  return `Saved progress: ${Math.round((reader.paginationInfo?.bookProgression || 0) * 100)}%`;
}

return 'No active book';
```

### Example 2: Highlight Export Plugin

```typescript
// Export all highlights to a Markdown file
class HighlightExporter extends Plugin {
  async onload() {
    const api = this.app.plugins.plugins['los-libros']?.api;
    if (!api) return;

    this.addCommand({
      id: 'export-highlights',
      name: 'Export Highlights',
      callback: async () => {
        const library = get(api.state.library);
        const highlights = get(api.state.highlights);

        let markdown = '# Highlights Export\n\n';

        for (const book of library.books) {
          const bookHighlights = highlights.highlights[book.id] || [];
          if (bookHighlights.length === 0) continue;

          markdown += `## ${book.title}\n\n`;
          markdown += `*by ${book.author || 'Unknown'}*\n\n`;

          bookHighlights.forEach(h => {
            markdown += `- "${h.text}"\n`;
            if (h.annotation) {
              markdown += `  - *${h.annotation}*\n`;
            }
            markdown += '\n';
          });
        }

        await this.app.vault.create('Highlights Export.md', markdown);
        new Notice(`Exported highlights`);
      }
    });
  }
}
```

### Example 3: Reading Session Tracker

```typescript
// Track reading sessions with event listeners
const api = window.LosLibros;

let sessionStart: Date | null = null;
let pagesRead = 0;

// Listen to page turns
const disposable = api.events.on('page-turn', (event) => {
  if (!sessionStart) {
    sessionStart = new Date();
  }
  pagesRead++;

  const duration = Date.now() - sessionStart.getTime();
  const minutes = Math.floor(duration / 60000);

  console.log(`Session: ${minutes} min, ${pagesRead} pages`);
});

// Listen to book close
api.events.on('book-closed', () => {
  if (sessionStart) {
    const duration = Date.now() - sessionStart.getTime();
    const minutes = Math.floor(duration / 60000);
    new Notice(`Reading session: ${minutes} min, ${pagesRead} pages`);

    sessionStart = null;
    pagesRead = 0;
  }
});

// Cleanup when plugin unloads
this.register(() => disposable.dispose());
```

### Example 4: AI Summarizer UI Extension

```typescript
// Add AI summary button to reader toolbar
const api = this.app.plugins.plugins['los-libros']?.api;

const disposable = api.ui.toolbar.register({
  id: 'ai-summarize',
  icon: 'sparkles',
  label: 'AI Summary',
  onClick: async (ctx) => {
    const text = api.commands.reader.getVisibleText();
    if (!text) {
      new Notice('No visible text');
      return;
    }

    // Call your AI service
    const summary = await summarizeWithAI(text);
    new Notice(summary, 10000);
  }
});

this.register(() => disposable.dispose());
```

---

## 7. Version History

### v1.0.0 (Initial Release)

- Core APIs: Reader, Library, Highlights
- Reactive state via Svelte stores
- Typed event system (25+ events)
- Hook middleware with cancellation
- Capability-based security
- UI extension points (toolbar, sidebar, context menu)
- Stub APIs: Calibre, OPDS, Bookmarks, Navigation, Templates

### Future Roadmap

| Version | Features |
|---------|----------|
| v1.1.0 | Full Bookmarks API, Reading Notes |
| v1.2.0 | Full Navigation API (TOC, search) |
| v1.3.0 | Full Templates API |
| v2.0.0 | Full Calibre API, OPDS API |
| v2.1.0 | Dataview integration helpers |
| v2.2.0 | Templater helper namespace |

---

## 8. Type Reference

See the complete TypeScript definitions in:
- [`types/LosLibrosAPI.d.ts`](./types/LosLibrosAPI.d.ts)

Import types in your plugin:

```typescript
import type {
  LosLibrosAPI,
  Book,
  Highlight,
  Locator,
  ReaderState,
  Disposable
} from 'los-libros/api';
```

---

## 9. Contributing

The Los Libros API is open for contributions. See the main repository for:
- Issue tracking
- Pull request guidelines
- Development setup

---

*Los Libros API Specification v1.0.0*
*Last updated: January 2026*
