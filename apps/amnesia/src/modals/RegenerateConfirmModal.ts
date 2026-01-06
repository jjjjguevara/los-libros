/**
 * Regenerate Confirmation Modal
 *
 * Shows a warning before regenerating a book note from template.
 * This is a destructive operation that will overwrite user content.
 */

import { App, Modal, Setting } from 'obsidian';

export interface RegenerateConfirmResult {
  confirmed: boolean;
  preserveUserContent: boolean;
}

export class RegenerateConfirmModal extends Modal {
  private result: RegenerateConfirmResult = {
    confirmed: false,
    preserveUserContent: true,
  };
  private resolvePromise: ((result: RegenerateConfirmResult) => void) | null = null;
  private bookTitle: string;
  private notePath: string;

  constructor(app: App, bookTitle: string, notePath: string) {
    super(app);
    this.bookTitle = bookTitle;
    this.notePath = notePath;
  }

  /**
   * Open the modal and return a promise that resolves with the user's choice
   */
  openAndWait(): Promise<RegenerateConfirmResult> {
    return new Promise(resolve => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('amnesia-regenerate-confirm-modal');

    // Header with warning icon
    const headerEl = contentEl.createDiv({ cls: 'modal-header' });
    headerEl.createEl('h2', { text: 'Regenerate Book Note' });

    // Warning message
    const warningEl = contentEl.createDiv({ cls: 'warning-message' });
    warningEl.createEl('p', {
      text: 'You are about to regenerate the note for:',
    });
    warningEl.createEl('p', {
      text: this.bookTitle,
      cls: 'book-title',
    });
    warningEl.createEl('p', {
      text: this.notePath,
      cls: 'note-path',
    });

    // Warning explanation
    const explainEl = contentEl.createDiv({ cls: 'explanation' });
    explainEl.createEl('p', {
      text: 'This will re-render the note from the template. Depending on your choice below:',
    });

    const listEl = explainEl.createEl('ul');
    listEl.createEl('li', {
      text: 'Preserve user content: Content inside {% persist %} blocks and outside section markers will be kept.',
    });
    listEl.createEl('li', {
      text: 'Full regenerate: The entire note will be replaced with fresh template output. All custom content will be lost.',
    });

    // Options
    const optionsEl = contentEl.createDiv({ cls: 'options-section' });

    new Setting(optionsEl)
      .setName('Preserve user content')
      .setDesc('Keep content inside {% persist %} blocks and outside managed sections')
      .addToggle(toggle =>
        toggle
          .setValue(this.result.preserveUserContent)
          .onChange(value => {
            this.result.preserveUserContent = value;
          })
      );

    // Action buttons
    const buttonsEl = contentEl.createDiv({ cls: 'button-section' });

    const cancelBtn = buttonsEl.createEl('button', {
      text: 'Cancel',
      cls: 'mod-secondary',
    });
    cancelBtn.addEventListener('click', () => {
      this.result.confirmed = false;
      this.close();
    });

    const confirmBtn = buttonsEl.createEl('button', {
      text: 'Regenerate',
      cls: 'mod-warning',
    });
    confirmBtn.addEventListener('click', () => {
      this.result.confirmed = true;
      this.close();
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();

    if (this.resolvePromise) {
      this.resolvePromise(this.result);
      this.resolvePromise = null;
    }
  }
}

/**
 * Add CSS styles for the regenerate modal
 */
export function addRegenerateModalStyles(doc: Document): void {
  const styleId = 'amnesia-regenerate-modal-styles';
  if (doc.getElementById(styleId)) return;

  const style = doc.createElement('style');
  style.id = styleId;
  style.textContent = `
    .amnesia-regenerate-confirm-modal {
      padding: 20px;
    }

    .amnesia-regenerate-confirm-modal .modal-header h2 {
      margin-bottom: 16px;
      color: var(--text-warning);
    }

    .amnesia-regenerate-confirm-modal .warning-message {
      background: var(--background-modifier-warning);
      border: 1px solid var(--text-warning);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }

    .amnesia-regenerate-confirm-modal .warning-message p {
      margin: 4px 0;
    }

    .amnesia-regenerate-confirm-modal .book-title {
      font-weight: 600;
      font-size: 1.1em;
    }

    .amnesia-regenerate-confirm-modal .note-path {
      font-family: monospace;
      font-size: 0.9em;
      color: var(--text-muted);
    }

    .amnesia-regenerate-confirm-modal .explanation {
      margin-bottom: 16px;
    }

    .amnesia-regenerate-confirm-modal .explanation ul {
      margin-left: 20px;
      margin-top: 8px;
    }

    .amnesia-regenerate-confirm-modal .explanation li {
      margin-bottom: 8px;
    }

    .amnesia-regenerate-confirm-modal .options-section {
      margin-bottom: 20px;
    }

    .amnesia-regenerate-confirm-modal .button-section {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 20px;
    }

    .amnesia-regenerate-confirm-modal .button-section button {
      padding: 8px 20px;
      border-radius: 4px;
      cursor: pointer;
    }

    .amnesia-regenerate-confirm-modal .button-section .mod-secondary {
      background: var(--background-modifier-border);
      border: none;
    }

    .amnesia-regenerate-confirm-modal .button-section .mod-warning {
      background: var(--text-warning);
      color: var(--background-primary);
      border: none;
    }

    .amnesia-regenerate-confirm-modal .button-section .mod-warning:hover {
      filter: brightness(1.1);
    }
  `;
  doc.head.appendChild(style);
}
