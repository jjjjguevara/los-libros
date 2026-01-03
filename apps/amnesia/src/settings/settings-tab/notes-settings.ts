/**
 * Notes Settings Tab
 *
 * Template configuration for book notes, highlights, and indexes.
 * Integrates the Liquid template system for customizable note generation.
 */

import { Setting } from 'obsidian';
import type AmnesiaPlugin from '../../main';
import {
    createTabHeader,
    createSection,
    createSubsectionHeader,
    createExplainerBox,
} from '../settings-ui/section-helpers';
import { renderTemplatesSettings, addTemplatesStyles } from '../templates-settings-tab';

export interface NotesSettingsProps {
    plugin: AmnesiaPlugin;
    containerEl: HTMLElement;
}

export function NotesSettings({ plugin, containerEl }: NotesSettingsProps): void {
    const { settings } = plugin;

    // ==========================================================================
    // TAB HEADER
    // ==========================================================================

    createTabHeader(
        containerEl,
        'Notes',
        'Configure note generation, templates, and folder organization.'
    );

    // ==========================================================================
    // NOTE ORGANIZATION
    // ==========================================================================

    const organizationSection = createSection(containerEl, 'folder', 'Note Organization');

    new Setting(organizationSection)
        .setName('Books Folder')
        .setDesc('Where book notes are created in your vault')
        .addText(text => text
            .setPlaceholder('Books')
            .setValue(settings.notesFolder)
            .onChange(async (value) => {
                settings.notesFolder = value;
                await plugin.saveSettings();
            }));

    new Setting(organizationSection)
        .setName('Highlight Notes Folder')
        .setDesc('Where highlight notes are stored')
        .addText(text => text
            .setPlaceholder('Highlights')
            .setValue(settings.highlightFolder)
            .onChange(async (value) => {
                settings.highlightFolder = value;
                await plugin.saveSettings();
            }));

    new Setting(organizationSection)
        .setName('Atomic Highlights')
        .setDesc('Create each highlight as a separate note for granular linking')
        .addToggle(toggle => toggle
            .setValue(settings.atomicHighlights)
            .onChange(async (value) => {
                settings.atomicHighlights = value;
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // NOTE GENERATION
    // ==========================================================================

    const generationSection = createSection(containerEl, 'file-plus', 'Note Generation');

    new Setting(generationSection)
        .setName('Auto-create Book Notes')
        .setDesc('Automatically create notes when syncing new books')
        .addToggle(toggle => toggle
            .setValue(settings.autoCreateBookNotes)
            .onChange(async (value) => {
                settings.autoCreateBookNotes = value;
                await plugin.saveSettings();
            }));

    new Setting(generationSection)
        .setName('Update Existing Notes')
        .setDesc('Update frontmatter when metadata changes')
        .addDropdown(dropdown => dropdown
            .addOption('never', 'Never')
            .addOption('frontmatter', 'Frontmatter only')
            .addOption('full', 'Full note (overwrites content)')
            .setValue(settings.noteUpdateMode)
            .onChange(async (value) => {
                settings.noteUpdateMode = value as 'never' | 'frontmatter' | 'full';
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // TEMPLATES SECTION
    // ==========================================================================

    const templatesContainer = containerEl.createDiv({ cls: 'amnesia-templates-container' });

    createSubsectionHeader(templatesContainer, 'Templates');

    createExplainerBox(templatesContainer,
        'Amnesia uses <strong>Liquid templates</strong> (Shopify syntax) to generate book notes. ' +
        'Each template type has access to different variables. ' +
        'Click on a template to expand and customize it.'
    );

    // Add template styles
    addTemplatesStyles(templatesContainer);

    // Render the full templates settings (accordions for each template type)
    renderTemplatesSettings(templatesContainer, plugin);

    // ==========================================================================
    // METADATA MAPPING (for unified sync)
    // ==========================================================================

    const mappingSection = createSection(containerEl, 'link', 'Metadata Mapping');

    createExplainerBox(mappingSection,
        'Configure how book metadata maps to Obsidian frontmatter fields. ' +
        'These mappings are used during sync with Calibre and the Amnesia server.'
    );

    createSubsectionHeader(mappingSection, 'Frontmatter Fields');

    new Setting(mappingSection)
        .setName('Author Field')
        .setDesc('Frontmatter field for book author(s)')
        .addText(text => text
            .setPlaceholder('author')
            .setValue(settings.frontmatterMapping?.author || 'author')
            .onChange(async (value) => {
                if (!settings.frontmatterMapping) settings.frontmatterMapping = {};
                settings.frontmatterMapping.author = value;
                await plugin.saveSettings();
            }));

    new Setting(mappingSection)
        .setName('Series Field')
        .setDesc('Frontmatter field for book series')
        .addText(text => text
            .setPlaceholder('series')
            .setValue(settings.frontmatterMapping?.series || 'series')
            .onChange(async (value) => {
                if (!settings.frontmatterMapping) settings.frontmatterMapping = {};
                settings.frontmatterMapping.series = value;
                await plugin.saveSettings();
            }));

    new Setting(mappingSection)
        .setName('Bookshelves/Tags Field')
        .setDesc('Frontmatter field for Calibre tags/bookshelves')
        .addText(text => text
            .setPlaceholder('bookshelves')
            .setValue(settings.frontmatterMapping?.bookshelves || 'bookshelves')
            .onChange(async (value) => {
                if (!settings.frontmatterMapping) settings.frontmatterMapping = {};
                settings.frontmatterMapping.bookshelves = value;
                await plugin.saveSettings();
            }));

    new Setting(mappingSection)
        .setName('Rating Field')
        .setDesc('Frontmatter field for book rating')
        .addText(text => text
            .setPlaceholder('rating')
            .setValue(settings.frontmatterMapping?.rating || 'rating')
            .onChange(async (value) => {
                if (!settings.frontmatterMapping) settings.frontmatterMapping = {};
                settings.frontmatterMapping.rating = value;
                await plugin.saveSettings();
            }));

    new Setting(mappingSection)
        .setName('Progress Field')
        .setDesc('Frontmatter field for reading progress percentage')
        .addText(text => text
            .setPlaceholder('progress')
            .setValue(settings.frontmatterMapping?.progress || 'progress')
            .onChange(async (value) => {
                if (!settings.frontmatterMapping) settings.frontmatterMapping = {};
                settings.frontmatterMapping.progress = value;
                await plugin.saveSettings();
            }));

    createSubsectionHeader(mappingSection, 'Wikilink Formatting');

    new Setting(mappingSection)
        .setName('Author Wikilinks')
        .setDesc('Format author names as wikilinks [[Author/Name|Name]]')
        .addToggle(toggle => toggle
            .setValue(settings.wikilinkAuthors ?? true)
            .onChange(async (value) => {
                settings.wikilinkAuthors = value;
                await plugin.saveSettings();
            }));

    new Setting(mappingSection)
        .setName('Series Wikilinks')
        .setDesc('Format series names as wikilinks [[Series/Name|Name]]')
        .addToggle(toggle => toggle
            .setValue(settings.wikilinkSeries ?? true)
            .onChange(async (value) => {
                settings.wikilinkSeries = value;
                await plugin.saveSettings();
            }));

    new Setting(mappingSection)
        .setName('Bookshelf Wikilinks')
        .setDesc('Format tags/bookshelves as wikilinks [[Estanterias/Tag|Tag]]')
        .addToggle(toggle => toggle
            .setValue(settings.wikilinkBookshelves ?? true)
            .onChange(async (value) => {
                settings.wikilinkBookshelves = value;
                await plugin.saveSettings();
            }));
}
