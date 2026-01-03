/**
 * Settings UI Coordinator
 *
 * Orchestrates all settings UI components:
 * - Search drawer
 * - Floating outline
 * - Keyboard shortcuts
 * - Navigation and highlighting
 * Ported from doc-doctor plugin.
 */

import type { Scope } from 'obsidian';
import type { TabId } from './settings-search-index';
import { SearchDrawer } from './components/search-drawer';
import { FloatingOutline } from './components/floating-outline';
import { KeyboardHandler, highlightElement, addHighlightStyles } from './components/keyboard-handler';

// Tab order for navigation (matches amnesia settings tabs)
const TAB_ORDER: TabId[] = ['library', 'reading', 'sync', 'notes', 'advanced'];

// =============================================================================
// TYPES
// =============================================================================

export interface SettingsUICoordinatorOptions {
    containerEl: HTMLElement;
    scrollContainerEl: HTMLElement;
    getCurrentTab: () => TabId;
    navigateToTab: (tabId: TabId) => void;
    isSettingsActive: () => boolean;
    scope?: Scope; // Obsidian's scope for hierarchical key handling
}

// =============================================================================
// COORDINATOR CLASS
// =============================================================================

export class SettingsUICoordinator {
    private options: SettingsUICoordinatorOptions;
    private searchDrawer: SearchDrawer | null = null;
    private floatingOutline: FloatingOutline | null = null;
    private keyboardHandler: KeyboardHandler | null = null;
    private originalHandleKey: ((event: KeyboardEvent, keyInfo: { key: string }) => unknown) | null = null;
    private isInitialized = false;

    constructor(options: SettingsUICoordinatorOptions) {
        this.options = options;
    }

    // =========================================================================
    // LIFECYCLE
    // =========================================================================

    /**
     * Initialize all UI components
     */
    initialize(): void {
        if (this.isInitialized) return;

        // Add global highlight styles
        addHighlightStyles();

        // Initialize search drawer
        this.searchDrawer = new SearchDrawer({
            containerEl: this.options.containerEl,
            onNavigate: (tabId, settingId, settingName) => this.handleNavigate(tabId, settingId, settingName),
            onClose: () => {},
        });

        // Initialize floating outline
        this.floatingOutline = new FloatingOutline({
            containerEl: this.options.containerEl,
            scrollContainerEl: this.options.scrollContainerEl,
            onSearchClick: (query?: string) => this.openSearch(query),
            getCurrentTab: this.options.getCurrentTab,
        });
        this.floatingOutline.initialize();

        // Initialize keyboard handler
        this.keyboardHandler = new KeyboardHandler({
            onSearchTrigger: () => this.openSearch(),
            onOutlineTrigger: () => this.toggleOutline(),
            onEscape: () => this.handleEscape(),
            onTabNavigation: (direction) => this.navigateMenuTab(direction),
            isEnabled: this.options.isSettingsActive,
            isSearchOpen: () => this.searchDrawer?.isVisible ?? false,
        });
        this.keyboardHandler.activate();

        // Add escape handler directly on the modal to intercept before Obsidian's handler
        this.setupModalEscapeHandler();

        this.isInitialized = true;
    }

    /**
     * Setup escape handler by patching the scope's handleKey method.
     *
     * We patch handleKey because Obsidian's scope system processes key events
     * synchronously before DOM event listeners run. This allows us to intercept
     * Escape when our UI is open, while passing through to close the modal otherwise.
     */
    private setupModalEscapeHandler(): void {
        const scope = this.options.scope as unknown as {
            handleKey: (event: KeyboardEvent, keyInfo: { key: string }) => unknown;
        };
        if (!scope) return;

        // Store the original handleKey method
        this.originalHandleKey = scope.handleKey.bind(scope);

        // Patch handleKey to intercept Escape for our UI
        scope.handleKey = (event: KeyboardEvent, keyInfo: { key: string }) => {
            const key = keyInfo?.key || event?.key;

            if (key === 'Escape') {
                // If search is open, close it and stop propagation
                if (this.searchDrawer?.isVisible) {
                    this.searchDrawer.close();
                    return false; // Handled, prevent modal close
                }

                // If outline is open, close it and stop propagation
                if (this.floatingOutline?.isExpanded) {
                    this.floatingOutline.collapse();
                    return false; // Handled, prevent modal close
                }
            }

            // Let Obsidian handle everything else (including Escape when nothing is open)
            return this.originalHandleKey!(event, keyInfo);
        };
    }

    /**
     * Clean up all components
     */
    destroy(): void {
        // Restore original handleKey if we patched it
        if (this.originalHandleKey && this.options.scope) {
            const scope = this.options.scope as unknown as {
                handleKey: (event: KeyboardEvent, keyInfo: { key: string }) => unknown;
            };
            scope.handleKey = this.originalHandleKey;
            this.originalHandleKey = null;
        }

        this.searchDrawer?.destroy();
        this.floatingOutline?.destroy();
        this.keyboardHandler?.deactivate();

        this.searchDrawer = null;
        this.floatingOutline = null;
        this.keyboardHandler = null;
        this.isInitialized = false;
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Open the search drawer
     * @param query Optional initial search query
     */
    openSearch(query?: string): void {
        this.floatingOutline?.collapse();
        this.searchDrawer?.open(query);
    }

    /**
     * Close the search drawer
     */
    closeSearch(): void {
        this.searchDrawer?.close();
    }

    /**
     * Toggle the search drawer
     */
    toggleSearch(): void {
        if (this.searchDrawer?.isVisible) {
            this.closeSearch();
        } else {
            this.openSearch();
        }
    }

    /**
     * Open the outline panel
     */
    openOutline(): void {
        this.searchDrawer?.close();
        this.floatingOutline?.expand();
    }

    /**
     * Close the outline panel
     */
    closeOutline(): void {
        this.floatingOutline?.collapse();
    }

    /**
     * Toggle the outline panel
     */
    toggleOutline(): void {
        if (this.floatingOutline?.isExpanded) {
            this.closeOutline();
        } else {
            this.openOutline();
        }
    }

    /**
     * Refresh outline when tab content changes
     */
    refreshOutline(): void {
        this.floatingOutline?.refresh();
    }

    /**
     * Check if search is open
     */
    get isSearchOpen(): boolean {
        return this.searchDrawer?.isVisible ?? false;
    }

    /**
     * Check if outline is open
     */
    get isOutlineOpen(): boolean {
        return this.floatingOutline?.isExpanded ?? false;
    }

    // =========================================================================
    // NAVIGATION
    // =========================================================================

    /**
     * Navigate to next or previous menu tab
     */
    private navigateMenuTab(direction: 'next' | 'previous'): void {
        const currentTab = this.options.getCurrentTab();
        const currentIndex = TAB_ORDER.indexOf(currentTab);

        if (currentIndex === -1) return;

        let newIndex: number;
        if (direction === 'next') {
            newIndex = (currentIndex + 1) % TAB_ORDER.length;
        } else {
            newIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
        }

        const newTab = TAB_ORDER[newIndex];
        this.options.navigateToTab(newTab);
    }

    /**
     * Navigate to a specific setting
     */
    private handleNavigate(tabId: TabId, settingId: string, settingName: string): void {
        // Close search drawer first
        this.searchDrawer?.close();

        // Switch to the correct tab if needed
        if (this.options.getCurrentTab() !== tabId) {
            this.options.navigateToTab(tabId);

            // Wait for tab to render, then scroll to setting
            // Use requestAnimationFrame + timeout to ensure DOM is updated
            requestAnimationFrame(() => {
                setTimeout(() => {
                    this.scrollToSetting(settingId, settingName);
                }, 100);
            });
        } else {
            // Same tab - still use a small delay to let search drawer close
            requestAnimationFrame(() => {
                this.scrollToSetting(settingId, settingName);
            });
        }
    }

    /**
     * Scroll to and highlight a setting
     */
    private scrollToSetting(settingId: string, settingName: string): void {
        // Get the active tab content container - search only within it
        const activeTabContent = this.options.scrollContainerEl.querySelector('.amnesia-tab-content.is-active');
        const searchContainer = activeTabContent || this.options.scrollContainerEl;

        // Try multiple selectors to find the setting
        const selectors = [
            `[data-setting-id="${settingId}"]`,
            `#setting-${settingId}`,
            `[data-setting="${settingId}"]`,
        ];

        let element: HTMLElement | null = null;

        for (const selector of selectors) {
            element = searchContainer.querySelector(selector);
            if (element) break;
        }

        if (element) {
            highlightElement(element);
            return;
        }

        // Search by exact setting name first (most reliable)
        const allSettings = Array.from(searchContainer.querySelectorAll('.setting-item'));
        const settingNameLower = settingName.toLowerCase();

        // First pass: look for exact name match
        for (const setting of allSettings) {
            const nameEl = setting.querySelector('.setting-item-name');
            const name = nameEl?.textContent?.trim().toLowerCase() || '';

            if (name === settingNameLower) {
                highlightElement(setting as HTMLElement);
                return;
            }
        }

        // Second pass: look for partial name match
        for (const setting of allSettings) {
            const nameEl = setting.querySelector('.setting-item-name');
            const name = nameEl?.textContent?.trim().toLowerCase() || '';

            if (name.includes(settingNameLower) || settingNameLower.includes(name)) {
                highlightElement(setting as HTMLElement);
                return;
            }
        }

        // Fallback: fuzzy search using keywords from both id and name
        const keywords = [
            ...settingId.toLowerCase().split(/[.\-_\s]+/),
            ...settingName.toLowerCase().split(/\s+/)
        ].filter(k => k.length > 2);

        let bestMatch: HTMLElement | null = null;
        let bestScore = 0;

        for (const setting of allSettings) {
            const nameEl = setting.querySelector('.setting-item-name');
            const descEl = setting.querySelector('.setting-item-description');
            const name = nameEl?.textContent?.toLowerCase() || '';
            const desc = descEl?.textContent?.toLowerCase() || '';

            // Score based on keyword matches
            let score = 0;
            for (const keyword of keywords) {
                if (name.includes(keyword)) score += 3;
                else if (desc.includes(keyword)) score += 1;
            }

            if (score > bestScore) {
                bestScore = score;
                bestMatch = setting as HTMLElement;
            }
        }

        if (bestMatch && bestScore > 0) {
            highlightElement(bestMatch);
        }
    }

    /**
     * Handle escape key - returns true if we handled it
     */
    private handleEscape(): boolean {
        if (this.searchDrawer?.isVisible) {
            this.searchDrawer.close();
            return true;
        } else if (this.floatingOutline?.isExpanded) {
            this.floatingOutline.collapse();
            return true;
        }
        // Let the modal handle escape (close settings)
        return false;
    }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create and initialize the settings UI coordinator
 */
export function createSettingsUI(options: SettingsUICoordinatorOptions): SettingsUICoordinator {
    const coordinator = new SettingsUICoordinator(options);
    coordinator.initialize();
    return coordinator;
}
