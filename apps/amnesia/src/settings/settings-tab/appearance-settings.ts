/**
 * Appearance Settings Tab
 *
 * Typography, themes, and library view customization.
 */

import { Setting } from 'obsidian';
import type AmnesiaPlugin from '../../main';
import {
    createTabHeader,
    createSection,
    createSubsectionHeader,
    createExplainerBox,
} from '../settings-ui/section-helpers';

export interface AppearanceSettingsProps {
    plugin: AmnesiaPlugin;
    containerEl: HTMLElement;
}

export function AppearanceSettings({ plugin, containerEl }: AppearanceSettingsProps): void {
    const { settings } = plugin;

    // ==========================================================================
    // TAB HEADER
    // ==========================================================================

    createTabHeader(
        containerEl,
        'Appearance',
        'Customize the visual appearance of the reader and library views.'
    );

    // ==========================================================================
    // READER THEME
    // ==========================================================================

    const themeSection = createSection(containerEl, 'palette', 'Reader Theme');

    new Setting(themeSection)
        .setName('Default Reader Theme')
        .setDesc('Color scheme for the book reader')
        .addDropdown(dropdown => dropdown
            .addOption('system', 'System (follow Obsidian)')
            .addOption('light', 'Light')
            .addOption('dark', 'Dark')
            .addOption('sepia', 'Sepia (warm, paper-like)')
            .setValue(settings.defaultTheme)
            .onChange(async (value) => {
                settings.defaultTheme = value as 'system' | 'light' | 'dark' | 'sepia';
                await plugin.saveSettings();
            }));

    createExplainerBox(themeSection,
        'Individual books can override this theme. Per-book settings are saved automatically.'
    );

    // ==========================================================================
    // TYPOGRAPHY
    // ==========================================================================

    const typographySection = createSection(containerEl, 'type', 'Typography');

    new Setting(typographySection)
        .setName('Default Font Size')
        .setDesc('Base font size for reading (in pixels)')
        .addSlider(slider => slider
            .setLimits(10, 32, 1)
            .setValue(settings.defaultFontSize)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.defaultFontSize = value;
                await plugin.saveSettings();
            }));

    createExplainerBox(typographySection,
        'Font family is inherited from your Obsidian theme. To change it, modify your theme or use a CSS snippet.'
    );

    // ==========================================================================
    // COVER IMAGES
    // ==========================================================================

    const coversSection = createSection(containerEl, 'image', 'Cover Images');

    new Setting(coversSection)
        .setName('Generate Thumbnails')
        .setDesc('Create smaller thumbnail versions of book covers for faster loading')
        .addToggle(toggle => toggle
            .setValue(settings.assets.generateThumbnails)
            .onChange(async (value) => {
                settings.assets.generateThumbnails = value;
                await plugin.saveSettings();
            }));

    new Setting(coversSection)
        .setName('Thumbnail Size')
        .setDesc('Maximum dimension for thumbnails (in pixels)')
        .addSlider(slider => slider
            .setLimits(100, 400, 20)
            .setValue(settings.assets.thumbnailMaxSize)
            .setDynamicTooltip()
            .onChange(async (value) => {
                settings.assets.thumbnailMaxSize = value;
                await plugin.saveSettings();
            }));

    new Setting(coversSection)
        .setName('Covers Folder')
        .setDesc('Vault folder where cover images are stored')
        .addText(text => text
            .setPlaceholder('Attachments/covers')
            .setValue(settings.calibreCoversFolder)
            .onChange(async (value) => {
                settings.calibreCoversFolder = value;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // LIBRARY VIEW
    // ==========================================================================

    const librarySection = createSection(containerEl, 'grid', 'Library View');

    createExplainerBox(librarySection,
        'Library view settings control how your book collection is displayed in the sidebar.'
    );

    createSubsectionHeader(librarySection, 'Display Options');

    const libraryNote = librarySection.createEl('p', {
        cls: 'setting-item-description',
        text: 'Additional library view customization options will be added here based on the library implementation.',
    });
    libraryNote.style.opacity = '0.7';
    libraryNote.style.fontStyle = 'italic';

    // ==========================================================================
    // ASSET EXPORT
    // ==========================================================================

    const assetSection = createSection(containerEl, 'download', 'Asset Export');

    new Setting(assetSection)
        .setName('Export Folder')
        .setDesc('Default folder for exported book assets (images, etc.)')
        .addText(text => text
            .setPlaceholder('Assets/Books')
            .setValue(settings.assets.exportFolder)
            .onChange(async (value) => {
                settings.assets.exportFolder = value;
                await plugin.saveSettings();
            }));
}
