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
    // INLINE MODE
    // ==========================================================================

    const inlineSection = createSection(containerEl, 'layout', 'Inline Mode');

    createExplainerBox(inlineSection,
        'Inline mode embeds highlights and notes directly in the book note instead of creating separate files. ' +
        'Content is placed in managed sections (marked with HTML comments) that are updated during sync without touching your custom content.'
    );

    new Setting(inlineSection)
        .setName('Inline Highlights')
        .setDesc('Embed highlights in the book note instead of creating separate files')
        .addToggle(toggle => toggle
            .setValue(settings.inlineMode?.inlineHighlights ?? false)
            .onChange(async (value) => {
                if (!settings.inlineMode) {
                    settings.inlineMode = {
                        inlineHighlights: false,
                        inlineNotes: false,
                        highlightsSectionId: 'HIGHLIGHTS',
                        notesSectionId: 'NOTES',
                    };
                }
                settings.inlineMode.inlineHighlights = value;
                await plugin.saveSettings();
            }));

    new Setting(inlineSection)
        .setName('Inline Notes')
        .setDesc('Embed notes in the book note instead of creating separate files')
        .addToggle(toggle => toggle
            .setValue(settings.inlineMode?.inlineNotes ?? false)
            .onChange(async (value) => {
                if (!settings.inlineMode) {
                    settings.inlineMode = {
                        inlineHighlights: false,
                        inlineNotes: false,
                        highlightsSectionId: 'HIGHLIGHTS',
                        notesSectionId: 'NOTES',
                    };
                }
                settings.inlineMode.inlineNotes = value;
                await plugin.saveSettings();
            }));

    new Setting(inlineSection)
        .setName('Highlights Section ID')
        .setDesc('HTML comment marker ID for highlights section (e.g., HIGHLIGHTS → <!-- AMNESIA:HIGHLIGHTS:START -->)')
        .addText(text => text
            .setPlaceholder('HIGHLIGHTS')
            .setValue(settings.inlineMode?.highlightsSectionId ?? 'HIGHLIGHTS')
            .onChange(async (value) => {
                if (!settings.inlineMode) {
                    settings.inlineMode = {
                        inlineHighlights: false,
                        inlineNotes: false,
                        highlightsSectionId: 'HIGHLIGHTS',
                        notesSectionId: 'NOTES',
                    };
                }
                settings.inlineMode.highlightsSectionId = value || 'HIGHLIGHTS';
                await plugin.saveSettings();
            }));

    new Setting(inlineSection)
        .setName('Notes Section ID')
        .setDesc('HTML comment marker ID for notes section (e.g., NOTES → <!-- AMNESIA:NOTES:START -->)')
        .addText(text => text
            .setPlaceholder('NOTES')
            .setValue(settings.inlineMode?.notesSectionId ?? 'NOTES')
            .onChange(async (value) => {
                if (!settings.inlineMode) {
                    settings.inlineMode = {
                        inlineHighlights: false,
                        inlineNotes: false,
                        highlightsSectionId: 'HIGHLIGHTS',
                        notesSectionId: 'NOTES',
                    };
                }
                settings.inlineMode.notesSectionId = value || 'NOTES';
                await plugin.saveSettings();
            }));

    // ==========================================================================
    // PER-BOOK TEMPLATE OVERRIDES
    // ==========================================================================

    const perBookSection = createSection(containerEl, 'file-code', 'Per-Book Templates');

    createExplainerBox(perBookSection,
        'Allow individual books to use custom templates by setting a frontmatter flag. ' +
        'When enabled, notes with the flag will preserve their existing structure during sync.'
    );

    new Setting(perBookSection)
        .setName('Enable Per-Book Templates')
        .setDesc('Allow books to override global templates via frontmatter')
        .addToggle(toggle => toggle
            .setValue(settings.perBookTemplates?.enabled ?? true)
            .onChange(async (value) => {
                if (!settings.perBookTemplates) {
                    settings.perBookTemplates = {
                        enabled: true,
                        frontmatterFlag: 'customTemplate',
                        respectStructure: true,
                    };
                }
                settings.perBookTemplates.enabled = value;
                await plugin.saveSettings();
            }));

    new Setting(perBookSection)
        .setName('Frontmatter Flag')
        .setDesc('Frontmatter key that marks a note as using custom template (set to true)')
        .addText(text => text
            .setPlaceholder('customTemplate')
            .setValue(settings.perBookTemplates?.frontmatterFlag ?? 'customTemplate')
            .onChange(async (value) => {
                if (!settings.perBookTemplates) {
                    settings.perBookTemplates = {
                        enabled: true,
                        frontmatterFlag: 'customTemplate',
                        respectStructure: true,
                    };
                }
                settings.perBookTemplates.frontmatterFlag = value || 'customTemplate';
                await plugin.saveSettings();
            }));

    new Setting(perBookSection)
        .setName('Respect Note Structure')
        .setDesc('When flag is set, sync only updates frontmatter and doesn\'t regenerate body')
        .addToggle(toggle => toggle
            .setValue(settings.perBookTemplates?.respectStructure ?? true)
            .onChange(async (value) => {
                if (!settings.perBookTemplates) {
                    settings.perBookTemplates = {
                        enabled: true,
                        frontmatterFlag: 'customTemplate',
                        respectStructure: true,
                    };
                }
                settings.perBookTemplates.respectStructure = value;
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
