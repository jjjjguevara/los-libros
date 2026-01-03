/**
 * Security Module
 * @module api/security
 */

export {
  expandCapabilities,
  hasCapability,
  requireCapability,
  createCapabilityChecker,
  withCapability,
  withCapabilityAsync,
  ConnectionRegistry,
  type ConnectionInfo
} from './capabilities';

export {
  // Validators
  validateCreateHighlight,
  validateUpdateHighlight,
  validateCreateBookmark,
  validateUpdateBookmark,
  // Schema aliases
  CreateHighlightSchema,
  UpdateHighlightSchema,
  CreateBookmarkSchema,
  UpdateBookmarkSchema,
  NavigationTargetSchema,
  NavigatorConfigSchema,
  UpdateProgressSchema,
  // Helpers
  validate,
  withValidation,
  withValidationAsync,
  validatePartial,
  // Types
  type CreateHighlightInput,
  type UpdateHighlightInput,
  type CreateBookmarkInput,
  type UpdateBookmarkInput
} from './validation';
