# Los Libros API - Event System Specification

## Overview

The Los Libros event system provides a typed, framework-agnostic way to react to reader events. All events are strictly typed using TypeScript generics, ensuring type safety at compile time.

## Event Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Event Flow                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User Action ──► Internal Handler ──► Event Bus ──► Listeners   │
│                        │                   │                     │
│                        ▼                   ▼                     │
│                   Throttler          Typed Payload               │
│                  (if needed)                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Event Subscription

### Basic Usage

```typescript
const api = window.LosLibros;

// Subscribe to an event
const disposable = api.events.on('page-turn', (data) => {
  console.log(`Turned from page ${data.from} to ${data.to}`);
});

// Unsubscribe when done
disposable.dispose();
```

### Multiple Listeners

```typescript
// Add multiple listeners
const d1 = api.events.on('relocated', handleRelocated);
const d2 = api.events.on('highlight-created', handleHighlight);
const d3 = api.events.on('book-closed', handleClose);

// Cleanup all at once
function cleanup() {
  d1.dispose();
  d2.dispose();
  d3.dispose();
}
```

---

## Event Catalog

### Navigation Events

#### `relocated`

Fired when the reading position changes.

```typescript
interface RelocatedEvent {
  location: Locator;
  direction?: 'forward' | 'backward';
}
```

**Example**:
```typescript
api.events.on('relocated', ({ location, direction }) => {
  console.log('New position:', location.locations.cfi);
  console.log('Direction:', direction);
  console.log('Progress:', location.locations.totalProgression);
});
```

#### `page-turn`

Fired when a page turn occurs (paginated mode only).

```typescript
interface PageTurnEvent {
  from: number;      // Previous page (1-indexed)
  to: number;        // New page (1-indexed)
  spineIndex: number; // Current chapter
}
```

**Throttling**: Debounced to max 1 event per 100ms during rapid navigation.

#### `chapter-visible`

Fired when a chapter becomes visible or hidden.

```typescript
interface ChapterVisibleEvent {
  spineIndex: number;
  visible: boolean;
}
```

---

### Content Events

#### `rendered`

Fired when a chapter finishes rendering.

```typescript
interface RenderedEvent {
  spineIndex: number;
  href: string;
}
```

#### `text-selected`

Fired when text is selected.

```typescript
interface TextSelectedEvent {
  text: string;
  cfi: string;
  range: Range;
  selector: {
    exact: string;
    prefix?: string;
    suffix?: string;
  };
  spineIndex: number;
}
```

**Example**:
```typescript
api.events.on('text-selected', ({ text, cfi }) => {
  console.log('Selected:', text);
  console.log('At CFI:', cfi);
});
```

#### `link-clicked`

Fired when a link is clicked.

```typescript
interface LinkClickedEvent {
  href: string;
  external: boolean;
}
```

---

### Highlight Events

#### `highlight-created`

Fired when a highlight is created.

```typescript
interface HighlightCreatedEvent {
  highlight: Highlight;
}
```

#### `highlight-updated`

Fired when a highlight is updated.

```typescript
interface HighlightUpdatedEvent {
  highlight: Highlight;
}
```

#### `highlight-deleted`

Fired when a highlight is deleted.

```typescript
interface HighlightDeletedEvent {
  bookId: string;
  highlightId: string;
}
```

#### `highlight-clicked`

Fired when a highlight is clicked.

```typescript
interface HighlightClickedEvent {
  highlight: Highlight;
  position: { x: number; y: number };
}
```

---

### State Events

#### `loading`

Fired when loading state changes.

```typescript
interface LoadingEvent {
  loading: boolean;
}
```

#### `error`

Fired when an error occurs.

```typescript
interface ErrorEvent {
  error: Error;
}
```

#### `config-changed`

Fired when reader configuration changes.

```typescript
interface ConfigChangedEvent {
  config: NavigatorConfig;
}
```

#### `resize`

Fired when reader container resizes.

```typescript
interface ResizeEvent {
  width: number;
  height: number;
}
```

**Throttling**: Throttled to requestAnimationFrame (16ms).

---

### Library Events

#### `book-added`

Fired when a book is added to library.

```typescript
interface BookAddedEvent {
  book: Book;
}
```

#### `book-updated`

Fired when a book is updated.

```typescript
interface BookUpdatedEvent {
  book: Book;
}
```

#### `book-deleted`

Fired when a book is deleted.

```typescript
interface BookDeletedEvent {
  bookId: string;
}
```

#### `library-scanned`

Fired when library scan completes.

```typescript
interface LibraryScannedEvent {
  result: ScanResult;
}
```

#### `progress-updated`

Fired when reading progress is updated.

```typescript
interface ProgressUpdatedEvent {
  bookId: string;
  progress: number;
  cfi?: string;
}
```

---

### Book Lifecycle Events

#### `book-opened`

Fired when a book is opened.

```typescript
interface BookOpenedEvent {
  bookId: string;
  book: Book;
}
```

#### `book-closed`

Fired when a book is closed.

```typescript
interface BookClosedEvent {
  bookId: string;
}
```

---

## Hook System

Hooks allow you to intercept operations before they happen and optionally cancel them.

### Hook Registration

```typescript
const disposable = api.hooks.register('onBeforePageTurn', async (ctx) => {
  if (ctx.direction === 'forward' && someCondition) {
    return false; // Cancel the page turn
  }
  return true; // Allow the page turn
});

// Unregister when done
disposable.dispose();
```

### Available Hooks

#### `onBeforePageTurn`

Called before a page turn.

```typescript
interface OnBeforePageTurnContext {
  currentPage: number;
  nextPage: number;
  direction: 'forward' | 'backward';
}
```

**Returns**: `Promise<boolean>` - Return `false` to cancel.

**Example**:
```typescript
api.hooks.register('onBeforePageTurn', async (ctx) => {
  // Require reading for at least 30 seconds before allowing next page
  const timeOnPage = getTimeOnPage();
  if (timeOnPage < 30000 && ctx.direction === 'forward') {
    new Notice('Please spend more time reading this page!');
    return false;
  }
  return true;
});
```

#### `onBeforeHighlightCreate`

Called before a highlight is created.

```typescript
interface OnBeforeHighlightCreateContext {
  text: string;
  color: HighlightColor;
  cfi: string;
}
```

**Returns**: `Promise<boolean>` - Return `false` to cancel.

#### `onBeforeBookClose`

Called before a book is closed.

```typescript
interface OnBeforeBookCloseContext {
  bookId: string;
  hasUnsavedChanges: boolean;
}
```

**Example**:
```typescript
api.hooks.register('onBeforeBookClose', async (ctx) => {
  if (ctx.hasUnsavedChanges) {
    const proceed = await confirmDialog('You have unsaved changes. Close anyway?');
    return proceed;
  }
  return true;
});
```

#### `onBeforeNavigate`

Called before navigating to a location.

```typescript
interface OnBeforeNavigateContext {
  target: NavigationTarget;
  currentLocation: Locator | null;
}
```

---

## Hook Execution Order

Hooks execute **sequentially** in registration order. If any hook returns `false`, execution stops and the operation is cancelled.

```typescript
// Hook 1 - runs first
api.hooks.register('onBeforePageTurn', async () => {
  console.log('Hook 1');
  return true; // Continue
});

// Hook 2 - runs second
api.hooks.register('onBeforePageTurn', async () => {
  console.log('Hook 2');
  return false; // Cancel - Hook 3 never runs
});

// Hook 3 - skipped if Hook 2 returns false
api.hooks.register('onBeforePageTurn', async () => {
  console.log('Hook 3');
  return true;
});
```

---

## Event Throttling

High-frequency events are throttled to prevent performance issues:

| Event | Throttle |
|-------|----------|
| `resize` | requestAnimationFrame (16ms) |
| `page-turn` | Debounce 100ms |
| scroll events | requestAnimationFrame |

---

## Best Practices

### 1. Always Clean Up

```typescript
class MyPlugin extends Plugin {
  private disposables: Disposable[] = [];

  onload() {
    const api = this.app.plugins.plugins['los-libros']?.api;
    if (!api) return;

    this.disposables.push(
      api.events.on('page-turn', this.handlePageTurn)
    );
  }

  onunload() {
    this.disposables.forEach(d => d.dispose());
  }
}
```

### 2. Use Typed Event Handlers

```typescript
// TypeScript infers the correct event payload type
api.events.on('highlight-created', (data) => {
  // data.highlight is typed as Highlight
  console.log(data.highlight.text);
});
```

### 3. Keep Handlers Fast

```typescript
// Bad - slow handler blocks other listeners
api.events.on('page-turn', async (data) => {
  await heavyComputation(); // Blocks
});

// Good - defer heavy work
api.events.on('page-turn', (data) => {
  setTimeout(() => heavyComputation(), 0);
});
```

---

## Complete Event Map Reference

```typescript
interface ReaderEventMap {
  // Navigation
  'relocated': { location: Locator; direction?: 'forward' | 'backward' };
  'chapter-visible': { spineIndex: number; visible: boolean };
  'page-turn': { from: number; to: number; spineIndex: number };

  // Content
  'rendered': { spineIndex: number; href: string };
  'text-selected': { text: string; cfi: string; range: Range; selector: TextSelector; spineIndex: number };
  'link-clicked': { href: string; external: boolean };

  // Highlights
  'highlight-created': { highlight: Highlight };
  'highlight-updated': { highlight: Highlight };
  'highlight-deleted': { bookId: string; highlightId: string };
  'highlight-clicked': { highlight: Highlight; position: { x: number; y: number } };

  // State
  'loading': { loading: boolean };
  'error': { error: Error };
  'config-changed': { config: NavigatorConfig };
  'resize': { width: number; height: number };

  // Library
  'book-added': { book: Book };
  'book-updated': { book: Book };
  'book-deleted': { bookId: string };
  'library-scanned': { result: ScanResult };
  'progress-updated': { bookId: string; progress: number; cfi?: string };

  // Lifecycle
  'book-opened': { bookId: string; book: Book };
  'book-closed': { bookId: string };
}
```

---

*Los Libros Event System Specification v1.0.0*
