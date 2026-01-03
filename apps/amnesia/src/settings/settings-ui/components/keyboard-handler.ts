/**
 * Keyboard Handler for Settings UI
 *
 * Manages keyboard shortcuts for search and outline navigation.
 * - Cmd/Ctrl + F: Open search drawer
 * - Cmd/Ctrl + .: Toggle outline panel
 * - Escape: Close search/outline
 * Ported from doc-doctor plugin.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface KeyboardHandlerOptions {
    onSearchTrigger: () => void;
    onOutlineTrigger: () => void;
    onEscape: () => boolean; // Returns true if escape was handled
    onTabNavigation?: (direction: 'next' | 'previous') => void; // Tab navigation for menu tabs
    isEnabled: () => boolean;
    isSearchOpen?: () => boolean; // Check if search drawer is open
}

// =============================================================================
// KEYBOARD HANDLER CLASS
// =============================================================================

export class KeyboardHandler {
    private options: KeyboardHandlerOptions;
    private handler: ((e: KeyboardEvent) => void) | null = null;
    private isActive = false;

    constructor(options: KeyboardHandlerOptions) {
        this.options = options;
    }

    /**
     * Activate keyboard shortcuts
     */
    activate(): void {
        if (this.isActive) return;

        this.handler = this.handleKeydown.bind(this);
        document.addEventListener('keydown', this.handler as EventListener, true);
        this.isActive = true;
    }

    /**
     * Deactivate keyboard shortcuts
     */
    deactivate(): void {
        if (!this.isActive || !this.handler) return;

        document.removeEventListener('keydown', this.handler as EventListener, true);
        this.handler = null;
        this.isActive = false;
    }

    /**
     * Handle keydown events
     */
    private handleKeydown(e: KeyboardEvent): void {
        // Only handle if settings tab is active
        if (!this.options.isEnabled()) return;

        const isMod = e.metaKey || e.ctrlKey;

        // Cmd/Ctrl + F: Search
        if (isMod && e.key === 'f') {
            e.preventDefault();
            e.stopPropagation();
            this.options.onSearchTrigger();
            return;
        }

        // Cmd/Ctrl + .: Outline
        if (isMod && e.key === '.') {
            e.preventDefault();
            e.stopPropagation();
            this.options.onOutlineTrigger();
            return;
        }

        // Escape: Close (hierarchical - only prevent if we handled it)
        if (e.key === 'Escape') {
            const handled = this.options.onEscape();
            if (handled) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation(); // Prevent other handlers on same element
            }
            return;
        }

        // Tab/Shift+Tab: Navigate menu tabs (only when not in input fields or search)
        if (e.key === 'Tab' && !isMod && this.options.onTabNavigation) {
            // Don't intercept Tab when search is open (handled by search drawer)
            if (this.options.isSearchOpen?.()) return;

            // Don't intercept Tab when focus is on an interactive element
            const activeEl = document.activeElement;
            const isInInput = activeEl instanceof HTMLInputElement ||
                              activeEl instanceof HTMLTextAreaElement ||
                              activeEl instanceof HTMLSelectElement ||
                              activeEl?.getAttribute('contenteditable') === 'true';

            if (isInInput) return;

            // Navigate menu tabs
            e.preventDefault();
            e.stopPropagation();
            this.options.onTabNavigation(e.shiftKey ? 'previous' : 'next');
            return;
        }
    }
}

// =============================================================================
// FOCUS TRAP UTILITY
// =============================================================================

/**
 * Creates a focus trap for modal-like components
 */
export function createFocusTrap(containerEl: HTMLElement): () => void {
    const focusableSelectors = [
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
        'a[href]',
    ].join(', ');

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return;

        const focusableElements = containerEl.querySelectorAll(focusableSelectors);
        if (focusableElements.length === 0) return;

        const firstFocusable = focusableElements[0] as HTMLElement;
        const lastFocusable = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey) {
            // Shift + Tab
            if (document.activeElement === firstFocusable) {
                e.preventDefault();
                lastFocusable.focus();
            }
        } else {
            // Tab
            if (document.activeElement === lastFocusable) {
                e.preventDefault();
                firstFocusable.focus();
            }
        }
    };

    containerEl.addEventListener('keydown', handleKeydown);

    // Return cleanup function
    return () => {
        containerEl.removeEventListener('keydown', handleKeydown);
    };
}

// =============================================================================
// HIGHLIGHT UTILITY
// =============================================================================

/**
 * Temporarily highlight a setting element after navigation
 */
export function highlightElement(element: HTMLElement, duration = 2000): void {
    // Add highlight class
    element.classList.add('amnesia-setting-highlight');

    // Scroll into view with offset
    element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
    });

    // Remove highlight after duration
    setTimeout(() => {
        element.classList.remove('amnesia-setting-highlight');
    }, duration);
}

/**
 * Add highlight styles to document
 */
export function addHighlightStyles(): void {
    const styleId = 'amnesia-highlight-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* Setting highlight animation - subtle fade with left border accent */
        @keyframes amnesia-highlight-fade {
            0% {
                background-color: var(--interactive-accent);
                opacity: 0.15;
            }
            100% {
                background-color: transparent;
                opacity: 1;
            }
        }

        @keyframes amnesia-highlight-border {
            0% {
                border-left-color: var(--interactive-accent);
            }
            70% {
                border-left-color: var(--interactive-accent);
            }
            100% {
                border-left-color: transparent;
            }
        }

        .amnesia-setting-highlight {
            position: relative;
            border-radius: 6px;
            border-left: 3px solid var(--interactive-accent);
            animation: amnesia-highlight-border 2s ease-out forwards;
            background: linear-gradient(
                90deg,
                color-mix(in srgb, var(--interactive-accent) 12%, transparent) 0%,
                transparent 100%
            );
        }

        .amnesia-setting-highlight::before {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 6px;
            background-color: var(--interactive-accent);
            opacity: 0.08;
            animation: amnesia-highlight-fade 2s ease-out forwards;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
}
