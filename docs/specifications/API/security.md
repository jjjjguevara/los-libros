# Los Libros API - Security Model Specification

## Overview

The Los Libros API implements a **capability-based security model** that provides:
- Permission scoping for different access levels
- Input validation at the API boundary
- Protection against state corruption
- Advisory security for the Obsidian environment

## Capability System

### Available Capabilities

| Capability | Description | Allows |
|------------|-------------|--------|
| `read-state` | Read-only access | Subscribe to stores, read state, query data |
| `write-annotations` | Highlight management | Create, update, delete highlights |
| `write-bookmarks` | Bookmark management | Create, update, delete bookmarks and notes |
| `write-library` | Library management | Update books, modify progress, scan folders |
| `admin` | Administrative access | Delete all data, reset settings, destructive ops |

### Capability Hierarchy

```
admin
  └── write-library
        └── write-bookmarks
        └── write-annotations
              └── read-state (implicit)
```

Higher capabilities include lower capabilities. `admin` includes all permissions.

---

## Connection Handshake

### Requesting Capabilities

```typescript
// Request specific capabilities
const api = await window.LosLibros.connect('my-plugin-id', [
  'read-state',
  'write-annotations'
]);

// API is now scoped to these capabilities
```

### Plugin ID Requirements

- Must be a unique, stable identifier
- Recommended format: plugin's manifest `id`
- Used for:
  - Logging and audit trails
  - Per-plugin rate limiting (future)
  - Permission persistence (future)

### Scoped API

The returned API object only allows operations matching the requested capabilities:

```typescript
const api = await window.LosLibros.connect('my-plugin', ['read-state']);

// Allowed
const books = get(api.state.library).books;

// Throws PermissionError
await api.commands.highlights.create(...);
```

---

## Permission Checking

### Runtime Validation

Every command method validates permissions before execution:

```typescript
class HighlightCommandsImpl {
  async create(...args): Promise<Highlight> {
    // Check capability
    if (!this.hasCapability('write-annotations')) {
      throw new PermissionError(
        'write-annotations',
        'create highlight'
      );
    }

    // Proceed with operation
    return this.service.createHighlight(...args);
  }
}
```

### PermissionError

```typescript
class PermissionError extends Error {
  constructor(
    public readonly required: Capability,
    public readonly operation: string
  ) {
    super(`Permission denied: '${required}' required for '${operation}'`);
    this.name = 'PermissionError';
  }
}
```

### Handling Permission Errors

```typescript
try {
  await api.commands.highlights.create(...);
} catch (e) {
  if (e instanceof PermissionError) {
    new Notice(`Missing permission: ${e.required}`);
  }
}
```

---

## Input Validation

### Zod Schemas

All inputs are validated using Zod schemas at the API boundary:

```typescript
import { z } from 'zod';

// Highlight creation schema
const CreateHighlightSchema = z.object({
  bookId: z.string().min(1),
  text: z.string().min(1).max(10000),
  cfi: z.string().regex(/^epubcfi\(.+\)$/),
  color: z.enum(['yellow', 'green', 'blue', 'pink', 'purple', 'orange']),
  annotation: z.string().max(50000).optional(),
  chapter: z.string().optional(),
  pagePercent: z.number().min(0).max(100).optional(),
  spineIndex: z.number().int().min(0).optional(),
});
```

### Validation Flow

```
External Input
      │
      ▼
┌─────────────┐
│ Zod Schema  │ ──► ValidationError if invalid
│  Parsing    │
└─────────────┘
      │
      ▼
Validated Data
      │
      ▼
┌─────────────┐
│  Capability │ ──► PermissionError if denied
│   Check     │
└─────────────┘
      │
      ▼
Service Method
```

### ValidationError

```typescript
class ValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: z.ZodError['errors']
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
```

### Handling Validation Errors

```typescript
try {
  await api.commands.highlights.create(
    bookId,
    '',  // Empty text - invalid
    'invalid-cfi',  // Invalid CFI format
    'yellow'
  );
} catch (e) {
  if (e instanceof ValidationError) {
    console.error('Validation failed:', e.errors);
    // [
    //   { path: ['text'], message: 'String must contain at least 1 character' },
    //   { path: ['cfi'], message: 'Invalid CFI format' }
    // ]
  }
}
```

---

## State Protection

### Immutable State Exposure

State exposed through `api.state.*` is read-only:

```typescript
// Get current state
const state = get(api.state.library);

// This does NOT modify the actual state
state.books.push(newBook); // Ineffective

// Mutations MUST go through commands
await api.commands.library.addBook(newBook); // Correct way
```

### Redux Action Validation

All state mutations flow through validated Redux actions:

```typescript
// Internal: Actions are typed and validated
type LibraryAction =
  | { type: 'ADD_BOOK'; payload: Book }
  | { type: 'UPDATE_BOOK'; payload: Book }
  | { type: 'REMOVE_BOOK'; payload: string };

// Reducer validates action payloads
function libraryReducer(state: LibraryState, action: LibraryAction) {
  switch (action.type) {
    case 'ADD_BOOK':
      // Payload is guaranteed to be a valid Book
      return { ...state, books: [...state.books, action.payload] };
    // ...
  }
}
```

---

## Security Boundaries

### What IS Protected

1. **State Integrity**: Invalid data cannot enter the Redux store
2. **Operation Authorization**: Capabilities gate write operations
3. **Input Sanitization**: Zod validates all external inputs
4. **Audit Trail**: Plugin IDs logged with operations (future)

### What IS NOT Protected

1. **Code Inspection**: JavaScript is readable, patterns can be reverse-engineered
2. **Global Access**: Determined actors can access `window.LosLibros` directly
3. **File System**: Obsidian's vault API is accessible to all plugins
4. **Memory Access**: No process isolation in Electron

### Security Model Philosophy

Los Libros implements **advisory security**:
- Prevents accidental damage from buggy code
- Provides clear contracts and error messages
- Does NOT defend against malicious actors
- Follows Obsidian's trust model (users install plugins they trust)

---

## Best Practices

### For Plugin Developers

#### 1. Request Minimal Capabilities

```typescript
// Bad - requesting more than needed
const api = await window.LosLibros.connect('my-plugin', ['admin']);

// Good - request only what's needed
const api = await window.LosLibros.connect('my-plugin', ['read-state']);
```

#### 2. Handle Errors Gracefully

```typescript
try {
  const highlight = await api.commands.highlights.create(...);
} catch (e) {
  if (e instanceof PermissionError) {
    new Notice('This plugin needs annotation permissions');
  } else if (e instanceof ValidationError) {
    new Notice('Invalid highlight data');
  } else {
    console.error('Unexpected error:', e);
  }
}
```

#### 3. Validate Your Own Inputs

```typescript
// Validate before calling API
function createHighlight(text: string, cfi: string) {
  if (!text || text.length > 10000) {
    throw new Error('Invalid text length');
  }
  if (!cfi.startsWith('epubcfi(')) {
    throw new Error('Invalid CFI format');
  }
  return api.commands.highlights.create(bookId, text, cfi, 'yellow');
}
```

### For Los Libros Maintainers

#### 1. Always Validate at Boundary

```typescript
// Every public method validates inputs
async create(bookId: string, text: string, ...): Promise<Highlight> {
  const validated = CreateHighlightSchema.parse({ bookId, text, ... });
  // Use validated data
}
```

#### 2. Check Capabilities First

```typescript
async create(...): Promise<Highlight> {
  // Check permissions BEFORE doing any work
  this.requireCapability('write-annotations');

  // Now proceed
  const validated = CreateHighlightSchema.parse(...);
  return this.service.create(validated);
}
```

#### 3. Log Security Events

```typescript
// Log permission denials
if (!this.hasCapability(required)) {
  console.warn(`[Los Libros] Permission denied: ${pluginId} tried ${operation}`);
  throw new PermissionError(required, operation);
}
```

---

## Future Enhancements

### Planned Security Features

1. **Permission Prompts**: User consent for sensitive capabilities
2. **Per-Plugin Storage**: Isolated storage per plugin ID
3. **Rate Limiting**: Prevent API abuse
4. **Audit Logging**: Track all API operations
5. **Revocation**: Allow users to revoke plugin access

### Capability Extensions

Future capabilities under consideration:
- `read-library`: Separate from `read-state`
- `write-settings`: Modify reader settings
- `execute-scripts`: Run custom automation
- `network-access`: External API calls

---

## Error Reference

### PermissionError

```typescript
class PermissionError extends Error {
  name: 'PermissionError';
  required: Capability;  // Required capability
  operation: string;     // Attempted operation
}
```

### ValidationError

```typescript
class ValidationError extends Error {
  name: 'ValidationError';
  errors: Array<{
    path: (string | number)[];
    message: string;
    code: string;
  }>;
}
```

---

*Los Libros Security Model Specification v1.0.0*
