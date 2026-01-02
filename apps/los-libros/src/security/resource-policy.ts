/**
 * Resource Policy
 *
 * Controls what external resources can be loaded in EPUB content.
 * Provides Content Security Policy (CSP) generation and URL validation.
 *
 * Security features:
 * - CSP header/meta tag generation
 * - External resource blocking
 * - Protocol whitelisting
 * - Domain whitelisting (configurable)
 *
 * @see docs/specifications/file-system-architecture.md
 */

// ============================================================================
// Types
// ============================================================================

export interface ResourcePolicyConfig {
  /** Block all external resources (default: true) */
  blockExternalResources: boolean;
  /** Allow inline styles (default: true for EPUB compatibility) */
  allowInlineStyles: boolean;
  /** Allow inline scripts (default: false - ALWAYS) */
  allowInlineScripts: boolean;
  /** Allow data: URLs (default: true for inline images) */
  allowDataUrls: boolean;
  /** Allow blob: URLs (default: true for resource loading) */
  allowBlobUrls: boolean;
  /** Allowed protocols for resources */
  allowedProtocols: string[];
  /** Allowed domains for external resources */
  allowedDomains: string[];
  /** Report-only mode (logs violations but doesn't block) */
  reportOnly: boolean;
  /** Callback for CSP violations */
  onViolation?: (violation: ResourceViolation) => void;
}

export interface ResourceViolation {
  /** Type of violation */
  type: 'blocked-uri' | 'inline-script' | 'inline-style' | 'eval' | 'unsafe-protocol';
  /** The blocked resource URI */
  blockedUri: string;
  /** The directive that was violated */
  violatedDirective: string;
  /** Source file (if available) */
  sourceFile?: string;
  /** Line number (if available) */
  lineNumber?: number;
  /** Timestamp of the violation */
  timestamp: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_RESOURCE_POLICY: ResourcePolicyConfig = {
  blockExternalResources: true,
  allowInlineStyles: true,
  allowInlineScripts: false, // NEVER allow scripts
  allowDataUrls: true,
  allowBlobUrls: true,
  allowedProtocols: ['blob:', 'data:'],
  allowedDomains: [],
  reportOnly: false,
};

// ============================================================================
// CSP Directive Builder
// ============================================================================

type CSPDirective =
  | 'default-src'
  | 'script-src'
  | 'style-src'
  | 'img-src'
  | 'font-src'
  | 'connect-src'
  | 'media-src'
  | 'object-src'
  | 'frame-src'
  | 'child-src'
  | 'worker-src'
  | 'form-action'
  | 'base-uri'
  | 'frame-ancestors';

/**
 * Build a Content Security Policy string from configuration
 */
export function buildCSP(config: ResourcePolicyConfig): string {
  const directives: Map<CSPDirective, string[]> = new Map();

  // Default source - highly restrictive
  directives.set('default-src', ["'none'"]);

  // Script source - NEVER allow scripts in EPUB content
  directives.set('script-src', ["'none'"]);

  // Style source
  const styleSrc: string[] = ["'self'"];
  if (config.allowInlineStyles) {
    styleSrc.push("'unsafe-inline'");
  }
  if (config.allowDataUrls) {
    styleSrc.push('data:');
  }
  if (config.allowBlobUrls) {
    styleSrc.push('blob:');
  }
  directives.set('style-src', styleSrc);

  // Image source
  const imgSrc: string[] = ["'self'"];
  if (config.allowDataUrls) {
    imgSrc.push('data:');
  }
  if (config.allowBlobUrls) {
    imgSrc.push('blob:');
  }
  if (!config.blockExternalResources) {
    imgSrc.push('https:');
    for (const domain of config.allowedDomains) {
      imgSrc.push(domain);
    }
  }
  directives.set('img-src', imgSrc);

  // Font source
  const fontSrc: string[] = ["'self'"];
  if (config.allowDataUrls) {
    fontSrc.push('data:');
  }
  if (config.allowBlobUrls) {
    fontSrc.push('blob:');
  }
  directives.set('font-src', fontSrc);

  // Media source (audio/video)
  const mediaSrc: string[] = ["'self'"];
  if (config.allowBlobUrls) {
    mediaSrc.push('blob:');
  }
  if (config.allowDataUrls) {
    mediaSrc.push('data:');
  }
  directives.set('media-src', mediaSrc);

  // Connect source (fetch, XHR, WebSocket)
  directives.set('connect-src', ["'none'"]);

  // Object source (plugins)
  directives.set('object-src', ["'none'"]);

  // Frame source
  directives.set('frame-src', ["'none'"]);

  // Child/worker source
  directives.set('child-src', ["'none'"]);
  directives.set('worker-src', ["'none'"]);

  // Form actions
  directives.set('form-action', ["'none'"]);

  // Base URI
  directives.set('base-uri', ["'none'"]);

  // Frame ancestors (prevent framing)
  directives.set('frame-ancestors', ["'none'"]);

  // Build the CSP string
  const parts: string[] = [];
  for (const [directive, values] of directives) {
    parts.push(`${directive} ${values.join(' ')}`);
  }

  return parts.join('; ');
}

/**
 * Generate a CSP meta tag element
 */
export function createCSPMetaTag(config: ResourcePolicyConfig): HTMLMetaElement {
  const meta = document.createElement('meta');
  meta.httpEquiv = config.reportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';
  meta.content = buildCSP(config);
  return meta;
}

/**
 * Generate CSP meta tag as HTML string
 */
export function getCSPMetaTagString(config: ResourcePolicyConfig): string {
  const httpEquiv = config.reportOnly
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';
  const content = buildCSP(config);
  return `<meta http-equiv="${httpEquiv}" content="${escapeHtmlAttribute(content)}">`;
}

// ============================================================================
// URL Validation
// ============================================================================

/**
 * Check if a URL is allowed by the resource policy
 */
export function isUrlAllowed(url: string, config: ResourcePolicyConfig): boolean {
  // Empty or invalid URLs are allowed (will fail to load)
  if (!url || url.trim() === '') return true;

  // Fragment-only URLs are always allowed
  if (url.startsWith('#')) return true;

  // Relative URLs are allowed
  if (!url.includes('://') && !url.startsWith('//')) return true;

  // Check protocol
  const lowerUrl = url.toLowerCase();

  // Check against allowed protocols
  for (const protocol of config.allowedProtocols) {
    if (lowerUrl.startsWith(protocol.toLowerCase())) {
      return true;
    }
  }

  // Check data: URLs
  if (lowerUrl.startsWith('data:') && config.allowDataUrls) {
    return true;
  }

  // Check blob: URLs
  if (lowerUrl.startsWith('blob:') && config.allowBlobUrls) {
    return true;
  }

  // Block dangerous protocols
  if (lowerUrl.startsWith('javascript:') || lowerUrl.startsWith('vbscript:')) {
    return false;
  }

  // If blocking external resources, block http/https
  if (config.blockExternalResources) {
    if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
      // Check if domain is whitelisted
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;
        for (const domain of config.allowedDomains) {
          if (hostname === domain || hostname.endsWith(`.${domain}`)) {
            return true;
          }
        }
      } catch {
        // Invalid URL
      }
      return false;
    }
  }

  return true;
}

/**
 * Validate and potentially block a resource URL
 * Returns the URL if allowed, or empty string if blocked
 */
export function validateResourceUrl(
  url: string,
  config: ResourcePolicyConfig,
  resourceType: 'image' | 'style' | 'font' | 'media' | 'other' = 'other'
): string {
  if (isUrlAllowed(url, config)) {
    return url;
  }

  // Log violation if callback provided
  if (config.onViolation) {
    config.onViolation({
      type: 'blocked-uri',
      blockedUri: url,
      violatedDirective: `${resourceType}-src`,
      timestamp: Date.now(),
    });
  }

  return '';
}

// ============================================================================
// Resource Policy Manager
// ============================================================================

export class ResourcePolicyManager {
  private config: ResourcePolicyConfig;
  private violations: ResourceViolation[] = [];

  constructor(config: Partial<ResourcePolicyConfig> = {}) {
    this.config = { ...DEFAULT_RESOURCE_POLICY, ...config };
  }

  /**
   * Get the current CSP string
   */
  getCSP(): string {
    return buildCSP(this.config);
  }

  /**
   * Create a CSP meta tag element
   */
  createMetaTag(): HTMLMetaElement {
    return createCSPMetaTag(this.config);
  }

  /**
   * Get CSP meta tag as string
   */
  getMetaTagString(): string {
    return getCSPMetaTagString(this.config);
  }

  /**
   * Check if a URL is allowed
   */
  isAllowed(url: string): boolean {
    return isUrlAllowed(url, this.config);
  }

  /**
   * Validate a resource URL
   */
  validateUrl(
    url: string,
    resourceType: 'image' | 'style' | 'font' | 'media' | 'other' = 'other'
  ): string {
    const result = validateResourceUrl(url, this.config, resourceType);

    if (result === '' && url !== '') {
      // Record violation
      const violation: ResourceViolation = {
        type: 'blocked-uri',
        blockedUri: url,
        violatedDirective: `${resourceType}-src`,
        timestamp: Date.now(),
      };
      this.violations.push(violation);

      if (this.config.onViolation) {
        this.config.onViolation(violation);
      }
    }

    return result;
  }

  /**
   * Get recorded violations
   */
  getViolations(): ResourceViolation[] {
    return [...this.violations];
  }

  /**
   * Clear recorded violations
   */
  clearViolations(): void {
    this.violations = [];
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ResourcePolicyConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ResourcePolicyConfig {
    return { ...this.config };
  }

  /**
   * Add a domain to the whitelist
   */
  addAllowedDomain(domain: string): void {
    if (!this.config.allowedDomains.includes(domain)) {
      this.config.allowedDomains.push(domain);
    }
  }

  /**
   * Remove a domain from the whitelist
   */
  removeAllowedDomain(domain: string): void {
    const index = this.config.allowedDomains.indexOf(domain);
    if (index !== -1) {
      this.config.allowedDomains.splice(index, 1);
    }
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Escape HTML attribute value for safe insertion
 */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================================
// Singleton Instance
// ============================================================================

let policyInstance: ResourcePolicyManager | null = null;

/**
 * Get the global resource policy manager
 */
export function getResourcePolicy(config?: Partial<ResourcePolicyConfig>): ResourcePolicyManager {
  if (!policyInstance) {
    policyInstance = new ResourcePolicyManager(config);
  } else if (config) {
    policyInstance.updateConfig(config);
  }
  return policyInstance;
}
