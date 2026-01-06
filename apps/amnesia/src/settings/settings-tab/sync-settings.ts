/**
 * Sync Settings Tab
 *
 * Unified sync engine, conflict resolution, and sync options.
 */

import { Setting } from 'obsidian';
import type AmnesiaPlugin from '../../main';
import type { SyncDirection, ConflictResolution, SyncableField } from '../../calibre/calibre-types';
import type {
    UnifiedConflictStrategy,
    UnifiedSyncMode,
    FieldAlias,
    ReaderVaultSyncMode,
    ReaderVaultConflictStrategy,
} from '../settings';
import {
    createTabHeader,
    createSection,
    createSubsectionHeader,
    createExplainerBox,
} from '../settings-ui/section-helpers';
import { AdvancedAccordion } from '../settings-ui/components/advanced-accordion';

export interface SyncSettingsProps {
    plugin: AmnesiaPlugin;
    containerEl: HTMLElement;
}

export function SyncSettings({ plugin, containerEl }: SyncSettingsProps): void {
    const { settings } = plugin;

    // ==========================================================================
    // TAB HEADER
    // ==========================================================================

    createTabHeader(
        containerEl,
        'Sync',
        'Configure synchronization between Obsidian, Calibre, and remote servers.'
    );

    // ==========================================================================
    // UNIFIED SYNC ENGINE
    // ==========================================================================

    const engineSection = createSection(containerEl, 'zap', 'Unified Sync Engine');

    createExplainerBox(engineSection,
        'The unified sync engine provides robust synchronization with resume support, conflict resolution, and progress tracking across all adapters.'
    );

    new Setting(engineSection)
        .setName('Enable Unified Sync Engine')
        .setDesc('Use the new unified sync architecture for all synchronization')
        .addToggle(toggle => toggle
            .setValue(settings.unifiedSync.enabled)
            .onChange(async (value) => {
                settings.unifiedSync.enabled = value;
                await plugin.saveSettings();
            }));

    new Setting(engineSection)
        .setName('Default Sync Mode')
        .setDesc('How to sync by default')
        .addDropdown(dropdown => dropdown
            .addOption('incremental', 'Incremental (faster, syncs changes only)')
            .addOption('full', 'Full (complete resync)')
            .addOption('custom', 'Custom (manual selection)')
            .setValue(settings.unifiedSync.defaultMode)
            .onChange(async (value) => {
                settings.unifiedSync.defaultMode = value as UnifiedSyncMode;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // CONFLICT RESOLUTION
    // ==========================================================================

    const conflictSection = createSection(containerEl, 'git-merge', 'Conflict Resolution');

    new Setting(conflictSection)
        .setName('Default Conflict Strategy')
        .setDesc('How to resolve conflicts when the same item is modified in multiple places')
        .addDropdown(dropdown => dropdown
            .addOption('last-write-wins', 'Last Write Wins (most recent change)')
            .addOption('prefer-local', 'Prefer Local (keep Obsidian changes)')
            .addOption('prefer-remote', 'Prefer Remote (keep server changes)')
            .addOption('merge', 'Merge (combine non-conflicting fields)')
            .addOption('ask-user', 'Ask User (prompt for each conflict)')
            .setValue(settings.unifiedSync.defaultConflictStrategy)
            .onChange(async (value) => {
                settings.unifiedSync.defaultConflictStrategy = value as UnifiedConflictStrategy;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // SYNC ADAPTERS
    // ==========================================================================

    const adaptersSection = createSection(containerEl, 'plug', 'Sync Adapters');

    createExplainerBox(adaptersSection,
        'Enable or disable specific sync adapters. Each adapter syncs with a different source.'
    );

    new Setting(adaptersSection)
        .setName('Calibre Adapter')
        .setDesc('Sync with Calibre library (local database + Content Server)')
        .addToggle(toggle => toggle
            .setValue(settings.unifiedSync.enabledAdapters.calibre)
            .onChange(async (value) => {
                settings.unifiedSync.enabledAdapters.calibre = value;
                await plugin.saveSettings();
            }));

    new Setting(adaptersSection)
        .setName('Server Adapter')
        .setDesc('Sync with Amnesia remote server')
        .addToggle(toggle => toggle
            .setValue(settings.unifiedSync.enabledAdapters.server)
            .onChange(async (value) => {
                settings.unifiedSync.enabledAdapters.server = value;
                await plugin.saveSettings();
            }));

    new Setting(adaptersSection)
        .setName('File Adapter')
        .setDesc('Sync with local file system')
        .addToggle(toggle => toggle
            .setValue(settings.unifiedSync.enabledAdapters.file)
            .onChange(async (value) => {
                settings.unifiedSync.enabledAdapters.file = value;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // CALIBRE SYNC OPTIONS
    // ==========================================================================

    const calibreSection = createSection(containerEl, 'library', 'Calibre Sync Options');

    new Setting(calibreSection)
        .setName('Sync Direction')
        .setDesc('Direction of metadata synchronization with Calibre')
        .addDropdown(dropdown => dropdown
            .addOption('bidirectional', 'Bidirectional')
            .addOption('pull-only', 'Pull Only (Calibre → Obsidian)')
            .addOption('push-only', 'Push Only (Obsidian → Calibre)')
            .setValue(settings.calibreSyncDirection)
            .onChange(async (value) => {
                settings.calibreSyncDirection = value as SyncDirection;
                await plugin.saveSettings();
            }));

    new Setting(calibreSection)
        .setName('Legacy Conflict Resolution')
        .setDesc('Conflict resolution for legacy Calibre sync')
        .addDropdown(dropdown => dropdown
            .addOption('last-write', 'Last Write Wins')
            .addOption('prefer-local', 'Prefer Local')
            .addOption('prefer-calibre', 'Prefer Calibre')
            .addOption('manual', 'Ask User')
            .setValue(settings.calibreConflictResolution)
            .onChange(async (value) => {
                settings.calibreConflictResolution = value as ConflictResolution;
                await plugin.saveSettings();
            }));

    createSubsectionHeader(calibreSection, 'Syncable Fields');

    const allFields: { value: SyncableField; label: string; desc: string }[] = [
        { value: 'status', label: 'Reading Status', desc: 'To-read, reading, finished' },
        { value: 'rating', label: 'Rating', desc: 'Star rating' },
        { value: 'tags', label: 'Tags', desc: 'Book tags/genres' },
        { value: 'progress', label: 'Reading Progress', desc: 'Current position' },
    ];

    for (const field of allFields) {
        new Setting(calibreSection)
            .setName(field.label)
            .setDesc(field.desc)
            .addToggle(toggle => toggle
                .setValue(settings.calibreSyncableFields.includes(field.value))
                .onChange(async (value) => {
                    if (value) {
                        if (!settings.calibreSyncableFields.includes(field.value)) {
                            settings.calibreSyncableFields.push(field.value);
                        }
                    } else {
                        settings.calibreSyncableFields = settings.calibreSyncableFields.filter(
                            f => f !== field.value
                        );
                    }
                    await plugin.saveSettings();
                }));
    }

    // ==========================================================================
    // READER ↔ VAULT SYNC
    // ==========================================================================

    const readerVaultSection = createSection(containerEl, 'refresh-cw', 'Reader ↔ Vault Sync');

    createExplainerBox(readerVaultSection,
        'Synchronize highlights and annotations between the in-app reader and your vault notes. ' +
        'Changes made in the reader can be reflected in your vault, and vice versa.'
    );

    new Setting(readerVaultSection)
        .setName('Enable Reader ↔ Vault Sync')
        .setDesc('Automatically sync highlights and annotations with vault notes')
        .addToggle(toggle => toggle
            .setValue(settings.readerVaultSync.enabled)
            .onChange(async (value) => {
                settings.readerVaultSync.enabled = value;
                await plugin.saveSettings();
            }));

    new Setting(readerVaultSection)
        .setName('Auto-Sync')
        .setDesc('Automatically sync on highlight create/update/delete')
        .addToggle(toggle => toggle
            .setValue(settings.readerVaultSync.autoSync)
            .onChange(async (value) => {
                settings.readerVaultSync.autoSync = value;
                await plugin.saveSettings();
            }));

    createSubsectionHeader(readerVaultSection, 'Sync Direction');

    new Setting(readerVaultSection)
        .setName('Highlight Sync Mode')
        .setDesc('Direction for highlight synchronization')
        .addDropdown(dropdown => dropdown
            .addOption('bidirectional', 'Bidirectional (both ways)')
            .addOption('reader-to-vault', 'Reader → Vault only')
            .addOption('vault-to-reader', 'Vault → Reader only')
            .addOption('manual', 'Manual (trigger explicitly)')
            .setValue(settings.readerVaultSync.highlightSyncMode)
            .onChange(async (value) => {
                settings.readerVaultSync.highlightSyncMode = value as ReaderVaultSyncMode;
                await plugin.saveSettings();
            }));

    new Setting(readerVaultSection)
        .setName('Note Sync Mode')
        .setDesc('Direction for annotation/note synchronization')
        .addDropdown(dropdown => dropdown
            .addOption('bidirectional', 'Bidirectional (both ways)')
            .addOption('reader-to-vault', 'Reader → Vault only')
            .addOption('vault-to-reader', 'Vault → Reader only')
            .addOption('manual', 'Manual (trigger explicitly)')
            .setValue(settings.readerVaultSync.noteSyncMode)
            .onChange(async (value) => {
                settings.readerVaultSync.noteSyncMode = value as ReaderVaultSyncMode;
                await plugin.saveSettings();
            }));

    createSubsectionHeader(readerVaultSection, 'Conflict & Deletion Handling');

    new Setting(readerVaultSection)
        .setName('Conflict Strategy')
        .setDesc('How to resolve conflicts when both reader and vault have changes')
        .addDropdown(dropdown => dropdown
            .addOption('last-write-wins', 'Last Write Wins')
            .addOption('reader-wins', 'Reader Wins (prefer reader)')
            .addOption('vault-wins', 'Vault Wins (prefer vault)')
            .addOption('ask-user', 'Ask User (show modal)')
            .setValue(settings.readerVaultSync.conflictStrategy)
            .onChange(async (value) => {
                settings.readerVaultSync.conflictStrategy = value as ReaderVaultConflictStrategy;
                await plugin.saveSettings();
            }));

    new Setting(readerVaultSection)
        .setName('Append-Only Vault')
        .setDesc('Deletions in reader won\'t delete vault notes (preserves your work)')
        .addToggle(toggle => toggle
            .setValue(settings.readerVaultSync.appendOnlyVault)
            .onChange(async (value) => {
                settings.readerVaultSync.appendOnlyVault = value;
                await plugin.saveSettings();
            }));

    new Setting(readerVaultSection)
        .setName('Preserve Reader Highlights')
        .setDesc('Deletions in vault won\'t delete reader highlights')
        .addToggle(toggle => toggle
            .setValue(settings.readerVaultSync.preserveReaderHighlights)
            .onChange(async (value) => {
                settings.readerVaultSync.preserveReaderHighlights = value;
                await plugin.saveSettings();
            }));

    createSubsectionHeader(readerVaultSection, 'Performance');

    new Setting(readerVaultSection)
        .setName('Debounce Delay')
        .setDesc('Wait time before syncing vault changes (ms)')
        .addSlider(slider => slider
            .setLimits(500, 10000, 500)
            .setValue(settings.readerVaultSync.debounceDelay)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.readerVaultSync.debounceDelay = value;
                await plugin.saveSettings();
            }));

    createSubsectionHeader(readerVaultSection, 'Hub File Regeneration');

    new Setting(readerVaultSection)
        .setName('Auto-Regenerate Hub Files')
        .setDesc('Automatically regenerate hub highlight files when highlights change')
        .addToggle(toggle => toggle
            .setValue(settings.readerVaultSync.autoRegenerateHub)
            .onChange(async (value) => {
                settings.readerVaultSync.autoRegenerateHub = value;
                await plugin.saveSettings();
            }));

    new Setting(readerVaultSection)
        .setName('Hub Regeneration Delay')
        .setDesc('Wait time before regenerating hub files (ms) - batches rapid changes')
        .addSlider(slider => slider
            .setLimits(1000, 30000, 1000)
            .setValue(settings.readerVaultSync.hubRegenerateDelay)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.readerVaultSync.hubRegenerateDelay = value;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // FIELD ALIASES
    // ==========================================================================

    const aliasSection = createSection(containerEl, 'repeat', 'Field Aliases');

    createExplainerBox(aliasSection,
        'Field aliases allow multiple frontmatter keys to map to the same Calibre field. ' +
        'This is useful when migrating from other plugins or when different notes use different key names. ' +
        'The first alias in each list is used when writing to frontmatter.'
    );

    // Render alias list
    const aliasListEl = aliasSection.createDiv({ cls: 'amnesia-alias-list' });
    renderAliasListUI(aliasListEl, plugin);

    // Add new alias button
    new Setting(aliasSection)
        .setName('Add New Alias')
        .setDesc('Create a mapping for a new field')
        .addButton(button => button
            .setButtonText('Add Alias')
            .onClick(async () => {
                // Add a new empty alias
                settings.fieldAliases.push({
                    canonicalField: 'new_field',
                    aliases: ['new_field'],
                });
                await plugin.saveSettings();
                // Re-render the list
                aliasListEl.empty();
                renderAliasListUI(aliasListEl, plugin);
            }));

    // Export/Import
    createSubsectionHeader(aliasSection, 'Export/Import');

    new Setting(aliasSection)
        .setName('Export Aliases')
        .setDesc('Export field aliases as YAML for backup or sharing')
        .addButton(button => button
            .setButtonText('Copy to Clipboard')
            .onClick(async () => {
                const yaml = generateAliasYaml(settings.fieldAliases);
                await navigator.clipboard.writeText(yaml);
                // Show notification
                const notice = document.body.createDiv({
                    cls: 'notice',
                    text: 'Aliases copied to clipboard!',
                });
                setTimeout(() => notice.remove(), 2000);
            }));

    new Setting(aliasSection)
        .setName('Import Aliases')
        .setDesc('Import field aliases from YAML')
        .addTextArea(text => text
            .setPlaceholder('Paste YAML here...\n\ntitle:\n  - title\n  - book_name')
            .onChange(async () => {
                // Only parse when button is clicked
            }))
        .addButton(button => button
            .setButtonText('Import')
            .onClick(async () => {
                const textarea = aliasSection.querySelector('textarea');
                if (!textarea) return;

                const yaml = textarea.value;
                try {
                    const parsed = parseAliasYaml(yaml);
                    if (parsed.length > 0) {
                        settings.fieldAliases = parsed;
                        await plugin.saveSettings();
                        // Re-render the list
                        aliasListEl.empty();
                        renderAliasListUI(aliasListEl, plugin);
                        textarea.value = '';
                    }
                } catch (e) {
                    console.error('Failed to parse alias YAML:', e);
                }
            }));

    // ==========================================================================
    // RESUME & RECOVERY
    // ==========================================================================

    const resumeSection = createSection(containerEl, 'save', 'Resume & Recovery');

    new Setting(resumeSection)
        .setName('Enable Resume')
        .setDesc('Allow interrupted syncs to be resumed from where they left off')
        .addToggle(toggle => toggle
            .setValue(settings.unifiedSync.enableResume)
            .onChange(async (value) => {
                settings.unifiedSync.enableResume = value;
                await plugin.saveSettings();
            }));

    new Setting(resumeSection)
        .setName('Show Resume Notification')
        .setDesc('Show notification on startup if an incomplete sync can be resumed')
        .addToggle(toggle => toggle
            .setValue(settings.unifiedSync.showResumeNotification)
            .onChange(async (value) => {
                settings.unifiedSync.showResumeNotification = value;
                await plugin.saveSettings();
            }));

    new Setting(resumeSection)
        .setName('Checkpoint Interval')
        .setDesc('Save progress every N items (allows resume from last checkpoint)')
        .addSlider(slider => slider
            .setLimits(10, 500, 10)
            .setValue(settings.unifiedSync.checkpointInterval)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.unifiedSync.checkpointInterval = value;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // ADVANCED OPTIONS (Accordion)
    // ==========================================================================

    const advancedAccordion = new AdvancedAccordion(containerEl, {
        title: 'Performance Tuning',
        storageKey: 'amnesia-sync-advanced',
    });
    const advancedContent = advancedAccordion.render();

    new Setting(advancedContent)
        .setName('Concurrency')
        .setDesc('Maximum concurrent sync operations')
        .addSlider(slider => slider
            .setLimits(1, 20, 1)
            .setValue(settings.unifiedSync.concurrency)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.unifiedSync.concurrency = value;
                await plugin.saveSettings();
            }));

    new Setting(advancedContent)
        .setName('Rate Limit')
        .setDesc('Maximum requests per second')
        .addSlider(slider => slider
            .setLimits(1, 50, 1)
            .setValue(settings.unifiedSync.rateLimit)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.unifiedSync.rateLimit = value;
                await plugin.saveSettings();
            }));

    createSubsectionHeader(advancedContent, 'Cover Downloads');

    new Setting(advancedContent)
        .setName('Parallel Cover Downloads')
        .setDesc('Download multiple covers simultaneously during sync')
        .addToggle(toggle => toggle
            .setValue(settings.unifiedSync.parallelCoverDownloads)
            .onChange(async (value) => {
                settings.unifiedSync.parallelCoverDownloads = value;
                await plugin.saveSettings();
            }));

    new Setting(advancedContent)
        .setName('Cover Download Concurrency')
        .setDesc('Number of covers to download in parallel')
        .addSlider(slider => slider
            .setLimits(1, 20, 1)
            .setValue(settings.unifiedSync.coverDownloadConcurrency)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.unifiedSync.coverDownloadConcurrency = value;
                await plugin.saveSettings();
            }));

    createSubsectionHeader(advancedContent, 'Note Generation');

    new Setting(advancedContent)
        .setName('Batch Note Generation')
        .setDesc('Generate notes in batches for better performance')
        .addToggle(toggle => toggle
            .setValue(settings.unifiedSync.batchNoteGeneration)
            .onChange(async (value) => {
                settings.unifiedSync.batchNoteGeneration = value;
                await plugin.saveSettings();
            }));

    new Setting(advancedContent)
        .setName('Note Generation Batch Size')
        .setDesc('Number of notes to generate per batch')
        .addSlider(slider => slider
            .setLimits(10, 200, 10)
            .setValue(settings.unifiedSync.noteGenerationBatchSize)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.unifiedSync.noteGenerationBatchSize = value;
                await plugin.saveSettings();
            }));
}

// ============================================================================
// Alias Management Helper Functions
// ============================================================================

/**
 * Render the alias list UI
 */
function renderAliasListUI(containerEl: HTMLElement, plugin: AmnesiaPlugin): void {
    const { settings } = plugin;

    // Add styles if not already added
    addAliasStyles(containerEl);

    if (!settings.fieldAliases || settings.fieldAliases.length === 0) {
        containerEl.createEl('p', {
            text: 'No field aliases configured. Click "Add Alias" to create one.',
            cls: 'amnesia-alias-empty',
        });
        return;
    }

    for (let i = 0; i < settings.fieldAliases.length; i++) {
        const alias = settings.fieldAliases[i];
        renderAliasItem(containerEl, alias, i, plugin);
    }
}

/**
 * Render a single alias item
 */
function renderAliasItem(
    containerEl: HTMLElement,
    alias: FieldAlias,
    index: number,
    plugin: AmnesiaPlugin
): void {
    const { settings } = plugin;

    const itemEl = containerEl.createDiv({ cls: 'amnesia-alias-item' });

    // Canonical field (left side)
    const canonicalEl = itemEl.createDiv({ cls: 'amnesia-alias-canonical' });
    const canonicalInput = canonicalEl.createEl('input', {
        type: 'text',
        value: alias.canonicalField,
        placeholder: 'Calibre field',
    });
    canonicalInput.addClass('amnesia-alias-input');
    canonicalInput.addEventListener('change', async () => {
        settings.fieldAliases[index].canonicalField = canonicalInput.value;
        await plugin.saveSettings();
    });

    // Arrow
    itemEl.createSpan({ cls: 'amnesia-alias-arrow', text: '→' });

    // Aliases (right side)
    const aliasesEl = itemEl.createDiv({ cls: 'amnesia-alias-list-values' });
    const aliasesInput = aliasesEl.createEl('input', {
        type: 'text',
        value: alias.aliases.join(', '),
        placeholder: 'frontmatter keys (comma-separated)',
    });
    aliasesInput.addClass('amnesia-alias-input', 'amnesia-alias-values-input');
    aliasesInput.addEventListener('change', async () => {
        const aliases = aliasesInput.value
            .split(',')
            .map(a => a.trim())
            .filter(a => a.length > 0);
        if (aliases.length > 0) {
            settings.fieldAliases[index].aliases = aliases;
            await plugin.saveSettings();
        }
    });

    // Delete button
    const deleteBtn = itemEl.createEl('button', {
        cls: 'amnesia-alias-delete',
        text: '×',
    });
    deleteBtn.addEventListener('click', async () => {
        settings.fieldAliases.splice(index, 1);
        await plugin.saveSettings();
        // Re-render
        const parentEl = containerEl;
        parentEl.empty();
        renderAliasListUI(parentEl, plugin);
    });
}

/**
 * Generate YAML from field aliases
 */
function generateAliasYaml(aliases: FieldAlias[]): string {
    const lines: string[] = ['# Field Aliases for Amnesia', ''];

    for (const alias of aliases) {
        lines.push(`${alias.canonicalField}:`);
        for (const a of alias.aliases) {
            lines.push(`  - ${a}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Parse YAML to field aliases
 */
function parseAliasYaml(yaml: string): FieldAlias[] {
    const aliases: FieldAlias[] = [];
    const lines = yaml.split('\n');

    let currentField: string | null = null;
    let currentAliases: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();

        // Skip comments and empty lines
        if (trimmed.startsWith('#') || trimmed === '') {
            // Save previous field if exists
            if (currentField && currentAliases.length > 0) {
                aliases.push({
                    canonicalField: currentField,
                    aliases: currentAliases,
                });
                currentField = null;
                currentAliases = [];
            }
            continue;
        }

        // Check for field definition (ends with :)
        const fieldMatch = trimmed.match(/^([a-zA-Z0-9_]+):$/);
        if (fieldMatch) {
            // Save previous field if exists
            if (currentField && currentAliases.length > 0) {
                aliases.push({
                    canonicalField: currentField,
                    aliases: currentAliases,
                });
            }
            currentField = fieldMatch[1];
            currentAliases = [];
            continue;
        }

        // Check for alias item (starts with -)
        const aliasMatch = trimmed.match(/^-\s*(.+)$/);
        if (aliasMatch && currentField) {
            currentAliases.push(aliasMatch[1].trim());
        }
    }

    // Don't forget the last field
    if (currentField && currentAliases.length > 0) {
        aliases.push({
            canonicalField: currentField,
            aliases: currentAliases,
        });
    }

    return aliases;
}

/**
 * Add alias UI styles
 */
function addAliasStyles(containerEl: HTMLElement): void {
    const doc = containerEl.doc;
    const styleId = 'amnesia-alias-styles';
    if (doc.getElementById(styleId)) return;

    const style = doc.createElement('style');
    style.id = styleId;
    style.textContent = `
        .amnesia-alias-list {
            margin-bottom: 16px;
        }

        .amnesia-alias-empty {
            color: var(--text-muted);
            font-style: italic;
        }

        .amnesia-alias-item {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            padding: 8px;
            background: var(--background-secondary);
            border-radius: 6px;
        }

        .amnesia-alias-canonical {
            flex: 0 0 150px;
        }

        .amnesia-alias-arrow {
            color: var(--text-muted);
            font-weight: bold;
        }

        .amnesia-alias-list-values {
            flex: 1;
        }

        .amnesia-alias-input {
            width: 100%;
            padding: 4px 8px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 4px;
            background: var(--background-primary);
        }

        .amnesia-alias-values-input {
            font-family: monospace;
        }

        .amnesia-alias-delete {
            flex: 0 0 24px;
            width: 24px;
            height: 24px;
            padding: 0;
            border: none;
            background: var(--background-modifier-error);
            color: var(--text-on-accent);
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
        }

        .amnesia-alias-delete:hover {
            filter: brightness(1.1);
        }
    `;
    doc.head.appendChild(style);
}
