# **Architectural Specification: Designing a Public Plugin API for Obsidian (Los Libros)**

## **1\. Executive Summary: The Platform-Within-a-Platform Mandate**

The contemporary landscape of Personal Knowledge Management (PKM) tools has shifted from static file repositories to dynamic, programmable operating environments. Within the Obsidian ecosystem, which boasts over 1.5 million users and thousands of community plugins, the expectation for interoperability is no longer a "nice-to-have" feature but a foundational requirement.1 "Los Libros," envisioned as a premier EPUB and PDF reader plugin, faces an architectural challenge that transcends mere document rendering: it must function as a platform-within-a-platform.

This report provides an exhaustive architectural specification for the Los Libros Public API. The objective is to design an interface that allows third-party scripts (via Templater or QuickAdd), other plugins (like Dataview or Excalidraw), and power users to control the reading experience programmatically. The complexity of this task is compounded by the specific technology stack—Redux for internal state management and Svelte for the User Interface (UI). Integrating these technologies into an external-facing API requires a rigorous analysis of state bridging, reactive data binding, and secure execution contexts.

The analysis draws upon established patterns from the Visual Studio Code (VS Code) extension architecture, specifically its handling of "Activation Events" and "Disposables," to solve the chronic issues of memory management in long-running single-page applications.3 Furthermore, it synthesizes community standards established by the "Big Three" of Obsidian interoperability—Dataview, Templater, and Excalidraw—to ensure that Los Libros behaves as a "good citizen" within the plugin ecosystem.5

Central to this specification is the "Headless Engine" philosophy. This architectural paradigm mandates that the core logic of the reader be strictly decoupled from its visual presentation, allowing the API to drive the application in a "headless" mode for background data extraction, automation, and synchronization. Through the implementation of a Redux-Svelte Facade, a Capability-based security model, and a Slot-based Registry system for UI injection, Los Libros aims to establish a new standard for plugin architecture—one that prioritizes stability, security, and limitless extensibility.

## ---

**2\. Foundational Architecture: The Headless Engine Paradigm**

To design an API that survives the rapid iteration of the Obsidian core and the plugin ecosystem, one must adopt an architecture that separates concern between *logic* and *presentation*. The majority of fragile plugins fail because their logic is tightly bound to the DOM; when the UI is closed, the logic dies. The "Headless Engine" paradigm solves this by treating the visual interface (the Svelte components) as merely one of many possible consumers of the core application logic.

### **2.1 The Decoupling Mandate**

In the context of an EPUB/PDF reader, the user often interacts with the document without viewing it—fetching annotations for a Dataview query, synchronizing reading progress via a script, or pre-processing a file for text-to-speech.

**Architectural Separation:**

* **The Core (Engine):** A singleton instance responsible for file parsing, Redux state management, annotation CRUD (Create, Read, Update, Delete) operations, and persistence. This layer has zero dependency on the DOM or Svelte. It operates purely on data structures and the file system adapter.  
* **The View (UI):** A Svelte-based presentation layer that subscribes to the Core. It is ephemeral; it can be created, destroyed, and recreated (e.g., when switching tabs) without affecting the state of the Core.  
* **The API (Bridge):** The public interface interacts *only* with the Core. When an external script calls api.openBook('manual.pdf'), it instructs the Core to load the resource. The Core then signals the View (if active) to update.

This separation mirrors the architecture seen in high-performance VS Code extensions, where the "Extension Host" (logic) runs separately from the "Renderer" (UI), ensuring that heavy computations or API calls do not freeze the interface.4

### **2.2 The Global Access Strategy**

Obsidian plugins run in the main process, sharing the global window object. While polluting the global scope is generally discouraged in web development, in the context of Obsidian scripting (Templater/QuickAdd), it is a pragmatic necessity for ease of use.

Dual-Exposure Pattern:  
The specification recommends a dual-exposure strategy to satisfy both "Hobbyist Scripters" and "Professional Plugin Developers."

| Access Method | Implementation | Target Audience | Pros | Cons |
| :---- | :---- | :---- | :---- | :---- |
| **Plugin Registry** | app.plugins.plugins\['los-libros'\].api | Plugin Devs | Stable, canonical, explicit dependency declaration.9 | Verbose; requires knowing the exact plugin ID. |
| **Global Facade** | window.LosLibros | Scripters | Fast prototyping, easy access in console.9 | Risk of collision; requires explicit cleanup on unload. |

The reset() Pattern:  
Drawing from the ExcalidrawAutomate API, the Los Libros API must implement a reset() method.5 Since the API object is a singleton that persists across the application lifecycle, a script that modifies state (e.g., changing the default highlight color) might inadvertently affect subsequent scripts. The reset() method allows consumers to return the internal state of the automation engine to a known default configuration before beginning their operations.

### **2.3 VS Code Patterns: Activation and Disposables**

The most significant architectural borrowing for Los Libros comes from the VS Code Extension API: the rigorous management of lifecycle and resources.

Lazy Activation:  
An EPUB/PDF reader uses heavy dependencies (e.g., pdf.js worker files). Loading these immediately on Obsidian startup slows down the application for users who aren't currently reading. The API must support Lazy Activation.4

* **Implementation:** The API exposed on startup is a lightweight "Stub." It contains metadata methods and event listeners but does not load the rendering engine.  
* **Trigger:** The full engine activates only when:  
  1. The user opens a relevant file extension (.epub, .pdf).  
  2. An API method explicitly requests a heavy operation (e.g., api.engine.initialize()).

The Disposable Contract:  
Memory leaks are the silent killer of long-running Single Page Applications (SPAs). Every time an external plugin registers a listener, adds a button, or subscribes to a store, it creates a reference that prevents garbage collection.  
Los Libros must enforce the Disposable Pattern.3 Every registration method in the API must return a Disposable object (an object with a .dispose() method).

TypeScript

interface Disposable {  
    dispose(): void;  
}

// Usage Example  
const buttonRegistration \= api.ui.toolbar.addButton({... });  
// When the consuming plugin unloads:  
buttonRegistration.dispose();

This contract shifts the responsibility of cleanup to the consumer but provides the standard mechanism to do so, aligning with the best practices of the TypeScript ecosystem.10

## ---

**3\. Reactive State Management: The Redux-Svelte Bridge**

The specific technology constraint of Los Libros—Redux for state and Svelte for UI—presents a unique interoperability challenge. Redux is a predictable state container with a strict unidirectional data flow, while Svelte is a compiler-based reactive framework. The Public API must act as a "Translator," converting the rigid Redux state into fluid, reactive streams that external plugins can consume easily.

### **3.1 The Redux Store Facade**

Exposing the raw Redux store (store.getState(), store.dispatch()) to the public API is an architectural anti-pattern. It creates tight coupling between external plugins and the internal implementation details (action types, reducer structures). If the internal Redux schema changes, every plugin relying on the raw store breaks.

The Solution: A Typed Facade  
The API acts as a Facade, mediating access to the store.11

* **Internal State:** Normalized, complex, potentially containing non-serializable objects (e.g., Buffers).  
* **Public State:** Denormalized, simplified, read-only interfaces.

The Facade utilizes Redux selectors internally to transform state. For example, the internal state might store pages as a map of IDs, but the Public API exposes a simple currentPage object.

### **3.2 Bridging to Svelte Stores**

Svelte's writable and readable stores are implementations of the Observable pattern. They are framework-agnostic in their consumption (you can .subscribe() to a Svelte store from React or Vanilla JS).13 This makes them the ideal vehicle for exposing state in the Public API.

The "Redux-to-Svelte" Sync Mechanism:  
To expose Redux state as Svelte stores, Los Libros must implement a synchronization utility. This utility subscribes to the Redux store and updates a corresponding Svelte store whenever the selected slice of state changes.  
**Code Pattern: The Reactive Selector**

TypeScript

import { store } from './internal/store';  
import { readable } from 'svelte/store';

// A utility to turn a Redux selector into a Svelte Readable Store  
export function createReactiveSelector\<T\>(selector: (state: RootState) \=\> T) {  
    // Initial value  
    const initialValue \= selector(store.getState());  
      
    return readable(initialValue, (set) \=\> {  
        // Redux subscription  
        const unsubscribe \= store.subscribe(() \=\> {  
            const nextValue \= selector(store.getState());  
            // Only update if value has changed (Reference Equality)  
            if (nextValue\!== initialValue) {  
                set(nextValue);  
            }  
        });  
        return unsubscribe; // Cleanup when the store is no longer used  
    });  
}

This pattern ensures that the Public API is always reactive. A plugin developer can simply write $api.state.currentPage in their own Svelte component, or api.state.currentPage.subscribe(val \=\>...) in a script, and receive real-time updates driven by the internal Redux engine.14

### **3.3 TypeScript and Selector Safety**

In a large application, typing the state is critical to prevent runtime errors. The API design leverages TypeScript's advanced type inference to ensure that the selectors exposed are strictly typed.

TypedUseSelectorHook Pattern:  
While typically used within React components, this pattern is adapted here for the API. By defining a custom RootState type exported from the store, we can ensure that any selector function exposed on the API returns exactly the type expected.16  
Circular Dependency Management:  
A common pitfall in Redux/TypeScript projects is circular dependencies between the store definition and the slice reducers when inferring types. To mitigate this in the API design, the type definitions (LosLibrosAPI.d.ts) must be generated and decoupled from the runtime code. This allows external plugins to import the types of the state without importing the runtime store, which keeps the plugin bundle size small and prevents context conflicts.18

### **3.4 Read-Only vs. Write-Access**

The "Single Source of Truth" principle of Redux must be protected. External plugins should **never** be able to directly mutate the state (e.g., api.state.zoom \= 200 must be forbidden).

Command-Based Mutation:  
State mutation is exclusively handled via Command methods exposed on the API.

* **Read:** api.state.zoom (Returns a Read-Only Svelte Store).  
* **Write:** api.commands.setZoom(200).

This setZoom command dispatches a Redux Thunk (dispatch(setZoomThunk(200))). The Thunk handles validation, side effects (e.g., re-rendering the canvas), and persistence. This ensures that all state changes go through the same rigorous lifecycle, regardless of whether they originated from the user clicking a button or a script executing a command.19

## ---

**4\. UI Extensibility: Slots and Registries**

A primary requirement for Los Libros is to allow other plugins to inject UI elements—translation tools, AI summarizers, or note-taking widgets—directly into the reader interface. Since the UI is built with Svelte, but consuming plugins might use React, Vue, or Vanilla JS, the API must be **framework-agnostic**.

### **4.1 The Component Registry Pattern**

The most robust way to handle UI injection is through a "Registry" system. The API defines specific "Zones" or "Slots" in the UI (e.g., Toolbar, Sidebar, ContextMenu, Footer).

**Registry Interface:**

TypeScript

interface UIItem {  
    id: string;  
    icon: string;  
    label: string;  
    onClick: (context: ReaderContext) \=\> void;  
}

api.ui.toolbar.registerItem(item: UIItem): Disposable;

When a plugin registers an item, the internal Svelte component responsible for the toolbar subscribes to the registry. It reacts to the addition, re-rendering the list of buttons to include the new item. This effectively allows imperative code (the registerItem call) to drive declarative UI (the Svelte render).20

### **4.2 Dynamic Slot Injection (The Portal Strategy)**

For more complex UI requirements—such as a plugin wanting to render a custom React component inside the Los Libros sidebar—a simple icon registry is insufficient. The API must implement a **DOM Portal** pattern.

**Mechanism:**

1. **Mount Point Creation:** The Los Libros sidebar component renders an empty \<div\> container for the injected content.  
2. **Callback Execution:** The API calls a provided mount function from the external plugin, passing this HTMLElement container as an argument.  
3. **External Rendering:** The external plugin uses its own framework (e.g., ReactDOM.render or new Vue({...})) to render content into that container.

**Code Pattern:**

TypeScript

api.ui.sidebar.addView({  
    id: 'my-custom-view',  
    title: 'Graph Analysis',  
    mount: (container: HTMLElement) \=\> {  
        // External plugin has full control of 'container'  
        const graph \= new GraphComponent({ target: container });  
        return () \=\> graph.destroy(); // Return cleanup function  
    }  
});

This approach completely decouples the internal framework (Svelte) from the external framework, preventing the "Framework War" often seen in plugin ecosystems.22

### **4.3 Handling Svelte Context Conflicts**

A critical technical risk identified in the research is the conflict between different versions of Svelte running in the same application. If Los Libros uses Svelte 5 (Runes) and an external plugin uses Svelte 4, or if they share a global Svelte context, runtime errors can occur.24

**Isolation Strategy:**

* **Web Components (Custom Elements):** For highly complex internal components that need to be exported (e.g., a Minimap), Los Libros should package them as Web Components using the svelte:options tag feature. This encapsulates the Svelte runtime inside the shadow DOM of the custom element, isolating it from the rest of the application.25  
* **Shadow DOM:** Even for standard injections, wrapping the injection container in a Shadow DOM root protects the Los Libros UI from CSS bleed (global styles from the injected plugin) and protects the injected plugin from Los Libros styles.

## ---

**5\. The Event Horizon: Typed Emitters and Middleware**

Beyond simple state changes, plugins need to react to *events*—moments in time like "Page Turned," "Annotation Created," or "File Closed."

### **5.1 Typed Event Emitters**

While the native DOM EventTarget is available, a custom EventEmitter is preferred for the API because it allows for strict TypeScript typing of event payloads.

The Architecture:  
The API exposes an events namespace.  
api.events.on('page-turn', (payload) \=\> {... })  
Typing Strategy:  
To ensure developer experience (DX), the on method is generic, accepting a key from a ReaderEventMap interface.

TypeScript

interface ReaderEventMap {  
    'page-turn': { from: number; to: number; documentId: string };  
    'annotation-create': { id: string; content: string; color: string };  
    'error': { code: number; message: string };  
}

When a developer types api.events.on('page-turn', (e) \=\>...) in their IDE, TypeScript automatically infers that e has properties from and to. This significantly reduces integration bugs compared to "stringly typed" events.26

### **5.2 The Middleware/Hook Pattern**

Standard events are "post-facto"—they happen *after* the action. However, powerful automation requires **Interception**—the ability to run code *before* an action and potentially modify or cancel it. This is implemented via a Middleware or Hook system.

Cancellation Tokens:  
The API supports hooks like onBeforePageTurn.

TypeScript

api.hooks.register('onBeforePageTurn', async (ctx) \=\> {  
    if (ctx.isAnnotationUnsaved) {  
        new Notice("Please save your note first\!");  
        return false; // Cancel the page turn  
    }  
    return true;  
});

Sequential Execution:  
Unlike events which can fire in parallel, hooks must execute strictly sequentially. The API iterates through registered hooks; if any hook returns false (or a Cancellation Token), the operation aborts. This allows plugins to act as "Gatekeepers," enforcing workflows (e.g., "You cannot close this PDF until you have reviewed 5 flashcards").28

### **5.3 Throttling and Performance**

High-frequency events, such as scroll or resize, can degrade performance if broadcast raw to all plugins. The API implementation includes an internal **Event Bus Throttler**. It aggregates high-frequency DOM events and dispatches API events only on requestAnimationFrame or after a debounce interval (e.g., 100ms), ensuring that a heavy Dataview query triggered by scrolling doesn't freeze the reader.30

## ---

**6\. Ecosystem Interoperability**

Los Libros does not exist in a vacuum. Its value is multiplied by its ability to talk to the "Big Three" of Obsidian: Dataview, Templater, and the Metadata Cache.

### **6.1 Dataview Integration: The Source Interface**

Dataview primarily indexes Markdown files. Binary files (PDF/EPUB) are opaque to it. Los Libros must bridge this gap.

Strategy 1: The Shadow Note (Metadata Mirroring)  
For every book, Los Libros maintains a synchronised Markdown file (often called a "Sidecar" or "Shadow Note") containing YAML frontmatter.

* **Data:** Current page, percentage read, last read date, total pages, author, title.  
* **Mechanism:** When reading state changes in Redux, a middleware triggers a debounced write to this Markdown file.  
* **Result:** Users can write standard Dataview queries:  
  SQL  
  TABLE percentage\_read, last\_read   
  FROM "Books"   
  WHERE percentage\_read \> 50

Strategy 2: The Inline API (DataviewJS)  
Los Libros exposes a helper object lib or ll that mimics the Dataview dv object. This allows advanced users to query the internal database of the reader directly within DataviewJS blocks.  
dv.table(, window.LosLibros.getAllBooks().map(b \=\> \[b.title, b.progress\])).6

### **6.2 Templater and Scripting Support**

Templater users require synchronous, string-returning functions to inject data into notes.

The Helper Namespace:  
The API includes a helpers namespace specifically designed for template injection.

* api.helpers.getSelection(): Returns the currently highlighted text.  
* api.helpers.getLink(): Returns an Obsidian URI linking to the exact scroll position.  
* api.helpers.formatCitation(style: 'APA' | 'MLA'): Returns a formatted citation string.

These helpers are designed to be "fail-safe." If the reader is not open, they return an empty string or a friendly error message rather than throwing an exception that breaks the user's template execution.7

### **6.3 Inter-Plugin Communication Protocol**

To communicate with plugins that do not have a public API, Los Libros uses the Obsidian app.workspace.trigger mechanism. It emits custom events on the global workspace object.  
app.workspace.trigger('los-libros:open-book', { file: '...' })  
This allows strictly decoupled plugins to "fire and forget" messages to Los Libros without needing a hard dependency on the API object.29

## ---

**7\. Security and Sandboxing**

The flexibility of an open API introduces significant security risks. A malicious or poorly written plugin could corrupt the reading state, delete annotations, or exfiltrate data.

### **7.1 Capability-Based Security Model**

In the absence of a platform-level permission system in Obsidian, Los Libros implements a **Capability Token** system.

The Handshake:  
When a plugin initializes and requests access to the Los Libros API, it must request specific capabilities.

TypeScript

const api \= await LosLibros.connect('my-plugin-id', \['read-state', 'write-annotations'\]);

* **Read-Only Token:** Allows subscription to stores and reading metadata.  
* **Write Token:** Required to execute commands (e.g., deleteAnnotation).  
* **Admin Token:** Required for destructive actions (e.g., deleteAllData).

While this doesn't stop a malicious actor who decompiles the code (since client-side security is ultimately advisory), it prevents *accidental* destruction by buggy scripts that call the wrong method.33

### **7.2 Input Validation (Zod)**

The Redux reducers are the "sacred" core of the application. No data from the outside world enters the state tree without validation.  
The API uses Zod, a runtime schema validation library, at the API boundary.  
**Validation Flow:**

1. External plugin calls api.annotations.create(data).  
2. API Middleware runs AnnotationSchema.parse(data).  
3. If validation fails, the API throws a descriptive ValidationError and rejects the Promise.  
4. If validation passes, the data is passed to the Redux Dispatcher.  
   This effectively "sanitizes" inputs, preventing "State Corruption" attacks where malformed data causes the internal rendering engine to crash.34

### **7.3 iframe Isolation for Scripting**

If Los Libros allows users to write custom JS "macros" within the reader (similar to QuickAdd macros), these scripts should be executed within a sandboxed iframe or a restricted eval context (like the Function constructor with limited scope). This limits the script's access to the global window object and prevents it from accessing the file system directly unless explicitly permitted via the API.30

## ---

**8\. Documentation and Developer Experience (DX)**

The success of an API is determined by its ease of use. A powerful API that is undocumented is useless.

### **8.1 Automated Documentation Pipeline**

Documentation must stay in sync with the code. Manual wikis are prone to rot.  
TypeDoc Implementation:  
Los Libros uses TypeDoc to generate API references directly from the TypeScript source code.

* **JSDoc Comments:** Every exported method and interface in the source is annotated with JSDoc examples (@example).  
* **CI/CD Generation:** A GitHub Action runs on every commit to main, generating the HTML documentation and deploying it to GitHub Pages.  
* **Markdown Export:** Using typedoc-plugin-markdown, the docs are also generated as Markdown files in the repo, allowing users to read the docs *inside* Obsidian.36

### **8.2 The Sample Plugin Repository**

To lower the barrier to entry, a separate "Los Libros Sample Plugin" repository is maintained. This is a minimal Obsidian plugin that implements:

1. Connecting to the API.  
2. Registering a toolbar button.  
3. Listening to a page turn event.  
4. Adding a custom UI overlay.  
   This serves as a "Rosetta Stone" for developers, providing working, copy-pasteable code patterns.39

### **8.3 Semantic Versioning (SemVer)**

The API strictly adheres to Semantic Versioning.

* **Major (1.0.0 \-\> 2.0.0):** Breaking changes to the API interfaces.  
* **Minor (1.1.0 \-\> 1.2.0):** New features (e.g., new event types) that are backward compatible.  
* **Patch (1.1.1 \-\> 1.1.2):** Bug fixes.

API Version Check:  
The API object exposes its version: api.version. Consuming plugins can check this at runtime (semver.satisfies(api.version, '\>=1.2.0')) to feature-detect or gracefully degrade if the user hasn't updated Los Libros.41

## ---

**9\. Conclusion**

The architectural design of the Los Libros Public API is a study in balance. It balances the rigidity of Redux with the reactivity of Svelte; the isolation of the Headless Engine with the seamlessness of UI Injection; and the openness of a community ecosystem with the security of a Capability-based model.

By implementing the **Facade Pattern** for state, the **Registry Pattern** for UI, and the **Disposable Contract** for lifecycle management, Los Libros positions itself not merely as a plugin, but as a foundational platform within the Obsidian ecosystem. This specification ensures that as the ecosystem evolves, Los Libros will remain a stable, extensible, and secure pillar for digital reading and knowledge management.

#### **Obras citadas**

1. Excalidraw plugin: How do you use it? : r/ObsidianMD \- Reddit, fecha de acceso: enero 1, 2026, [https://www.reddit.com/r/ObsidianMD/comments/1h8zvmm/excalidraw\_plugin\_how\_do\_you\_use\_it/](https://www.reddit.com/r/ObsidianMD/comments/1h8zvmm/excalidraw_plugin_how_do_you_use_it/)  
2. Plugins \- Obsidian, fecha de acceso: enero 1, 2026, [https://obsidian.md/plugins](https://obsidian.md/plugins)  
3. Plugin architecture, fecha de acceso: enero 1, 2026, [https://cs.uwaterloo.ca/\~m2nagapp/courses/CS446/1195/Arch\_Design\_Activity/PlugIn.pdf](https://cs.uwaterloo.ca/~m2nagapp/courses/CS446/1195/Arch_Design_Activity/PlugIn.pdf)  
4. VS Code Extensions: Basic Concepts & Architecture \- Jessvin Thomas, fecha de acceso: enero 1, 2026, [https://jessvint.medium.com/vs-code-extensions-basic-concepts-architecture-8c8f7069145c](https://jessvint.medium.com/vs-code-extensions-basic-concepts-architecture-8c8f7069145c)  
5. Excalidraw Automate How To | obsidian-excalidraw-plugin, fecha de acceso: enero 1, 2026, [https://zsviczian.github.io/obsidian-excalidraw-plugin/API/introduction.html](https://zsviczian.github.io/obsidian-excalidraw-plugin/API/introduction.html)  
6. Dataview \- GitHub Pages, fecha de acceso: enero 1, 2026, [https://blacksmithgu.github.io/obsidian-dataview/](https://blacksmithgu.github.io/obsidian-dataview/)  
7. SilentVoid13/Templater: A template plugin for obsidian \- GitHub, fecha de acceso: enero 1, 2026, [https://github.com/SilentVoid13/Templater](https://github.com/SilentVoid13/Templater)  
8. A Comprehensive Analysis of The VS Code Extension Ecosystem, fecha de acceso: enero 1, 2026, [https://arxiv.org/pdf/2411.07479](https://arxiv.org/pdf/2411.07479)  
9. Inter-plugin Communication (Expose API to Other Plugins), fecha de acceso: enero 1, 2026, [https://forum.obsidian.md/t/inter-plugin-communication-expose-api-to-other-plugins/23618](https://forum.obsidian.md/t/inter-plugin-communication-expose-api-to-other-plugins/23618)  
10. Extension API \- Visual Studio Code, fecha de acceso: enero 1, 2026, [https://code.visualstudio.com/api](https://code.visualstudio.com/api)  
11. A type-safe approach to Redux stores in TypeScript \- Medium, fecha de acceso: enero 1, 2026, [https://medium.com/@resir014/a-type-safe-approach-to-redux-stores-in-typescript-6474e012b81e](https://medium.com/@resir014/a-type-safe-approach-to-redux-stores-in-typescript-6474e012b81e)  
12. From Redux to reactive typescript-friendly state handling \- Medium, fecha de acceso: enero 1, 2026, [https://medium.com/@alexey.rempel/from-redux-to-reactive-typescript-friendly-state-handling-9f04a2948564](https://medium.com/@alexey.rempel/from-redux-to-reactive-typescript-friendly-state-handling-9f04a2948564)  
13. Working with Svelte stores \- Learn web development | MDN, fecha de acceso: enero 1, 2026, [https://developer.mozilla.org/en-US/docs/Learn\_web\_development/Core/Frameworks\_libraries/Svelte\_stores](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Frameworks_libraries/Svelte_stores)  
14. Stores • Svelte Docs, fecha de acceso: enero 1, 2026, [https://svelte.dev/docs/svelte/stores](https://svelte.dev/docs/svelte/stores)  
15. Getting Started with Readable & Writable Stores in Svelte, fecha de acceso: enero 1, 2026, [https://www.digitalocean.com/community/tutorials/svelte-svelte-store](https://www.digitalocean.com/community/tutorials/svelte-svelte-store)  
16. Usage With TypeScript \- Redux, fecha de acceso: enero 1, 2026, [https://redux.js.org/usage/usage-with-typescript](https://redux.js.org/usage/usage-with-typescript)  
17. React-Redux useSelector typescript type for state \- Stack Overflow, fecha de acceso: enero 1, 2026, [https://stackoverflow.com/questions/57472105/react-redux-useselector-typescript-type-for-state](https://stackoverflow.com/questions/57472105/react-redux-useselector-typescript-type-for-state)  
18. How to use Redux with TypeScript ? \- DEV Community, fecha de acceso: enero 1, 2026, [https://dev.to/tris909/how-to-use-redux-with-typescript-1oag](https://dev.to/tris909/how-to-use-redux-with-typescript-1oag)  
19. Access the Redux Store Outside a React Component \- Dave Ceddia, fecha de acceso: enero 1, 2026, [https://daveceddia.com/access-redux-store-outside-react/](https://daveceddia.com/access-redux-store-outside-react/)  
20. Registering Svelte components outside the main project to be used ..., fecha de acceso: enero 1, 2026, [https://stackoverflow.com/questions/77357843/registering-svelte-components-outside-the-main-project-to-be-used-in-the-main-pr](https://stackoverflow.com/questions/77357843/registering-svelte-components-outside-the-main-project-to-be-used-in-the-main-pr)  
21. Prototype a plugin architecture SvelteKit for activities \- YouTube, fecha de acceso: enero 1, 2026, [https://www.youtube.com/watch?v=HTbUQDnt3\_I](https://www.youtube.com/watch?v=HTbUQDnt3_I)  
22. Dynamically generated slots and context · Issue \#3480 · sveltejs/svelte, fecha de acceso: enero 1, 2026, [https://github.com/sveltejs/svelte/issues/3480](https://github.com/sveltejs/svelte/issues/3480)  
23. How to fill slots in Svelte components consumed by raw Javascript?, fecha de acceso: enero 1, 2026, [https://www.reddit.com/r/sveltejs/comments/q6rey4/how\_to\_fill\_slots\_in\_svelte\_components\_consumed/](https://www.reddit.com/r/sveltejs/comments/q6rey4/how_to_fill_slots_in_svelte_components_consumed/)  
24. Plugin fails to load when migrated to Svelte 5 (issue might be due to ..., fecha de acceso: enero 1, 2026, [https://forum.obsidian.md/t/plugin-fails-to-load-when-migrated-to-svelte-5-issue-might-be-due-to-my-code/93929](https://forum.obsidian.md/t/plugin-fails-to-load-when-migrated-to-svelte-5-issue-might-be-due-to-my-code/93929)  
25. How to import your Svelte component into non Svelte web page?, fecha de acceso: enero 1, 2026, [https://www.reddit.com/r/sveltejs/comments/xbocww/how\_to\_import\_your\_svelte\_component\_into\_non/](https://www.reddit.com/r/sveltejs/comments/xbocww/how_to_import_your_svelte_component_into_non/)  
26. Events \- Developer Documentation \- Obsidian Developer Docs, fecha de acceso: enero 1, 2026, [https://docs.obsidian.md/Plugins/Events](https://docs.obsidian.md/Plugins/Events)  
27. Angular 4 trigger custom event \- EventEmitter vs dispatchEvent(), fecha de acceso: enero 1, 2026, [https://stackoverflow.com/questions/49194485/angular-4-trigger-custom-event-eventemitter-vs-dispatchevent](https://stackoverflow.com/questions/49194485/angular-4-trigger-custom-event-eventemitter-vs-dispatchevent)  
28. async.auto, using modern async functions and TypeScript? \- Reddit, fecha de acceso: enero 1, 2026, [https://www.reddit.com/r/typescript/comments/1hge8z5/asyncauto\_using\_modern\_async\_functions\_and/](https://www.reddit.com/r/typescript/comments/1hge8z5/asyncauto_using_modern_async_functions_and/)  
29. Trigger custom events on linting · Issue \#1215 · platers/obsidian-linter, fecha de acceso: enero 1, 2026, [https://github.com/platers/obsidian-linter/issues/1215](https://github.com/platers/obsidian-linter/issues/1215)  
30. Creating End-to-End Type Safety In a Modern JS Stack \- Harness IO, fecha de acceso: enero 1, 2026, [https://www.harness.io/blog/creating-end-to-end-type-safety-in-a-modern-js-stack](https://www.harness.io/blog/creating-end-to-end-type-safety-in-a-modern-js-stack)  
31. How to get started with Obsidian Dataview and DataviewJS \- Medium, fecha de acceso: enero 1, 2026, [https://medium.com/os-techblog/how-to-get-started-with-obsidian-dataview-and-dataviewjs-5d6b5733d4a4](https://medium.com/os-techblog/how-to-get-started-with-obsidian-dataview-and-dataviewjs-5d6b5733d4a4)  
32. How I use Obsidian Templater \- Cassidy Williams, fecha de acceso: enero 1, 2026, [https://cassidoo.co/post/obsidian-templater/](https://cassidoo.co/post/obsidian-templater/)  
33. JavaScript/TypeScript Security Playbook | Kodem, fecha de acceso: enero 1, 2026, [https://www.kodemsecurity.com/resources/javascript-typescript-security-playbook](https://www.kodemsecurity.com/resources/javascript-typescript-security-playbook)  
34. Optimized Next.js TypeScript Best Practices with Modern UI/UX, fecha de acceso: enero 1, 2026, [https://cursor.directory/optimized-nextjs-typescript-best-practices-modern-ui-ux](https://cursor.directory/optimized-nextjs-typescript-best-practices-modern-ui-ux)  
35. TypeScript, Security, and Type Juggling with Ariel Shulman & Liran Tal, fecha de acceso: enero 1, 2026, [https://www.youtube.com/watch?v=ryn69TJAub8](https://www.youtube.com/watch?v=ryn69TJAub8)  
36. TypeDoc, fecha de acceso: enero 1, 2026, [https://typedoc.org/](https://typedoc.org/)  
37. typedoc-plugin-markdown \- NPM, fecha de acceso: enero 1, 2026, [https://www.npmjs.com/package/typedoc-plugin-markdown](https://www.npmjs.com/package/typedoc-plugin-markdown)  
38. How to create API Documentation of any Typescript Project?, fecha de acceso: enero 1, 2026, [https://www.rupeshtiwari.com/future-blogs/javascript/node/typescript/webpack/how-to-create-documentation-of-any-typescript-project/](https://www.rupeshtiwari.com/future-blogs/javascript/node/typescript/webpack/how-to-create-documentation-of-any-typescript-project/)  
39. obsidianmd/obsidian-sample-plugin \- GitHub, fecha de acceso: enero 1, 2026, [https://github.com/obsidianmd/obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin)  
40. typedoc2md/typedoc-plugin-markdown-examples \- GitHub, fecha de acceso: enero 1, 2026, [https://github.com/typedoc2md/typedoc-plugin-markdown-examples](https://github.com/typedoc2md/typedoc-plugin-markdown-examples)  
41. Semantic Versioning 2.0.0 | Semantic Versioning, fecha de acceso: enero 1, 2026, [https://semver.org/](https://semver.org/)  
42. Obsidian Plugin: \`semantic-release\` boilerplate config \- GitHub Gist, fecha de acceso: enero 1, 2026, [https://gist.github.com/johannrichard/b75ec94659d2d3db4b7b3bcf7fe2a8c1](https://gist.github.com/johannrichard/b75ec94659d2d3db4b7b3bcf7fe2a8c1)