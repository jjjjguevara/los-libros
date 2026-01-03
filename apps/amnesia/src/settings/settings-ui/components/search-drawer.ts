/**
 * Search Drawer Component
 *
 * A drawer-based search interface for settings discovery.
 * Triggered by Cmd+F or clicking the search button.
 * Ported from doc-doctor plugin.
 */

import { setIcon } from 'obsidian';
import { getSettingsIndex, type SearchResult, type TabId } from '../settings-search-index';

// =============================================================================
// TYPES
// =============================================================================

export interface SearchDrawerOptions {
    containerEl: HTMLElement;
    onNavigate: (tabId: TabId, settingId: string, settingName: string) => void;
    onClose: () => void;
}

// =============================================================================
// TAB LABELS AND ICONS
// =============================================================================

const TAB_INFO: Record<TabId, { label: string; icon: string }> = {
    library: { label: 'Library', icon: 'library' },
    reading: { label: 'Reading', icon: 'book-open' },
    sync: { label: 'Sync', icon: 'refresh-cw' },
    notes: { label: 'Notes', icon: 'file-text' },
    advanced: { label: 'Advanced', icon: 'settings' },
};

// =============================================================================
// SEARCH DRAWER CLASS
// =============================================================================

export class SearchDrawer {
    private containerEl: HTMLElement;
    private drawerEl: HTMLElement | null = null;
    private inputEl: HTMLInputElement | null = null;
    private resultsEl: HTMLElement | null = null;
    private onNavigate: (tabId: TabId, settingId: string, settingName: string) => void;
    private onClose: () => void;
    private isOpen = false;
    private searchTimeout: NodeJS.Timeout | null = null;

    constructor(options: SearchDrawerOptions) {
        this.containerEl = options.containerEl;
        this.onNavigate = options.onNavigate;
        this.onClose = options.onClose;
    }

    /**
     * Open the search drawer
     * @param initialQuery Optional initial search query to populate
     */
    open(initialQuery?: string): void {
        if (this.isOpen) {
            this.inputEl?.focus();
            return;
        }

        this.isOpen = true;
        this.render();

        // Set initial query if provided
        if (initialQuery && this.inputEl) {
            this.inputEl.value = initialQuery;
            this.performSearch(initialQuery);
        }

        this.inputEl?.focus();
    }

    /**
     * Close the search drawer
     */
    close(): void {
        if (!this.isOpen) return;

        this.isOpen = false;
        this.removeClickAwayHandler();
        this.drawerEl?.remove();
        this.drawerEl = null;
        this.inputEl = null;
        this.resultsEl = null;
        this.onClose();
    }

    /**
     * Toggle the search drawer
     */
    toggle(): void {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Check if drawer is open
     */
    get isVisible(): boolean {
        return this.isOpen;
    }

    /**
     * Render the search drawer
     */
    private render(): void {
        // Create drawer container
        this.drawerEl = document.createElement('div');
        this.drawerEl.className = 'amnesia-search-drawer';
        this.drawerEl.setAttribute('role', 'search');

        // Simple search header - matches Obsidian's native search style
        const header = this.drawerEl.createEl('div', { cls: 'amnesia-search-header' });

        // Search icon
        const searchIcon = header.createEl('span', { cls: 'amnesia-search-icon' });
        setIcon(searchIcon, 'search');

        // Search input - simple text field
        this.inputEl = header.createEl('input', {
            cls: 'amnesia-search-input',
            attr: {
                type: 'text',
                placeholder: 'Search settings...',
                'aria-label': 'Search settings',
            },
        });

        // Simple text close button (x) - clickable placeholder style
        const closeBtn = header.createEl('span', {
            cls: 'amnesia-search-close',
            text: '×',
            attr: { 'aria-label': 'Close search', role: 'button', tabindex: '0' },
        });
        closeBtn.addEventListener('click', () => this.close());
        closeBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.close();
            }
        });

        // Results container
        this.resultsEl = this.drawerEl.createEl('div', { cls: 'amnesia-search-results' });

        // Initial empty state
        this.showEmptyState();

        // Event listeners
        this.inputEl.addEventListener('input', () => this.handleInput());
        this.inputEl.addEventListener('keydown', (e) => this.handleKeydown(e));

        // CRITICAL: Add capture phase escape handler on the drawer itself
        // This fires before Obsidian's modal handler can close the modal
        this.drawerEl.addEventListener(
            'keydown',
            (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    this.close();
                }
            },
            true // capture phase
        );

        // Insert at top of container
        this.containerEl.insertBefore(this.drawerEl, this.containerEl.firstChild);

        // Click-away handler to close drawer
        this.setupClickAwayHandler();

        // Add styles
        this.addStyles();
    }

    private clickAwayHandler: ((e: MouseEvent) => void) | null = null;

    /**
     * Setup click-away handler to close drawer when clicking outside
     */
    private setupClickAwayHandler(): void {
        this.clickAwayHandler = (e: MouseEvent) => {
            if (!this.isOpen || !this.drawerEl) return;

            const target = e.target as HTMLElement;
            // Don't close if clicking inside the drawer or on the search FAB button
            if (this.drawerEl.contains(target) || target.closest('.amnesia-fab-search')) {
                return;
            }

            this.close();
        };

        // Use setTimeout to avoid closing immediately from the click that opened it
        setTimeout(() => {
            document.addEventListener('click', this.clickAwayHandler!, true);
        }, 100);
    }

    /**
     * Remove click-away handler
     */
    private removeClickAwayHandler(): void {
        if (this.clickAwayHandler) {
            document.removeEventListener('click', this.clickAwayHandler, true);
            this.clickAwayHandler = null;
        }
    }

    /**
     * Handle input changes with debounce
     */
    private handleInput(): void {
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }

        this.searchTimeout = setTimeout(() => {
            const query = this.inputEl?.value.trim() || '';
            this.performSearch(query);
        }, 150);
    }

    /**
     * Handle keyboard navigation
     */
    private handleKeydown(e: KeyboardEvent): void {
        switch (e.key) {
            case 'Escape':
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation(); // Prevent modal from closing
                this.close();
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.focusNextResult();
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.focusPreviousResult();
                break;
            case 'Tab':
                // Tab and Shift+Tab for result navigation
                e.preventDefault();
                if (e.shiftKey) {
                    this.focusPreviousResult();
                } else {
                    this.focusNextResult();
                }
                break;
            case 'Enter':
                e.preventDefault();
                this.selectFocusedResult();
                break;
        }
    }

    /**
     * Perform the search
     */
    private performSearch(query: string): void {
        if (!this.resultsEl) return;

        if (!query || query.length < 2) {
            this.showEmptyState();
            return;
        }

        const index = getSettingsIndex();
        const results = index.search(query, { limit: 20 });

        if (results.length === 0) {
            this.showNoResults(query);
            return;
        }

        this.renderResults(results, query);
    }

    /**
     * Show empty state
     */
    private showEmptyState(): void {
        if (!this.resultsEl) return;

        this.resultsEl.empty();
        const emptyEl = this.resultsEl.createEl('div', { cls: 'amnesia-search-empty' });
        emptyEl.createEl('p', { text: 'Type to search settings...' });
        emptyEl.createEl('p', {
            text: 'Search by name, description, or keywords',
            cls: 'amnesia-search-hint',
        });
    }

    /**
     * Show no results state
     */
    private showNoResults(query: string): void {
        if (!this.resultsEl) return;

        this.resultsEl.empty();
        const noResults = this.resultsEl.createEl('div', { cls: 'amnesia-search-no-results' });
        noResults.createEl('p', { text: `No settings found for "${query}"` });
        noResults.createEl('p', {
            text: 'Try different keywords or browse tabs',
            cls: 'amnesia-search-hint',
        });
    }

    /**
     * Render search results grouped by tab
     */
    private renderResults(results: SearchResult[], query: string): void {
        if (!this.resultsEl) return;

        this.resultsEl.empty();

        // Group results by tab
        const grouped = new Map<TabId, SearchResult[]>();
        for (const result of results) {
            const tab = result.entry.tab;
            if (!grouped.has(tab)) {
                grouped.set(tab, []);
            }
            grouped.get(tab)!.push(result);
        }

        // Header with result count
        const headerEl = this.resultsEl.createEl('div', { cls: 'amnesia-search-results-header' });
        headerEl.createEl('span', { text: `"${query}"` });
        headerEl.createEl('span', {
            text: `${results.length} result${results.length !== 1 ? 's' : ''}`,
            cls: 'amnesia-search-count',
        });

        // Render each group
        for (const [tabId, tabResults] of grouped) {
            this.renderTabGroup(tabId, tabResults);
        }
    }

    /**
     * Render a tab group
     */
    private renderTabGroup(tabId: TabId, results: SearchResult[]): void {
        if (!this.resultsEl) return;

        const tabInfo = TAB_INFO[tabId];
        const groupEl = this.resultsEl.createEl('div', { cls: 'amnesia-search-group' });

        // Group header
        const groupHeader = groupEl.createEl('div', { cls: 'amnesia-search-group-header' });
        const iconEl = groupHeader.createEl('span', { cls: 'amnesia-search-group-icon' });
        setIcon(iconEl, tabInfo.icon);
        groupHeader.createEl('span', { text: tabInfo.label });
        groupHeader.createEl('span', {
            text: `(${results.length})`,
            cls: 'amnesia-search-group-count',
        });

        // Results list
        const listEl = groupEl.createEl('div', { cls: 'amnesia-search-group-list' });

        for (const result of results) {
            this.renderResultItem(listEl, result, tabId);
        }
    }

    /**
     * Render a single result item
     */
    private renderResultItem(containerEl: HTMLElement, result: SearchResult, tabId: TabId): void {
        const entry = result.entry;
        // Use div instead of button for simple list appearance
        const itemEl = containerEl.createEl('div', {
            cls: 'amnesia-search-result-item',
            attr: {
                'data-setting-id': entry.id,
                'data-tab-id': tabId,
                tabindex: '0',
                role: 'button',
            },
        });

        // Breadcrumb path
        const pathEl = itemEl.createEl('div', { cls: 'amnesia-search-result-path' });
        pathEl.createEl('span', { text: entry.section });
        if (entry.subsection) {
            pathEl.createEl('span', { text: ' › ', cls: 'amnesia-path-separator' });
            pathEl.createEl('span', { text: entry.subsection });
        }
        if (entry.isAdvanced) {
            pathEl.createEl('span', { text: ' (Advanced)', cls: 'amnesia-advanced-badge' });
        }

        // Setting name
        itemEl.createEl('div', { text: entry.name, cls: 'amnesia-search-result-name' });

        // Description
        itemEl.createEl('div', {
            text: entry.description,
            cls: 'amnesia-search-result-desc',
        });

        // Click handler
        itemEl.addEventListener('click', () => {
            this.onNavigate(tabId, entry.id, entry.name);
            this.close();
        });

        // Keyboard handler for result items
        itemEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.onNavigate(tabId, entry.id, entry.name);
                this.close();
            } else if (e.key === 'Tab') {
                // Tab/Shift+Tab navigation between results
                e.preventDefault();
                if (e.shiftKey) {
                    this.focusPreviousResult();
                } else {
                    this.focusNextResult();
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.focusNextResult();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.focusPreviousResult();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.close();
            }
        });
    }

    /**
     * Focus next result item
     */
    private focusNextResult(): void {
        const items = this.resultsEl?.querySelectorAll('.amnesia-search-result-item');
        if (!items || items.length === 0) return;

        const focused = document.activeElement;
        const currentIndex = Array.from(items).indexOf(focused as HTMLElement);

        if (currentIndex === -1 || currentIndex === items.length - 1) {
            (items[0] as HTMLElement).focus();
        } else {
            (items[currentIndex + 1] as HTMLElement).focus();
        }
    }

    /**
     * Focus previous result item
     */
    private focusPreviousResult(): void {
        const items = this.resultsEl?.querySelectorAll('.amnesia-search-result-item');
        if (!items || items.length === 0) return;

        const focused = document.activeElement;
        const currentIndex = Array.from(items).indexOf(focused as HTMLElement);

        if (currentIndex === -1 || currentIndex === 0) {
            (items[items.length - 1] as HTMLElement).focus();
        } else {
            (items[currentIndex - 1] as HTMLElement).focus();
        }
    }

    /**
     * Select the currently focused result
     */
    private selectFocusedResult(): void {
        const focused = document.activeElement;
        if (focused?.classList.contains('amnesia-search-result-item')) {
            (focused as HTMLElement).click();
        }
    }

    /**
     * Add component styles
     */
    private addStyles(): void {
        const styleId = 'amnesia-search-drawer-styles';
        // Remove existing styles to ensure updates take effect
        const existing = document.getElementById(styleId);
        if (existing) existing.remove();

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            /* Search Drawer Container */
            .amnesia-search-drawer {
                position: sticky;
                top: 0;
                z-index: 100;
                background: var(--background-primary);
                border-bottom: 1px solid var(--background-modifier-border);
                padding: 12px 16px;
                margin: -20px -20px 16px -20px;
                animation: amnesia-slide-down 0.2s ease-out;
            }

            @keyframes amnesia-slide-down {
                from {
                    opacity: 0;
                    transform: translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            /* Search Header - Simple line style matching Obsidian */
            .amnesia-search-header {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 4px 0;
                border-bottom: 1px solid var(--background-modifier-border);
            }

            .amnesia-search-icon {
                color: var(--text-muted);
                flex-shrink: 0;
            }

            .amnesia-search-icon svg {
                width: 16px;
                height: 16px;
            }

            .amnesia-search-input {
                flex: 1;
                background: transparent;
                border: none;
                outline: none;
                font-size: 14px;
                color: var(--text-normal);
                padding: 4px 0;
            }

            .amnesia-search-input::placeholder {
                color: var(--text-muted);
            }

            /* Simple text close button */
            .amnesia-search-close {
                cursor: pointer;
                color: var(--text-muted);
                font-size: 18px;
                line-height: 1;
                padding: 2px 6px;
                border-radius: 4px;
                transition: color 0.15s ease, background 0.15s ease;
            }

            .amnesia-search-close:hover {
                color: var(--text-normal);
                background: var(--background-modifier-hover);
            }

            /* Search Results */
            .amnesia-search-results {
                max-height: 400px;
                overflow-y: auto;
                margin-top: 12px;
                background: var(--background-primary);
                padding: 8px 0;
            }

            .amnesia-search-results-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 0;
                margin-bottom: 8px;
                border-bottom: 1px solid var(--background-modifier-border);
                font-size: 13px;
            }

            .amnesia-search-count {
                color: var(--text-muted);
            }

            /* Empty and No Results States */
            .amnesia-search-empty,
            .amnesia-search-no-results {
                text-align: center;
                padding: 24px 16px;
                color: var(--text-muted);
            }

            .amnesia-search-empty p:first-child,
            .amnesia-search-no-results p:first-child {
                font-size: 14px;
                margin-bottom: 4px;
            }

            .amnesia-search-hint {
                font-size: 12px;
                opacity: 0.7;
            }

            /* Result Groups */
            .amnesia-search-group {
                margin-bottom: 16px;
            }

            .amnesia-search-group-header {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                background: var(--background-secondary);
                border-radius: 6px;
                margin-bottom: 8px;
                font-weight: 500;
                font-size: 13px;
            }

            .amnesia-search-group-icon {
                color: var(--interactive-accent);
            }

            .amnesia-search-group-icon svg {
                width: 16px;
                height: 16px;
            }

            .amnesia-search-group-count {
                color: var(--text-muted);
                font-weight: normal;
                margin-left: auto;
            }

            .amnesia-search-group-list {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            /* Result Items - simple list style */
            .amnesia-search-result-item {
                display: block;
                width: 100%;
                text-align: left;
                padding: 8px 12px;
                background: none;
                border: none;
                border-radius: 0;
                cursor: pointer;
                transition: background 0.15s ease;
            }

            .amnesia-search-result-item:hover,
            .amnesia-search-result-item:focus {
                background: var(--background-secondary-alt);
                outline: none;
            }

            .amnesia-search-result-item:focus {
                background: var(--background-secondary);
            }

            .amnesia-search-result-path {
                font-size: 11px;
                color: var(--text-muted);
                margin-bottom: 4px;
            }

            .amnesia-path-separator {
                opacity: 0.5;
            }

            .amnesia-advanced-badge {
                background: var(--background-modifier-border);
                padding: 1px 6px;
                border-radius: 10px;
                font-size: 10px;
                margin-left: 4px;
            }

            .amnesia-search-result-name {
                font-weight: 500;
                font-size: 14px;
                color: var(--text-normal);
                margin-bottom: 2px;
            }

            .amnesia-search-result-desc {
                font-size: 12px;
                color: var(--text-muted);
                line-height: 1.4;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Destroy the search drawer
     */
    destroy(): void {
        this.close();
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }
    }
}
