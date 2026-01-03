/**
 * Security Module
 *
 * Provides security utilities for EPUB content rendering:
 * - HTML sanitization (DOMPurify-based)
 * - Content Security Policy (CSP) management
 * - Resource URL validation
 * - External resource blocking
 *
 * @see docs/specifications/file-system-architecture.md
 */

export {
  ContentSanitizer,
  getSanitizer,
  sanitizeHtml,
  DEFAULT_SANITIZER_CONFIG,
  type SanitizerConfig,
  type SanitizeResult,
} from './content-sanitizer';

export {
  ResourcePolicyManager,
  getResourcePolicy,
  buildCSP,
  createCSPMetaTag,
  getCSPMetaTagString,
  isUrlAllowed,
  validateResourceUrl,
  DEFAULT_RESOURCE_POLICY,
  type ResourcePolicyConfig,
  type ResourceViolation,
} from './resource-policy';
