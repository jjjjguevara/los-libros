/**
 * PDF Context Menu
 *
 * Right-click context menu for PDF page operations.
 * Supports single and multi-page actions.
 */

export interface ContextMenuAction {
  /** Display label */
  label: string;
  /** Icon (optional, can be emoji or SVG) */
  icon?: string;
  /** Action handler */
  action: (pages: number[]) => void | Promise<void>;
  /** Show divider before this item */
  divider?: boolean;
  /** Disable this action */
  disabled?: boolean;
  /** Only show for single page selection */
  singlePageOnly?: boolean;
  /** Only show for multi-page selection */
  multiPageOnly?: boolean;
}

/**
 * Context menu for PDF operations
 */
export class PdfContextMenu {
  private menu: HTMLElement | null = null;
  private boundHandleOutsideClick: (e: MouseEvent) => void;
  private boundHandleKeydown: (e: KeyboardEvent) => void;

  constructor() {
    this.boundHandleOutsideClick = this.handleOutsideClick.bind(this);
    this.boundHandleKeydown = this.handleKeydown.bind(this);
  }

  /**
   * Show context menu at position
   */
  show(x: number, y: number, pages: number[], actions: ContextMenuAction[]): void {
    this.hide();

    this.menu = document.createElement('div');
    this.menu.className = 'pdf-context-menu';
    this.menu.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      background: var(--background-primary, white);
      border: 1px solid var(--background-modifier-border, #ddd);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      min-width: 180px;
      max-width: 280px;
      z-index: 10000;
      overflow: hidden;
      font-size: 13px;
    `;

    // Header showing selection
    const header = document.createElement('div');
    header.className = 'pdf-context-menu-header';
    header.style.cssText = `
      padding: 8px 12px;
      font-weight: 600;
      color: var(--text-normal, #333);
      border-bottom: 1px solid var(--background-modifier-border, #eee);
      background: var(--background-secondary, #f8f8f8);
    `;
    header.textContent = pages.length === 1
      ? `Page ${pages[0]}`
      : `${pages.length} pages selected`;
    this.menu.appendChild(header);

    // Filter actions based on selection count
    const filteredActions = actions.filter((action) => {
      if (action.singlePageOnly && pages.length > 1) return false;
      if (action.multiPageOnly && pages.length === 1) return false;
      return true;
    });

    // Actions container
    const actionsContainer = document.createElement('div');
    actionsContainer.style.cssText = `
      padding: 4px 0;
    `;

    for (const action of filteredActions) {
      if (action.divider) {
        const divider = document.createElement('hr');
        divider.style.cssText = `
          margin: 4px 0;
          border: none;
          border-top: 1px solid var(--background-modifier-border, #eee);
        `;
        actionsContainer.appendChild(divider);
      }

      const item = document.createElement('button');
      item.className = 'pdf-context-menu-item';
      item.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 12px;
        background: none;
        border: none;
        cursor: ${action.disabled ? 'not-allowed' : 'pointer'};
        text-align: left;
        color: ${action.disabled ? 'var(--text-muted, #888)' : 'var(--text-normal, #333)'};
        font-size: 13px;
        transition: background 0.1s;
      `;

      if (action.icon) {
        const icon = document.createElement('span');
        icon.style.cssText = `
          width: 16px;
          text-align: center;
          font-size: 14px;
        `;
        icon.textContent = action.icon;
        item.appendChild(icon);
      }

      const label = document.createElement('span');
      label.textContent = action.label;
      item.appendChild(label);

      if (!action.disabled) {
        item.addEventListener('click', async () => {
          this.hide();
          try {
            await action.action(pages);
          } catch (error) {
            console.error('Context menu action failed:', error);
          }
        });

        item.addEventListener('mouseover', () => {
          item.style.background = 'var(--background-modifier-hover, #f0f0f0)';
        });

        item.addEventListener('mouseout', () => {
          item.style.background = 'none';
        });
      }

      actionsContainer.appendChild(item);
    }

    this.menu.appendChild(actionsContainer);
    document.body.appendChild(this.menu);

    // Adjust position if menu goes off-screen
    this.adjustPosition();

    // Add event listeners
    requestAnimationFrame(() => {
      document.addEventListener('click', this.boundHandleOutsideClick);
      document.addEventListener('keydown', this.boundHandleKeydown);
    });
  }

  /**
   * Hide context menu
   */
  hide(): void {
    if (this.menu) {
      this.menu.remove();
      this.menu = null;
      document.removeEventListener('click', this.boundHandleOutsideClick);
      document.removeEventListener('keydown', this.boundHandleKeydown);
    }
  }

  /**
   * Check if menu is visible
   */
  get visible(): boolean {
    return this.menu !== null;
  }

  /**
   * Adjust menu position to stay on screen
   */
  private adjustPosition(): void {
    if (!this.menu) return;

    const rect = this.menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Adjust horizontal position
    if (rect.right > viewportWidth - 10) {
      this.menu.style.left = `${viewportWidth - rect.width - 10}px`;
    }

    // Adjust vertical position
    if (rect.bottom > viewportHeight - 10) {
      this.menu.style.top = `${viewportHeight - rect.height - 10}px`;
    }
  }

  /**
   * Handle clicks outside menu
   */
  private handleOutsideClick(e: MouseEvent): void {
    if (this.menu && !this.menu.contains(e.target as Node)) {
      this.hide();
    }
  }

  /**
   * Handle keyboard events
   */
  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.hide();
    }
  }

  /**
   * Destroy the context menu
   */
  destroy(): void {
    this.hide();
  }
}

/**
 * Create default context menu actions for PDF pages
 */
export function createDefaultPdfActions(callbacks: {
  onGoToPage: (page: number) => void;
  onCopyAsImage: (pages: number[]) => Promise<void>;
  onExportAsImage: (pages: number[]) => Promise<void>;
  onPrintPages: (pages: number[]) => Promise<void>;
  onRotateClockwise: (pages: number[]) => void;
  onRotateCounterClockwise: (pages: number[]) => void;
  onCopyToNote: (pages: number[]) => Promise<void>;
}): ContextMenuAction[] {
  return [
    {
      label: 'Go to page',
      icon: '→',
      action: (pages) => callbacks.onGoToPage(pages[0]),
      singlePageOnly: true,
    },
    {
      label: 'Copy as image',
      icon: '📋',
      action: callbacks.onCopyAsImage,
      divider: true,
    },
    {
      label: 'Export as PNG',
      icon: '💾',
      action: callbacks.onExportAsImage,
    },
    {
      label: 'Print pages',
      icon: '🖨️',
      action: callbacks.onPrintPages,
    },
    {
      label: 'Rotate clockwise',
      icon: '↻',
      action: callbacks.onRotateClockwise,
      divider: true,
    },
    {
      label: 'Rotate counter-clockwise',
      icon: '↺',
      action: callbacks.onRotateCounterClockwise,
    },
    {
      label: 'Copy to note',
      icon: '📝',
      action: callbacks.onCopyToNote,
      divider: true,
    },
  ];
}
