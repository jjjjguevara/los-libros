/**
 * Library Settings Tab
 *
 * Calibre connection, folder configuration, and note creation settings.
 */

import { Setting, Notice } from 'obsidian';
import type AmnesiaPlugin from '../../main';
import {
    createTabHeader,
    createSection,
    createSubsectionHeader,
    createExplainerBox,
} from '../settings-ui/section-helpers';

export interface LibrarySettingsProps {
    plugin: AmnesiaPlugin;
    containerEl: HTMLElement;
}

export function LibrarySettings({ plugin, containerEl }: LibrarySettingsProps): void {
    const { settings } = plugin;

    // ==========================================================================
    // TAB HEADER
    // ==========================================================================

    createTabHeader(
        containerEl,
        'Library',
        'Connect to Calibre and configure your book library organization.'
    );

    // ==========================================================================
    // CALIBRE CONTENT SERVER
    // ==========================================================================

    const serverSection = createSection(containerEl, 'server', 'Calibre Content Server');

    createExplainerBox(serverSection,
        'Connect to Calibre Content Server to sync your library. Start the server in Calibre via Connect/Share → Start Content Server.'
    );

    new Setting(serverSection)
        .setName('Enable Content Server')
        .setDesc('Connect to Calibre Content Server for library access')
        .addToggle(toggle => toggle
            .setValue(settings.calibreContentServerEnabled)
            .onChange(async (value) => {
                settings.calibreContentServerEnabled = value;
                await plugin.saveSettings();
            }));

    new Setting(serverSection)
        .setName('Server URL')
        .setDesc('URL of your Calibre Content Server (e.g., http://localhost:8080)')
        .addText(text => text
            .setPlaceholder('http://localhost:8080')
            .setValue(settings.calibreContentServerUrl)
            .onChange(async (value) => {
                settings.calibreContentServerUrl = value;
                await plugin.saveSettings();
            }));

    new Setting(serverSection)
        .setName('Username')
        .setDesc('Username for Content Server authentication (if enabled)')
        .addText(text => text
            .setPlaceholder('Optional')
            .setValue(settings.calibreContentServerUsername)
            .onChange(async (value) => {
                settings.calibreContentServerUsername = value;
                await plugin.saveSettings();
            }));

    new Setting(serverSection)
        .setName('Password')
        .setDesc('Password for Content Server authentication')
        .addText(text => {
            text.inputEl.type = 'password';
            text.setPlaceholder('Optional')
                .setValue(settings.calibreContentServerPassword)
                .onChange(async (value) => {
                    settings.calibreContentServerPassword = value;
                    await plugin.saveSettings();
                });
        });

    new Setting(serverSection)
        .setName('Test Connection')
        .setDesc('Verify connection to Calibre Content Server')
        .addButton(btn => btn
            .setButtonText('Test')
            .setCta()
            .onClick(async () => {
                btn.setDisabled(true);
                btn.setButtonText('Testing...');
                try {
                    const response = await fetch(`${settings.calibreContentServerUrl}/ajax/library-info`, {
                        headers: settings.calibreContentServerUsername ? {
                            'Authorization': 'Basic ' + btoa(`${settings.calibreContentServerUsername}:${settings.calibreContentServerPassword}`)
                        } : {},
                    });
                    if (response.ok) {
                        new Notice('Connection successful!');
                    } else {
                        new Notice(`Connection failed: ${response.status} ${response.statusText}`);
                    }
                } catch (e) {
                    new Notice(`Connection failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
                } finally {
                    btn.setDisabled(false);
                    btn.setButtonText('Test');
                }
            }));

    // ==========================================================================
    // LOCAL LIBRARY
    // ==========================================================================

    const localSection = createSection(containerEl, 'folder', 'Local Library');

    new Setting(localSection)
        .setName('Enable Calibre Integration')
        .setDesc('Enable full Calibre library integration (metadata, covers, sync)')
        .addToggle(toggle => toggle
            .setValue(settings.calibreEnabled)
            .onChange(async (value) => {
                settings.calibreEnabled = value;
                await plugin.saveSettings();
            }));

    new Setting(localSection)
        .setName('Calibre Library Path')
        .setDesc('Path to your Calibre library folder on disk')
        .addText(text => text
            .setPlaceholder('/path/to/Calibre Library')
            .setValue(settings.calibreLibraryPath)
            .onChange(async (value) => {
                settings.calibreLibraryPath = value;
                await plugin.saveSettings();
            }));

    new Setting(localSection)
        .setName('Local Books Folder')
        .setDesc('Vault folder for locally stored books (not from Calibre)')
        .addText(text => text
            .setPlaceholder('Books')
            .setValue(settings.localBooksFolder)
            .onChange(async (value) => {
                settings.localBooksFolder = value;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // VAULT FOLDERS
    // ==========================================================================

    const foldersSection = createSection(containerEl, 'folder-tree', 'Vault Folders');

    createExplainerBox(foldersSection,
        'Configure where Amnesia creates notes and stores files in your vault. All paths are relative to your vault root.'
    );

    new Setting(foldersSection)
        .setName('Book Notes Folder')
        .setDesc('Where book notes are created')
        .addText(text => text
            .setPlaceholder('Florilegios')
            .setValue(settings.calibreBookNotesFolder)
            .onChange(async (value) => {
                settings.calibreBookNotesFolder = value;
                await plugin.saveSettings();
            }));

    new Setting(foldersSection)
        .setName('Author Index Folder')
        .setDesc('Where author index notes are created')
        .addText(text => text
            .setPlaceholder('Autores')
            .setValue(settings.calibreAuthorIndexFolder)
            .onChange(async (value) => {
                settings.calibreAuthorIndexFolder = value;
                await plugin.saveSettings();
            }));

    new Setting(foldersSection)
        .setName('Series Index Folder')
        .setDesc('Where series index notes are created')
        .addText(text => text
            .setPlaceholder('Series')
            .setValue(settings.calibreSeriesIndexFolder)
            .onChange(async (value) => {
                settings.calibreSeriesIndexFolder = value;
                await plugin.saveSettings();
            }));

    new Setting(foldersSection)
        .setName('Shelf Index Folder')
        .setDesc('Where shelf/tag index notes are created')
        .addText(text => text
            .setPlaceholder('Estanterias')
            .setValue(settings.calibreShelfIndexFolder)
            .onChange(async (value) => {
                settings.calibreShelfIndexFolder = value;
                await plugin.saveSettings();
            }));

    new Setting(foldersSection)
        .setName('Highlights Folder')
        .setDesc('Where highlight notes are created')
        .addText(text => text
            .setPlaceholder('Subrayados')
            .setValue(settings.calibreHighlightsFolder)
            .onChange(async (value) => {
                settings.calibreHighlightsFolder = value;
                await plugin.saveSettings();
            }));

    new Setting(foldersSection)
        .setName('Base Index Folder')
        .setDesc('Where main index files are stored')
        .addText(text => text
            .setPlaceholder('Indices')
            .setValue(settings.calibreBaseFilesFolder)
            .onChange(async (value) => {
                settings.calibreBaseFilesFolder = value;
                await plugin.saveSettings();
            }));

    new Setting(foldersSection)
        .setName('Covers Folder')
        .setDesc('Where book cover images are stored')
        .addText(text => text
            .setPlaceholder('Attachments/covers')
            .setValue(settings.calibreCoversFolder)
            .onChange(async (value) => {
                settings.calibreCoversFolder = value;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // NOTE CREATION
    // ==========================================================================

    const notesSection = createSection(containerEl, 'file-text', 'Note Creation');

    new Setting(notesSection)
        .setName('Auto-create Book Notes')
        .setDesc('Automatically create a note when opening a book for the first time')
        .addToggle(toggle => toggle
            .setValue(settings.autoCreateBookNotes)
            .onChange(async (value) => {
                settings.autoCreateBookNotes = value;
                await plugin.saveSettings();
            }));

    new Setting(notesSection)
        .setName('Templates Folder')
        .setDesc('Vault folder containing custom templates')
        .addText(text => text
            .setPlaceholder('Templates/Amnesia')
            .setValue(settings.templatesFolder)
            .onChange(async (value) => {
                settings.templatesFolder = value;
                await plugin.saveSettings();
            }));

    createSubsectionHeader(notesSection, 'Highlight Notes');

    new Setting(notesSection)
        .setName('Atomic Highlights')
        .setDesc('Create each highlight as a separate note (enables backlinks per highlight)')
        .addToggle(toggle => toggle
            .setValue(settings.atomicHighlights)
            .onChange(async (value) => {
                settings.atomicHighlights = value;
                await plugin.saveSettings();
            }));
}
