/**
 * Floating Outline Navigator Component
 *
 * A FAB (Floating Action Button) with an expandable outline panel
 * for navigating settings sections within the current tab.
 * Ported from doc-doctor plugin.
 */

import { setIcon } from 'obsidian';
import type { TabId } from '../settings-search-index';

// =============================================================================
// TYPES
// =============================================================================

export interface OutlineItem {
    id: string;
    label: string;
    level: 1 | 2 | 3; // h2 = 1, h3 = 2, h4 = 3
    isAdvanced: boolean;
    element: HTMLElement; // DOM reference for scroll target
    children?: OutlineItem[];
}

export interface FloatingOutlineOptions {
    containerEl: HTMLElement;
    scrollContainerEl: HTMLElement;
    onSearchClick: (query?: string) => void;
    getCurrentTab: () => TabId;
}

interface OutlineState {
    items: OutlineItem[];
    activeItemId: string | null;
    isExpanded: boolean;
}

// =============================================================================
// TAB INFO
// =============================================================================

const TAB_INFO: Record<TabId, { label: string; icon: string }> = {
    library: { label: 'Library', icon: 'library' },
    reading: { label: 'Reading', icon: 'book-open' },
    pdf: { label: 'PDF', icon: 'file-type' },
    sync: { label: 'Sync', icon: 'refresh-cw' },
    notes: { label: 'Notes', icon: 'file-text' },
    advanced: { label: 'Advanced', icon: 'settings' },
};

// =============================================================================
// FLOATING OUTLINE CLASS
// =============================================================================

export class FloatingOutline {
    private containerEl: HTMLElement;
    private scrollContainerEl: HTMLElement;
    private fabEl: HTMLElement | null = null;
    private panelEl: HTMLElement | null = null;
    private onSearchClick: (query?: string) => void;
    private getCurrentTab: () => TabId;

    private state: OutlineState = {
        items: [],
        activeItemId: null,
        isExpanded: false,
    };

    private scrollHandler: (() => void) | null = null;
    private resizeObserver: ResizeObserver | null = null;

    constructor(options: FloatingOutlineOptions) {
        this.containerEl = options.containerEl;
        this.scrollContainerEl = options.scrollContainerEl;
        this.onSearchClick = options.onSearchClick;
        this.getCurrentTab = options.getCurrentTab;
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Initialize and render the floating outline
     */
    initialize(): void {
        this.render();
        this.setupScrollSpy();
        this.addStyles();
    }

    /**
     * Refresh the outline when tab content changes
     */
    refresh(): void {
        this.scanForSections();
        this.updatePanelContent();
        this.updateActiveItem();
    }

    /**
     * Toggle the outline panel
     */
    toggle(): void {
        if (this.state.isExpanded) {
            this.collapse();
        } else {
            this.expand();
        }
    }

    /**
     * Expand the outline panel
     */
    expand(): void {
        if (!this.state.isExpanded) {
            this.state.isExpanded = true;
            this.updatePanelVisibility();
            this.setupClickAwayHandler();
        }
    }

    /**
     * Collapse the outline panel
     */
    collapse(): void {
        if (this.state.isExpanded) {
            this.state.isExpanded = false;
            this.removeClickAwayHandler();
            this.updatePanelVisibility();
        }
    }

    private clickAwayHandler: ((e: MouseEvent) => void) | null = null;

    /**
     * Setup click-away handler to close panel when clicking outside
     */
    private setupClickAwayHandler(): void {
        this.clickAwayHandler = (e: MouseEvent) => {
            if (!this.state.isExpanded || !this.panelEl || !this.fabEl) return;

            const target = e.target as HTMLElement;
            // Don't close if clicking inside the panel or on the FAB
            if (this.panelEl.contains(target) || this.fabEl.contains(target)) {
                return;
            }

            this.collapse();
        };

        // Use setTimeout to avoid closing immediately from the click that opened it
        setTimeout(() => {
            if (this.clickAwayHandler) {
                document.addEventListener('click', this.clickAwayHandler, true);
            }
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
     * Check if panel is expanded
     */
    get isExpanded(): boolean {
        return this.state.isExpanded;
    }

    /**
     * Destroy the component
     */
    destroy(): void {
        this.removeClickAwayHandler();
        if (this.scrollHandler) {
            this.scrollContainerEl.removeEventListener('scroll', this.scrollHandler);
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        this.fabEl?.remove();
        this.panelEl?.remove();
    }

    // =========================================================================
    // RENDERING
    // =========================================================================

    private render(): void {
        this.renderFAB();
        this.renderPanel();
        this.scanForSections();
        this.updatePanelContent();
    }

    private renderFAB(): void {
        this.fabEl = document.createElement('div');
        this.fabEl.className = 'amnesia-floating-fab';
        this.fabEl.setAttribute('role', 'toolbar');
        this.fabEl.setAttribute('aria-label', 'Settings navigation');

        // Search button
        const searchBtn = this.fabEl.createEl('button', {
            cls: 'amnesia-fab-button amnesia-fab-search',
            attr: {
                'aria-label': 'Search settings (Cmd+F)',
                title: 'Search settings (⌘F)',
            },
        });
        setIcon(searchBtn, 'search');
        searchBtn.addEventListener('click', () => this.onSearchClick());

        // Outline toggle button
        const outlineBtn = this.fabEl.createEl('button', {
            cls: 'amnesia-fab-button amnesia-fab-outline',
            attr: {
                'aria-label': 'Toggle outline (Cmd+.)',
                title: 'Toggle outline (⌘.)',
                'aria-expanded': 'false',
            },
        });
        setIcon(outlineBtn, 'list');
        outlineBtn.addEventListener('click', () => this.toggle());

        // Append FAB to modal element (not scrolling container) for proper fixed positioning
        const modalEl = this.containerEl.closest('.modal') || this.containerEl;
        modalEl.appendChild(this.fabEl);
    }

    private renderPanel(): void {
        this.panelEl = document.createElement('div');
        this.panelEl.className = 'amnesia-outline-panel';
        this.panelEl.setAttribute('role', 'navigation');
        this.panelEl.setAttribute('aria-label', 'Settings outline');
        this.panelEl.hidden = true;

        // CRITICAL: Add capture phase escape handler to close panel before modal
        this.panelEl.addEventListener(
            'keydown',
            (e) => {
                if (e.key === 'Escape' && this.state.isExpanded) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    this.collapse();
                }
            },
            true // capture phase
        );

        // Append panel to modal element (not scrolling container) for proper fixed positioning
        const modalEl = this.containerEl.closest('.modal') || this.containerEl;
        modalEl.appendChild(this.panelEl);
    }

    private updatePanelContent(): void {
        if (!this.panelEl) return;

        this.panelEl.innerHTML = '';

        const currentTab = this.getCurrentTab();
        const tabInfo = TAB_INFO[currentTab];

        // Header - clickable to scroll to top of tab content
        const header = this.panelEl.createEl('div', {
            cls: 'amnesia-outline-header',
            attr: {
                role: 'button',
                tabindex: '0',
                title: 'Scroll to top',
            }
        });
        const headerIcon = header.createEl('span', { cls: 'amnesia-outline-header-icon' });
        setIcon(headerIcon, tabInfo.icon);
        header.createEl('span', { text: tabInfo.label, cls: 'amnesia-outline-header-title' });

        // Click header to scroll to top
        header.addEventListener('click', () => this.scrollToTop());
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.scrollToTop();
            }
        });

        // Items list
        const listEl = this.panelEl.createEl('div', { cls: 'amnesia-outline-list' });

        if (this.state.items.length === 0) {
            listEl.createEl('div', {
                text: 'No sections found',
                cls: 'amnesia-outline-empty',
            });
        } else {
            this.renderOutlineItems(listEl, this.state.items);
        }

        // Footer with inline search - simple line with icon
        const footer = this.panelEl.createEl('div', { cls: 'amnesia-outline-footer' });
        const searchIcon = footer.createEl('span', { cls: 'amnesia-outline-search-icon' });
        setIcon(searchIcon, 'search');
        const searchInput = footer.createEl('input', {
            cls: 'amnesia-outline-search-input',
            attr: {
                type: 'text',
                placeholder: 'Filter...',
                'aria-label': 'Filter sections',
            },
        });

        // Auto-filter headings as user types
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.trim().toLowerCase();
            this.filterOutlineItems(listEl, query);
        });

        // Handle keyboard navigation
        searchInput.addEventListener('keydown', (e) => {
            e.stopPropagation(); // Prevent outline from scrolling

            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (searchInput.value) {
                    searchInput.value = '';
                    this.filterOutlineItems(listEl, '');
                } else {
                    searchInput.blur();
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                // Navigate to first visible item
                const firstVisible = listEl.querySelector('.amnesia-outline-item:not(.amnesia-outline-hidden)') as HTMLElement;
                if (firstVisible) {
                    firstVisible.click();
                }
            }
        });
    }

    /**
     * Filter outline items based on search query
     */
    private filterOutlineItems(listEl: HTMLElement, query: string): void {
        const items = listEl.querySelectorAll('.amnesia-outline-item');
        items.forEach((item) => {
            const label = item.querySelector('.amnesia-outline-label')?.textContent?.toLowerCase() || '';
            const matches = !query || label.includes(query);
            item.classList.toggle('amnesia-outline-hidden', !matches);
        });
    }

    private renderOutlineItems(containerEl: HTMLElement, items: OutlineItem[]): void {
        for (const item of items) {
            // Use div instead of button for simple list appearance
            const itemEl = containerEl.createEl('div', {
                cls: `amnesia-outline-item amnesia-outline-level-${item.level}`,
                attr: {
                    'data-item-id': item.id,
                    'aria-current': item.id === this.state.activeItemId ? 'true' : 'false',
                    role: 'button',
                    tabindex: '0',
                },
            });

            // Label (no indicator line for cleaner appearance)
            itemEl.createEl('span', { text: item.label, cls: 'amnesia-outline-label' });

            // Advanced badge
            if (item.isAdvanced) {
                const badge = itemEl.createEl('span', { cls: 'amnesia-outline-advanced-badge' });
                setIcon(badge, 'flask-conical');
            }

            // Click handler
            itemEl.addEventListener('click', () => this.navigateToItem(item));

            // Keyboard handler for accessibility
            itemEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.navigateToItem(item);
                }
            });

            // Render children recursively
            if (item.children && item.children.length > 0) {
                this.renderOutlineItems(containerEl, item.children);
            }
        }
    }

    private updatePanelVisibility(): void {
        if (!this.panelEl || !this.fabEl) return;

        const outlineBtn = this.fabEl.querySelector('.amnesia-fab-outline');

        if (this.state.isExpanded) {
            this.panelEl.hidden = false;
            this.panelEl.classList.add('amnesia-outline-panel-visible');
            outlineBtn?.setAttribute('aria-expanded', 'true');
            outlineBtn?.classList.add('amnesia-fab-button-active');
        } else {
            this.panelEl.classList.remove('amnesia-outline-panel-visible');
            outlineBtn?.setAttribute('aria-expanded', 'false');
            outlineBtn?.classList.remove('amnesia-fab-button-active');

            // Hide after animation
            setTimeout(() => {
                if (!this.state.isExpanded && this.panelEl) {
                    this.panelEl.hidden = true;
                }
            }, 200);
        }
    }

    // =========================================================================
    // SECTION SCANNING
    // =========================================================================

    private scanForSections(): void {
        const items: OutlineItem[] = [];

        // IMPORTANT: Only scan the ACTIVE tab content, not all tabs
        const activeContent = this.scrollContainerEl.querySelector('.amnesia-tab-content.is-active');
        const searchContainer = activeContent || this.scrollContainerEl;

        // First, try to find elements with data-section-id within the active tab
        const sections = searchContainer.querySelectorAll('[data-section-id]');

        if (sections.length > 0) {
            sections.forEach((section) => {
                const id = section.getAttribute('data-section-id') || '';
                const labelEl = section.querySelector('.setting-item-heading, h2, h3, .amnesia-section-title, .amnesia-accordion-title');
                const label = labelEl?.textContent?.trim() || id;
                const level = this.determineLevel(section as HTMLElement);
                const isAdvanced = section.classList.contains('amnesia-advanced-section') ||
                    section.closest('.amnesia-advanced-accordion') !== null;

                items.push({
                    id,
                    label,
                    level,
                    isAdvanced,
                    element: section as HTMLElement,
                });
            });
        } else {
            // Fall back to heading-based scanning within the active tab
            // Priority order: .setting-item-heading (Obsidian standard), then h2/h3
            const headings = searchContainer.querySelectorAll('.setting-item-heading, h2, h3');

            headings.forEach((heading, index) => {
                // Skip if it's inside a setting-item (not a section header)
                const parentSettingItem = heading.closest('.setting-item');
                if (parentSettingItem && !heading.classList.contains('setting-item-heading')) {
                    return;
                }

                const id = `section-${index}`;
                const label = heading.textContent?.trim() || `Section ${index + 1}`;

                // Skip empty labels
                if (!label || label.length === 0) return;

                const level = this.determineHeadingLevel(heading as HTMLElement);
                const isAdvanced = heading.closest('.amnesia-advanced-accordion') !== null;

                items.push({
                    id,
                    label,
                    level,
                    isAdvanced,
                    element: heading as HTMLElement,
                });
            });
        }

        this.state.items = items;
    }

    private determineLevel(element: HTMLElement): 1 | 2 | 3 {
        const level = element.getAttribute('data-section-level');
        if (level === '2') return 2;
        if (level === '3') return 3;
        return 1;
    }

    private determineHeadingLevel(element: HTMLElement): 1 | 2 | 3 {
        if (element.tagName === 'H2') return 1;
        if (element.tagName === 'H3') return 2;
        if (element.classList.contains('setting-item-heading')) return 1;
        return 2;
    }

    // =========================================================================
    // SCROLL SPY
    // =========================================================================

    private setupScrollSpy(): void {
        let ticking = false;

        this.scrollHandler = () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    this.updateActiveItem();
                    ticking = false;
                });
                ticking = true;
            }
        };

        this.scrollContainerEl.addEventListener('scroll', this.scrollHandler, { passive: true });

        // Also refresh on resize
        this.resizeObserver = new ResizeObserver(() => {
            this.updateActiveItem();
        });
        this.resizeObserver.observe(this.scrollContainerEl);
    }

    private updateActiveItem(): void {
        if (this.state.items.length === 0) return;

        const scrollTop = this.scrollContainerEl.scrollTop;
        const containerRect = this.scrollContainerEl.getBoundingClientRect();
        const threshold = containerRect.top + 100; // Offset from top

        let activeItem: OutlineItem | null = null;

        // Find the item that's currently in view
        for (const item of this.state.items) {
            const rect = item.element.getBoundingClientRect();
            if (rect.top <= threshold) {
                activeItem = item;
            } else {
                break;
            }
        }

        // Default to first item if none found
        if (!activeItem && this.state.items.length > 0) {
            activeItem = this.state.items[0];
        }

        if (activeItem && activeItem.id !== this.state.activeItemId) {
            this.state.activeItemId = activeItem.id;
            this.updateActiveHighlight();
        }
    }

    private updateActiveHighlight(): void {
        if (!this.panelEl) return;

        // Remove all active states
        this.panelEl.querySelectorAll('.amnesia-outline-item').forEach((item) => {
            item.setAttribute('aria-current', 'false');
            item.querySelector('.amnesia-outline-indicator')?.classList.remove('amnesia-outline-indicator-active');
        });

        // Add active state to current item
        const activeEl = this.panelEl.querySelector(`[data-item-id="${this.state.activeItemId}"]`);
        if (activeEl) {
            activeEl.setAttribute('aria-current', 'true');
            activeEl.querySelector('.amnesia-outline-indicator')?.classList.add('amnesia-outline-indicator-active');
        }
    }

    // =========================================================================
    // NAVIGATION
    // =========================================================================

    private navigateToItem(item: OutlineItem): void {
        // Smooth scroll to element
        item.element.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
        });

        // Update active state immediately for better UX
        this.state.activeItemId = item.id;
        this.updateActiveHighlight();

        // Collapse panel on mobile
        if (window.innerWidth < 768) {
            this.collapse();
        }
    }

    /**
     * Scroll to the top of the current tab content (H1/header)
     */
    private scrollToTop(): void {
        // Find the active tab content and scroll to its top
        const activeContent = this.scrollContainerEl.querySelector('.amnesia-tab-content.is-active');
        if (activeContent) {
            // Find the first heading (context card or tab header)
            const firstHeading = activeContent.querySelector('.amnesia-context-card, .amnesia-compound-header, h2');
            if (firstHeading) {
                firstHeading.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                });
            } else {
                // Fallback: scroll the container to top
                this.scrollContainerEl.scrollTo({
                    top: 0,
                    behavior: 'smooth',
                });
            }
        } else {
            // Fallback: scroll the container to top
            this.scrollContainerEl.scrollTo({
                top: 0,
                behavior: 'smooth',
            });
        }

        // Clear active item since we're at the top
        this.state.activeItemId = null;
        this.updateActiveHighlight();
    }

    // =========================================================================
    // STYLES
    // =========================================================================

    private addStyles(): void {
        const styleId = 'amnesia-floating-outline-styles';
        // Remove existing styles to ensure updates take effect
        const existing = document.getElementById(styleId);
        if (existing) existing.remove();

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            /* =================================================================
               FLOATING ACTION BUTTON (FAB)
               Position absolute within the modal (which has position: relative)
               ================================================================= */
            .amnesia-floating-fab {
                position: absolute;
                bottom: 24px;
                right: 24px;
                display: flex;
                gap: 8px;
                z-index: 1000;
                animation: amnesia-fab-enter 0.3s ease-out;
            }

            @keyframes amnesia-fab-enter {
                from {
                    opacity: 0;
                    transform: translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            .amnesia-fab-button {
                width: 44px;
                height: 44px;
                border-radius: 50%;
                border: none;
                background: var(--interactive-accent);
                color: var(--text-on-accent);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
                transition: all 0.2s ease;
            }

            .amnesia-fab-button:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
            }

            .amnesia-fab-button:active {
                transform: translateY(0);
            }

            .amnesia-fab-button svg {
                width: 20px;
                height: 20px;
            }

            .amnesia-fab-button-active {
                background: var(--interactive-accent-hover);
            }

            /* Search button variant */
            .amnesia-fab-search {
                background: var(--background-secondary);
                color: var(--text-normal);
                border: 1px solid var(--background-modifier-border);
            }

            .amnesia-fab-search:hover {
                background: var(--background-modifier-hover);
            }

            /* =================================================================
               OUTLINE PANEL
               Position absolute within the modal (which has position: relative)
               ================================================================= */
            .amnesia-outline-panel {
                position: absolute;
                bottom: 80px;
                right: 24px;
                width: 240px;
                max-height: 400px;
                background: var(--background-primary);
                border: 1px solid var(--background-modifier-border);
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                overflow: hidden;
                z-index: 999;
                opacity: 0;
                transform: translateY(10px) scale(0.95);
                transition: all 0.2s ease;
            }

            .amnesia-outline-panel-visible {
                opacity: 1;
                transform: translateY(0) scale(1);
            }

            /* Header - clickable to scroll to top */
            .amnesia-outline-header {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 12px 16px;
                background: var(--background-secondary);
                border-bottom: 1px solid var(--background-modifier-border);
                cursor: pointer;
                transition: background-color 0.15s ease;
            }

            .amnesia-outline-header:hover {
                background: var(--background-modifier-hover);
            }

            .amnesia-outline-header:focus {
                outline: none;
            }

            .amnesia-outline-header-icon {
                color: var(--interactive-accent);
            }

            .amnesia-outline-header-icon svg {
                width: 18px;
                height: 18px;
            }

            .amnesia-outline-header-title {
                font-weight: 600;
                font-size: 14px;
                flex: 1;
            }

            .amnesia-outline-close {
                background: transparent;
                border: none;
                cursor: pointer;
                padding: 4px;
                border-radius: 4px;
                color: var(--text-muted);
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .amnesia-outline-close:hover {
                background: var(--background-modifier-hover);
                color: var(--text-normal);
            }

            .amnesia-outline-close svg {
                width: 16px;
                height: 16px;
            }

            /* Items list - simple line-separated list */
            .amnesia-outline-list {
                max-height: 280px;
                overflow-y: auto;
                padding: 0;
            }

            .amnesia-outline-empty {
                padding: 24px 16px;
                text-align: center;
                color: var(--text-muted);
                font-size: 13px;
            }

            /* Simple list items - no button styling */
            .amnesia-outline-item {
                display: flex;
                align-items: center;
                gap: 8px;
                width: 100%;
                padding: 8px 16px;
                background: none;
                border: none;
                border-radius: 0;
                box-shadow: none;
                cursor: pointer;
                text-align: left;
                font-size: 13px;
                color: var(--text-muted);
                transition: color 0.15s ease, background 0.15s ease;
            }

            .amnesia-outline-item:hover {
                background: var(--background-secondary-alt);
                color: var(--text-normal);
            }

            .amnesia-outline-item[aria-current="true"] {
                color: var(--interactive-accent);
                font-weight: 500;
            }

            /* Level indentation */
            .amnesia-outline-level-1 {
                padding-left: 16px;
            }

            .amnesia-outline-level-2 {
                padding-left: 28px;
                font-size: 12px;
            }

            .amnesia-outline-level-3 {
                padding-left: 40px;
                font-size: 12px;
            }

            .amnesia-outline-label {
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            /* Advanced badge */
            .amnesia-outline-advanced-badge {
                color: var(--text-faint);
                opacity: 0.6;
            }

            .amnesia-outline-advanced-badge svg {
                width: 12px;
                height: 12px;
            }

            /* Hidden items during filtering */
            .amnesia-outline-hidden {
                display: none;
            }

            /* Footer with inline search - simple line */
            .amnesia-outline-footer {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                border-top: 1px solid var(--background-modifier-border);
            }

            .amnesia-outline-search-icon {
                color: var(--text-faint);
                flex-shrink: 0;
            }

            .amnesia-outline-search-icon svg {
                width: 14px;
                height: 14px;
            }

            .amnesia-outline-search-input {
                flex: 1;
                background: none;
                border: none;
                outline: none;
                font-size: 12px;
                color: var(--text-normal);
                padding: 0;
                min-width: 0;
            }

            .amnesia-outline-search-input::placeholder {
                color: var(--text-faint);
                font-size: 12px;
            }

            /* =================================================================
               RESPONSIVE ADJUSTMENTS
               ================================================================= */
            @media (max-width: 768px) {
                .amnesia-floating-fab {
                    bottom: 16px;
                    right: 16px;
                }

                .amnesia-outline-panel {
                    bottom: 72px;
                    right: 16px;
                    left: 16px;
                    width: auto;
                    max-height: 50vh;
                }
            }

            /* Dark mode adjustments */
            .theme-dark .amnesia-fab-button {
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            }

            .theme-dark .amnesia-outline-panel {
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            }
        `;
        document.head.appendChild(style);
    }
}
