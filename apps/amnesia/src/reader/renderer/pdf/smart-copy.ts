/**
 * Smart Copy
 *
 * Markdown-aware text extraction from PDF structured text.
 * Detects formatting (bold, italic) from font metadata and
 * headings from font size heuristics.
 *
 * @example
 * ```typescript
 * import { extractAsMarkdown, extractAsPlainText } from './smart-copy';
 *
 * const markdown = extractAsMarkdown(textLayerData);
 * const plain = extractAsPlainText(textLayerData);
 * ```
 */

import type { PdfTextLayerData, PdfTextItem, PdfCharPosition } from '../types';

// Re-export the TextLayerData type for external use
export type { PdfTextLayerData as TextLayerData };

// Use aliases for internal consistency
type CharPosition = PdfCharPosition;
type TextItem = PdfTextItem;
type TextLayerData = PdfTextLayerData;

/**
 * Span of text with consistent formatting
 */
interface TextSpan {
  text: string;
  fontName: string;
  fontSize: number;
  isBold: boolean;
  isItalic: boolean;
  isMonospace: boolean;
}

/**
 * Processed line with spans and metadata
 */
interface ProcessedLine {
  spans: TextSpan[];
  fontSize: number;
  isHeading: boolean;
  headingLevel: number;
  indent: number;
  isBullet: boolean;
  isNumbered: boolean;
}

/**
 * Detect if a font name indicates bold weight
 */
function isBoldFont(fontName: string): boolean {
  const lower = fontName.toLowerCase();
  return (
    lower.includes('bold') ||
    lower.includes('black') ||
    lower.includes('heavy') ||
    lower.includes('semibold') ||
    lower.includes('demibold') ||
    lower.includes('-b')
  );
}

/**
 * Detect if a font name indicates italic style
 */
function isItalicFont(fontName: string): boolean {
  const lower = fontName.toLowerCase();
  return (
    lower.includes('italic') ||
    lower.includes('oblique') ||
    lower.includes('slanted') ||
    lower.includes('-i')
  );
}

/**
 * Detect if a font name indicates monospace
 */
function isMonospaceFont(fontName: string): boolean {
  const lower = fontName.toLowerCase();
  return (
    lower.includes('mono') ||
    lower.includes('courier') ||
    lower.includes('consolas') ||
    lower.includes('menlo') ||
    lower.includes('code') ||
    lower.includes('typewriter')
  );
}

/**
 * Calculate average font size from text items
 */
function calculateAverageFontSize(items: TextItem[]): number {
  if (items.length === 0) return 12;

  let totalSize = 0;
  let count = 0;

  for (const item of items) {
    if (item.fontSize > 0) {
      totalSize += item.fontSize;
      count++;
    }
  }

  return count > 0 ? totalSize / count : 12;
}

/**
 * Determine heading level based on font size ratio to average
 */
function getHeadingLevel(fontSize: number, avgFontSize: number): number {
  const ratio = fontSize / avgFontSize;

  if (ratio >= 2.0) return 1; // H1: 2x+ average
  if (ratio >= 1.5) return 2; // H2: 1.5x+ average
  if (ratio >= 1.25) return 3; // H3: 1.25x+ average
  if (ratio >= 1.1) return 4; // H4: 1.1x+ average

  return 0; // Not a heading
}

/**
 * Detect if a line starts with a bullet point
 */
function detectBullet(text: string): boolean {
  const trimmed = text.trimStart();
  return /^[•·▪▸►◆○●\-\*]\s/.test(trimmed);
}

/**
 * Detect if a line starts with a number (ordered list)
 */
function detectNumbered(text: string): boolean {
  const trimmed = text.trimStart();
  return /^\d+[\.\)]\s/.test(trimmed);
}

/**
 * Remove bullet/number prefix from text
 */
function removeBulletPrefix(text: string): string {
  return text.replace(/^\s*[•·▪▸►◆○●\-\*]\s+/, '').replace(/^\s*\d+[\.\)]\s+/, '');
}

/**
 * Group consecutive characters with same font into spans
 */
function groupIntoSpans(chars: CharPosition[] | undefined, fallbackText: string, fallbackFontSize: number): TextSpan[] {
  // If no character positions, return a single span with the text
  if (!chars || chars.length === 0) {
    return [{
      text: fallbackText,
      fontName: 'unknown',
      fontSize: fallbackFontSize,
      isBold: false,
      isItalic: false,
      isMonospace: false,
    }];
  }

  const spans: TextSpan[] = [];
  let currentSpan: TextSpan | null = null;

  for (const char of chars) {
    const fontName = char.fontName ?? 'unknown';
    const isBold = isBoldFont(fontName);
    const isItalic = isItalicFont(fontName);
    const isMono = isMonospaceFont(fontName);

    if (
      currentSpan &&
      currentSpan.isBold === isBold &&
      currentSpan.isItalic === isItalic &&
      currentSpan.isMonospace === isMono &&
      Math.abs(currentSpan.fontSize - char.fontSize) < 0.5
    ) {
      // Continue current span
      currentSpan.text += char.char;
    } else {
      // Start new span
      if (currentSpan && currentSpan.text.length > 0) {
        spans.push(currentSpan);
      }
      currentSpan = {
        text: char.char,
        fontName,
        fontSize: char.fontSize,
        isBold,
        isItalic,
        isMonospace: isMono,
      };
    }
  }

  // Add final span
  if (currentSpan && currentSpan.text.length > 0) {
    spans.push(currentSpan);
  }

  return spans;
}

/**
 * Process a text item into a line with formatting info
 */
function processLine(item: TextItem, avgFontSize: number): ProcessedLine {
  const spans = groupIntoSpans(item.charPositions, item.text, item.fontSize);
  const headingLevel = getHeadingLevel(item.fontSize, avgFontSize);
  const text = item.text;

  return {
    spans,
    fontSize: item.fontSize,
    isHeading: headingLevel > 0,
    headingLevel,
    indent: item.x,
    isBullet: detectBullet(text),
    isNumbered: detectNumbered(text),
  };
}

/**
 * Format a span as Markdown
 */
function formatSpan(span: TextSpan): string {
  let text = span.text;

  // Skip empty text
  if (!text.trim()) return text;

  // Handle monospace first (code blocks)
  if (span.isMonospace) {
    text = `\`${text}\``;
  } else {
    // Apply bold/italic formatting
    if (span.isBold && span.isItalic) {
      text = `***${text}***`;
    } else if (span.isBold) {
      text = `**${text}**`;
    } else if (span.isItalic) {
      text = `*${text}*`;
    }
  }

  return text;
}

/**
 * Format a line as Markdown
 */
function formatLine(line: ProcessedLine, prevLine: ProcessedLine | null): string {
  // Build line content from spans
  let content = line.spans.map(formatSpan).join('');

  // Handle headings
  if (line.isHeading && line.headingLevel > 0) {
    const prefix = '#'.repeat(line.headingLevel);
    return `${prefix} ${content.trim()}\n`;
  }

  // Handle bullet lists
  if (line.isBullet) {
    return `- ${removeBulletPrefix(content).trim()}\n`;
  }

  // Handle numbered lists
  if (line.isNumbered) {
    const match = content.match(/^\s*(\d+)[\.\)]/);
    const num = match ? match[1] : '1';
    return `${num}. ${removeBulletPrefix(content).trim()}\n`;
  }

  // Regular paragraph
  return content;
}

/**
 * Extract text layer data as Markdown
 *
 * @param data Text layer data from MuPDF
 * @returns Markdown-formatted string
 */
export function extractAsMarkdown(data: TextLayerData): string {
  if (data.items.length === 0) return '';

  const avgFontSize = calculateAverageFontSize(data.items);
  const lines: ProcessedLine[] = data.items.map((item) => processLine(item, avgFontSize));

  let markdown = '';
  let prevLine: ProcessedLine | null = null;
  let inParagraph = false;

  for (const line of lines) {
    const formatted = formatLine(line, prevLine);

    // Add paragraph breaks between different block types
    if (prevLine) {
      const wasBlock = prevLine.isHeading || prevLine.isBullet || prevLine.isNumbered;
      const isBlock = line.isHeading || line.isBullet || line.isNumbered;

      if (wasBlock || isBlock) {
        // Block elements get their own line
        if (!markdown.endsWith('\n\n')) {
          markdown += '\n';
        }
      } else if (inParagraph) {
        // Continue paragraph with space
        markdown += ' ';
      }
    }

    markdown += formatted;
    inParagraph = !line.isHeading && !line.isBullet && !line.isNumbered;
    prevLine = line;
  }

  // Clean up excessive whitespace and empty markers
  return markdown
    .replace(/\n{3,}/g, '\n\n')     // Max 2 newlines
    .replace(/\*{4,}/g, '')          // Remove 4+ asterisks (empty bold+italic)
    .replace(/\*\*\*\*$/gm, '')      // Remove trailing empty markers
    .trim();
}

/**
 * Extract text layer data as plain text
 *
 * @param data Text layer data from MuPDF
 * @returns Plain text string
 */
export function extractAsPlainText(data: TextLayerData): string {
  if (data.items.length === 0) return '';

  return data.items.map((item) => item.text).join('\n');
}

/**
 * Extract selection from text layer
 *
 * @param data Text layer data
 * @param startOffset Character offset where selection starts
 * @param endOffset Character offset where selection ends
 * @returns Selected text as Markdown
 */
export function extractSelectionAsMarkdown(
  data: TextLayerData,
  startOffset: number,
  endOffset: number
): string {
  if (data.items.length === 0) return '';

  let currentOffset = 0;
  const selectedItems: TextItem[] = [];

  for (const item of data.items) {
    const itemEnd = currentOffset + item.text.length;

    // Check if this item overlaps with selection
    if (currentOffset < endOffset && itemEnd > startOffset) {
      // Calculate partial selection within this item
      const localStart = Math.max(0, startOffset - currentOffset);
      const localEnd = Math.min(item.text.length, endOffset - currentOffset);

      // Create partial item with selected chars
      if (item.charPositions && item.charPositions.length > 0) {
        const selectedChars = item.charPositions.slice(localStart, localEnd);
        if (selectedChars.length > 0) {
          selectedItems.push({
            ...item,
            text: selectedChars.map((c) => c.char).join(''),
            charPositions: selectedChars,
          });
        }
      } else {
        // Fallback: use substring when charPositions is not available
        const selectedText = item.text.substring(localStart, localEnd);
        if (selectedText) {
          selectedItems.push({
            ...item,
            text: selectedText,
          });
        }
      }
    }

    currentOffset = itemEnd;
    if (currentOffset >= endOffset) break;
  }

  // Create temporary TextLayerData for selection
  const selectionData: TextLayerData = {
    page: data.page,
    width: data.width,
    height: data.height,
    items: selectedItems,
  };

  return extractAsMarkdown(selectionData);
}

/**
 * Copy handler result
 */
export interface CopyResult {
  plainText: string;
  markdown: string;
  html: string;
}

/**
 * Prepare text for clipboard with multiple formats
 *
 * @param data Text layer data
 * @returns Copy result with multiple formats
 */
export function prepareCopyData(data: TextLayerData): CopyResult {
  const plainText = extractAsPlainText(data);
  const markdown = extractAsMarkdown(data);

  // Convert markdown to simple HTML
  const html = markdown
    .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/^- (.*?)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.*?)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>');

  return { plainText, markdown, html };
}
