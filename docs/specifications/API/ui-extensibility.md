# Los Libros API - UI Extensibility Specification

## Overview

Los Libros provides framework-agnostic UI extension points that allow plugins to:
- Add buttons to the reader toolbar
- Create custom sidebar views/tabs
- Extend the context menu
- Inject custom components via DOM portals

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    Los Libros Reader UI                         │
├────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      TOOLBAR                             │   │
│  │  [Home] [Settings] [◄] [►] | [Custom1] [Custom2] ...    │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌──────────────┐  ┌───────────────────────────────────────┐   │
│  │   SIDEBAR    │  │           READER CONTENT              │   │
│  │              │  │                                       │   │
│  │  [TOC]       │  │                                       │   │
│  │  [Highlights]│  │          EPUB/PDF Content             │   │
│  │  [Bookmarks] │  │                                       │   │
│  │  [Custom]    │  │                                       │   │
│  │    ↓         │  │                                       │   │
│  │  ┌────────┐  │  │                                       │   │
│  │  │ Portal │  │  │                                       │   │
│  │  │ Mount  │  │  │                                       │   │
│  │  └────────┘  │  │                                       │   │
│  └──────────────┘  └───────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

---

## Toolbar Extension

### Registration

```typescript
const api = window.LosLibros;

const disposable = api.ui.toolbar.register({
  id: 'my-plugin-action',
  icon: 'sparkles',           // Lucide icon name
  label: 'AI Summary',        // Tooltip text
  onClick: (context) => {
    console.log('Book ID:', context.bookId);
    console.log('Location:', context.currentLocation);
    console.log('Selection:', context.selection);
  },
  position: 'right',          // 'left' or 'right'
  priority: 100               // Lower = earlier position
});

// Cleanup
disposable.dispose();
```

### ToolbarItem Interface

```typescript
interface ToolbarItem {
  /** Unique identifier */
  id: string;

  /** Lucide icon name (see https://lucide.dev/icons/) */
  icon: string;

  /** Tooltip text */
  label: string;

  /** Click handler */
  onClick: (context: ReaderContext) => void;

  /** Position in toolbar (default: 'right') */
  position?: 'left' | 'right';

  /** Sort priority within position (default: 100) */
  priority?: number;
}
```

### ReaderContext

```typescript
interface ReaderContext {
  /** Current book ID */
  bookId: string;

  /** Current reading position */
  currentLocation: Locator | null;

  /** Current text selection (if any) */
  selection: PendingSelection | null;
}
```

### Example: Translate Button

```typescript
api.ui.toolbar.register({
  id: 'translate-selection',
  icon: 'languages',
  label: 'Translate Selection',
  position: 'right',
  onClick: async (ctx) => {
    if (!ctx.selection) {
      new Notice('Select text first');
      return;
    }

    const translated = await translateText(ctx.selection.text);
    new Notice(translated, 10000);
  }
});
```

---

## Sidebar Extension

### Registration

```typescript
const disposable = api.ui.sidebar.register({
  id: 'my-custom-view',
  title: 'Graph View',
  icon: 'network',
  mount: (container: HTMLElement) => {
    // Render your content into the container
    container.innerHTML = '<h3>My Custom View</h3>';

    // Return cleanup function
    return () => {
      container.innerHTML = '';
    };
  }
});
```

### SidebarView Interface

```typescript
interface SidebarView {
  /** Unique identifier */
  id: string;

  /** Tab title */
  title: string;

  /** Lucide icon name (optional) */
  icon?: string;

  /**
   * Mount function called when view becomes visible.
   * @param container - Empty HTMLElement to render into
   * @returns Cleanup function called when view is destroyed
   */
  mount: (container: HTMLElement) => () => void;
}
```

### DOM Portal Pattern

The `mount` function receives a plain HTMLElement, making it framework-agnostic:

#### Vanilla JS

```typescript
api.ui.sidebar.register({
  id: 'vanilla-view',
  title: 'Stats',
  mount: (container) => {
    const div = document.createElement('div');
    div.textContent = 'Hello World';
    container.appendChild(div);

    return () => container.innerHTML = '';
  }
});
```

#### Svelte

```typescript
import MyComponent from './MyComponent.svelte';

api.ui.sidebar.register({
  id: 'svelte-view',
  title: 'My Svelte View',
  mount: (container) => {
    const component = new MyComponent({ target: container });
    return () => component.$destroy();
  }
});
```

#### React

```typescript
import React from 'react';
import { createRoot } from 'react-dom/client';
import MyComponent from './MyComponent';

api.ui.sidebar.register({
  id: 'react-view',
  title: 'My React View',
  mount: (container) => {
    const root = createRoot(container);
    root.render(<MyComponent />);
    return () => root.unmount();
  }
});
```

#### Vue

```typescript
import { createApp } from 'vue';
import MyComponent from './MyComponent.vue';

api.ui.sidebar.register({
  id: 'vue-view',
  title: 'My Vue View',
  mount: (container) => {
    const app = createApp(MyComponent);
    app.mount(container);
    return () => app.unmount();
  }
});
```

---

## Context Menu Extension

### Registration

```typescript
const disposable = api.ui.contextMenu.register({
  id: 'lookup-word',
  label: 'Look Up Definition',
  icon: 'book-open',
  condition: (ctx) => ctx.hasSelection && ctx.text.split(' ').length === 1,
  action: (ctx) => {
    const word = ctx.text.trim();
    openDictionary(word);
  }
});
```

### ContextMenuItem Interface

```typescript
interface ContextMenuItem {
  /** Unique identifier */
  id: string;

  /** Display label */
  label: string;

  /** Lucide icon name (optional) */
  icon?: string;

  /**
   * Condition for showing this item.
   * If not provided, item always shows.
   */
  condition?: (ctx: SelectionContext) => boolean;

  /** Action handler */
  action: (ctx: SelectionContext) => void;
}
```

### SelectionContext

```typescript
interface SelectionContext {
  /** Selected text */
  text: string;

  /** EPUB CFI of selection */
  cfi: string;

  /** DOM Range */
  range: Range;

  /** Whether there is an active selection */
  hasSelection: boolean;
}
```

### Example: Multiple Items

```typescript
// Define as single word
api.ui.contextMenu.register({
  id: 'define-word',
  label: 'Define',
  icon: 'book',
  condition: (ctx) => ctx.text.split(/\s+/).length === 1,
  action: (ctx) => lookupDefinition(ctx.text)
});

// Search in vault
api.ui.contextMenu.register({
  id: 'search-vault',
  label: 'Search in Vault',
  icon: 'search',
  condition: (ctx) => ctx.hasSelection,
  action: (ctx) => {
    this.app.internalPlugins.getPluginById('global-search')
      .instance.openGlobalSearch(ctx.text);
  }
});

// Copy with citation
api.ui.contextMenu.register({
  id: 'copy-citation',
  label: 'Copy with Citation',
  icon: 'quote',
  condition: (ctx) => ctx.hasSelection,
  action: (ctx) => {
    const citation = formatCitation(ctx.text, currentBook);
    navigator.clipboard.writeText(citation);
    new Notice('Copied with citation');
  }
});
```

---

## Style Isolation

### Shadow DOM Protection

Los Libros wraps injected content in Shadow DOM to prevent style conflicts:

```typescript
// Internal implementation
mount: (container) => {
  // Los Libros creates shadow root
  const shadowRoot = container.attachShadow({ mode: 'open' });

  // Your mount function receives the shadow root
  const innerContainer = document.createElement('div');
  shadowRoot.appendChild(innerContainer);

  // Call plugin's mount with inner container
  const cleanup = pluginMount(innerContainer);

  return cleanup;
}
```

### Styling Injected Content

Add styles directly to your mounted content:

```typescript
mount: (container) => {
  // Add scoped styles
  const style = document.createElement('style');
  style.textContent = `
    .my-component {
      padding: 1rem;
      background: var(--background-primary);
      color: var(--text-normal);
    }
  `;
  container.appendChild(style);

  const div = document.createElement('div');
  div.className = 'my-component';
  div.textContent = 'Styled content';
  container.appendChild(div);

  return () => container.innerHTML = '';
}
```

### CSS Variables

Los Libros exposes Obsidian's CSS variables inside the shadow DOM:

```css
/* Available variables */
--background-primary
--background-secondary
--text-normal
--text-muted
--text-accent
--interactive-accent
--interactive-hover
/* ... and all Obsidian theme variables */
```

---

## Component Registry Internals

### How Registration Works

```typescript
// Internal: ComponentRegistry class
class ComponentRegistry<T> {
  private items = new Map<string, T>();

  register(item: T & { id: string }): Disposable {
    this.items.set(item.id, item);
    this.notifySubscribers();

    return {
      dispose: () => {
        this.items.delete(item.id);
        this.notifySubscribers();
      }
    };
  }

  getAll(): T[] {
    return Array.from(this.items.values());
  }

  subscribe(callback: () => void): () => void {
    // Svelte-compatible subscription
  }
}
```

### Reactive Updates

Svelte components subscribe to registry changes:

```svelte
<!-- Toolbar.svelte -->
<script>
  import { toolbarRegistry } from '../api/ui/registry';

  // Automatically updates when items added/removed
  $: items = $toolbarRegistry.getAll();
</script>

{#each items as item}
  <button on:click={() => item.onClick(context)}>
    <Icon name={item.icon} />
  </button>
{/each}
```

---

## Best Practices

### 1. Use Unique IDs

```typescript
// Include plugin name to avoid conflicts
api.ui.toolbar.register({
  id: 'my-plugin:translate',  // Namespaced
  // ...
});
```

### 2. Clean Up on Unload

```typescript
class MyPlugin extends Plugin {
  private disposables: Disposable[] = [];

  onload() {
    this.disposables.push(
      api.ui.toolbar.register({ ... }),
      api.ui.sidebar.register({ ... }),
      api.ui.contextMenu.register({ ... })
    );
  }

  onunload() {
    this.disposables.forEach(d => d.dispose());
  }
}
```

### 3. Handle Missing API

```typescript
const api = this.app.plugins.plugins['los-libros']?.api;
if (!api) {
  console.warn('Los Libros not installed');
  return;
}
```

### 4. Defer Heavy Rendering

```typescript
mount: (container) => {
  // Show loading state immediately
  container.innerHTML = '<div>Loading...</div>';

  // Defer heavy work
  requestAnimationFrame(async () => {
    const data = await fetchData();
    renderContent(container, data);
  });

  return () => container.innerHTML = '';
}
```

### 5. Respect Theme Changes

```typescript
mount: (container) => {
  const render = () => {
    const isDark = document.body.classList.contains('theme-dark');
    container.style.background = isDark ? '#1e1e1e' : '#ffffff';
  };

  render();

  // Listen for theme changes
  const observer = new MutationObserver(render);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class']
  });

  return () => observer.disconnect();
}
```

---

## Limitations

### What You CAN Do

- Add toolbar buttons
- Create sidebar tabs
- Extend context menu
- Render any framework into portals
- Access reader context (location, selection)
- Style with CSS variables

### What You CANNOT Do

- Modify reader content directly
- Override built-in UI
- Access internal Svelte components
- Bypass security checks
- Render outside designated zones

---

*Los Libros UI Extensibility Specification v1.0.0*
