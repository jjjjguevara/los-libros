/**
 * Templates Settings Tab
 *
 * Settings UI for template customization following Doc Doctor patterns.
 * Features:
 * - Collapsible sections for each template type
 * - Textarea with syntax highlighting hints
 * - Variables reference
 * - Reset to default button
 * - Edit in Editor button (opens template in vault)
 */

import { App, Notice, Setting, TFile, normalizePath, setIcon } from 'obsidian';
import type LosLibrosPlugin from '../main';
import type { TemplateSettings, TemplateConfig } from '../templates/template-types';
import { TEMPLATE_VARIABLES, formatVariablesDescription } from '../templates/template-types';
import { DEFAULT_TEMPLATE_SETTINGS } from '../templates/default-templates';
import { FolderSuggestModal } from './folder-suggest';

/**
 * Template type metadata for UI
 */
interface TemplateTypeMeta {
  key: keyof TemplateSettings;
  name: string;
  description: string;
  icon: string;
}

const TEMPLATE_TYPES: TemplateTypeMeta[] = [
  {
    key: 'bookNote',
    name: 'Book Note',
    description: 'Template for book metadata notes',
    icon: 'book',
  },
  {
    key: 'hubHighlights',
    name: 'Hub Highlights',
    description: 'Aggregated highlights for a book',
    icon: 'highlighter',
  },
  {
    key: 'hubNotes',
    name: 'Hub Notes',
    description: 'Aggregated user notes for a book',
    icon: 'sticky-note',
  },
  {
    key: 'atomicHighlight',
    name: 'Atomic Highlight',
    description: 'Individual highlight note (advanced)',
    icon: 'quote',
  },
  {
    key: 'atomicNote',
    name: 'Atomic Note',
    description: 'Individual user note (advanced)',
    icon: 'edit',
  },
  {
    key: 'authorIndex',
    name: 'Author Index',
    description: 'Index page for an author',
    icon: 'user',
  },
  {
    key: 'seriesIndex',
    name: 'Series Index',
    description: 'Index page for a book series',
    icon: 'list-ordered',
  },
  {
    key: 'shelfIndex',
    name: 'Shelf Index',
    description: 'Index page for a bookshelf/tag',
    icon: 'bookmark',
  },
];

/**
 * Render the templates settings section
 */
export function renderTemplatesSettings(
  containerEl: HTMLElement,
  plugin: LosLibrosPlugin
): void {
  const settings = plugin.settings;

  // Header
  containerEl.createEl('h1', { text: 'Templates' });
  containerEl.createEl('p', {
    text: 'Customize the Liquid templates used for generating notes. Click on a template to expand and edit.',
    cls: 'setting-item-description',
  });

  // Templates folder setting
  let templatesFolderInput: HTMLInputElement;
  new Setting(containerEl)
    .setName('Custom templates folder')
    .setDesc('Folder for vault template overrides (optional)')
    .addText(text => {
      templatesFolderInput = text.inputEl;
      text.inputEl.style.width = '200px';
      text
        .setPlaceholder('Templates/Los Libros')
        .setValue(settings.templatesFolder)
        .onChange(async value => {
          settings.templatesFolder = value;
          await plugin.saveSettings();
        });
    })
    .addButton(button => {
      button.setButtonText('Browse').onClick(() => {
        const modal = new FolderSuggestModal(plugin.app, async folder => {
          settings.templatesFolder = folder.path;
          templatesFolderInput.value = folder.path;
          await plugin.saveSettings();
        });
        modal.open();
      });
    });

  // Separator
  containerEl.createEl('hr');

  // Template sections
  for (const templateMeta of TEMPLATE_TYPES) {
    renderTemplateSection(containerEl, plugin, templateMeta);
  }
}

/**
 * Render a single template section with accordion
 */
function renderTemplateSection(
  containerEl: HTMLElement,
  plugin: LosLibrosPlugin,
  meta: TemplateTypeMeta
): void {
  const settings = plugin.settings;
  const templateConfig = settings.templates[meta.key];
  const defaultConfig = DEFAULT_TEMPLATE_SETTINGS[meta.key];

  // Accordion container
  const accordionEl = containerEl.createDiv({ cls: 'll-template-accordion' });

  // Accordion header
  const headerEl = accordionEl.createDiv({ cls: 'll-template-accordion-header' });

  // Icon
  const iconEl = headerEl.createSpan({ cls: 'll-template-icon' });
  setIcon(iconEl, meta.icon);

  // Title and description
  const titleContainer = headerEl.createDiv({ cls: 'll-template-title-container' });
  titleContainer.createEl('span', { cls: 'll-template-title', text: meta.name });

  // Enabled badge
  const badgeEl = titleContainer.createSpan({
    cls: `ll-template-badge ${templateConfig.enabled ? 'enabled' : 'disabled'}`,
    text: templateConfig.enabled ? 'Enabled' : 'Disabled',
  });

  // Expand icon
  const expandIcon = headerEl.createSpan({ cls: 'll-template-expand-icon' });
  setIcon(expandIcon, 'chevron-down');

  // Accordion content (initially hidden)
  const contentEl = accordionEl.createDiv({ cls: 'll-template-accordion-content' });
  contentEl.style.display = 'none';

  // Toggle accordion
  headerEl.addEventListener('click', () => {
    const isOpen = contentEl.style.display !== 'none';
    contentEl.style.display = isOpen ? 'none' : 'block';
    expandIcon.empty();
    setIcon(expandIcon, isOpen ? 'chevron-down' : 'chevron-up');
  });

  // Description
  contentEl.createEl('p', {
    text: meta.description,
    cls: 'setting-item-description',
  });

  // Enabled toggle
  new Setting(contentEl)
    .setName('Enable')
    .setDesc('Generate notes using this template')
    .addToggle(toggle =>
      toggle.setValue(templateConfig.enabled).onChange(async value => {
        settings.templates[meta.key].enabled = value;
        badgeEl.textContent = value ? 'Enabled' : 'Disabled';
        badgeEl.className = `ll-template-badge ${value ? 'enabled' : 'disabled'}`;
        await plugin.saveSettings();
      })
    );

  // Folder setting
  let folderInput: HTMLInputElement;
  new Setting(contentEl)
    .setName('Output folder')
    .setDesc('Where to save generated notes')
    .addText(text => {
      folderInput = text.inputEl;
      text.inputEl.style.width = '200px';
      text
        .setPlaceholder(defaultConfig.folder)
        .setValue(templateConfig.folder)
        .onChange(async value => {
          settings.templates[meta.key].folder = value;
          await plugin.saveSettings();
        });
    })
    .addButton(button => {
      button.setButtonText('Browse').onClick(() => {
        const modal = new FolderSuggestModal(plugin.app, async folder => {
          settings.templates[meta.key].folder = folder.path;
          folderInput.value = folder.path;
          await plugin.saveSettings();
        });
        modal.open();
      });
    });

  // Variables reference
  const variablesEl = contentEl.createDiv({ cls: 'll-template-variables' });
  variablesEl.createEl('strong', { text: 'Variables: ' });
  variablesEl.createSpan({
    text: formatVariablesDescription(meta.key),
    cls: 'll-template-variables-list',
  });

  // Show all variables button
  const showAllBtn = variablesEl.createEl('button', {
    text: 'Show all',
    cls: 'll-template-show-all-btn',
  });

  const allVariablesEl = contentEl.createDiv({ cls: 'll-template-all-variables' });
  allVariablesEl.style.display = 'none';

  showAllBtn.addEventListener('click', () => {
    const isVisible = allVariablesEl.style.display !== 'none';
    allVariablesEl.style.display = isVisible ? 'none' : 'block';
    showAllBtn.textContent = isVisible ? 'Show all' : 'Hide';

    if (!isVisible) {
      allVariablesEl.empty();
      const table = allVariablesEl.createEl('table', { cls: 'll-variables-table' });
      const headerRow = table.createEl('tr');
      headerRow.createEl('th', { text: 'Variable' });
      headerRow.createEl('th', { text: 'Description' });

      for (const variable of TEMPLATE_VARIABLES[meta.key]) {
        const row = table.createEl('tr');
        row.createEl('td', { text: `{{${variable.name}}}`, cls: 'll-variable-name' });
        row.createEl('td', { text: variable.description });
      }
    }
  });

  // Template textarea
  new Setting(contentEl)
    .setName('Template')
    .setDesc('Liquid template content')
    .addTextArea(textarea => {
      textarea.inputEl.rows = 12;
      textarea.inputEl.style.width = '100%';
      textarea.inputEl.style.fontFamily = 'monospace';
      textarea.inputEl.style.fontSize = '12px';
      textarea
        .setPlaceholder('Enter your template...')
        .setValue(templateConfig.template)
        .onChange(async value => {
          settings.templates[meta.key].template = value;
          await plugin.saveSettings();
        });
    });

  // Action buttons
  const actionsEl = contentEl.createDiv({ cls: 'll-template-actions' });

  // Reset button
  const resetBtn = actionsEl.createEl('button', {
    text: 'Reset to Default',
    cls: 'll-template-reset-btn',
  });
  resetBtn.addEventListener('click', async () => {
    settings.templates[meta.key].template = defaultConfig.template;
    settings.templates[meta.key].folder = defaultConfig.folder;
    await plugin.saveSettings();
    new Notice(`${meta.name} template reset to default`);
    // Re-render the section
    accordionEl.empty();
    renderTemplateSection(containerEl, plugin, meta);
    accordionEl.remove();
  });

  // Edit in Editor button
  const editBtn = actionsEl.createEl('button', {
    text: 'Edit in Editor',
    cls: 'll-template-edit-btn',
  });
  editBtn.addEventListener('click', async () => {
    await openTemplateInEditor(plugin, meta.key, templateConfig);
  });
}

/**
 * Open a template file in the Obsidian editor
 */
async function openTemplateInEditor(
  plugin: LosLibrosPlugin,
  templateKey: keyof TemplateSettings,
  config: TemplateConfig
): Promise<void> {
  const app = plugin.app;
  const folder = plugin.settings.templatesFolder;
  const filename = `${templateKey}.liquid`;
  const filePath = normalizePath(`${folder}/${filename}`);

  try {
    // Ensure folder exists
    const folderFile = app.vault.getAbstractFileByPath(folder);
    if (!folderFile) {
      await app.vault.createFolder(folder);
    }

    // Check if file exists
    let file = app.vault.getAbstractFileByPath(filePath);

    if (!file) {
      // Create the file with current template content
      await app.vault.create(filePath, config.template);
      file = app.vault.getAbstractFileByPath(filePath);
      new Notice(`Created template file: ${filePath}`);
    }

    if (file instanceof TFile) {
      // Open the file in a new leaf
      const leaf = app.workspace.getLeaf('tab');
      await leaf.openFile(file);

      // Store reference for override detection
      plugin.settings.templates[templateKey].vaultTemplatePath = filePath;
      await plugin.saveSettings();
    }
  } catch (error) {
    console.error('Failed to open template in editor:', error);
    new Notice(`Failed to open template: ${error}`);
  }
}

/**
 * Add CSS styles for templates tab
 */
export function addTemplatesStyles(containerEl: HTMLElement): void {
  const style = containerEl.createEl('style');
  style.textContent = `
    .ll-template-accordion {
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
      margin-bottom: 12px;
      overflow: hidden;
    }

    .ll-template-accordion-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      cursor: pointer;
      background: var(--background-secondary);
      transition: background 0.2s ease;
    }

    .ll-template-accordion-header:hover {
      background: var(--background-modifier-hover);
    }

    .ll-template-icon {
      display: flex;
      align-items: center;
      color: var(--text-muted);
    }

    .ll-template-icon svg {
      width: 18px;
      height: 18px;
    }

    .ll-template-title-container {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ll-template-title {
      font-weight: 500;
    }

    .ll-template-badge {
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .ll-template-badge.enabled {
      background: var(--text-success);
      color: var(--background-primary);
    }

    .ll-template-badge.disabled {
      background: var(--background-modifier-border);
      color: var(--text-muted);
    }

    .ll-template-expand-icon {
      display: flex;
      align-items: center;
      color: var(--text-muted);
    }

    .ll-template-expand-icon svg {
      width: 16px;
      height: 16px;
    }

    .ll-template-accordion-content {
      padding: 16px;
      border-top: 1px solid var(--background-modifier-border);
    }

    .ll-template-variables {
      margin: 12px 0;
      padding: 8px 12px;
      background: var(--background-secondary);
      border-radius: 4px;
      font-size: 13px;
    }

    .ll-template-variables-list {
      color: var(--text-muted);
      font-family: monospace;
      font-size: 12px;
    }

    .ll-template-show-all-btn {
      margin-left: 8px;
      font-size: 12px;
      color: var(--text-accent);
      background: none;
      border: none;
      cursor: pointer;
      text-decoration: underline;
    }

    .ll-template-all-variables {
      margin: 8px 0;
      padding: 12px;
      background: var(--background-primary-alt);
      border-radius: 4px;
      max-height: 200px;
      overflow-y: auto;
    }

    .ll-variables-table {
      width: 100%;
      font-size: 12px;
      border-collapse: collapse;
    }

    .ll-variables-table th,
    .ll-variables-table td {
      padding: 4px 8px;
      text-align: left;
      border-bottom: 1px solid var(--background-modifier-border);
    }

    .ll-variables-table th {
      font-weight: 600;
      background: var(--background-secondary);
    }

    .ll-variable-name {
      font-family: monospace;
      color: var(--text-accent);
    }

    .ll-template-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    .ll-template-reset-btn,
    .ll-template-edit-btn {
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }

    .ll-template-reset-btn {
      background: var(--background-modifier-border);
      border: none;
      color: var(--text-normal);
    }

    .ll-template-reset-btn:hover {
      background: var(--background-modifier-hover);
    }

    .ll-template-edit-btn {
      background: var(--interactive-accent);
      border: none;
      color: var(--text-on-accent);
    }

    .ll-template-edit-btn:hover {
      background: var(--interactive-accent-hover);
    }
  `;
}
