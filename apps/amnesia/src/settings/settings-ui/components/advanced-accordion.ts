/**
 * Advanced Accordion Component
 *
 * A collapsible section for advanced/power-user settings.
 * Implements progressive disclosure to reduce cognitive load.
 * Ported from doc-doctor plugin.
 */

import { setIcon } from 'obsidian';

// =============================================================================
// TYPES
// =============================================================================

export interface AdvancedAccordionOptions {
    title?: string;
    description?: string;
    settingsCount?: number;
    defaultExpanded?: boolean;
    storageKey?: string; // LocalStorage key for persistence
}

// =============================================================================
// ADVANCED ACCORDION CLASS
// =============================================================================

export class AdvancedAccordion {
    private containerEl: HTMLElement;
    private accordionEl: HTMLElement | null = null;
    private contentEl: HTMLElement | null = null;
    private headerEl: HTMLElement | null = null;
    private options: AdvancedAccordionOptions;
    private isExpanded: boolean;

    constructor(containerEl: HTMLElement, options: AdvancedAccordionOptions = {}) {
        this.containerEl = containerEl;
        this.options = {
            title: 'Advanced',
            description: 'These settings are for advanced users',
            settingsCount: undefined,
            defaultExpanded: false,
            storageKey: undefined,
            ...options,
        };

        // Restore state from localStorage if key provided
        if (this.options.storageKey) {
            const saved = localStorage.getItem(this.options.storageKey);
            this.isExpanded = saved ? saved === 'true' : (this.options.defaultExpanded ?? false);
        } else {
            this.isExpanded = this.options.defaultExpanded ?? false;
        }
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Render the accordion and return the content element for settings
     */
    render(): HTMLElement {
        this.accordionEl = document.createElement('div');
        this.accordionEl.className = 'amnesia-advanced-accordion';
        // Use a slugified version of the title for unique section ID
        const sectionId = (this.options.title || 'advanced')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
        this.accordionEl.setAttribute('data-section-id', sectionId);
        this.accordionEl.setAttribute('data-section-level', '1');

        // Header (clickable)
        this.headerEl = this.accordionEl.createEl('button', {
            cls: 'amnesia-accordion-header',
            attr: {
                'aria-expanded': String(this.isExpanded),
                'aria-controls': 'amnesia-accordion-content',
            },
        });

        // Chevron icon
        const chevronEl = this.headerEl.createEl('span', { cls: 'amnesia-accordion-chevron' });
        setIcon(chevronEl, 'chevron-right');

        // Title
        this.headerEl.createEl('span', {
            text: this.options.title,
            cls: 'amnesia-accordion-title',
        });

        // Settings count badge
        if (this.options.settingsCount !== undefined) {
            this.headerEl.createEl('span', {
                text: `${this.options.settingsCount} settings`,
                cls: 'amnesia-accordion-count',
            });
        }

        // Content wrapper
        const contentWrapper = this.accordionEl.createEl('div', {
            cls: 'amnesia-accordion-content-wrapper',
            attr: {
                id: 'amnesia-accordion-content',
            },
        });

        // Warning banner
        if (this.options.description) {
            const warningEl = contentWrapper.createEl('div', { cls: 'amnesia-accordion-warning' });
            const warningIcon = warningEl.createEl('span', { cls: 'amnesia-accordion-warning-icon' });
            setIcon(warningIcon, 'alert-triangle');
            warningEl.createEl('span', { text: this.options.description });
        }

        // Actual content container
        this.contentEl = contentWrapper.createEl('div', { cls: 'amnesia-accordion-content' });

        // Event handler
        this.headerEl.addEventListener('click', () => this.toggle());

        // Set initial state
        this.updateVisualState();

        // Add styles
        this.addStyles();

        // Append to container
        this.containerEl.appendChild(this.accordionEl);

        return this.contentEl;
    }

    /**
     * Expand the accordion
     */
    expand(): void {
        if (!this.isExpanded) {
            this.isExpanded = true;
            this.updateVisualState();
            this.saveState();
        }
    }

    /**
     * Collapse the accordion
     */
    collapse(): void {
        if (this.isExpanded) {
            this.isExpanded = false;
            this.updateVisualState();
            this.saveState();
        }
    }

    /**
     * Toggle the accordion
     */
    toggle(): void {
        this.isExpanded = !this.isExpanded;
        this.updateVisualState();
        this.saveState();
    }

    /**
     * Get the content element for adding settings
     */
    getContentEl(): HTMLElement | null {
        return this.contentEl;
    }

    /**
     * Check if expanded
     */
    get expanded(): boolean {
        return this.isExpanded;
    }

    /**
     * Update the settings count badge
     */
    updateSettingsCount(count: number): void {
        const countEl = this.headerEl?.querySelector('.amnesia-accordion-count');
        if (countEl) {
            countEl.textContent = `${count} settings`;
        }
    }

    /**
     * Destroy the accordion
     */
    destroy(): void {
        this.accordionEl?.remove();
        this.accordionEl = null;
        this.contentEl = null;
        this.headerEl = null;
    }

    // =========================================================================
    // PRIVATE METHODS
    // =========================================================================

    private updateVisualState(): void {
        if (!this.accordionEl || !this.headerEl) return;

        // Update classes
        this.accordionEl.classList.toggle('amnesia-accordion-expanded', this.isExpanded);

        // Update aria
        this.headerEl.setAttribute('aria-expanded', String(this.isExpanded));

        // Update chevron
        const chevronEl = this.headerEl.querySelector('.amnesia-accordion-chevron');
        if (chevronEl) {
            chevronEl.innerHTML = '';
            setIcon(chevronEl as HTMLElement, this.isExpanded ? 'chevron-down' : 'chevron-right');
        }
    }

    private saveState(): void {
        if (this.options.storageKey) {
            localStorage.setItem(this.options.storageKey, String(this.isExpanded));
        }
    }

    // =========================================================================
    // STYLES
    // =========================================================================

    private addStyles(): void {
        const styleId = 'amnesia-advanced-accordion-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            /* =================================================================
               ACCORDION CONTAINER
               ================================================================= */
            .amnesia-advanced-accordion {
                margin-top: 24px;
                border: 1px solid var(--background-modifier-border);
                border-radius: 8px;
                overflow: hidden;
            }

            /* =================================================================
               HEADER
               ================================================================= */
            .amnesia-accordion-header {
                display: flex;
                align-items: center;
                gap: 8px;
                width: 100%;
                padding: 12px 16px;
                background: var(--background-secondary);
                border: none;
                cursor: pointer;
                text-align: left;
                font-size: 14px;
                font-weight: 500;
                color: var(--text-normal);
                transition: background-color 0.15s ease;
            }

            .amnesia-accordion-header:hover {
                background: var(--background-modifier-hover);
            }

            .amnesia-accordion-header:focus {
                outline: 2px solid var(--interactive-accent);
                outline-offset: -2px;
            }

            .amnesia-accordion-chevron {
                color: var(--text-muted);
                transition: transform 0.2s ease;
            }

            .amnesia-accordion-chevron svg {
                width: 16px;
                height: 16px;
            }

            .amnesia-accordion-expanded .amnesia-accordion-chevron {
                transform: rotate(0deg);
            }

            .amnesia-accordion-title {
                flex: 1;
            }

            .amnesia-accordion-count {
                font-size: 12px;
                font-weight: normal;
                color: var(--text-muted);
                padding: 2px 8px;
                background: var(--background-modifier-border);
                border-radius: 10px;
            }

            /* =================================================================
               CONTENT
               ================================================================= */
            .amnesia-accordion-content-wrapper {
                display: grid;
                grid-template-rows: 0fr;
                transition: grid-template-rows 0.25s ease;
            }

            .amnesia-accordion-expanded .amnesia-accordion-content-wrapper {
                grid-template-rows: 1fr;
            }

            .amnesia-accordion-content-wrapper > * {
                overflow: hidden;
            }

            .amnesia-accordion-warning {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 16px;
                background: rgba(251, 191, 36, 0.1);
                border-bottom: 1px solid var(--background-modifier-border);
                font-size: 12px;
                color: var(--text-warning, #fbbf24);
            }

            .amnesia-accordion-warning-icon {
                flex-shrink: 0;
            }

            .amnesia-accordion-warning-icon svg {
                width: 14px;
                height: 14px;
            }

            .amnesia-accordion-content {
                padding: 16px;
                background: var(--background-primary);
            }

            .amnesia-accordion-content .setting-item {
                padding: 12px 0;
                border-bottom: 1px solid var(--background-modifier-border);
            }

            .amnesia-accordion-content .setting-item:last-child {
                border-bottom: none;
                padding-bottom: 0;
            }

            /* =================================================================
               ANIMATIONS
               ================================================================= */
            @media (prefers-reduced-motion: no-preference) {
                .amnesia-accordion-chevron {
                    transition: transform 0.2s ease;
                }
            }
        `;
        document.head.appendChild(style);
    }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create and render an advanced accordion
 */
export function createAdvancedAccordion(
    containerEl: HTMLElement,
    options?: AdvancedAccordionOptions
): AdvancedAccordion {
    const accordion = new AdvancedAccordion(containerEl, options);
    accordion.render();
    return accordion;
}
