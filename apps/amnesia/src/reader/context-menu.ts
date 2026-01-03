/**
 * Reader Context Menu
 *
 * Provides right-click context menu functionality for the EPUB reader
 * with Doc Doctor AI integration placeholders.
 */

import { Menu, Notice } from 'obsidian';
import type { HighlightColor } from '../library/types';

export interface ContextMenuOptions {
  /** Selected text (if any) */
  selectedText?: string;
  /** CFI of selection */
  selectionCfi?: string;
  /** Whether clicking on an existing highlight */
  isHighlight?: boolean;
  /** Existing highlight data */
  highlightData?: {
    id: string;
    color: HighlightColor;
    text: string;
    annotation?: string;
  };
  /** Callbacks */
  onHighlight?: (color: HighlightColor) => void;
  onCopyText?: () => void;
  onCopyLink?: () => void;
  onLookup?: (text: string) => void;
  onSearchInVault?: (text: string) => void;
  onCreateNote?: (text: string) => void;
  /** Doc Doctor AI callbacks (placeholders) */
  onAIExplain?: (text: string) => void;
  onAISummarize?: (text: string) => void;
  onAITranslate?: (text: string) => void;
  onAIDefine?: (text: string) => void;
  onAIAnalyze?: (text: string) => void;
}

/**
 * Show the reader context menu
 */
export function showReaderContextMenu(
  event: MouseEvent,
  options: ContextMenuOptions
): void {
  const menu = new Menu();

  const hasSelection = options.selectedText && options.selectedText.trim().length > 0;
  const selectedText = options.selectedText?.trim() || '';
  const shortText = selectedText.length > 30
    ? selectedText.slice(0, 30) + '...'
    : selectedText;

  // === Selection Actions ===
  if (hasSelection) {
    menu.addItem((item) => {
      item
        .setTitle('Copy')
        .setIcon('copy')
        .onClick(() => {
          if (options.onCopyText) {
            options.onCopyText();
          } else {
            navigator.clipboard.writeText(selectedText);
            new Notice('Copied to clipboard');
          }
        });
    });

    menu.addSeparator();

    // === Highlight Colors ===
    menu.addItem((item) => {
      item
        .setTitle('Highlight Yellow')
        .setIcon('highlighter')
        .onClick(() => options.onHighlight?.('yellow'));
    });

    menu.addItem((item) => {
      item
        .setTitle('Highlight Green')
        .setIcon('highlighter')
        .onClick(() => options.onHighlight?.('green'));
    });

    menu.addItem((item) => {
      item
        .setTitle('Highlight Blue')
        .setIcon('highlighter')
        .onClick(() => options.onHighlight?.('blue'));
    });

    menu.addItem((item) => {
      item
        .setTitle('Highlight Pink')
        .setIcon('highlighter')
        .onClick(() => options.onHighlight?.('pink'));
    });

    menu.addItem((item) => {
      item
        .setTitle('Highlight Purple')
        .setIcon('highlighter')
        .onClick(() => options.onHighlight?.('purple'));
    });

    menu.addSeparator();

    // === Vault Integration ===
    menu.addItem((item) => {
      item
        .setTitle(`Search in vault: "${shortText}"`)
        .setIcon('search')
        .onClick(() => {
          if (options.onSearchInVault) {
            options.onSearchInVault(selectedText);
          } else {
            // Default: open Obsidian search
            (window as any).app?.internalPlugins?.plugins?.['global-search']?.instance?.openGlobalSearch(selectedText);
          }
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Create note from selection')
        .setIcon('file-plus')
        .onClick(() => {
          if (options.onCreateNote) {
            options.onCreateNote(selectedText);
          } else {
            new Notice('Create note: Coming soon');
          }
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Copy link to selection')
        .setIcon('link')
        .onClick(() => {
          if (options.onCopyLink) {
            options.onCopyLink();
          } else {
            new Notice('Link copied');
          }
        });
    });

    menu.addSeparator();

    // === Doc Doctor AI Integration (Placeholders) ===
    menu.addItem((item) => {
      item
        .setTitle('Explain with AI')
        .setIcon('bot')
        .onClick(() => {
          if (options.onAIExplain) {
            options.onAIExplain(selectedText);
          } else {
            new Notice('Doc Doctor AI: Explain - Coming soon');
          }
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Summarize with AI')
        .setIcon('bot')
        .onClick(() => {
          if (options.onAISummarize) {
            options.onAISummarize(selectedText);
          } else {
            new Notice('Doc Doctor AI: Summarize - Coming soon');
          }
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Define with AI')
        .setIcon('bot')
        .onClick(() => {
          if (options.onAIDefine) {
            options.onAIDefine(selectedText);
          } else {
            new Notice('Doc Doctor AI: Define - Coming soon');
          }
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Translate with AI')
        .setIcon('languages')
        .onClick(() => {
          if (options.onAITranslate) {
            options.onAITranslate(selectedText);
          } else {
            new Notice('Doc Doctor AI: Translate - Coming soon');
          }
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Analyze with AI')
        .setIcon('sparkles')
        .onClick(() => {
          if (options.onAIAnalyze) {
            options.onAIAnalyze(selectedText);
          } else {
            new Notice('Doc Doctor AI: Analyze - Coming soon');
          }
        });
    });
  }

  // === Existing Highlight Actions ===
  if (options.isHighlight && options.highlightData) {
    if (hasSelection) {
      menu.addSeparator();
    }

    menu.addItem((item) => {
      item
        .setTitle('Edit highlight note')
        .setIcon('edit')
        .onClick(() => {
          new Notice('Edit highlight: Coming soon');
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Change highlight color')
        .setIcon('palette')
        .onClick(() => {
          new Notice('Change color: Coming soon');
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Delete highlight')
        .setIcon('trash')
        .onClick(() => {
          new Notice('Delete highlight: Coming soon');
        });
    });
  }

  // === No Selection - General Actions ===
  if (!hasSelection && !options.isHighlight) {
    menu.addItem((item) => {
      item
        .setTitle('Add bookmark here')
        .setIcon('bookmark')
        .onClick(() => {
          new Notice('Bookmark added');
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Go to page...')
        .setIcon('arrow-right')
        .onClick(() => {
          new Notice('Go to page: Coming soon');
        });
    });
  }

  menu.showAtMouseEvent(event);
}

/**
 * Handle context menu event in the reader
 */
export function handleReaderContextMenu(
  event: MouseEvent,
  getSelectedText: () => string | null,
  getSelectionCfi: () => string | null,
  callbacks: Partial<ContextMenuOptions>
): void {
  event.preventDefault();
  event.stopPropagation();

  const selectedText = getSelectedText() || undefined;
  const selectionCfi = getSelectionCfi() || undefined;

  showReaderContextMenu(event, {
    selectedText,
    selectionCfi,
    ...callbacks,
  });
}
