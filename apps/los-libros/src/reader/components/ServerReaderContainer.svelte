<script lang="ts">
  /**
   * ServerReaderContainer
   *
   * EPUB reader component that uses the custom Rust server renderer
   * instead of epub.js. Requires los-libros-server to be running.
   */
  import { onMount, onDestroy, tick, createEventDispatcher } from 'svelte';
  import { Platform } from 'obsidian';
  import type LosLibrosPlugin from '../../main';
  import type { HighlightColor, Highlight } from '../../library/types';
  import type { PendingSelection } from '../../highlights/highlight-store';
  import type { CalibreBookFull } from '../../calibre/calibre-types';
  import { loadBook, isAbsolutePath, getCalibreBookNotePath } from '../book-loader';
  import HighlightPopup from '../../highlights/components/HighlightPopup.svelte';
  import Portal from '../../components/Portal.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import ProgressSlider from './ProgressSlider.svelte';
  import NotebookSidebar from './NotebookSidebar.svelte';
  import { sidebarStore, type SidebarTab } from '../../sidebar/sidebar.store';
  import type { Bookmark, ReadingNote } from '../../bookmarks/bookmark-types';
  import {
    type ReaderSettings,
    type ThemePreset,
    type TapZoneAction,
    getThemeColors,
    DEFAULT_READER_SETTINGS,
  } from '../reader-settings';
  import {
    type PerBookSettings,
    extractPerBookSettings,
    mergePerBookSettings,
  } from '../book-settings-store';

  // Helper to get margin value (handles both number and object formats)
  function getMarginValue(margins: number | { left: number; right: number; top: number; bottom: number }): number {
    return typeof margins === 'number' ? margins : margins.left;
  }
  import { HapticFeedback } from '../../utils';
  import {
    Settings,
    Bookmark as BookmarkIcon,
    BookmarkCheck,
    List,
    X,
    Maximize2,
    Minimize2,
    Image,
    ExternalLink,
    Info,
    MoreVertical,
    ChevronLeft,
    ChevronRight,
    Highlighter,
    StickyNote,
  } from 'lucide-svelte';

  // Import the new renderer
  import {
    EpubRenderer,
    ApiClient,
    createApiClient,
    SyncManager,
    getDeviceId,
    HighlightOverlay,
    HybridBookProvider,
    createHybridProvider,
    ProviderAdapter,
    createProviderAdapter,
    type ReadingLocation,
    type ParsedBook,
    type TocEntry,
    type RendererConfig,
    type ProviderStatus,
    type ProviderMode,
    type ContentProvider,
  } from '../renderer';

  export let plugin: LosLibrosPlugin;
  export let bookPath: string;
  export let bookTitle: string = '';
  export let _activeLeafTrigger: number = 0;

  /**
   * Navigate to a CFI location - exposed for external calls from reader-view
   */
  export function navigateToCfi(cfi: string): void {
    renderer?.display({ type: 'cfi', cfi });
  }

  /**
   * Remove a highlight from the overlay - exposed for external calls
   */
  export function removeHighlightFromOverlay(highlightId: string): void {
    renderer?.removeHighlight(highlightId);
    // Also update local state to stay in sync
    bookHighlights = bookHighlights.filter(h => h.id !== highlightId);
  }

  /**
   * Navigate to a highlight by CFI then precise text location.
   * Supports both paginated and scrolled reading modes.
   */
  export async function navigateToHighlight(cfi: string, text: string): Promise<void> {
    // Small yield to ensure DOM is settled after book load
    await new Promise(r => requestAnimationFrame(r));

    const iframe = renderer?.getIframe?.();
    const doc = iframe?.contentDocument;
    const searchText = text.slice(0, 50);
    const mode = renderer?.getMode?.() || 'paginated';

    // Scroll mode: Use chapter-scoped search to avoid false matches
    if (mode === 'scrolled') {
      if (doc && iframe) {
        // Get the chapter element from CFI to scope the search
        const spineIndex = getSpineIndexFromCfi(cfi);
        const chapterElement = spineIndex !== null ? getChapterElement(doc, spineIndex) : null;

        // Search within the specific chapter only
        const range = findTextRange(doc, searchText, chapterElement);
        if (range) {
          const rect = range.getBoundingClientRect();
          const viewportHeight = iframe.clientHeight || 600;
          const MARGIN = 50;

          // Check vertical visibility for scroll mode
          if (rect.top >= -MARGIN && rect.bottom <= viewportHeight + MARGIN) {
            return; // Already visible
          }
          // Text found but not visible - scroll directly to it
          navigateToTextRangeScrolled(range, doc);
          return;
        }
      }
      // Text not found in chapter - chapter might not be loaded, use CFI navigation
      renderer?.display({ type: 'cfi', cfi });
      waitForTextAndScrollNavigate(text, 0, cfi);
      return;
    }

    // Paginated mode: Try text search first (faster if already on correct page)
    if (doc && iframe) {
      const range = findTextRange(doc, searchText);
      if (range) {
        const rect = range.getBoundingClientRect();
        const viewportWidth = iframe.clientWidth || 800;
        const MARGIN = 50;
        if (rect.left >= -MARGIN && rect.right <= viewportWidth + MARGIN) {
          return; // Already visible
        }
        // Navigate in paginated mode
        navigateToTextRange(range, iframe);
        return;
      }
    }

    // Text not found - use CFI to load the correct chapter
    renderer?.display({ type: 'cfi', cfi });
    waitForTextAndNavigate(text, 0);
  }

  /**
   * Navigate to text in scrolled mode using chapter-relative positioning.
   * Uses a retry approach to handle content loading during scroll.
   */
  function navigateToTextRangeScrolled(range: Range, doc: Document): void {
    const scrollContainer = doc.scrollingElement || doc.documentElement;
    const viewportHeight = scrollContainer.clientHeight;
    const MARGIN = 100; // Margin for "in view" detection

    // Find the chapter element containing this range
    const chapterElement = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element).closest('.epub-chapter')
      : range.commonAncestorContainer.parentElement?.closest('.epub-chapter');

    if (!chapterElement) {
      return;
    }

    // Function to calculate and scroll to target
    const scrollToTarget = (attempt: number) => {
      // Re-get the rect each time as positions change during content load
      const rect = range.getBoundingClientRect();
      const currentScrollTop = scrollContainer.scrollTop;

      // Check if already in view
      if (rect.top >= MARGIN && rect.bottom <= viewportHeight - MARGIN) {
        renderer?.reanchorHighlights?.();
        return;
      }

      // Calculate document-relative position
      const documentTop = rect.top + currentScrollTop;
      const targetScrollTop = documentTop - (viewportHeight / 2) + (rect.height / 2);

      // Use instant scroll for retries, smooth for first attempt
      scrollContainer.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: attempt === 0 ? 'smooth' : 'auto',
      });

      // Retry if this isn't the last attempt
      if (attempt < 3) {
        // Wait for scroll + potential content reflow, then check again
        const delay = attempt === 0 ? 800 : 200; // Longer wait for smooth scroll
        setTimeout(() => scrollToTarget(attempt + 1), delay);
      } else {
        // Final reanchor
        renderer?.reanchorHighlights?.();
      }
    };

    // Start the scroll sequence
    scrollToTarget(0);
  }

  /**
   * Navigate directly to a text range that's already been found.
   */
  function navigateToTextRange(range: Range, iframe: HTMLIFrameElement): void {
    const doc = iframe.contentDocument;
    if (!doc) return;

    const rect = range.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) return;

    const paginator = renderer?.getPaginator?.();
    if (!paginator) return;

    const columnWidth = paginator.getColumnWidth();
    const gap = paginator.getGap();
    const pageWidth = columnWidth + gap;
    if (pageWidth <= 0) return;

    // Check if already visible
    const viewportWidth = iframe.clientWidth || 800;
    const MARGIN = 50;
    if (rect.left >= -MARGIN && rect.right <= viewportWidth + MARGIN) {
      console.warn('[navigateToHighlight] Text already visible');
      return;
    }

    // Calculate target page from current position
    const container = doc.getElementById('content-container');
    const transform = container?.style.transform || '';
    const match = transform.match(/translate3d\((-?\d+(?:\.\d+)?)px/);
    const currentOffset = match ? Math.abs(parseFloat(match[1])) : 0;
    const docPosition = currentOffset + rect.left;
    const targetPage = Math.max(0, Math.floor(docPosition / pageWidth));

    console.warn('[navigateToHighlight] Direct nav: ' + JSON.stringify({
      rectLeft: Math.round(rect.left),
      currentOffset: Math.round(currentOffset),
      targetPage
    }));

    paginator.goToPage(targetPage);
  }

  // Track last transform to detect stabilization
  let lastTransformCheck = '';
  let transformStableCount = 0;

  /**
   * Wait for content to load and transform to stabilize, find text, navigate.
   */
  function waitForTextAndNavigate(text: string, attempt: number): void {
    const MAX_ATTEMPTS = 40; // 2 seconds max wait

    if (attempt >= MAX_ATTEMPTS) {
      console.warn('[navigateToHighlight] Gave up after', attempt, 'attempts');
      return;
    }

    const iframe = renderer?.getIframe?.();
    const doc = iframe?.contentDocument;
    if (!doc) {
      setTimeout(() => waitForTextAndNavigate(text, attempt + 1), 50);
      return;
    }

    // Wait for transform to stabilize after CFI navigation
    const container = doc.getElementById('content-container');
    const currentTransform = container?.style.transform || '';

    if (attempt < 3 || currentTransform !== lastTransformCheck) {
      // Transform still changing, wait for it to stabilize
      lastTransformCheck = currentTransform;
      transformStableCount = 0;
      setTimeout(() => waitForTextAndNavigate(text, attempt + 1), 50);
      return;
    }

    transformStableCount++;
    if (transformStableCount < 2) {
      // Need 2 consecutive stable readings
      setTimeout(() => waitForTextAndNavigate(text, attempt + 1), 50);
      return;
    }

    // Transform is stable, now search for text
    const searchText = text.slice(0, 50);
    const range = findTextRange(doc, searchText);
    if (!range) {
      setTimeout(() => waitForTextAndNavigate(text, attempt + 1), 50);
      return;
    }

    const rect = range.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) {
      setTimeout(() => waitForTextAndNavigate(text, attempt + 1), 50);
      return;
    }

    const mode = renderer?.getMode?.() || 'paginated';
    const MARGIN = 50;

    if (mode === 'scrolled') {
      // Scroll mode: check vertical visibility
      const viewportHeight = iframe.clientHeight || 600;
      if (rect.top >= -MARGIN && rect.bottom <= viewportHeight + MARGIN) {
        console.warn('[navigateToHighlight] Text visible after CFI nav (scroll mode)');
        lastTransformCheck = '';
        transformStableCount = 0;
        return;
      }
      // Navigate in scroll mode
      navigateToTextRangeScrolled(range, doc);
      lastTransformCheck = '';
      transformStableCount = 0;
      return;
    }

    // Paginated mode
    const paginator = renderer?.getPaginator?.();
    if (!paginator) return;

    const columnWidth = paginator.getColumnWidth();
    const gap = paginator.getGap();
    const pageWidth = columnWidth + gap;
    if (pageWidth <= 0) return;

    // Check if already visible
    const viewportWidth = iframe.clientWidth || 800;
    if (rect.left >= -MARGIN && rect.right <= viewportWidth + MARGIN) {
      console.warn('[navigateToHighlight] Text visible after CFI nav');
      lastTransformCheck = '';
      transformStableCount = 0;
      return;
    }

    // Calculate target page
    const match = currentTransform.match(/translate3d\((-?\d+(?:\.\d+)?)px/);
    const currentOffset = match ? Math.abs(parseFloat(match[1])) : 0;
    const docPosition = currentOffset + rect.left;
    const targetPage = Math.max(0, Math.floor(docPosition / pageWidth));

    console.warn('[navigateToHighlight] Navigating: ' + JSON.stringify({
      rectLeft: Math.round(rect.left),
      currentOffset: Math.round(currentOffset),
      targetPage
    }));

    paginator.goToPage(targetPage);

    // Reset tracking for next call
    lastTransformCheck = '';
    transformStableCount = 0;
  }

  /**
   * Wait for text to appear after CFI navigation, then scroll to it (scroll mode).
   * Simpler than waitForTextAndNavigate since we don't need to wait for transforms.
   */
  function waitForTextAndScrollNavigate(text: string, attempt: number, cfi?: string): void {
    const MAX_ATTEMPTS = 40; // 2 seconds max wait

    if (attempt >= MAX_ATTEMPTS) {
      console.warn('[navigateToHighlight] Scroll: gave up after', attempt, 'attempts');
      return;
    }

    const iframe = renderer?.getIframe?.();
    const doc = iframe?.contentDocument;
    if (!doc) {
      setTimeout(() => waitForTextAndScrollNavigate(text, attempt + 1, cfi), 50);
      return;
    }

    // Get chapter element from CFI for scoped search
    const spineIndex = cfi ? getSpineIndexFromCfi(cfi) : null;
    const chapterElement = spineIndex !== null ? getChapterElement(doc, spineIndex) : null;

    // Search for text within the specific chapter (or whole document if no CFI)
    const searchText = text.slice(0, 50);
    const range = findTextRange(doc, searchText, chapterElement);
    if (!range) {
      // Text not found yet, chapter might still be loading
      setTimeout(() => waitForTextAndScrollNavigate(text, attempt + 1, cfi), 50);
      return;
    }

    const rect = range.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) {
      // Range exists but not rendered yet
      setTimeout(() => waitForTextAndScrollNavigate(text, attempt + 1, cfi), 50);
      return;
    }

    // Check if text is already visible after CFI navigation
    const viewportHeight = iframe.clientHeight || 600;
    const MARGIN = 50;
    if (rect.top >= -MARGIN && rect.bottom <= viewportHeight + MARGIN) {
      console.warn('[navigateToHighlight] Scroll mode: text visible after CFI nav');
      return;
    }

    // Text found and rendered but not visible, scroll to it
    console.warn('[navigateToHighlight] Scroll mode: found text, scrolling');
    navigateToTextRangeScrolled(range, doc);
  }

  /**
   * Parse CFI to get spine index
   * CFI format: epubcfi(/6/22!/4/2/1:0) where 22/2-1 = spine index 10
   */
  function getSpineIndexFromCfi(cfi: string): number | null {
    const match = cfi.match(/epubcfi\(\/6\/(\d+)/);
    if (!match) return null;
    return Math.floor(parseInt(match[1], 10) / 2) - 1;
  }

  /**
   * Get the chapter element for a given spine index
   */
  function getChapterElement(doc: Document, spineIndex: number): Element | null {
    return doc.querySelector(`.epub-chapter[data-chapter-index="${spineIndex}"]`);
  }

  /**
   * Find a text string in the document (or within a specific root element) and return a Range
   */
  function findTextRange(doc: Document, searchText: string, root?: Element | null): Range | null {
    const searchRoot = root || doc.body;
    const walker = doc.createTreeWalker(searchRoot, NodeFilter.SHOW_TEXT, null);

    let node: Text | null;
    while ((node = walker.nextNode() as Text)) {
      const nodeText = node.textContent || '';
      const index = nodeText.indexOf(searchText);
      if (index !== -1) {
        const range = doc.createRange();
        range.setStart(node, index);
        range.setEnd(node, Math.min(index + searchText.length, nodeText.length));
        return range;
      }
    }
    return null;
  }

  const dispatch = createEventDispatcher<{
    titleResolved: { title: string };
  }>();

  // DOM references
  let container: HTMLElement;
  let rendererContainer: HTMLElement;

  // Renderer instances
  let renderer: EpubRenderer | null = null;
  let apiClient: ApiClient | null = null;
  let syncManager: SyncManager | null = null;
  let bookProvider: HybridBookProvider | null = null;
  let providerAdapter: ProviderAdapter | null = null;
  let providerStatus: ProviderStatus | null = null;

  // Book state
  let book: ParsedBook | null = null;
  let bookId: string = '';
  let toc: TocEntry[] = [];
  let isCalibreBook = false;
  let calibreBook: CalibreBookFull | undefined;

  // UI state
  let loading = true;
  let error: string | null = null;
  let progress = 0;
  let currentChapter = '';
  let showToc = false;
  let showSettings = false;
  let showBottomNav = true;
  let isFullScreen = false;
  let showMoreMenu = false;
  let showBookInfo = false;
  let showNotebook = false;
  let notebookTab: 'highlights' | 'bookmarks' | 'notes' | 'images' = 'highlights';

  // Auto-scroll state
  let isAutoScrolling = false;

  // Auto-save interval
  let autoSaveInterval: ReturnType<typeof setInterval> | null = null;
  const AUTO_SAVE_INTERVAL_MS = 30000; // 30 seconds

  // Highlight state
  let showHighlightPopup = false;
  let highlightPopupPosition = { x: 0, y: 0 };
  let pendingSelection: PendingSelection | null = null;
  let highlightPopupMode: 'new' | 'existing' = 'new';
  let selectedExistingHighlight: Highlight | null = null;
  let bookHighlights: Highlight[] = [];
  let bookBookmarks: Bookmark[] = [];
  let bookNotes: ReadingNote[] = [];
  let highlightBookId: string = ''; // The actual book ID used for highlights/bookmarks (Calibre UUID or vault book ID)

  // Track last cursor/touch position for popup positioning (works for both mouse and touch)
  let lastPointerPosition = { x: 0, y: 0 };

  // Flag to ignore clicks immediately after showing popup (prevents click-through from selection)
  let ignoreNextContainerClick = false;

  // Debug: track popup state changes
  $: console.log('[Svelte Reactive] Popup state: showHighlightPopup=' + showHighlightPopup + ', hasPending=' + !!pendingSelection + ', hasExisting=' + !!selectedExistingHighlight + ', loading=' + loading);

  // Reader settings
  let readerSettings: ReaderSettings = {
    ...DEFAULT_READER_SETTINGS,
    fontSize: plugin.settings.defaultFontSize,
    theme: plugin.settings.defaultTheme as ThemePreset,
    flow: plugin.settings.paginated ? 'paginated' : 'scrolled',
  };

  // Page tracking
  let totalPages = 0;
  let currentPage = 0;

  // Mobile detection
  const isMobile = Platform.isMobile;

  // Handle tab activation
  $: if (_activeLeafTrigger && renderer) {
    // Renderer handles resize automatically
  }

  // Subscribe to Calibre store to update calibreBook when data becomes available
  let calibreStoreUnsubscribe: (() => void) | null = null;

  $: if (isCalibreBook && !calibreBook && bookPath && plugin.calibreService) {
    // Set up subscription if not already done
    if (!calibreStoreUnsubscribe) {
      const store = plugin.calibreService.getStore();
      calibreStoreUnsubscribe = store.subscribe((state) => {
        if (state.books && state.books.length > 0 && !calibreBook) {
          const found = state.books.find(b => b.epubPath === bookPath);
          if (found) {
            calibreBook = found;
          }
        }
      });
    }
  }

  onMount(async () => {
    if (!bookPath) {
      error = 'No book path provided';
      loading = false;
      return;
    }

    isCalibreBook = isAbsolutePath(bookPath);

    try {
      // Initialize book provider (hybrid: server + WASM fallback)
      const deviceId = getDeviceId();
      const providerMode: ProviderMode = plugin.settings.serverEnabled ? 'auto' : 'wasm';

      // Get WASM path for offline mode (in Obsidian plugin folder)
      const pluginDir = (plugin.manifest as any).dir || '.obsidian/plugins/los-libros';
      const wasmPath = `${pluginDir}/wasm/epub_processor_bg.wasm`;

      // Load WASM file from vault
      let wasmSource: ArrayBuffer | undefined;
      try {
        const adapter = plugin.app.vault.adapter;
        if (adapter && typeof (adapter as any).readBinary === 'function') {
          wasmSource = await (adapter as any).readBinary(wasmPath);
          console.log('[Reader] Loaded WASM file:', wasmPath, 'size:', wasmSource?.byteLength);
        }
      } catch (e) {
        console.warn('[Reader] Failed to load WASM file:', e);
      }

      bookProvider = createHybridProvider({
        serverUrl: plugin.settings.serverEnabled ? plugin.settings.serverUrl : undefined,
        deviceId,
        mode: providerMode,
        wasmSource,
        onStatusChange: (status) => {
          providerStatus = status;
          console.log('[Reader] Provider status:', status);
        },
      });

      // Check provider availability
      providerStatus = await bookProvider.getStatus();
      if (providerStatus.active === 'none') {
        error = 'No book provider available. Enable server connection or ensure your browser supports WebAssembly.';
        loading = false;
        return;
      }

      // Get API client for sync operations (if server is available)
      apiClient = bookProvider.getServerClient();

      // Create provider adapter for renderer
      providerAdapter = createProviderAdapter(bookProvider);

      // Wait for container to be ready
      await tick();
      let attempts = 0;
      while ((!rendererContainer || rendererContainer.clientWidth < 100) && attempts < 50) {
        await new Promise(r => requestAnimationFrame(r));
        attempts++;
      }

      if (!rendererContainer) {
        error = 'Reader container not ready';
        loading = false;
        return;
      }

      // Load book data
      const calibreBooks = plugin.calibreService?.getStore().getValue().books;
      const vaultBooks = plugin.libraryStore.getValue().books;
      const loadedBook = await loadBook(plugin.app, bookPath, vaultBooks, calibreBooks);

      // Resolve book metadata
      if (isCalibreBook) {
        calibreBook = calibreBooks?.find(b => b.epubPath === bookPath);
        if (calibreBook && !bookTitle) {
          bookTitle = calibreBook.title;
          dispatch('titleResolved', { title: bookTitle });
        }
      } else {
        const vaultBook = vaultBooks.find(b => b.localPath === bookPath);
        if (vaultBook && !bookTitle) {
          bookTitle = vaultBook.title;
          dispatch('titleResolved', { title: bookTitle });
        }
      }

      // Create renderer with config
      const rendererConfig: Partial<RendererConfig> = {
        mode: readerSettings.flow === 'paginated' ? 'paginated' : 'scrolled',
        fontSize: readerSettings.fontSize,
        fontFamily: readerSettings.fontFamily || 'Georgia, serif',
        lineHeight: readerSettings.lineHeight || 1.6,
        theme: readerSettings.theme,
        columns: readerSettings.columns || 'auto',
        margin: getMarginValue(readerSettings.margins),
      };

      renderer = new EpubRenderer(rendererContainer, providerAdapter!, rendererConfig);

      // Set up event handlers
      renderer.on('relocated', handleRelocated);
      renderer.on('rendered', handleRendered);
      renderer.on('selected', handleSelected);
      renderer.on('highlightClicked', handleHighlightClicked);
      renderer.on('error', handleError);
      renderer.on('loading', (isLoading) => { loading = isLoading; });

      // Load book via provider (uses server or WASM depending on availability)
      // Pass the filename from the path for better book ID generation
      const filename = loadedBook.metadata.epubPath.split('/').pop() || 'book.epub';
      book = await providerAdapter!.uploadBook(loadedBook.arrayBuffer, filename);
      bookId = book.id;
      toc = book.toc;

      // Load book in renderer
      await renderer.load(bookId);

      // Initialize sync manager only if server is available
      if (apiClient && providerStatus?.server) {
        syncManager = new SyncManager(apiClient, {
          deviceId,
          syncInterval: (plugin.settings.syncInterval || 0) * 60 * 1000,
          onStatusChange: (status) => {
            // Status change logged only in debug mode
          },
        });
        await syncManager.initialize(bookId);
      } else {
        console.log('[Reader] Sync manager disabled - using offline WASM mode');
      }

      // Get highlightBookId early - needed for per-book settings
      // Use loadedBook.metadata.bookId which is set correctly by book-loader for both vault and Calibre books
      highlightBookId = loadedBook.metadata.bookId || '';
      console.log('[ServerReader] Book loaded', {
        highlightBookId,
        isCalibreBook,
        calibreUuid: calibreBook?.uuid,
        metadataBookId: loadedBook.metadata.bookId,
        bookId
      });

      // Update sidebar store with current book info so sidebar knows which book is open
      sidebarStore.setActiveBook(highlightBookId || null, bookPath, bookTitle);

      // Load per-book settings FIRST (BEFORE display())
      // This ensures the correct mode is set before navigating to saved position
      if (highlightBookId && plugin.bookSettingsStore) {
        const savedSettings = plugin.bookSettingsStore.getReaderSettings(highlightBookId, readerSettings);
        readerSettings = savedSettings;
        // Apply loaded settings to renderer BEFORE display
        if (renderer) {
          console.log('[ServerReader] Applying per-book settings:', { mode: readerSettings.flow });
          await renderer.updateConfig({
            mode: readerSettings.flow === 'paginated' ? 'paginated' : 'scrolled',
            fontSize: readerSettings.fontSize,
            fontFamily: readerSettings.fontFamily,
            lineHeight: readerSettings.lineHeight,
            textAlign: readerSettings.textAlign,
            theme: readerSettings.theme as ThemePreset,
            columns: readerSettings.columns as 'single' | 'dual' | 'auto',
            margin: getMarginValue(readerSettings.margins),
          });
        }
      }

      // Load saved position
      let savedCfi: string | undefined;
      if (isCalibreBook && calibreBook) {
        const notePath = getCalibreBookNotePath(calibreBook, plugin.settings.calibreBookNotesFolder);
        const noteFile = plugin.app.vault.getAbstractFileByPath(notePath + '.md');
        if (noteFile) {
          const cache = plugin.app.metadataCache.getFileCache(noteFile as any);
          savedCfi = cache?.frontmatter?.currentCfi as string | undefined;
          progress = (cache?.frontmatter?.progress as number) || 0;
        }
      } else {
        const vaultBook = vaultBooks.find(b => b.localPath === bookPath);
        savedCfi = vaultBook?.currentCfi;
        progress = vaultBook?.progress || 0;
      }

      // Display at saved position (use instant scroll for initial load)
      // Mode is already set correctly via updateConfig above
      if (savedCfi) {
        await renderer.display({ type: 'cfi', cfi: savedCfi }, { instant: true });
      } else {
        await renderer.display(undefined, { instant: true });
      }

      // Load highlights, bookmarks, and notes
      if (highlightBookId) {
        // Load highlights and bookmarks data
        if (plugin.highlightService) {
          bookHighlights = plugin.highlightService.getHighlights(highlightBookId);
        }
        if (plugin.bookmarkService) {
          const artifacts = plugin.bookmarkService.getBookArtifacts(highlightBookId);
          bookBookmarks = artifacts.bookmarks;
          bookNotes = artifacts.notes;
        }

        // Pass highlights to renderer after layout is stable
        console.warn('[ServerReader] About to set highlights:', {
          count: bookHighlights.length,
          mode: readerSettings.flow,
          hasRenderer: !!renderer
        });
        if (bookHighlights.length > 0) {
          // Wait for layout stability after display()
          // Multiple rAF calls ensure we're past any pending layout/scroll updates
          await new Promise(r => requestAnimationFrame(r));
          await new Promise(r => requestAnimationFrame(r));
          await new Promise(r => setTimeout(r, 200));
          // Force browser to process any pending scroll events
          await new Promise(r => requestAnimationFrame(r));
          console.warn('[ServerReader] Calling setStoredHighlights now');
          renderer?.setStoredHighlights(bookHighlights);
        }
      }

      // Set up auto-save interval
      autoSaveInterval = setInterval(() => {
        saveProgress();
      }, AUTO_SAVE_INTERVAL_MS);

      // Set up beforeunload handler
      window.addEventListener('beforeunload', saveProgress);

      loading = false;
    } catch (e) {
      console.error('Failed to load book:', e);
      error = e instanceof Error ? e.message : String(e);
      loading = false;
    }
  });

  onDestroy(() => {
    document.body.classList.remove('los-libros-fullscreen-mode');

    // Save final progress
    saveProgress();

    // Save final settings (clear pending and save immediately)
    if (saveSettingsTimeout) {
      clearTimeout(saveSettingsTimeout);
      saveSettingsTimeout = null;
    }
    if (highlightBookId && plugin.bookSettingsStore) {
      const perBook = extractPerBookSettings(readerSettings);
      plugin.bookSettingsStore.saveBookSettings(highlightBookId, perBook);
    }

    // Clean up auto-save interval
    if (autoSaveInterval) {
      clearInterval(autoSaveInterval);
      autoSaveInterval = null;
    }

    // Clean up debounced progress save
    if (saveProgressTimeout) {
      clearTimeout(saveProgressTimeout);
      saveProgressTimeout = null;
    }

    // Remove beforeunload handler
    window.removeEventListener('beforeunload', saveProgress);

    // Clean up auto-scroll
    stopAutoScroll();

    // Clean up Calibre store subscription
    calibreStoreUnsubscribe?.();

    // Clean up
    syncManager?.stop();
    renderer?.destroy();
  });

  // Event handlers
  function handleRelocated(location: ReadingLocation) {
    progress = location.percentage;

    // Use book-wide page numbers if available, otherwise fall back to chapter-relative
    currentPage = location.pageInBook ?? location.pageInChapter ?? 0;
    totalPages = location.totalPagesInBook ?? location.totalPagesInChapter ?? 0;

    // Find current chapter
    if (book) {
      const spineItem = book.spine[location.spineIndex];
      const tocEntry = toc.find(t => t.href === spineItem?.href || spineItem?.href.includes(t.href));
      currentChapter = tocEntry?.label || '';
    }

    // Close highlight popup on scroll/navigation to prevent stale positioning
    if (showHighlightPopup) {
      closePopup();
    }

    // Trigger debounced progress save on each page turn
    debouncedSaveProgress();
  }

  function handleRendered(data: { spineIndex: number; href: string }) {
    // Chapter rendered
    console.log('[Rendered]', data.href);

    // Re-anchor highlights after chapter render (new system uses setStoredHighlights)
    if (renderer && bookHighlights.length > 0) {
      setTimeout(() => {
        renderer?.setStoredHighlights(bookHighlights);
      }, 100);
    }
  }

  function handleSelected(data: {
    text: string;
    cfi: string;
    range: Range;
    position: { x: number; y: number };
    spineIndex?: number;
    selector?: { textQuote?: { exact: string; prefix?: string; suffix?: string }; textPosition?: { start: number; end: number } };
  }) {
    console.log('[ServerReader] handleSelected called', { textLength: data.text?.length, position: data.position });
    // Use highlightBookId which is set consistently for both Calibre and vault books
    const activeBookId = highlightBookId;
    if (!activeBookId || !data.text) {
      console.log('[ServerReader] handleSelected early return - no bookId or text', { activeBookId, hasText: !!data.text, highlightBookId, bookId });
      return;
    }

    // Capture selection rects for immediate highlight rendering
    const selectionRects = HighlightOverlay.getRectsFromRange(data.range);
    const rectsJson = selectionRects.map(r => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    }));

    // Set up pending selection for highlight popup with robust anchoring data
    pendingSelection = {
      bookId: activeBookId,
      text: data.text,
      cfi: data.cfi,
      chapter: currentChapter,
      pagePercent: progress,
      rects: rectsJson,
      // NEW: Robust anchoring fields
      spineIndex: data.spineIndex,
      textQuote: data.selector?.textQuote,
      textPosition: data.selector?.textPosition,
    };

    // Use the position from the selection event (already translated from iframe coordinates)
    highlightPopupPosition = {
      x: data.position.x,
      y: data.position.y + 10, // Small offset below selection
    };

    console.log('[ServerReader] Popup position: x=' + highlightPopupPosition.x + ', y=' + highlightPopupPosition.y + ' (from selection: x=' + data.position.x + ', y=' + data.position.y + ')');

    // Set flag to ignore the click event that follows the selection
    ignoreNextContainerClick = true;
    setTimeout(() => { ignoreNextContainerClick = false; }, 100);

    showHighlightPopup = true;
    highlightPopupMode = 'new';
    selectedExistingHighlight = null;

    if (readerSettings.hapticFeedback) {
      HapticFeedback.light();
    }
  }

  function handleHighlightClicked(data: { annotationId: string; position: { x: number; y: number } }) {
    // Find the highlight in bookHighlights by its ID
    const highlight = bookHighlights.find(h => h.id === data.annotationId);
    if (!highlight) {
      console.warn('[Reader] Clicked highlight not found:', data.annotationId);
      return;
    }

    // Set flag to ignore the click event that follows
    ignoreNextContainerClick = true;
    setTimeout(() => { ignoreNextContainerClick = false; }, 100);

    // Show popup in 'existing' mode for the clicked highlight
    // Use the position from the event (translated from iframe coords)
    selectedExistingHighlight = highlight;
    highlightPopupMode = 'existing';
    highlightPopupPosition = {
      x: data.position.x,
      y: data.position.y + 10,
    };
    pendingSelection = null;
    showHighlightPopup = true;

    console.log('[ServerReader] Highlight clicked, popup at: x=' + highlightPopupPosition.x + ', y=' + highlightPopupPosition.y);

    if (readerSettings.hapticFeedback) {
      HapticFeedback.light();
    }
  }

  function handleError(err: Error) {
    console.error('[Reader Error]', err);
    error = err.message;
  }

  // Navigation
  function prevPage() {
    renderer?.prev();
    if (readerSettings.hapticFeedback) HapticFeedback.light();
  }

  function nextPage() {
    renderer?.next();
    if (readerSettings.hapticFeedback) HapticFeedback.light();
  }

  function goToChapter(entry: TocEntry) {
    renderer?.display({ type: 'href', href: entry.href });
    showToc = false;
    if (readerSettings.hapticFeedback) HapticFeedback.light();
  }

  function handleSeek(event: CustomEvent<{ percent: number }>) {
    renderer?.display({ type: 'percentage', percentage: event.detail.percent });
    if (readerSettings.hapticFeedback) HapticFeedback.medium();
  }

  function handleProgressClick(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const percent = (x / rect.width) * 100;
    renderer?.display({ type: 'percentage', percentage: percent });
    if (readerSettings.hapticFeedback) HapticFeedback.medium();
  }

  // Settings
  let saveSettingsTimeout: number | null = null;
  const SETTINGS_SAVE_DELAY_MS = 500;

  // Debounced save of per-book settings
  function debouncedSaveSettings() {
    if (saveSettingsTimeout) {
      clearTimeout(saveSettingsTimeout);
    }
    saveSettingsTimeout = window.setTimeout(async () => {
      if (highlightBookId && plugin.bookSettingsStore) {
        const perBook = extractPerBookSettings(readerSettings);
        await plugin.bookSettingsStore.saveBookSettings(highlightBookId, perBook);
      }
    }, SETTINGS_SAVE_DELAY_MS);
  }

  // Debounced save of reading progress (triggered on page turns)
  let saveProgressTimeout: number | null = null;
  const PROGRESS_SAVE_DELAY_MS = 2000; // Save progress 2 seconds after navigation stops

  function debouncedSaveProgress() {
    if (saveProgressTimeout) {
      clearTimeout(saveProgressTimeout);
    }
    saveProgressTimeout = window.setTimeout(() => {
      saveProgress();
    }, PROGRESS_SAVE_DELAY_MS);
  }

  function handleSettingsChange(event: CustomEvent<{ settings: Partial<ReaderSettings> }>) {
    const changes = event.detail.settings;

    // Properly merge margins if they're being updated
    if (changes.margins) {
      readerSettings = {
        ...readerSettings,
        ...changes,
        margins: { ...readerSettings.margins, ...changes.margins }
      };
    } else {
      readerSettings = { ...readerSettings, ...changes };
    }

    // Apply to renderer - include all configurable settings
    // Note: Renderer currently only supports single margin value
    // Using horizontal margin (left) for column padding
    if (renderer) {
      renderer.updateConfig({
        mode: readerSettings.flow === 'paginated' ? 'paginated' : 'scrolled',
        fontSize: readerSettings.fontSize,
        fontFamily: readerSettings.fontFamily,
        lineHeight: readerSettings.lineHeight,
        textAlign: readerSettings.textAlign,
        theme: readerSettings.theme,
        columns: readerSettings.columns,
        margin: getMarginValue(readerSettings.margins),
      });
    }

    // Apply brightness filter to container
    if (changes.brightness !== undefined && rendererContainer) {
      const brightness = changes.brightness / 100;
      rendererContainer.style.filter = brightness < 1 ? `brightness(${brightness})` : '';
    }

    if (readerSettings.hapticFeedback) HapticFeedback.light();

    // Save settings with debounce
    debouncedSaveSettings();
  }

  // Highlights
  async function handleCreateHighlight(event: CustomEvent<{ color: HighlightColor; annotation?: string; tags?: string[]; type?: 'highlight' | 'underline' }>) {
    if (!pendingSelection) return;

    const now = new Date();

    // Build W3C-aligned selector for robust re-anchoring
    const selector = {
      primary: { type: 'CfiSelector' as const, cfi: pendingSelection.cfi },
      fallback: {
        type: 'TextQuoteSelector' as const,
        exact: pendingSelection.textQuote?.exact ?? pendingSelection.text,
        prefix: pendingSelection.textQuote?.prefix,
        suffix: pendingSelection.textQuote?.suffix,
      },
      ...(pendingSelection.textPosition && {
        position: {
          type: 'TextPositionSelector' as const,
          start: pendingSelection.textPosition.start,
          end: pendingSelection.textPosition.end,
        },
      }),
    };

    const highlight: Highlight = {
      id: `hl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      bookId: pendingSelection.bookId,
      text: pendingSelection.text,
      cfi: pendingSelection.cfi,
      color: event.detail.color,
      chapter: pendingSelection.chapter,
      pagePercent: pendingSelection.pagePercent,
      createdAt: now,
      updatedAt: now,
      synced: false,
      annotation: event.detail.annotation,
      tags: event.detail.tags,
      type: event.detail.type || 'highlight',
      // NEW: Robust anchoring fields
      spineIndex: pendingSelection.spineIndex ?? 0,
      selector,
    };

    // Save locally
    plugin.highlightService?.addHighlight(highlight);
    bookHighlights = [...bookHighlights, highlight];

    // Update stored highlights for re-anchoring
    renderer?.setStoredHighlights(bookHighlights);

    // Add to renderer overlay for immediate display
    if (renderer && pendingSelection.rects && pendingSelection.rects.length > 0) {
      renderer.addHighlight(highlight.id, highlight.id, event.detail.color, pendingSelection.rects);
    }

    // Sync to server
    syncManager?.create('annotation', highlight.id, highlight);

    // Clear text selection to prevent double-highlight effect
    renderer?.clearSelection();

    closePopup();

    if (readerSettings.hapticFeedback) HapticFeedback.success();
  }

  async function handleDeleteHighlight(event?: CustomEvent<{ id: string }>) {
    const highlightId = event?.detail?.id || selectedExistingHighlight?.id;
    if (!highlightId) return;

    plugin.highlightService?.deleteHighlight(highlightId);
    bookHighlights = bookHighlights.filter(h => h.id !== highlightId);

    // Remove from renderer overlay
    renderer?.removeHighlight(highlightId);

    syncManager?.delete('annotation', highlightId);

    closePopup();

    if (readerSettings.hapticFeedback) HapticFeedback.light();
  }

  async function handleUpdateHighlight(event: CustomEvent<{ id: string; color?: HighlightColor; annotation?: string; tags?: string[]; locked?: boolean }>) {
    const { id, ...updates } = event.detail;

    // Find and update the highlight
    const highlightIndex = bookHighlights.findIndex(h => h.id === id);
    if (highlightIndex === -1) return;

    const updatedHighlight = {
      ...bookHighlights[highlightIndex],
      ...updates,
      updatedAt: new Date(),
      synced: false,
    };

    // Update locally
    bookHighlights[highlightIndex] = updatedHighlight;
    bookHighlights = [...bookHighlights]; // Trigger reactivity

    plugin.highlightService?.updateHighlight(highlightBookId, id, updates);

    // Update overlay if color changed
    if (updates.color && renderer) {
      renderer.updateHighlightColor(id, updates.color);
    }

    // Sync to server
    syncManager?.update('annotation', id, updatedHighlight);

    if (readerSettings.hapticFeedback) HapticFeedback.light();
  }

  function handleBookmarkFromPopup(event: CustomEvent<{ name?: string }>) {
    // Create a bookmark at current position
    const name = event.detail.name || currentChapter || `Page ${currentPage + 1}`;
    // For now, just provide haptic feedback - full bookmark system can be implemented later
    if (readerSettings.hapticFeedback) HapticFeedback.success();
    closePopup();
  }

  function handleCopyText(event: CustomEvent<{ text: string }>) {
    navigator.clipboard.writeText(event.detail.text).then(() => {
      if (readerSettings.hapticFeedback) HapticFeedback.success();
    }).catch(() => {});
    closePopup();
  }

  function handleCopyLink(event: CustomEvent<{ cfi: string; bookId: string }>) {
    // Create a link to this position in the book
    const link = `obsidian://los-libros?book=${encodeURIComponent(event.detail.bookId)}&cfi=${encodeURIComponent(event.detail.cfi)}`;
    navigator.clipboard.writeText(link).then(() => {
      if (readerSettings.hapticFeedback) HapticFeedback.success();
    }).catch(() => {});
    closePopup();
  }

  function getAllTags(): string[] {
    // Collect all unique tags from book highlights
    const tagSet = new Set<string>();
    bookHighlights.forEach(h => {
      h.tags?.forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }

  function closePopup() {
    console.log('[closePopup] Called from:', new Error().stack);
    showHighlightPopup = false;
    pendingSelection = null;
    selectedExistingHighlight = null;
  }

  // Progress saving
  function saveProgress() {
    if (!renderer) return;

    const location = renderer.getLocation();
    if (!location) return;

    const cfi = location.cfi;
    const progressVal = location.percentage;

    if (isCalibreBook && calibreBook) {
      // Save to plugin data for Calibre books
      plugin.loadData().then((data: Record<string, any>) => {
        data = data || {};
        data.calibreProgress = data.calibreProgress || {};
        data.calibreProgress[calibreBook!.uuid] = {
          progress: progressVal,
          currentCfi: cfi,
          updatedAt: new Date().toISOString(),
        };
        plugin.saveData(data);
      });
    } else {
      // Save to library store for vault books
      const vaultBook = plugin.libraryStore.getValue().books.find(b => b.localPath === bookPath);
      if (vaultBook) {
        plugin.libraryService?.updateProgress(vaultBook.id, progressVal, cfi);
      }
    }
  }

  // UI toggles
  function toggleFullScreen() {
    const readerElement = container?.closest('.los-libros-reader');
    if (!readerElement) return;

    const isCurrentlyFullscreen = document.fullscreenElement != null;

    if (!isCurrentlyFullscreen) {
      readerElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }

    if (readerSettings.hapticFeedback) HapticFeedback.light();
  }

  // Open book images gallery
  function openImagesGallery() {
    if (!bookPath) return;
    // Create new leaf with images view
    plugin.openBookImages(bookPath, bookTitle);
    showMoreMenu = false;
    if (readerSettings.hapticFeedback) HapticFeedback.light();
  }

  // Open in Calibre
  function openInCalibre() {
    if (!isCalibreBook || !calibreBook) return;

    const calibreUrl = `calibre://show-book/${encodeURIComponent(plugin.settings.calibreLibraryPath)}/${calibreBook.calibreId}`;
    window.open(calibreUrl, '_blank');
    showMoreMenu = false;
    if (readerSettings.hapticFeedback) HapticFeedback.light();
  }

  // Toggle bookmark at current position
  async function toggleBookmark() {
    if (!renderer || !highlightBookId || !plugin.bookmarkService) {
      if (readerSettings.hapticFeedback) HapticFeedback.error();
      return;
    }

    const location = renderer.getLocation();
    if (!location) {
      if (readerSettings.hapticFeedback) HapticFeedback.error();
      return;
    }

    try {
      const result = await plugin.bookmarkService.toggleBookmark({
        bookId: highlightBookId,
        cfi: location.cfi,
        name: currentChapter || `Page ${currentPage + 1}`,
        chapter: currentChapter,
        pagePercent: Math.round(progress),
      });

      // Refresh bookmarks list
      bookBookmarks = plugin.bookmarkService.getBookmarks(highlightBookId);

      if (result.created) {
        if (readerSettings.hapticFeedback) HapticFeedback.success();
      } else {
        if (readerSettings.hapticFeedback) HapticFeedback.light();
      }
    } catch (e) {
      console.error('Failed to toggle bookmark:', e);
      if (readerSettings.hapticFeedback) HapticFeedback.error();
    }
  }

  // Check if current position has a bookmark
  $: hasBookmarkAtCurrentPosition = (() => {
    if (!renderer || !highlightBookId || !plugin.bookmarkService) return false;
    const location = renderer.getLocation();
    if (!location) return false;
    return plugin.bookmarkService.hasBookmarkAtCfi(highlightBookId, location.cfi);
  })();

  // Show book info
  function toggleBookInfo() {
    showBookInfo = !showBookInfo;
    showMoreMenu = false;
    if (readerSettings.hapticFeedback) HapticFeedback.light();
  }

  // Open book sidebar (new Obsidian ItemView)
  function openBookSidebar(tab?: SidebarTab) {
    const activeBookId = isCalibreBook ? calibreBook?.uuid : highlightBookId;
    if (tab) {
      sidebarStore.setTab(tab);
    }
    sidebarStore.setActiveBook(activeBookId || null, bookPath, bookTitle);
    plugin.activateBookSidebar(activeBookId || undefined, bookPath, bookTitle);
    showMoreMenu = false;
    if (readerSettings.hapticFeedback) HapticFeedback.light();
  }

  // Legacy: Toggle in-reader notebook sidebar (kept for fallback)
  function toggleNotebook() {
    showNotebook = !showNotebook;
    showToc = false;
    showSettings = false;
    showBookInfo = false;
    showMoreMenu = false;
    if (readerSettings.hapticFeedback) HapticFeedback.light();
  }

  // Legacy: Open in-reader notebook sidebar to a specific tab (kept for fallback)
  function openNotebookTab(tab: 'highlights' | 'bookmarks' | 'notes' | 'images') {
    notebookTab = tab;
    showNotebook = true;
    showToc = false;
    showSettings = false;
    showBookInfo = false;
    showMoreMenu = false;
    if (readerSettings.hapticFeedback) HapticFeedback.light();
  }

  // Handle notebook sidebar navigation
  function handleNotebookNavigate(event: CustomEvent<{ cfi: string }>) {
    renderer?.display({ type: 'cfi', cfi: event.detail.cfi });
    if (readerSettings.hapticFeedback) HapticFeedback.light();
  }

  // Handle bookmark deletion from sidebar
  async function handleDeleteBookmarkFromSidebar(event: CustomEvent<{ id: string }>) {
    if (!plugin.bookmarkService || !highlightBookId) return;
    try {
      await plugin.bookmarkService.deleteBookmark(highlightBookId, event.detail.id);
      bookBookmarks = plugin.bookmarkService.getBookmarks(highlightBookId);
      if (readerSettings.hapticFeedback) HapticFeedback.light();
    } catch (e) {
      console.error('Failed to delete bookmark:', e);
    }
  }

  // Handle note deletion from sidebar
  async function handleDeleteNoteFromSidebar(event: CustomEvent<{ id: string }>) {
    if (!plugin.bookmarkService || !highlightBookId) return;
    try {
      await plugin.bookmarkService.deleteNote(highlightBookId, event.detail.id);
      bookNotes = plugin.bookmarkService.getNotes(highlightBookId);
      if (readerSettings.hapticFeedback) HapticFeedback.light();
    } catch (e) {
      console.error('Failed to delete note:', e);
    }
  }

  // Handle highlight deletion from sidebar
  async function handleDeleteHighlightFromSidebar(event: CustomEvent<{ id: string }>) {
    if (!plugin.highlightService || !highlightBookId) return;
    const highlightId = event.detail.id;

    try {
      // Delete from service
      await plugin.highlightService.deleteHighlight(highlightBookId, highlightId);

      // Update local array (triggers sidebar reactivity)
      bookHighlights = bookHighlights.filter(h => h.id !== highlightId);

      // Remove from renderer overlay immediately
      renderer?.removeHighlight(highlightId);

      // Sync deletion
      syncManager?.delete('annotation', highlightId);

      if (readerSettings.hapticFeedback) HapticFeedback.light();
    } catch (e) {
      console.error('Failed to delete highlight:', e);
    }
  }

  // Auto-scroll toggle
  function toggleAutoScroll() {
    isAutoScrolling = !isAutoScrolling;
    if (isAutoScrolling) {
      startAutoScroll();
    } else {
      stopAutoScroll();
    }
    if (readerSettings.hapticFeedback) HapticFeedback.light();
  }

  let autoScrollInterval: ReturnType<typeof setInterval> | null = null;

  function startAutoScroll() {
    if (autoScrollInterval) clearInterval(autoScrollInterval);
    const speed = readerSettings.autoScroll?.speed ?? 5;
    const delay = Math.max(500, 3000 - (speed * 250));
    autoScrollInterval = setInterval(() => {
      if (renderer && isAutoScrolling) {
        renderer.next();
      }
    }, delay);
  }

  function stopAutoScroll() {
    if (autoScrollInterval) {
      clearInterval(autoScrollInterval);
      autoScrollInterval = null;
    }
    isAutoScrolling = false;
  }

  function handleSpeedChange(event: CustomEvent<{ speed: number }>) {
    readerSettings = {
      ...readerSettings,
      autoScroll: { ...readerSettings.autoScroll, speed: event.detail.speed }
    };
    if (isAutoScrolling) {
      startAutoScroll(); // Restart with new speed
    }
  }

  // Keyboard handling
  function handleKeydown(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;

    // Skip if this is a repeat event (key held down)
    if (event.repeat) return;

    console.log('[Svelte] handleKeydown:', event.key, 'target:', event.target?.constructor?.name);

    switch (event.key) {
      case 'ArrowLeft':
      case 'PageUp':
        event.preventDefault();
        console.log('[Svelte] Calling prevPage()');
        prevPage();
        break;
      case 'ArrowRight':
      case 'PageDown':
        event.preventDefault();
        console.log('[Svelte] Calling nextPage()');
        nextPage();
        break;
      case ' ':
        event.preventDefault();
        event.shiftKey ? prevPage() : nextPage();
        break;
      case 'Escape':
        showToc = false;
        showSettings = false;
        showNotebook = false;
        showHighlightPopup = false;
        break;
      case 't':
      case 'T':
        if (!event.metaKey && !event.ctrlKey) {
          showToc = !showToc;
          showSettings = false;
        }
        break;
      case 's':
      case 'S':
        if (!event.metaKey && !event.ctrlKey) {
          showSettings = !showSettings;
          showToc = false;
        }
        break;
      case 'f':
      case 'F':
        if (!event.metaKey && !event.ctrlKey) {
          toggleFullScreen();
        }
        break;
    }
  }

  // Pointer tracking for popup positioning (works with both mouse and touch)
  function handlePointerMove(event: MouseEvent) {
    lastPointerPosition = { x: event.clientX, y: event.clientY };
  }

  function handleTouchMove(event: TouchEvent) {
    if (event.touches.length > 0) {
      const touch = event.touches[0];
      lastPointerPosition = { x: touch.clientX, y: touch.clientY };
    }
  }

  function handlePointerUp(event: MouseEvent) {
    // Update position on mouseup for accurate popup placement
    lastPointerPosition = { x: event.clientX, y: event.clientY };
  }

  function handleTouchEnd(event: TouchEvent) {
    // Use changedTouches for touchend (touches array is empty at this point)
    if (event.changedTouches.length > 0) {
      const touch = event.changedTouches[0];
      lastPointerPosition = { x: touch.clientX, y: touch.clientY };
    }
  }

  // Execute a tap zone action
  function executeTapAction(action: TapZoneAction) {
    switch (action) {
      case 'prev-page':
        prevPage();
        break;
      case 'next-page':
        nextPage();
        break;
      case 'toggle-ui':
        showBottomNav = !showBottomNav;
        break;
      case 'bookmark':
        // TODO: Implement bookmark action
        if (readerSettings.hapticFeedback) HapticFeedback.medium();
        break;
      case 'none':
        // Do nothing
        break;
    }
  }

  // Container click handling
  function handleContainerClick(event: MouseEvent) {
    // Ignore click that immediately follows a selection (prevents closing the popup we just opened)
    if (ignoreNextContainerClick) {
      console.log('[handleContainerClick] Ignoring click after selection');
      return;
    }

    // Close any open menus/panels
    if (showSettings || showToc || showMoreMenu || showBookInfo || showNotebook) {
      showSettings = false;
      showToc = false;
      showMoreMenu = false;
      showBookInfo = false;
      showNotebook = false;
      return;
    }

    if (showHighlightPopup) {
      closePopup();
      return;
    }

    // Tap zones for paginated mode
    if (readerSettings.flow === 'paginated') {
      const rect = container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const width = rect.width;

      if (x < width / 3) {
        executeTapAction(readerSettings.tapZones.left);
      } else if (x > (width * 2) / 3) {
        executeTapAction(readerSettings.tapZones.right);
      } else {
        executeTapAction(readerSettings.tapZones.center);
      }
    }
  }
</script>

<svelte:window
  on:keydown={handleKeydown}
  on:mousemove={handlePointerMove}
  on:touchmove={handleTouchMove}
  on:mouseup={handlePointerUp}
  on:touchend={handleTouchEnd}
/>

<div
  class="los-libros-reader server-reader"
  bind:this={container}
  on:click={handleContainerClick}
>
  <!-- Renderer container - always rendered and visible so paginator can calculate dimensions -->
  <div class="renderer-container" bind:this={rendererContainer}></div>

  {#if loading}
    <div class="reader-loading-overlay">
      <div class="loading-spinner"></div>
      <p>Loading book...</p>
    </div>
  {:else if error}
    <div class="reader-error">
      <div class="error-icon">⚠️</div>
      <h3>Unable to load book</h3>
      <p>{error}</p>
      {#if !plugin.settings.serverEnabled}
        <p class="error-hint">
          Enable the Los Libros server in plugin settings to use the reader.
        </p>
      {/if}
    </div>
  {:else}
    <!-- Top Bar with Controls -->
    <div class="reader-topbar" class:hidden={!showBottomNav}>
      <div class="topbar-left">
        <button class="icon-button" on:click|stopPropagation={() => { showToc = !showToc; showSettings = false; showMoreMenu = false; }} title="Table of Contents (T)">
          <List size={20} />
        </button>
        <span class="chapter-title">{currentChapter || bookTitle}</span>
      </div>
      <div class="topbar-center">
        <!-- Quick font controls -->
        <button class="icon-button font-btn" on:click|stopPropagation={() => { readerSettings = {...readerSettings, fontSize: Math.max(10, readerSettings.fontSize - 2)}; renderer?.updateConfig({ fontSize: readerSettings.fontSize }); debouncedSaveSettings(); }} title="Decrease font size">
          A-
        </button>
        <span class="font-size-display">{readerSettings.fontSize}</span>
        <button class="icon-button font-btn" on:click|stopPropagation={() => { readerSettings = {...readerSettings, fontSize: Math.min(40, readerSettings.fontSize + 2)}; renderer?.updateConfig({ fontSize: readerSettings.fontSize }); debouncedSaveSettings(); }} title="Increase font size">
          A+
        </button>
      </div>
      <div class="topbar-right">
        <button class="icon-button" on:click|stopPropagation={toggleBookmark} title="Bookmark" class:active={hasBookmarkAtCurrentPosition}>
          {#if hasBookmarkAtCurrentPosition}
            <BookmarkCheck size={20} />
          {:else}
            <BookmarkIcon size={20} />
          {/if}
        </button>
        <button class="icon-button" on:click|stopPropagation={() => openBookSidebar('highlights')} title="Notebook">
          <Highlighter size={20} />
        </button>
        <button class="icon-button" on:click|stopPropagation={() => { showSettings = !showSettings; showToc = false; showMoreMenu = false; showNotebook = false; }} title="Settings (S)">
          <Settings size={20} />
        </button>
        <button class="icon-button" on:click|stopPropagation={() => { showMoreMenu = !showMoreMenu; showToc = false; showSettings = false; showNotebook = false; }} title="More options">
          <MoreVertical size={20} />
        </button>
      </div>
    </div>

    <!-- More menu dropdown -->
    {#if showMoreMenu}
      <div class="more-menu" on:click|stopPropagation>
        <button class="menu-item" on:click={() => openBookSidebar('highlights')}>
          <Highlighter size={18} />
          <span>Highlights</span>
          {#if bookHighlights.length > 0}
            <span class="menu-badge">{bookHighlights.length}</span>
          {/if}
        </button>
        <button class="menu-item" on:click={() => openBookSidebar('bookmarks')}>
          <BookmarkIcon size={18} />
          <span>Bookmarks</span>
          {#if bookBookmarks.length > 0}
            <span class="menu-badge">{bookBookmarks.length}</span>
          {/if}
        </button>
        <button class="menu-item" on:click={() => openBookSidebar('notes')}>
          <StickyNote size={18} />
          <span>Notes</span>
          {#if bookNotes.length > 0}
            <span class="menu-badge">{bookNotes.length}</span>
          {/if}
        </button>
        <button class="menu-item" on:click={() => openBookSidebar('images')}>
          <Image size={18} />
          <span>Images</span>
        </button>
        <div class="menu-divider"></div>
        {#if isCalibreBook && calibreBook}
          <button class="menu-item" on:click={openInCalibre}>
            <ExternalLink size={18} />
            <span>Open in Calibre</span>
          </button>
        {/if}
        <button class="menu-item" on:click={toggleBookInfo}>
          <Info size={18} />
          <span>Book Info</span>
        </button>
        <div class="menu-divider"></div>
        <button class="menu-item" on:click|stopPropagation={toggleFullScreen}>
          {#if isFullScreen}
            <Minimize2 size={18} />
            <span>Exit Fullscreen</span>
          {:else}
            <Maximize2 size={18} />
            <span>Fullscreen (F)</span>
          {/if}
        </button>
      </div>
    {/if}

    <!-- Full-width Progress Bar at Bottom -->
    <div class="reader-progress-bar" class:hidden={!showBottomNav}>
      <div class="progress-nav">
        <button class="nav-btn" on:click|stopPropagation={prevPage} aria-label="Previous page">
          <ChevronLeft size={20} />
        </button>
        <div class="progress-track-wrapper" on:click|stopPropagation={handleProgressClick}>
          <div class="progress-track">
            <div class="progress-fill" style="width: {progress}%"></div>
          </div>
          <span class="progress-info">
            {#if totalPages > 0}
              Page {currentPage + 1} of {totalPages} · {Math.round(progress)}%
            {:else}
              {Math.round(progress)}%
            {/if}
          </span>
        </div>
        <button class="nav-btn" on:click|stopPropagation={nextPage} aria-label="Next page">
          <ChevronRight size={20} />
        </button>
      </div>
    </div>

    <!-- Sidebar click-away overlay -->
    {#if showToc || showSettings || showBookInfo || showNotebook}
      <div
        class="sidebar-overlay"
        on:click={() => { showToc = false; showSettings = false; showBookInfo = false; showNotebook = false; }}
        on:keydown={(e) => e.key === 'Escape' && (showToc = false, showSettings = false, showBookInfo = false, showNotebook = false)}
        role="button"
        tabindex="-1"
        aria-label="Close sidebar"
      />
    {/if}

    <!-- TOC Sidebar -->
    {#if showToc}
      <div class="sidebar toc-sidebar" on:click|stopPropagation>
        <div class="sidebar-header">
          <h3>Contents</h3>
          <button class="icon-button" on:click={() => showToc = false}>
            <X size={20} />
          </button>
        </div>
        <div class="toc-list">
          {#each toc as entry}
            <button
              class="toc-item"
              on:click={() => goToChapter(entry)}
            >
              {entry.label}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Settings Panel -->
    {#if showSettings}
      <div class="sidebar settings-sidebar" on:click|stopPropagation>
        <SettingsPanel
          settings={readerSettings}
          visible={true}
          {isFullScreen}
          on:change={handleSettingsChange}
          on:close={() => showSettings = false}
          on:fullscreenToggle={toggleFullScreen}
        />
      </div>
    {/if}

    <!-- Book Info Panel -->
    {#if showBookInfo && book}
      <div class="sidebar info-sidebar" on:click|stopPropagation>
        <div class="sidebar-header">
          <h3>Book Info</h3>
          <button class="icon-button" on:click={() => showBookInfo = false}>
            <X size={20} />
          </button>
        </div>
        <div class="book-info-content">
          {#if book.metadata.coverHref}
            <div class="book-cover">
              <img src="{plugin.settings.serverUrl}/api/v1/books/{bookId}/resources/{encodeURIComponent(book.metadata.coverHref)}" alt="Cover" />
            </div>
          {/if}
          <div class="book-meta">
            <h2 class="book-title">{book.metadata.title}</h2>
            {#if book.metadata.creators && book.metadata.creators.length > 0}
              <p class="book-author">{book.metadata.creators.map(c => c.name).join(', ')}</p>
            {/if}
            {#if book.metadata.publisher}
              <p class="book-field"><strong>Publisher:</strong> {book.metadata.publisher}</p>
            {/if}
            {#if book.metadata.language}
              <p class="book-field"><strong>Language:</strong> {book.metadata.language}</p>
            {/if}
            {#if book.metadata.identifier}
              <p class="book-field"><strong>Identifier:</strong> {book.metadata.identifier}</p>
            {/if}
            {#if book.metadata.description}
              <div class="book-description">
                <strong>Description:</strong>
                <p>{@html book.metadata.description}</p>
              </div>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <!-- Notebook Sidebar -->
    {#if showNotebook}
      <div class="sidebar notebook-sidebar-container" on:click|stopPropagation>
        <NotebookSidebar
          highlights={bookHighlights}
          bookmarks={bookBookmarks}
          notes={bookNotes}
          {bookPath}
          {bookTitle}
          initialTab={notebookTab}
          on:close={() => showNotebook = false}
          on:navigateTo={handleNotebookNavigate}
          on:deleteHighlight={handleDeleteHighlightFromSidebar}
          on:deleteBookmark={handleDeleteBookmarkFromSidebar}
          on:deleteNote={handleDeleteNoteFromSidebar}
          on:openImages={openImagesGallery}
        />
      </div>
    {/if}

  {/if}
</div>

<!-- Highlight Popup rendered via Portal to document.body to escape all stacking contexts -->
{#if showHighlightPopup && (pendingSelection || selectedExistingHighlight)}
  <Portal>
    <!-- Click-away overlay: clicking outside popup closes it -->
    <div
      style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 999998; background: transparent; pointer-events: auto;"
      on:click={closePopup}
      on:keydown={(e) => e.key === 'Escape' && closePopup()}
      role="button"
      tabindex="-1"
      aria-label="Close popup"
    />
    <HighlightPopup
      mode={highlightPopupMode}
      selection={pendingSelection}
      existingHighlight={selectedExistingHighlight}
      position={highlightPopupPosition}
      existingTags={getAllTags()}
      on:highlight={handleCreateHighlight}
      on:updateHighlight={handleUpdateHighlight}
      on:deleteHighlight={handleDeleteHighlight}
      on:bookmark={handleBookmarkFromPopup}
      on:copyText={handleCopyText}
      on:copyLink={handleCopyLink}
      on:close={closePopup}
    />
  </Portal>
{/if}

<style>
  .los-libros-reader.server-reader {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
    background: var(--background-primary);
    overflow: hidden;
  }

  .reader-loading-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    color: var(--text-muted);
    background: var(--background-primary);
    z-index: 50;
  }

  .reader-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 1rem;
    color: var(--text-muted);
  }

  .reader-error {
    text-align: center;
    padding: 2rem;
  }

  .error-icon {
    font-size: 3rem;
  }

  .error-hint {
    font-size: 0.875rem;
    color: var(--text-faint);
    margin-top: 1rem;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--background-modifier-border);
    border-top-color: var(--interactive-accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Top Bar */
  .reader-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    background: var(--background-secondary);
    border-bottom: 1px solid var(--background-modifier-border);
    transition: opacity 0.2s, transform 0.2s;
    z-index: 10;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
  }

  .reader-topbar.hidden {
    opacity: 0;
    pointer-events: none;
  }

  .topbar-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
  }

  .topbar-center {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0 1rem;
  }

  .font-btn {
    font-weight: 600;
    font-size: 0.75rem;
    min-width: 32px;
  }

  .font-size-display {
    font-size: 0.75rem;
    color: var(--text-muted);
    min-width: 24px;
    text-align: center;
  }

  .topbar-right {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .chapter-title {
    font-size: 0.875rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }

  /* Full-width Progress Bar */
  .reader-progress-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 0.75rem 1rem;
    background: var(--background-secondary);
    border-top: 1px solid var(--background-modifier-border);
    transition: opacity 0.2s, transform 0.2s;
    z-index: 10;
  }

  .reader-progress-bar.hidden {
    opacity: 0;
    pointer-events: none;
  }

  .progress-nav {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 50%;
    cursor: pointer;
    color: var(--text-normal);
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .nav-btn:hover {
    background: var(--background-modifier-hover);
  }

  .progress-track-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    cursor: pointer;
  }

  .progress-track {
    height: 6px;
    background: var(--background-modifier-border);
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    border-radius: 3px;
    transition: width 0.2s ease;
  }

  .progress-info {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-align: center;
  }

  /* More menu dropdown */
  .more-menu {
    position: absolute;
    top: 48px;
    right: 1rem;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    z-index: 200;
    min-width: 180px;
    padding: 0.5rem 0;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.625rem 1rem;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-normal);
    font-size: 0.875rem;
    text-align: left;
    transition: background 0.1s;
  }

  .menu-item:hover {
    background: var(--background-modifier-hover);
  }

  .menu-divider {
    height: 1px;
    background: var(--background-modifier-border);
    margin: 0.5rem 0;
  }

  .menu-badge {
    margin-left: auto;
    font-size: 0.7rem;
    background: var(--background-modifier-border);
    color: var(--text-muted);
    padding: 2px 6px;
    border-radius: 10px;
  }

  .icon-button {
    background: none;
    border: none;
    padding: 0.5rem;
    cursor: pointer;
    color: var(--text-muted);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-button:hover {
    background: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  .icon-button.active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .renderer-container {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .sidebar {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 280px;
    background: var(--background-secondary);
    border-right: 1px solid var(--background-modifier-border);
    z-index: 100;
    display: flex;
    flex-direction: column;
    animation: slideIn 0.2s ease-out;
  }

  .toc-sidebar {
    left: 0;
  }

  .settings-sidebar,
  .info-sidebar,
  .notebook-sidebar-container {
    right: 0;
    border-right: none;
    border-left: 1px solid var(--background-modifier-border);
  }

  .notebook-sidebar-container {
    width: 350px;
    max-width: 90vw;
  }

  @keyframes slideIn {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(0);
    }
  }

  .settings-sidebar,
  .info-sidebar,
  .notebook-sidebar-container {
    animation-name: slideInRight;
  }

  @keyframes slideInRight {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }

  /* Book info panel */
  .book-info-content {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
  }

  .book-cover {
    text-align: center;
    margin-bottom: 1rem;
  }

  .book-cover img {
    max-width: 100%;
    max-height: 200px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .book-meta {
    font-size: 0.875rem;
  }

  .book-title {
    font-size: 1.1rem;
    margin: 0 0 0.5rem 0;
    line-height: 1.3;
  }

  .book-author {
    color: var(--text-muted);
    margin: 0 0 1rem 0;
  }

  .book-field {
    margin: 0.5rem 0;
    color: var(--text-normal);
  }

  .book-field strong {
    color: var(--text-muted);
  }

  .book-description {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--background-modifier-border);
  }

  .book-description p {
    margin: 0.5rem 0 0 0;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .sidebar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid var(--background-modifier-border);
  }

  .sidebar-header h3 {
    margin: 0;
    font-size: 1rem;
  }

  .toc-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
  }

  .toc-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.75rem 1rem;
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-normal);
    font-size: 0.875rem;
  }

  .toc-item:hover {
    background: var(--background-modifier-hover);
  }

  /* Highlight popup click-away overlay - must escape all stacking contexts */
  .los-libros-popup-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 999998; /* Just below popup z-index of 999999 */
    background: transparent;
    cursor: default;
    pointer-events: auto;
  }

  /* Sidebar click-away overlay */
  .sidebar-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 99;
    background: rgba(0, 0, 0, 0.3);
    cursor: default;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
