/**
 * Mobile Reflow
 *
 * Converts PDF structured text to responsive HTML for mobile reading.
 * Uses text layer data with character positions and font info to generate
 * semantic HTML that reflows naturally on different screen sizes.
 *
 * @example
 * ```typescript
 * import { MobileReflowRenderer } from './mobile-reflow';
 *
 * const renderer = new MobileReflowRenderer();
 * const html = renderer.renderPage(textLayerData);
 * container.innerHTML = html;
 * ```
 */

import type { PdfTextLayerData, PdfTextItem } from '../types';

/**
 * Reflow configuration
 */
export interface ReflowConfig {
  /** Base font size in px (default: 16) */
  baseFontSize?: number;
  /** Line height multiplier (default: 1.6) */
  lineHeight?: number;
  /** Horizontal padding in px (default: 16) */
  padding?: number;
  /** Maximum content width in px (default: 600) */
  maxWidth?: number;
  /** Font family (default: system fonts) */
  fontFamily?: string;
  /** Enable hyphenation (default: true) */
  enableHyphenation?: boolean;
  /** Preserve approximate paragraph breaks (default: true) */
  preserveParagraphs?: boolean;
}

const DEFAULT_CONFIG: Required<ReflowConfig> = {
  baseFontSize: 16,
  lineHeight: 1.6,
  padding: 16,
  maxWidth: 600,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  enableHyphenation: true,
  preserveParagraphs: true,
};

/**
 * Processed text block for reflow
 */
interface TextBlock {
  type: 'heading' | 'paragraph' | 'list-item' | 'code';
  level?: number; // For headings: 1-6
  content: FormattedSpan[];
  indent: number;
}

/**
 * Formatted text span
 */
interface FormattedSpan {
  text: string;
  isBold: boolean;
  isItalic: boolean;
  isMonospace: boolean;
  fontSize: number;
}

/**
 * Mobile reflow renderer
 */
export class MobileReflowRenderer {
  private config: Required<ReflowConfig>;

  constructor(config: ReflowConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<ReflowConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Render text layer data as responsive HTML
   */
  renderPage(data: PdfTextLayerData): string {
    if (!data.items || data.items.length === 0) {
      return '<div class="reflow-empty">No text content available</div>';
    }

    const blocks = this.extractBlocks(data);
    const html = this.blocksToHtml(blocks);

    return `
      <div class="reflow-container" style="${this.getContainerStyles()}">
        ${html}
      </div>
    `;
  }

  /**
   * Get the base CSS for reflowed content
   */
  getStyles(): string {
    return `
      .reflow-container {
        ${this.getContainerStyles()}
      }

      .reflow-container h1,
      .reflow-container h2,
      .reflow-container h3,
      .reflow-container h4,
      .reflow-container h5,
      .reflow-container h6 {
        margin-top: 1.5em;
        margin-bottom: 0.5em;
        line-height: 1.3;
        font-weight: 600;
      }

      .reflow-container h1 { font-size: 1.75em; }
      .reflow-container h2 { font-size: 1.5em; }
      .reflow-container h3 { font-size: 1.25em; }
      .reflow-container h4 { font-size: 1.1em; }
      .reflow-container h5 { font-size: 1em; }
      .reflow-container h6 { font-size: 0.9em; }

      .reflow-container p {
        margin: 0 0 1em 0;
        text-align: justify;
        ${this.config.enableHyphenation ? 'hyphens: auto;' : ''}
      }

      .reflow-container .list-item {
        margin: 0.25em 0;
        padding-left: 1.5em;
        position: relative;
      }

      .reflow-container .list-item::before {
        content: "\\2022";
        position: absolute;
        left: 0.5em;
      }

      .reflow-container code {
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
        background: rgba(0, 0, 0, 0.05);
        padding: 0.1em 0.3em;
        border-radius: 3px;
        font-size: 0.9em;
      }

      .reflow-container .code-block {
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
        background: rgba(0, 0, 0, 0.05);
        padding: 1em;
        border-radius: 4px;
        overflow-x: auto;
        margin: 1em 0;
        font-size: 0.85em;
        white-space: pre-wrap;
      }

      .reflow-container .indented {
        margin-left: 1.5em;
      }

      .reflow-empty {
        text-align: center;
        color: #888;
        padding: 2em;
        font-style: italic;
      }

      /* Dark mode support */
      .theme-dark .reflow-container {
        color: #e0e0e0;
      }

      .theme-dark .reflow-container code,
      .theme-dark .reflow-container .code-block {
        background: rgba(255, 255, 255, 0.1);
      }
    `;
  }

  /**
   * Get container styles as inline CSS
   */
  private getContainerStyles(): string {
    return `
      font-family: ${this.config.fontFamily};
      font-size: ${this.config.baseFontSize}px;
      line-height: ${this.config.lineHeight};
      padding: ${this.config.padding}px;
      max-width: ${this.config.maxWidth}px;
      margin: 0 auto;
      word-wrap: break-word;
      overflow-wrap: break-word;
    `.replace(/\n/g, ' ').trim();
  }

  /**
   * Extract semantic blocks from text items
   */
  private extractBlocks(data: PdfTextLayerData): TextBlock[] {
    const blocks: TextBlock[] = [];
    const avgFontSize = this.calculateAverageFontSize(data.items);
    const avgX = this.calculateAverageX(data.items);

    // Group items by approximate Y position (lines)
    const lines = this.groupIntoLines(data.items, data.height);

    let currentBlock: TextBlock | null = null;
    let lastY = 0;

    for (const line of lines) {
      const lineText = line.map((item) => item.text).join(' ').trim();
      if (!lineText) continue;

      const lineFontSize = this.getLineFontSize(line);
      const lineIndent = this.getLineIndent(line, avgX, data.width);
      const headingLevel = this.getHeadingLevel(lineFontSize, avgFontSize);
      const isBullet = this.detectBullet(lineText);
      const isCodeLine = this.detectCodeLine(line);

      // Determine block type
      let blockType: TextBlock['type'] = 'paragraph';
      if (headingLevel > 0) {
        blockType = 'heading';
      } else if (isBullet) {
        blockType = 'list-item';
      } else if (isCodeLine) {
        blockType = 'code';
      }

      // Create spans for this line
      const spans = this.createSpans(line);

      // Check for paragraph break (significant Y gap)
      const y = line[0]?.y ?? 0;
      const yGap = y - lastY;
      const isParagraphBreak =
        this.config.preserveParagraphs && yGap > lineFontSize * 1.5;

      // Should we start a new block?
      const shouldStartNew =
        !currentBlock ||
        currentBlock.type !== blockType ||
        headingLevel > 0 ||
        isBullet ||
        isCodeLine ||
        isParagraphBreak;

      if (shouldStartNew) {
        if (currentBlock && currentBlock.content.length > 0) {
          blocks.push(currentBlock);
        }
        currentBlock = {
          type: blockType,
          level: headingLevel > 0 ? headingLevel : undefined,
          content: spans,
          indent: lineIndent,
        };
      } else if (currentBlock) {
        // Continue current block - add space and append
        if (currentBlock.content.length > 0) {
          const lastSpan = currentBlock.content[currentBlock.content.length - 1];
          lastSpan.text += ' ';
        }
        currentBlock.content.push(...spans);
      }

      lastY = y;
    }

    // Don't forget the last block
    if (currentBlock && currentBlock.content.length > 0) {
      blocks.push(currentBlock);
    }

    return blocks;
  }

  /**
   * Group text items into lines based on Y position
   */
  private groupIntoLines(items: PdfTextItem[], pageHeight: number): PdfTextItem[][] {
    if (items.length === 0) return [];

    // Sort by Y then X
    const sorted = [...items].sort((a, b) => {
      const yDiff = a.y - b.y;
      if (Math.abs(yDiff) < 3) return a.x - b.x; // Same line
      return yDiff;
    });

    const lines: PdfTextItem[][] = [];
    let currentLine: PdfTextItem[] = [];
    let currentY = sorted[0].y;

    for (const item of sorted) {
      // If Y differs significantly, start new line
      if (Math.abs(item.y - currentY) > item.height * 0.5) {
        if (currentLine.length > 0) {
          // Sort line by X position
          currentLine.sort((a, b) => a.x - b.x);
          lines.push(currentLine);
        }
        currentLine = [item];
        currentY = item.y;
      } else {
        currentLine.push(item);
      }
    }

    // Don't forget last line
    if (currentLine.length > 0) {
      currentLine.sort((a, b) => a.x - b.x);
      lines.push(currentLine);
    }

    return lines;
  }

  /**
   * Calculate average font size from items
   */
  private calculateAverageFontSize(items: PdfTextItem[]): number {
    if (items.length === 0) return 12;

    let sum = 0;
    let count = 0;

    for (const item of items) {
      if (item.fontSize > 0) {
        sum += item.fontSize;
        count++;
      }
    }

    return count > 0 ? sum / count : 12;
  }

  /**
   * Calculate average X position (left margin)
   */
  private calculateAverageX(items: PdfTextItem[]): number {
    if (items.length === 0) return 0;

    const xValues = items.map((item) => item.x).filter((x) => x > 0);
    if (xValues.length === 0) return 0;

    // Use the mode or median of the most common X positions
    xValues.sort((a, b) => a - b);
    return xValues[Math.floor(xValues.length / 4)] ?? 0;
  }

  /**
   * Get dominant font size for a line
   */
  private getLineFontSize(line: PdfTextItem[]): number {
    if (line.length === 0) return 12;

    let sum = 0;
    let count = 0;

    for (const item of line) {
      if (item.fontSize > 0) {
        sum += item.fontSize;
        count++;
      }
    }

    return count > 0 ? sum / count : 12;
  }

  /**
   * Calculate indent level based on X position
   */
  private getLineIndent(line: PdfTextItem[], avgX: number, pageWidth: number): number {
    if (line.length === 0) return 0;

    const firstX = line[0].x;
    const indentThreshold = pageWidth * 0.05; // 5% of page width

    if (firstX > avgX + indentThreshold) {
      return Math.floor((firstX - avgX) / indentThreshold);
    }

    return 0;
  }

  /**
   * Determine heading level based on font size ratio
   */
  private getHeadingLevel(fontSize: number, avgFontSize: number): number {
    const ratio = fontSize / avgFontSize;

    if (ratio >= 2.0) return 1;
    if (ratio >= 1.5) return 2;
    if (ratio >= 1.25) return 3;
    if (ratio >= 1.15) return 4;

    return 0;
  }

  /**
   * Detect if a line starts with a bullet point
   */
  private detectBullet(text: string): boolean {
    const trimmed = text.trimStart();
    return /^[•·▪▸►◆○●\-\*]\s/.test(trimmed);
  }

  /**
   * Detect if a line is likely code (monospace font)
   */
  private detectCodeLine(line: PdfTextItem[]): boolean {
    if (line.length === 0) return false;

    // Check if any item has monospace font
    for (const item of line) {
      if (item.charPositions) {
        for (const char of item.charPositions) {
          if (char.fontName && this.isMonospaceFont(char.fontName)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Check if font name indicates monospace
   */
  private isMonospaceFont(fontName: string): boolean {
    const lower = fontName.toLowerCase();
    return (
      lower.includes('mono') ||
      lower.includes('courier') ||
      lower.includes('consolas') ||
      lower.includes('menlo') ||
      lower.includes('code')
    );
  }

  /**
   * Check if font name indicates bold
   */
  private isBoldFont(fontName: string): boolean {
    const lower = fontName.toLowerCase();
    return (
      lower.includes('bold') ||
      lower.includes('black') ||
      lower.includes('heavy') ||
      lower.includes('semibold')
    );
  }

  /**
   * Check if font name indicates italic
   */
  private isItalicFont(fontName: string): boolean {
    const lower = fontName.toLowerCase();
    return lower.includes('italic') || lower.includes('oblique');
  }

  /**
   * Create formatted spans from line items
   */
  private createSpans(line: PdfTextItem[]): FormattedSpan[] {
    const spans: FormattedSpan[] = [];

    for (const item of line) {
      // If we have character positions with font info, use them
      if (item.charPositions && item.charPositions.length > 0) {
        let currentSpan: FormattedSpan | null = null;

        for (const char of item.charPositions) {
          const fontName = char.fontName ?? '';
          const isBold = this.isBoldFont(fontName);
          const isItalic = this.isItalicFont(fontName);
          const isMono = this.isMonospaceFont(fontName);

          if (
            currentSpan &&
            currentSpan.isBold === isBold &&
            currentSpan.isItalic === isItalic &&
            currentSpan.isMonospace === isMono
          ) {
            currentSpan.text += char.char;
          } else {
            if (currentSpan) {
              spans.push(currentSpan);
            }
            currentSpan = {
              text: char.char,
              isBold,
              isItalic,
              isMonospace: isMono,
              fontSize: char.fontSize,
            };
          }
        }

        if (currentSpan) {
          spans.push(currentSpan);
        }
      } else {
        // Fallback: single span for the whole item
        spans.push({
          text: item.text,
          isBold: false,
          isItalic: false,
          isMonospace: false,
          fontSize: item.fontSize,
        });
      }
    }

    return spans;
  }

  /**
   * Convert blocks to HTML
   */
  private blocksToHtml(blocks: TextBlock[]): string {
    return blocks.map((block) => this.blockToHtml(block)).join('\n');
  }

  /**
   * Convert a single block to HTML
   */
  private blockToHtml(block: TextBlock): string {
    const indentClass = block.indent > 0 ? ' class="indented"' : '';

    switch (block.type) {
      case 'heading': {
        const content = this.spansToHtml(block.content);
        const level = Math.min(6, Math.max(1, block.level ?? 1));
        return `<h${level}${indentClass}>${content}</h${level}>`;
      }

      case 'list-item': {
        // Remove bullet prefix from plain text spans before HTML conversion
        const cleanedSpans = this.removeBulletPrefixFromSpans(block.content);
        const content = this.spansToHtml(cleanedSpans);
        return `<div class="list-item"${indentClass}>${content}</div>`;
      }

      case 'code': {
        // For code, use plain text (stripped of formatting)
        const plainText = block.content.map((s) => s.text).join('');
        return `<div class="code-block"${indentClass}>${this.escapeHtml(plainText)}</div>`;
      }

      case 'paragraph':
      default: {
        const content = this.spansToHtml(block.content);
        return `<p${indentClass}>${content}</p>`;
      }
    }
  }

  /**
   * Remove bullet/number prefix from the first span's text
   * Works on plain text before HTML conversion
   */
  private removeBulletPrefixFromSpans(spans: FormattedSpan[]): FormattedSpan[] {
    if (spans.length === 0) return spans;

    // Clone spans to avoid mutating the original
    const result = spans.map((s) => ({ ...s }));

    // Remove bullet from the first span's text
    const first = result[0];
    first.text = first.text
      .replace(/^[•·▪▸►◆○●\-\*]\s*/, '')
      .replace(/^\d+[.)]\s*/, '');

    // If first span is now empty, remove it
    if (first.text === '' && result.length > 1) {
      result.shift();
    }

    return result;
  }

  /**
   * Convert spans to HTML
   */
  private spansToHtml(spans: FormattedSpan[]): string {
    return spans
      .map((span) => {
        let html = this.escapeHtml(span.text);

        if (span.isMonospace) {
          html = `<code>${html}</code>`;
        } else {
          if (span.isBold && span.isItalic) {
            html = `<strong><em>${html}</em></strong>`;
          } else if (span.isBold) {
            html = `<strong>${html}</strong>`;
          } else if (span.isItalic) {
            html = `<em>${html}</em>`;
          }
        }

        return html;
      })
      .join('');
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Strip HTML tags from content
   */
  private stripTags(html: string): string {
    return html.replace(/<[^>]*>/g, '');
  }
}

/**
 * Create a mobile reflow renderer with default settings
 */
export function createMobileReflowRenderer(config?: ReflowConfig): MobileReflowRenderer {
  return new MobileReflowRenderer(config);
}

/**
 * Quickly render a page as reflowed HTML
 */
export function renderAsReflowedHtml(
  data: PdfTextLayerData,
  config?: ReflowConfig
): string {
  const renderer = new MobileReflowRenderer(config);
  return renderer.renderPage(data);
}
