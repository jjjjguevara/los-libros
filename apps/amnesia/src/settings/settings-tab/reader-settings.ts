/**
 * Reader Settings Tab
 *
 * Reading mode, layout, navigation, and progress sync settings.
 */

import { Setting } from 'obsidian';
import type AmnesiaPlugin from '../../main';
import {
    createTabHeader,
    createSection,
    createExplainerBox,
    createShortcutsTable,
} from '../settings-ui/section-helpers';

export interface ReaderSettingsProps {
    plugin: AmnesiaPlugin;
    containerEl: HTMLElement;
}

export function ReaderSettings({ plugin, containerEl }: ReaderSettingsProps): void {
    const { settings } = plugin;

    // ==========================================================================
    // TAB HEADER
    // ==========================================================================

    createTabHeader(
        containerEl,
        'Reading',
        'Configure reading experience, navigation, and progress tracking.'
    );

    // ==========================================================================
    // READING MODE
    // ==========================================================================

    const modeSection = createSection(containerEl, 'layout', 'Reading Mode');

    new Setting(modeSection)
        .setName('Paginated Reading')
        .setDesc('Display content in pages instead of continuous scroll')
        .addToggle(toggle => toggle
            .setValue(settings.paginated)
            .onChange(async (value) => {
                settings.paginated = value;
                await plugin.saveSettings();
            }));

    new Setting(modeSection)
        .setName('Default Theme')
        .setDesc('Color theme for the reader')
        .addDropdown(dropdown => dropdown
            .addOption('system', 'System (follow Obsidian)')
            .addOption('light', 'Light')
            .addOption('dark', 'Dark')
            .addOption('sepia', 'Sepia')
            .setValue(settings.defaultTheme)
            .onChange(async (value) => {
                settings.defaultTheme = value as 'system' | 'light' | 'dark' | 'sepia';
                await plugin.saveSettings();
            }));

    new Setting(modeSection)
        .setName('Default Font Size')
        .setDesc('Base font size in pixels')
        .addSlider(slider => slider
            .setLimits(10, 32, 1)
            .setValue(settings.defaultFontSize)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.defaultFontSize = value;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // PROGRESS & SYNC
    // ==========================================================================

    const progressSection = createSection(containerEl, 'cloud', 'Progress & Sync');

    new Setting(progressSection)
        .setName('Sync Reading Progress')
        .setDesc('Sync reading position with Calibre/server')
        .addToggle(toggle => toggle
            .setValue(settings.syncProgress)
            .onChange(async (value) => {
                settings.syncProgress = value;
                await plugin.saveSettings();
            }));

    new Setting(progressSection)
        .setName('Sync Highlights')
        .setDesc('Sync highlights with Calibre/server')
        .addToggle(toggle => toggle
            .setValue(settings.syncHighlights)
            .onChange(async (value) => {
                settings.syncHighlights = value;
                await plugin.saveSettings();
            }));

    new Setting(progressSection)
        .setName('Auto-sync Interval')
        .setDesc('Automatically sync every N minutes (0 = manual only)')
        .addSlider(slider => slider
            .setLimits(0, 60, 5)
            .setValue(settings.syncInterval)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.syncInterval = value;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // HIGHLIGHT SETTINGS
    // ==========================================================================

    const highlightSection = createSection(containerEl, 'highlighter', 'Highlight Settings');

    new Setting(highlightSection)
        .setName('Highlight Notes Folder')
        .setDesc('Where highlight notes are stored in your vault')
        .addText(text => text
            .setPlaceholder('Highlights')
            .setValue(settings.highlightFolder)
            .onChange(async (value) => {
                settings.highlightFolder = value;
                await plugin.saveSettings();
            }));

    new Setting(highlightSection)
        .setName('Atomic Highlights')
        .setDesc('Create each highlight as a separate note for granular linking')
        .addToggle(toggle => toggle
            .setValue(settings.atomicHighlights)
            .onChange(async (value) => {
                settings.atomicHighlights = value;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // KEYBOARD SHORTCUTS
    // ==========================================================================

    const shortcutsSection = createSection(containerEl, 'keyboard', 'Reader Keyboard Shortcuts');

    createExplainerBox(shortcutsSection,
        'These shortcuts are available while reading. Modify them in Obsidian Settings → Hotkeys.'
    );

    createShortcutsTable(shortcutsSection, [
        { key: '→ / Space / PageDown', action: 'Next page' },
        { key: '← / Shift+Space / PageUp', action: 'Previous page' },
        { key: 'Home', action: 'Go to beginning' },
        { key: 'End', action: 'Go to end' },
        { key: 'T', action: 'Toggle table of contents' },
        { key: 'F', action: 'Toggle fullscreen' },
        { key: 'Ctrl/Cmd + F', action: 'Search in book' },
        { key: '+ / =', action: 'Increase font size' },
        { key: '-', action: 'Decrease font size' },
        { key: '0', action: 'Reset font size' },
        { key: 'Esc', action: 'Close reader' },
    ]);
}
