/**
 * Sync Settings Tab
 *
 * Unified sync engine, conflict resolution, and sync options.
 */

import { Setting } from 'obsidian';
import type AmnesiaPlugin from '../../main';
import type { SyncDirection, ConflictResolution, SyncableField } from '../../calibre/calibre-types';
import type { UnifiedConflictStrategy, UnifiedSyncMode } from '../settings';
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
