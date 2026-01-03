import { FuzzySuggestModal, TFolder, setIcon, type FuzzyMatch, type App } from 'obsidian';

/**
 * Modal for selecting a folder from the vault
 * Following Doc Doctor's FolderSuggestModal pattern for consistent UX
 */
export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  private folders: TFolder[];
  private onSelect: (folder: TFolder) => void;

  constructor(app: App, onSelect: (folder: TFolder) => void) {
    super(app);
    this.onSelect = onSelect;

    // Get all folders from vault
    this.folders = [];
    const rootFolder = app.vault.getRoot();
    this.collectFolders(rootFolder);

    // Sort alphabetically
    this.folders.sort((a, b) => a.path.localeCompare(b.path));

    this.setPlaceholder('Type to search for a folder...');
  }

  private collectFolders(folder: TFolder): void {
    // Add this folder (skip root which has empty path)
    if (folder.path) {
      this.folders.push(folder);
    }
    // Recursively add children
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        this.collectFolders(child);
      }
    }
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(folder: TFolder): string {
    return folder.path;
  }

  onChooseItem(folder: TFolder, _evt: MouseEvent | KeyboardEvent): void {
    this.onSelect(folder);
  }

  renderSuggestion(match: FuzzyMatch<TFolder>, el: HTMLElement): void {
    const folder = match.item;
    const container = el.createDiv({ cls: 'll-folder-suggestion' });
    const iconEl = container.createSpan({ cls: 'll-folder-icon' });
    setIcon(iconEl, 'folder');
    container.createSpan({ text: folder.path });
  }
}
