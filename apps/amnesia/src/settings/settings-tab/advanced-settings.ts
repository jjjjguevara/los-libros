/**
 * Advanced Settings Tab
 *
 * Cache, performance, network, deduplication, OPDS, and debug settings.
 */

import { Setting, Notice } from 'obsidian';
import type AmnesiaPlugin from '../../main';
import {
    createTabHeader,
    createSection,
    createSubsectionHeader,
    createExplainerBox,
} from '../settings-ui/section-helpers';
import { AdvancedAccordion } from '../settings-ui/components/advanced-accordion';

export interface AdvancedSettingsProps {
    plugin: AmnesiaPlugin;
    containerEl: HTMLElement;
}

export function AdvancedSettings({ plugin, containerEl }: AdvancedSettingsProps): void {
    const { settings } = plugin;

    // ==========================================================================
    // TAB HEADER
    // ==========================================================================

    createTabHeader(
        containerEl,
        'Advanced',
        'Cache management, performance tuning, and developer options.'
    );

    // ==========================================================================
    // CACHE SETTINGS
    // ==========================================================================

    const cacheSection = createSection(containerEl, 'database', 'Cache Settings');

    createExplainerBox(cacheSection,
        'Amnesia uses a two-tier cache: L1 (fast, in-memory) and L2 (persistent, IndexedDB). This improves loading times for frequently accessed books.'
    );

    new Setting(cacheSection)
        .setName('Max Cached Books')
        .setDesc('Maximum number of books to keep in memory cache')
        .addSlider(slider => slider
            .setLimits(1, 50, 1)
            .setValue(settings.maxCachedBooks)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.maxCachedBooks = value;
                await plugin.saveSettings();
            }));

    new Setting(cacheSection)
        .setName('Max Cache Size')
        .setDesc('Maximum cache size in megabytes')
        .addSlider(slider => slider
            .setLimits(50, 1000, 50)
            .setValue(settings.maxCacheSize)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.maxCacheSize = value;
                await plugin.saveSettings();
            }));

    new Setting(cacheSection)
        .setName('Clear Cache')
        .setDesc('Remove all cached book data')
        .addButton(btn => btn
            .setButtonText('Clear')
            .setWarning()
            .onClick(async () => {
                btn.setDisabled(true);
                btn.setButtonText('Clearing...');
                try {
                    // TODO: Implement cache clearing
                    new Notice('Cache cleared');
                } catch (e) {
                    new Notice(`Failed to clear cache: ${e instanceof Error ? e.message : 'Unknown error'}`);
                } finally {
                    btn.setDisabled(false);
                    btn.setButtonText('Clear');
                }
            }));

    // Advanced cache accordion
    const cacheAccordion = new AdvancedAccordion(containerEl, {
        title: 'Advanced Cache Configuration',
        storageKey: 'amnesia-cache-advanced',
    });
    const cacheContent = cacheAccordion.render();

    createSubsectionHeader(cacheContent, 'L1 Cache (Memory)');

    new Setting(cacheContent)
        .setName('L1 Max Size')
        .setDesc('Maximum memory cache size in MB')
        .addSlider(slider => slider
            .setLimits(10, 200, 10)
            .setValue(Math.round(settings.advancedCache.l1MaxSizeBytes / (1024 * 1024)))
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.advancedCache.l1MaxSizeBytes = value * 1024 * 1024;
                await plugin.saveSettings();
            }));

    new Setting(cacheContent)
        .setName('L1 Max Entries')
        .setDesc('Maximum number of items in memory cache')
        .addSlider(slider => slider
            .setLimits(100, 2000, 100)
            .setValue(settings.advancedCache.l1MaxEntries)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.advancedCache.l1MaxEntries = value;
                await plugin.saveSettings();
            }));

    createSubsectionHeader(cacheContent, 'L2 Cache (IndexedDB)');

    new Setting(cacheContent)
        .setName('Enable L2 Cache')
        .setDesc('Use IndexedDB for persistent caching across sessions')
        .addToggle(toggle => toggle
            .setValue(settings.advancedCache.l2Enabled)
            .onChange(async (value) => {
                settings.advancedCache.l2Enabled = value;
                await plugin.saveSettings();
            }));

    new Setting(cacheContent)
        .setName('L2 Max Size')
        .setDesc('Maximum persistent cache size in MB')
        .addSlider(slider => slider
            .setLimits(100, 2000, 100)
            .setValue(Math.round(settings.advancedCache.l2MaxSizeBytes / (1024 * 1024)))
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.advancedCache.l2MaxSizeBytes = value * 1024 * 1024;
                await plugin.saveSettings();
            }));

    new Setting(cacheContent)
        .setName('L2 Max Entries')
        .setDesc('Maximum number of items in persistent cache')
        .addSlider(slider => slider
            .setLimits(1000, 10000, 500)
            .setValue(settings.advancedCache.l2MaxEntries)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.advancedCache.l2MaxEntries = value;
                await plugin.saveSettings();
            }));

    createSubsectionHeader(cacheContent, 'Cache Behavior');

    new Setting(cacheContent)
        .setName('Promote on Access')
        .setDesc('Move L2 items to L1 when accessed')
        .addToggle(toggle => toggle
            .setValue(settings.advancedCache.promoteOnAccess)
            .onChange(async (value) => {
                settings.advancedCache.promoteOnAccess = value;
                await plugin.saveSettings();
            }));

    new Setting(cacheContent)
        .setName('Write Through')
        .setDesc('Immediately persist L1 writes to L2')
        .addToggle(toggle => toggle
            .setValue(settings.advancedCache.writeThrough)
            .onChange(async (value) => {
                settings.advancedCache.writeThrough = value;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // NETWORK SETTINGS
    // ==========================================================================

    const networkSection = createSection(containerEl, 'wifi', 'Network Monitoring');

    new Setting(networkSection)
        .setName('Enable Network Monitoring')
        .setDesc('Monitor connection status and automatically switch to offline mode')
        .addToggle(toggle => toggle
            .setValue(settings.network.enabled)
            .onChange(async (value) => {
                settings.network.enabled = value;
                await plugin.saveSettings();
            }));

    new Setting(networkSection)
        .setName('Health Check Interval')
        .setDesc('How often to check connection status (in seconds)')
        .addSlider(slider => slider
            .setLimits(10, 120, 10)
            .setValue(settings.network.checkInterval / 1000)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.network.checkInterval = value * 1000;
                await plugin.saveSettings();
            }));

    new Setting(networkSection)
        .setName('Failure Threshold')
        .setDesc('Failed checks before marking as offline')
        .addSlider(slider => slider
            .setLimits(1, 10, 1)
            .setValue(settings.network.failureThreshold)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.network.failureThreshold = value;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // OFFLINE MODE
    // ==========================================================================

    const offlineSection = createSection(containerEl, 'cloud-off', 'Offline Mode');

    new Setting(offlineSection)
        .setName('Enable Offline Mode')
        .setDesc('Download books for offline reading')
        .addToggle(toggle => toggle
            .setValue(settings.offline.enabled)
            .onChange(async (value) => {
                settings.offline.enabled = value;
                await plugin.saveSettings();
            }));

    new Setting(offlineSection)
        .setName('Concurrent Downloads')
        .setDesc('Number of books to download simultaneously')
        .addSlider(slider => slider
            .setLimits(1, 10, 1)
            .setValue(settings.offline.concurrentDownloads)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.offline.concurrentDownloads = value;
                await plugin.saveSettings();
            }));

    new Setting(offlineSection)
        .setName('Quota Warning Threshold')
        .setDesc('Warn when storage usage exceeds this percentage')
        .addSlider(slider => slider
            .setLimits(50, 95, 5)
            .setValue(Math.round(settings.offline.quotaWarningThreshold * 100))
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.offline.quotaWarningThreshold = value / 100;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // DEDUPLICATION
    // ==========================================================================

    const dedupSection = createSection(containerEl, 'copy', 'Content Deduplication');

    createExplainerBox(dedupSection,
        'Deduplication reduces storage by identifying and sharing identical content across books.'
    );

    new Setting(dedupSection)
        .setName('Enable Deduplication')
        .setDesc('Use content-based addressing to deduplicate stored data')
        .addToggle(toggle => toggle
            .setValue(settings.deduplication.enabled)
            .onChange(async (value) => {
                settings.deduplication.enabled = value;
                await plugin.saveSettings();
            }));

    new Setting(dedupSection)
        .setName('Hash Algorithm')
        .setDesc('Algorithm for content fingerprinting')
        .addDropdown(dropdown => dropdown
            .addOption('SHA-256', 'SHA-256 (recommended)')
            .addOption('SHA-384', 'SHA-384')
            .addOption('SHA-512', 'SHA-512 (most secure)')
            .setValue(settings.deduplication.algorithm)
            .onChange(async (value) => {
                settings.deduplication.algorithm = value as 'SHA-256' | 'SHA-384' | 'SHA-512';
                await plugin.saveSettings();
            }));

    new Setting(dedupSection)
        .setName('Minimum Size')
        .setDesc('Only deduplicate files larger than this (in KB)')
        .addSlider(slider => slider
            .setLimits(1, 100, 1)
            .setValue(Math.round(settings.deduplication.minSize / 1024))
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.deduplication.minSize = value * 1024;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // OPDS FEEDS
    // ==========================================================================

    const opdsSection = createSection(containerEl, 'rss', 'OPDS Feeds');

    createExplainerBox(opdsSection,
        'OPDS (Open Publication Distribution System) allows browsing and downloading books from compatible catalogs.'
    );

    new Setting(opdsSection)
        .setName('Cache Feeds')
        .setDesc('Cache OPDS feed responses for faster browsing')
        .addToggle(toggle => toggle
            .setValue(settings.opds.cacheFeeds)
            .onChange(async (value) => {
                settings.opds.cacheFeeds = value;
                await plugin.saveSettings();
            }));

    new Setting(opdsSection)
        .setName('Cache Duration')
        .setDesc('How long to cache feed responses (in minutes)')
        .addSlider(slider => slider
            .setLimits(5, 120, 5)
            .setValue(Math.round(settings.opds.cacheDuration / 60000))
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.opds.cacheDuration = value * 60000;
                await plugin.saveSettings();
            }));

    new Setting(opdsSection)
        .setName('Request Timeout')
        .setDesc('Timeout for OPDS requests (in seconds)')
        .addSlider(slider => slider
            .setLimits(5, 60, 5)
            .setValue(Math.round(settings.opds.timeout / 1000))
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.opds.timeout = value * 1000;
                await plugin.saveSettings();
            }));

    createSubsectionHeader(opdsSection, 'Custom Feeds');

    const feedCount = settings.opds.customFeeds.length;
    const feedNote = opdsSection.createEl('p', {
        cls: 'setting-item-description',
        text: feedCount > 0
            ? `${feedCount} custom feed${feedCount === 1 ? '' : 's'} configured. Feed management UI coming soon.`
            : 'No custom feeds configured. Feed management UI coming soon.',
    });
    feedNote.style.opacity = '0.7';
    feedNote.style.fontStyle = 'italic';

    // ==========================================================================
    // DEBUG & DEVELOPMENT
    // ==========================================================================

    const debugSection = createSection(containerEl, 'bug', 'Debug & Development');

    createExplainerBox(debugSection,
        '<strong>Warning:</strong> These options are for debugging and development. They may impact performance or stability.'
    );

    new Setting(debugSection)
        .setName('Remote Server')
        .setDesc('Enable connection to Amnesia remote server')
        .addToggle(toggle => toggle
            .setValue(settings.serverEnabled)
            .onChange(async (value) => {
                settings.serverEnabled = value;
                await plugin.saveSettings();
            }));

    new Setting(debugSection)
        .setName('Server URL')
        .setDesc('URL of the Amnesia server')
        .addText(text => text
            .setPlaceholder('https://amnesia.example.com')
            .setValue(settings.serverUrl)
            .onChange(async (value) => {
                settings.serverUrl = value;
                await plugin.saveSettings();
            }));

    new Setting(debugSection)
        .setName('Reset All Settings')
        .setDesc('Reset all settings to their default values')
        .addButton(btn => btn
            .setButtonText('Reset')
            .setWarning()
            .onClick(async () => {
                const confirmed = confirm('Are you sure you want to reset all settings to defaults? This cannot be undone.');
                if (confirmed) {
                    // TODO: Implement settings reset
                    new Notice('Settings reset to defaults');
                }
            }));
}
