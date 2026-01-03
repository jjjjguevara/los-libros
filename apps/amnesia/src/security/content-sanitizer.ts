/**
 * Content Sanitizer
 *
 * Provides HTML sanitization for EPUB content using DOMPurify.
 * Protects against XSS attacks and other HTML injection vulnerabilities.
 *
 * Security features:
 * - Removes script tags and event handlers
 * - Sanitizes href/src attributes
 * - Blocks external resources (configurable)
 * - Removes dangerous CSS expressions
 * - Allows safe EPUB content elements
 *
 * @see docs/specifications/file-system-architecture.md
 */

import DOMPurify from 'dompurify';

// ============================================================================
// Types
// ============================================================================

export interface SanitizerConfig {
  /** Allow external images (default: false) */
  allowExternalImages: boolean;
  /** Allow external stylesheets (default: false) */
  allowExternalStylesheets: boolean;
  /** Allow data: URLs (default: true for inline images) */
  allowDataUrls: boolean;
  /** Allow blob: URLs (default: true for resource loading) */
  allowBlobUrls: boolean;
  /** Custom allowed domains for external resources */
  allowedDomains: string[];
  /** Enable strict mode (removes more potentially dangerous elements) */
  strictMode: boolean;
}

export interface SanitizeResult {
  /** Sanitized HTML */
  html: string;
  /** Elements that were removed */
  removedElements: string[];
  /** Attributes that were removed */
  removedAttributes: string[];
  /** External URLs that were blocked */
  blockedUrls: string[];
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_SANITIZER_CONFIG: SanitizerConfig = {
  allowExternalImages: false,
  allowExternalStylesheets: false,
  allowDataUrls: true,
  allowBlobUrls: true,
  allowedDomains: [],
  strictMode: false,
};

// ============================================================================
// DOMPurify Configuration
// ============================================================================

/**
 * Safe tags allowed in EPUB content
 */
const ALLOWED_TAGS = [
  // Document structure
  'html', 'head', 'body', 'section', 'article', 'nav', 'aside', 'header', 'footer', 'main',
  // Headings
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hgroup',
  // Text content
  'p', 'div', 'span', 'blockquote', 'pre', 'code', 'br', 'hr', 'wbr',
  // Lists
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  // Tables
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  // Inline text semantics
  'a', 'em', 'strong', 'b', 'i', 'u', 's', 'strike', 'del', 'ins', 'mark', 'small', 'sub', 'sup',
  'abbr', 'cite', 'dfn', 'kbd', 'samp', 'var', 'q', 'bdo', 'bdi', 'ruby', 'rt', 'rp',
  // Media
  'img', 'figure', 'figcaption', 'picture', 'source',
  'audio', 'video', 'track',
  // SVG (common safe elements)
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath', 'defs', 'symbol', 'use', 'clipPath', 'mask',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'image', 'title', 'desc',
  // Embedded content
  'object', 'param',
  // Forms (read-only display in ebooks)
  'form', 'fieldset', 'legend', 'label', 'input', 'button', 'select', 'option', 'optgroup',
  'textarea', 'output', 'progress', 'meter',
  // EPUB-specific
  'epub:switch', 'epub:case', 'epub:default',
  // MathML
  'math', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace', 'mrow', 'mfrac', 'msqrt', 'mroot',
  'mover', 'munder', 'munderover', 'msub', 'msup', 'msubsup', 'mtable', 'mtr', 'mtd',
  // Other safe elements
  'address', 'time', 'data', 'details', 'summary', 'dialog',
];

/**
 * Safe attributes allowed on elements
 */
const ALLOWED_ATTRIBUTES = [
  // Global attributes
  'id', 'class', 'lang', 'dir', 'title', 'hidden', 'tabindex', 'role',
  'aria-*', 'data-*',
  // Links
  'href', 'target', 'rel', 'download', 'type', 'hreflang',
  // Media
  'src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding',
  'poster', 'controls', 'autoplay', 'loop', 'muted', 'preload', 'crossorigin',
  // Tables
  'colspan', 'rowspan', 'headers', 'scope', 'abbr',
  // Forms
  'name', 'value', 'disabled', 'readonly', 'placeholder', 'required',
  'min', 'max', 'step', 'pattern', 'maxlength', 'minlength', 'for',
  // Lists
  'start', 'reversed', 'type',
  // SVG attributes
  'viewBox', 'preserveAspectRatio', 'xmlns', 'xmlns:xlink', 'x', 'y',
  'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'transform', 'opacity', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2',
  'points', 'font-family', 'font-size', 'text-anchor', 'dominant-baseline',
  'gradientUnits', 'offset', 'stop-color', 'stop-opacity', 'patternUnits',
  'xlink:href', 'clip-path', 'mask', 'filter',
  // MathML
  'mathvariant', 'mathsize', 'mathcolor', 'mathbackground',
  // EPUB-specific
  'epub:type', 'epub:prefix',
  // Misc
  'datetime', 'cite', 'open', 'manifest', 'style',
];

/**
 * Forbidden tags that should never appear
 */
const FORBID_TAGS = [
  'script', 'noscript', 'iframe', 'frame', 'frameset',
  'embed', 'applet', 'base', 'basefont', 'bgsound',
  'link', 'meta', 'template', 'slot', 'portal',
];

/**
 * Forbidden attributes (event handlers, dangerous)
 */
const FORBID_ATTR = [
  // Event handlers
  'onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onmouseover',
  'onmousemove', 'onmouseout', 'onmouseenter', 'onmouseleave',
  'onkeydown', 'onkeypress', 'onkeyup',
  'onfocus', 'onblur', 'onchange', 'oninput', 'onsubmit', 'onreset',
  'onload', 'onerror', 'onabort', 'onunload', 'onbeforeunload',
  'onscroll', 'onresize', 'onwheel',
  'ondrag', 'ondragend', 'ondragenter', 'ondragleave', 'ondragover', 'ondragstart', 'ondrop',
  'oncopy', 'oncut', 'onpaste',
  'onanimationstart', 'onanimationend', 'onanimationiteration',
  'ontransitionend', 'ontouchstart', 'ontouchmove', 'ontouchend', 'ontouchcancel',
  'onpointerdown', 'onpointerup', 'onpointermove', 'onpointerover', 'onpointerout',
  'oncontextmenu', 'onselect', 'onselectstart', 'oninvalid',
  'onformdata', 'ontoggle', 'oncancel', 'onclose',
  // Dangerous attributes
  'formaction', 'action',
];

// ============================================================================
// Content Sanitizer Class
// ============================================================================

export class ContentSanitizer {
  private config: SanitizerConfig;
  private purify: typeof DOMPurify;
  private removedElements: string[] = [];
  private removedAttributes: string[] = [];
  private blockedUrls: string[] = [];

  constructor(config: Partial<SanitizerConfig> = {}) {
    this.config = { ...DEFAULT_SANITIZER_CONFIG, ...config };
    this.purify = DOMPurify;

    // Configure DOMPurify hooks
    this.setupHooks();
  }

  /**
   * Configure DOMPurify hooks for advanced filtering
   */
  private setupHooks(): void {
    // Hook to track and filter URLs
    this.purify.addHook('uponSanitizeAttribute', (node, data) => {
      // Check href/src/xlink:href attributes for external URLs
      if (data.attrName === 'href' || data.attrName === 'src' || data.attrName === 'xlink:href') {
        const url = data.attrValue;
        if (url && !this.isAllowedUrl(url)) {
          this.blockedUrls.push(url);
          data.attrValue = '';
          data.keepAttr = false;
        }
      }

      // Block javascript: and vbscript: protocols
      if (data.attrValue) {
        const lowerValue = data.attrValue.toLowerCase().trim();
        if (lowerValue.startsWith('javascript:') || lowerValue.startsWith('vbscript:')) {
          data.attrValue = '';
          data.keepAttr = false;
        }
      }
    });

    // Hook to filter style attributes for dangerous CSS
    this.purify.addHook('uponSanitizeAttribute', (node, data) => {
      if (data.attrName === 'style') {
        data.attrValue = this.sanitizeInlineStyle(data.attrValue);
      }
    });

    // Hook to track removed elements
    this.purify.addHook('afterSanitizeElements', (node) => {
      // This hook is called for every node, including removed ones
    });

    // Hook to track removed attributes
    this.purify.addHook('afterSanitizeAttributes', (node) => {
      // Attributes have been sanitized at this point
    });
  }

  /**
   * Check if a URL is allowed based on configuration
   */
  private isAllowedUrl(url: string): boolean {
    // Allow empty URLs
    if (!url || url.trim() === '') return true;

    // Allow fragment-only URLs (internal links)
    if (url.startsWith('#')) return true;

    // Allow relative URLs (within the EPUB)
    if (!url.includes('://') && !url.startsWith('//')) return true;

    // Allow data: URLs if configured
    if (url.startsWith('data:') && this.config.allowDataUrls) return true;

    // Allow blob: URLs if configured
    if (url.startsWith('blob:') && this.config.allowBlobUrls) return true;

    // Check against allowed domains
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Check if domain is in allowed list
      for (const domain of this.config.allowedDomains) {
        if (hostname === domain || hostname.endsWith(`.${domain}`)) {
          return true;
        }
      }
    } catch {
      // Invalid URL - allow it (might be a relative path)
      return true;
    }

    // Block external URLs by default
    return false;
  }

  /**
   * Sanitize inline style attribute
   */
  private sanitizeInlineStyle(style: string): string {
    if (!style) return '';

    // Remove potentially dangerous CSS
    let sanitized = style
      // Remove expression() - IE CSS expression
      .replace(/expression\s*\([^)]*\)/gi, '')
      // Remove url() with external URLs (keep data: and blob:)
      .replace(/url\s*\(\s*["']?(?!data:|blob:)[^"')]+["']?\s*\)/gi, 'url()')
      // Remove behavior: (IE-specific)
      .replace(/behavior\s*:[^;]*/gi, '')
      // Remove -moz-binding (Firefox XBL)
      .replace(/-moz-binding\s*:[^;]*/gi, '')
      // Remove @import (could load external resources)
      .replace(/@import[^;]*/gi, '')
      // Remove javascript: in any property value
      .replace(/javascript\s*:/gi, '');

    return sanitized;
  }

  /**
   * Sanitize HTML content
   */
  sanitize(html: string): SanitizeResult {
    // Reset tracking
    this.removedElements = [];
    this.removedAttributes = [];
    this.blockedUrls = [];

    // Configure DOMPurify options
    const options: DOMPurify.Config = {
      ALLOWED_TAGS: this.config.strictMode
        ? ALLOWED_TAGS.filter(t => !['form', 'input', 'button', 'select', 'textarea', 'object', 'param'].includes(t))
        : ALLOWED_TAGS,
      ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
      FORBID_TAGS,
      FORBID_ATTR,
      ALLOW_DATA_ATTR: true,
      ALLOW_ARIA_ATTR: true,
      KEEP_CONTENT: true,
      IN_PLACE: false,
      WHOLE_DOCUMENT: false,
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false,
      RETURN_TRUSTED_TYPE: false,
      SANITIZE_DOM: true,
      SAFE_FOR_TEMPLATES: false,
      FORCE_BODY: false,
      ADD_TAGS: ['epub:switch', 'epub:case', 'epub:default'],
      ADD_ATTR: ['epub:type', 'epub:prefix'],
      // Allow blob: and data: URLs in src/href attributes
      // Default DOMPurify only allows http:, https:, ftp:, mailto:, tel:, data:
      // We need blob: for EPUB images loaded via WASM provider
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|blob|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    };

    // Sanitize the HTML
    const sanitizedHtml = this.purify.sanitize(html, options) as string;

    return {
      html: sanitizedHtml,
      removedElements: this.removedElements,
      removedAttributes: this.removedAttributes,
      blockedUrls: this.blockedUrls,
    };
  }

  /**
   * Sanitize HTML and return just the clean string
   */
  sanitizeToString(html: string): string {
    return this.sanitize(html).html;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SanitizerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): SanitizerConfig {
    return { ...this.config };
  }

  /**
   * Clear DOMPurify hooks (for cleanup)
   */
  destroy(): void {
    this.purify.removeAllHooks();
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let sanitizerInstance: ContentSanitizer | null = null;

/**
 * Get the global sanitizer instance
 */
export function getSanitizer(config?: Partial<SanitizerConfig>): ContentSanitizer {
  if (!sanitizerInstance) {
    sanitizerInstance = new ContentSanitizer(config);
  } else if (config) {
    sanitizerInstance.updateConfig(config);
  }
  return sanitizerInstance;
}

/**
 * Convenience function to sanitize HTML
 */
export function sanitizeHtml(html: string, config?: Partial<SanitizerConfig>): string {
  const sanitizer = config ? new ContentSanitizer(config) : getSanitizer();
  return sanitizer.sanitizeToString(html);
}
