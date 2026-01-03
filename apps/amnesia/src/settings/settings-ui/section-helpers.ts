/**
 * Section Helpers
 *
 * Shared utilities for creating consistent settings UI sections.
 * Ported from doc-doctor plugin with amnesia- prefix.
 */

import { setIcon } from 'obsidian';

// =============================================================================
// TAB HEADER
// =============================================================================

/**
 * Create a tab header with title and description
 */
export function createTabHeader(
    containerEl: HTMLElement,
    title: string,
    description: string,
): HTMLElement {
    const headerEl = containerEl.createEl('div', { cls: 'amnesia-compound-header' });
    headerEl.createEl('h2', { text: title });
    const descEl = headerEl.createEl('p', { cls: 'amnesia-compound-description' });
    descEl.innerHTML = description;
    return headerEl;
}

// =============================================================================
// FEATURE CARDS
// =============================================================================

/**
 * Create a feature cards container
 */
export function createFeatureCardsContainer(containerEl: HTMLElement): HTMLElement {
    return containerEl.createEl('div', { cls: 'amnesia-compound-cards' });
}

/**
 * Add a feature card to a container
 */
export function addFeatureCard(
    container: HTMLElement,
    icon: string,
    title: string,
    description: string,
): HTMLElement {
    const card = container.createEl('div', { cls: 'amnesia-feature-card' });

    const iconEl = card.createEl('span', { cls: 'amnesia-feature-icon' });
    setIcon(iconEl, icon);

    const textEl = card.createEl('div', { cls: 'amnesia-feature-text' });
    textEl.createEl('strong', { text: title });
    textEl.createEl('p', { text: description });

    return card;
}

// =============================================================================
// SECTIONS
// =============================================================================

/**
 * Create a section with icon header
 */
export function createSection(
    containerEl: HTMLElement,
    icon: string,
    title: string,
    description?: string,
): HTMLElement {
    const section = containerEl.createEl('div', { cls: 'amnesia-compound-section' });

    // Generate a unique section ID from the title for outline scanning
    const sectionId = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    section.setAttribute('data-section-id', sectionId);
    section.setAttribute('data-section-level', '2');

    const header = section.createEl('div', { cls: 'amnesia-section-header' });
    const iconEl = header.createEl('span', { cls: 'amnesia-section-icon' });
    setIcon(iconEl, icon);
    header.createEl('h3', { text: title });

    if (description) {
        section.createEl('p', {
            text: description,
            cls: 'amnesia-section-description',
        });
    }

    return section;
}

/**
 * Create a subsection header (h4 level)
 */
export function createSubsectionHeader(
    containerEl: HTMLElement,
    title: string,
    description?: string,
): HTMLElement {
    const wrapper = containerEl.createEl('div', { cls: 'amnesia-subsection' });
    wrapper.createEl('h4', { text: title, cls: 'amnesia-subsection-header' });

    if (description) {
        wrapper.createEl('p', {
            text: description,
            cls: 'amnesia-subsection-description',
        });
    }

    return wrapper;
}

// =============================================================================
// INFO BOXES & EXPLAINERS
// =============================================================================

/**
 * Create a threshold/info explainer box
 */
export function createExplainerBox(
    containerEl: HTMLElement,
    content: string,
): HTMLElement {
    const box = containerEl.createEl('div', { cls: 'amnesia-threshold-explainer' });
    box.innerHTML = content;
    return box;
}

/**
 * Create a format preview box
 */
export function createFormatPreview(
    containerEl: HTMLElement,
    label: string,
    content: string,
): HTMLElement {
    const preview = containerEl.createEl('div', { cls: 'amnesia-format-preview' });
    preview.createEl('strong', { text: label });
    const code = preview.createEl('pre');
    code.textContent = content;
    return preview;
}

/**
 * Create an info badge
 */
export function createInfoBadge(
    containerEl: HTMLElement,
    text: string,
): HTMLElement {
    const badge = containerEl.createEl('div', { cls: 'amnesia-tabs-info' });
    badge.createEl('span', { text });
    return badge;
}

// =============================================================================
// STATS & LISTS
// =============================================================================

/**
 * Create a stats display
 */
export function createStatsDisplay(
    containerEl: HTMLElement,
    stats: Array<{ value: number | string; label: string }>,
): HTMLElement {
    const statsEl = containerEl.createEl('div', { cls: 'amnesia-stats' });

    for (const stat of stats) {
        const statDiv = statsEl.createEl('div', { cls: 'amnesia-stat' });
        statDiv.createEl('span', { text: String(stat.value), cls: 'amnesia-stat-value' });
        statDiv.createEl('span', { text: stat.label, cls: 'amnesia-stat-label' });
    }

    return statsEl;
}

/**
 * Create a list with remove buttons
 */
export function createRemovableList(
    containerEl: HTMLElement,
    title: string,
    items: string[],
    onRemove: (item: string) => void,
): HTMLElement {
    const listEl = containerEl.createEl('div', { cls: 'amnesia-removable-list' });
    listEl.createEl('strong', { text: title });
    const list = listEl.createEl('ul');

    for (const item of items) {
        const li = list.createEl('li');
        li.createEl('span', { text: item, cls: 'amnesia-path' });

        const removeBtn = li.createEl('button', { cls: 'amnesia-remove-btn' });
        setIcon(removeBtn, 'x');
        removeBtn.title = 'Remove';
        removeBtn.addEventListener('click', () => onRemove(item));
    }

    return listEl;
}

// =============================================================================
// KEYBOARD SHORTCUTS TABLE
// =============================================================================

interface ShortcutDefinition {
    key: string;
    action: string;
}

/**
 * Create a keyboard shortcuts table
 */
export function createShortcutsTable(
    containerEl: HTMLElement,
    shortcuts: ShortcutDefinition[],
): HTMLElement {
    const table = containerEl.createEl('table', { cls: 'amnesia-shortcuts-table' });

    for (const shortcut of shortcuts) {
        const row = table.createEl('tr');
        const keyCell = row.createEl('td', { cls: 'amnesia-shortcut-key' });
        keyCell.createEl('kbd', { text: shortcut.key });
        row.createEl('td', { text: shortcut.action, cls: 'amnesia-shortcut-action' });
    }

    return table;
}

// =============================================================================
// STYLES
// =============================================================================

/**
 * Add the shared compound settings styles to a container
 * Only adds styles once per document
 */
export function addSharedStyles(): void {
    const styleId = 'amnesia-compound-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* =================================================================
           TAB HEADER
           ================================================================= */
        .amnesia-compound-header {
            margin-bottom: 24px;
        }

        .amnesia-compound-header h2 {
            margin: 0 0 8px 0;
            font-size: 1.4em;
            font-weight: 600;
        }

        .amnesia-compound-description {
            color: var(--text-muted);
            line-height: 1.6;
            margin: 0;
        }

        .amnesia-compound-description strong {
            color: var(--text-normal);
        }

        /* =================================================================
           FEATURE CARDS
           ================================================================= */
        .amnesia-compound-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 12px;
            margin-bottom: 24px;
        }

        .amnesia-feature-card {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 12px 16px;
            background: var(--background-secondary);
            border-radius: 8px;
            border: 1px solid var(--background-modifier-border);
            transition: border-color 0.15s ease, transform 0.15s ease;
        }

        .amnesia-feature-card:hover {
            border-color: var(--interactive-accent);
            transform: translateY(-1px);
        }

        .amnesia-feature-icon {
            flex-shrink: 0;
            color: var(--interactive-accent);
        }

        .amnesia-feature-icon svg {
            width: 20px;
            height: 20px;
        }

        .amnesia-feature-text {
            flex: 1;
            min-width: 0;
        }

        .amnesia-feature-text strong {
            display: block;
            margin-bottom: 4px;
            font-size: 0.95em;
        }

        .amnesia-feature-text p {
            margin: 0;
            font-size: 0.85em;
            color: var(--text-muted);
            line-height: 1.4;
        }

        /* =================================================================
           SECTIONS
           ================================================================= */
        .amnesia-compound-section {
            margin: 32px 0;
            padding: 20px;
            background: var(--background-primary-alt);
            border-radius: 8px;
            border: 1px solid var(--background-modifier-border);
        }

        .amnesia-compound-section:first-of-type {
            margin-top: 0;
        }

        .amnesia-section-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }

        .amnesia-section-header h3 {
            margin: 0;
            font-size: 1.1em;
            font-weight: 600;
        }

        .amnesia-section-icon {
            color: var(--interactive-accent);
        }

        .amnesia-section-icon svg {
            width: 18px;
            height: 18px;
        }

        .amnesia-section-description {
            color: var(--text-muted);
            margin: 0 0 16px 0;
            line-height: 1.5;
        }

        /* =================================================================
           SUBSECTIONS
           ================================================================= */
        .amnesia-subsection {
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px solid var(--background-modifier-border);
        }

        .amnesia-subsection:first-child {
            margin-top: 0;
            padding-top: 0;
            border-top: none;
        }

        .amnesia-subsection-header {
            margin: 0 0 8px 0;
            font-size: 1em;
            font-weight: 600;
            color: var(--text-normal);
        }

        .amnesia-subsection-description {
            color: var(--text-muted);
            margin: 0 0 12px 0;
            font-size: 0.9em;
            line-height: 1.5;
        }

        /* =================================================================
           INFO BOXES & EXPLAINERS
           ================================================================= */
        .amnesia-threshold-explainer {
            margin: 12px 0;
            padding: 12px 16px;
            background: var(--background-secondary);
            border-radius: 6px;
            font-size: 0.9em;
        }

        .amnesia-threshold-explainer strong {
            display: block;
            margin-bottom: 8px;
        }

        .amnesia-threshold-explainer ul {
            margin: 0;
            padding-left: 20px;
        }

        .amnesia-threshold-explainer li {
            margin-bottom: 4px;
            color: var(--text-muted);
        }

        .amnesia-format-preview {
            margin: 16px 0;
            padding: 12px 16px;
            background: var(--background-secondary);
            border-radius: 6px;
        }

        .amnesia-format-preview strong {
            display: block;
            margin-bottom: 8px;
            font-size: 0.9em;
        }

        .amnesia-format-preview pre {
            margin: 0;
            padding: 12px;
            background: var(--background-primary);
            border-radius: 4px;
            font-size: 0.85em;
            overflow-x: auto;
        }

        .amnesia-tabs-info {
            margin: 12px 0;
            padding: 8px 12px;
            background: var(--background-modifier-info);
            border-radius: 4px;
            font-size: 0.9em;
            color: var(--text-muted);
        }

        /* =================================================================
           STATS & LISTS
           ================================================================= */
        .amnesia-stats {
            display: flex;
            gap: 24px;
            margin: 16px 0;
        }

        .amnesia-stat {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 12px 24px;
            background: var(--background-secondary);
            border-radius: 6px;
        }

        .amnesia-stat-value {
            font-size: 1.5em;
            font-weight: 600;
            color: var(--text-normal);
        }

        .amnesia-stat-label {
            font-size: 0.85em;
            color: var(--text-muted);
        }

        .amnesia-removable-list {
            margin: 16px 0;
            padding: 12px 16px;
            background: var(--background-secondary);
            border-radius: 6px;
        }

        .amnesia-removable-list strong {
            display: block;
            margin-bottom: 8px;
            font-size: 0.9em;
        }

        .amnesia-removable-list ul {
            margin: 0;
            padding: 0;
            list-style: none;
        }

        .amnesia-removable-list li {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 8px;
            border-radius: 4px;
        }

        .amnesia-removable-list li:hover {
            background: var(--background-modifier-hover);
        }

        .amnesia-path {
            font-family: var(--font-monospace);
            font-size: 0.85em;
            color: var(--text-muted);
        }

        .amnesia-remove-btn {
            padding: 2px;
            background: transparent;
            border: none;
            cursor: pointer;
            color: var(--text-faint);
            border-radius: 4px;
        }

        .amnesia-remove-btn:hover {
            color: var(--text-error);
            background: var(--background-modifier-hover);
        }

        .amnesia-remove-btn svg {
            width: 14px;
            height: 14px;
        }

        /* =================================================================
           SHORTCUTS TABLE
           ================================================================= */
        .amnesia-shortcuts-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.9em;
        }

        .amnesia-shortcuts-table tr {
            border-bottom: 1px solid var(--background-modifier-border);
        }

        .amnesia-shortcuts-table tr:last-child {
            border-bottom: none;
        }

        .amnesia-shortcuts-table td {
            padding: 8px 0;
        }

        .amnesia-shortcut-key {
            width: 150px;
        }

        .amnesia-shortcut-key kbd {
            display: inline-block;
            padding: 2px 8px;
            background: var(--background-secondary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 4px;
            font-family: var(--font-monospace);
            font-size: 0.85em;
        }

        .amnesia-shortcut-action {
            color: var(--text-muted);
        }

        /* =================================================================
           RESPONSIVE
           ================================================================= */
        @media (max-width: 600px) {
            .amnesia-compound-cards {
                grid-template-columns: 1fr;
            }

            .amnesia-stats {
                flex-direction: column;
                gap: 12px;
            }

            .amnesia-stat {
                flex-direction: row;
                justify-content: space-between;
                padding: 12px 16px;
            }
        }
    `;
    document.head.appendChild(style);
}
