/**
 * Context Card Component
 *
 * A unified header card that appears at the top of each settings tab.
 * Provides orientation, feature discovery, and status information.
 * Ported from doc-doctor plugin.
 */

import { setIcon } from 'obsidian';

// =============================================================================
// TYPES
// =============================================================================

export interface ContextCardFeature {
    icon: string;        // Lucide icon name
    label: string;       // Short label (max 20 chars)
    description: string; // Tooltip description
    enabled?: boolean;   // Show enabled/disabled state
    comingSoon?: boolean;// Mark as coming soon
    value?: string;      // Optional value to display
}

export interface ContextCardStatus {
    type: 'success' | 'warning' | 'error' | 'info';
    message: string;
    icon?: string;
}

export interface ContextCardConfig {
    icon: string;
    title: string;
    description: string;
    features: ContextCardFeature[];
    status?: ContextCardStatus;
    learnMoreUrl?: string;
}

// =============================================================================
// CONTEXT CARD CLASS
// =============================================================================

export class ContextCard {
    private containerEl: HTMLElement;
    private cardEl: HTMLElement | null = null;
    private config: ContextCardConfig;

    constructor(containerEl: HTMLElement, config: ContextCardConfig) {
        this.containerEl = containerEl;
        this.config = config;
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Render the context card
     */
    render(): HTMLElement {
        this.cardEl = document.createElement('div');
        this.cardEl.className = 'amnesia-context-card';
        this.cardEl.setAttribute('role', 'banner');

        // Main content area
        const contentEl = this.cardEl.createEl('div', { cls: 'amnesia-context-card-content' });

        // Icon and text
        const headerEl = contentEl.createEl('div', { cls: 'amnesia-context-card-header' });

        const iconWrapper = headerEl.createEl('div', { cls: 'amnesia-context-card-icon' });
        setIcon(iconWrapper, this.config.icon);

        const textEl = headerEl.createEl('div', { cls: 'amnesia-context-card-text' });
        textEl.createEl('h3', { text: this.config.title, cls: 'amnesia-context-card-title' });
        textEl.createEl('p', { text: this.config.description, cls: 'amnesia-context-card-desc' });

        // Features grid
        if (this.config.features.length > 0) {
            const featuresEl = contentEl.createEl('div', { cls: 'amnesia-context-card-features' });
            for (const feature of this.config.features) {
                this.renderFeature(featuresEl, feature);
            }
        }

        // Status banner (if present)
        if (this.config.status) {
            this.renderStatus(this.cardEl, this.config.status);
        }

        // Add styles
        this.addStyles();

        // Insert into container
        this.containerEl.insertBefore(this.cardEl, this.containerEl.firstChild);

        return this.cardEl;
    }

    /**
     * Update the status
     */
    updateStatus(status: ContextCardStatus | null): void {
        if (!this.cardEl) return;

        // Remove existing status
        const existingStatus = this.cardEl.querySelector('.amnesia-context-card-status');
        existingStatus?.remove();

        // Add new status if provided
        if (status) {
            this.renderStatus(this.cardEl, status);
        }
    }

    /**
     * Update a feature's state
     */
    updateFeature(label: string, updates: Partial<ContextCardFeature>): void {
        if (!this.cardEl) return;

        const featureEl = this.cardEl.querySelector(`[data-feature="${label}"]`);
        if (!featureEl) return;

        // Update enabled state
        if (updates.enabled !== undefined) {
            featureEl.classList.toggle('amnesia-feature-enabled', updates.enabled);
            featureEl.classList.toggle('amnesia-feature-disabled', !updates.enabled);

            const indicator = featureEl.querySelector('.amnesia-feature-indicator');
            if (indicator) {
                indicator.textContent = updates.enabled ? '✓' : '○';
            }
        }

        // Update value
        if (updates.value !== undefined) {
            const valueEl = featureEl.querySelector('.amnesia-feature-value');
            if (valueEl) {
                valueEl.textContent = updates.value;
            }
        }
    }

    /**
     * Destroy the card
     */
    destroy(): void {
        this.cardEl?.remove();
        this.cardEl = null;
    }

    // =========================================================================
    // RENDERING HELPERS
    // =========================================================================

    private renderFeature(containerEl: HTMLElement, feature: ContextCardFeature): void {
        const featureEl = containerEl.createEl('div', {
            cls: 'amnesia-context-card-feature',
            attr: {
                'data-feature': feature.label,
                title: feature.description,
            },
        });

        // Add state classes
        if (feature.enabled !== undefined) {
            featureEl.classList.add(feature.enabled ? 'amnesia-feature-enabled' : 'amnesia-feature-disabled');
        }
        if (feature.comingSoon) {
            featureEl.classList.add('amnesia-feature-coming-soon');
        }

        // Icon
        const iconEl = featureEl.createEl('div', { cls: 'amnesia-feature-icon' });
        setIcon(iconEl, feature.icon);

        // Label
        featureEl.createEl('div', { text: feature.label, cls: 'amnesia-feature-label' });

        // Value or indicator
        if (feature.value) {
            featureEl.createEl('div', { text: feature.value, cls: 'amnesia-feature-value' });
        } else if (feature.enabled !== undefined) {
            featureEl.createEl('div', {
                text: feature.enabled ? '✓' : '○',
                cls: 'amnesia-feature-indicator',
            });
        } else if (feature.comingSoon) {
            featureEl.createEl('div', { text: 'Soon', cls: 'amnesia-feature-badge' });
        }
    }

    private renderStatus(containerEl: HTMLElement, status: ContextCardStatus): void {
        const statusEl = containerEl.createEl('div', {
            cls: `amnesia-context-card-status amnesia-status-${status.type}`,
        });

        // Icon
        const iconEl = statusEl.createEl('span', { cls: 'amnesia-status-icon' });
        const iconName = status.icon || this.getStatusIcon(status.type);
        setIcon(iconEl, iconName);

        // Message
        statusEl.createEl('span', { text: status.message, cls: 'amnesia-status-message' });
    }

    private getStatusIcon(type: ContextCardStatus['type']): string {
        switch (type) {
            case 'success': return 'check-circle';
            case 'warning': return 'alert-triangle';
            case 'error': return 'alert-circle';
            case 'info': return 'info';
            default: return 'info';
        }
    }

    // =========================================================================
    // STYLES
    // =========================================================================

    private addStyles(): void {
        const styleId = 'amnesia-context-card-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            /* =================================================================
               CONTEXT CARD CONTAINER
               ================================================================= */
            .amnesia-context-card {
                background: linear-gradient(
                    135deg,
                    var(--background-secondary) 0%,
                    var(--background-secondary-alt, var(--background-secondary)) 100%
                );
                border: 1px solid var(--background-modifier-border);
                border-radius: 12px;
                margin-bottom: 24px;
                overflow: hidden;
            }

            .amnesia-context-card-content {
                padding: 20px;
            }

            /* =================================================================
               HEADER (ICON + TEXT)
               ================================================================= */
            .amnesia-context-card-header {
                display: flex;
                align-items: flex-start;
                gap: 16px;
                margin-bottom: 16px;
            }

            .amnesia-context-card-icon {
                flex-shrink: 0;
                width: 48px;
                height: 48px;
                background: var(--interactive-accent);
                border-radius: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--text-on-accent);
            }

            .amnesia-context-card-icon svg {
                width: 24px;
                height: 24px;
            }

            .amnesia-context-card-text {
                flex: 1;
                min-width: 0;
            }

            .amnesia-context-card-title {
                font-size: 18px;
                font-weight: 600;
                margin: 0 0 4px 0;
                color: var(--text-normal);
            }

            .amnesia-context-card-desc {
                font-size: 14px;
                color: var(--text-muted);
                margin: 0;
                line-height: 1.5;
            }

            /* =================================================================
               FEATURES GRID
               ================================================================= */
            .amnesia-context-card-features {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
                gap: 12px;
            }

            .amnesia-context-card-feature {
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 12px 8px;
                background: var(--background-primary);
                border: 1px solid var(--background-modifier-border);
                border-radius: 8px;
                text-align: center;
                cursor: default;
                transition: all 0.15s ease;
            }

            .amnesia-context-card-feature:hover {
                border-color: var(--interactive-accent);
                transform: translateY(-1px);
            }

            .amnesia-feature-icon {
                color: var(--interactive-accent);
                margin-bottom: 8px;
            }

            .amnesia-feature-icon svg {
                width: 20px;
                height: 20px;
            }

            .amnesia-feature-label {
                font-size: 12px;
                font-weight: 500;
                color: var(--text-normal);
                margin-bottom: 4px;
            }

            .amnesia-feature-value {
                font-size: 11px;
                color: var(--text-muted);
            }

            .amnesia-feature-indicator {
                font-size: 12px;
                font-weight: 600;
            }

            .amnesia-feature-badge {
                font-size: 10px;
                padding: 2px 6px;
                background: var(--background-modifier-border);
                border-radius: 10px;
                color: var(--text-muted);
            }

            /* Feature states */
            .amnesia-feature-enabled .amnesia-feature-icon {
                color: var(--text-success, #4ade80);
            }

            .amnesia-feature-enabled .amnesia-feature-indicator {
                color: var(--text-success, #4ade80);
            }

            .amnesia-feature-disabled {
                opacity: 0.6;
            }

            .amnesia-feature-disabled .amnesia-feature-icon {
                color: var(--text-muted);
            }

            .amnesia-feature-coming-soon {
                opacity: 0.7;
            }

            .amnesia-feature-coming-soon .amnesia-feature-icon {
                color: var(--text-muted);
            }

            /* =================================================================
               STATUS BANNER
               ================================================================= */
            .amnesia-context-card-status {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 20px;
                font-size: 13px;
                border-top: 1px solid var(--background-modifier-border);
            }

            .amnesia-status-icon {
                flex-shrink: 0;
            }

            .amnesia-status-icon svg {
                width: 16px;
                height: 16px;
            }

            .amnesia-status-message {
                flex: 1;
            }

            /* Status types */
            .amnesia-status-success {
                background: rgba(74, 222, 128, 0.1);
                color: var(--text-success, #4ade80);
            }

            .amnesia-status-warning {
                background: rgba(251, 191, 36, 0.1);
                color: var(--text-warning, #fbbf24);
            }

            .amnesia-status-error {
                background: rgba(248, 113, 113, 0.1);
                color: var(--text-error, #f87171);
            }

            .amnesia-status-info {
                background: rgba(96, 165, 250, 0.1);
                color: var(--text-accent, #60a5fa);
            }

            /* =================================================================
               RESPONSIVE
               ================================================================= */
            @media (max-width: 480px) {
                .amnesia-context-card-header {
                    flex-direction: column;
                    align-items: center;
                    text-align: center;
                }

                .amnesia-context-card-features {
                    grid-template-columns: repeat(2, 1fr);
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
 * Create and render a context card
 */
export function createContextCard(
    containerEl: HTMLElement,
    config: ContextCardConfig
): ContextCard {
    const card = new ContextCard(containerEl, config);
    card.render();
    return card;
}
