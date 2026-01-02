/**
 * Input Validation
 * Simple validation without external dependencies
 * @module api/security/validation
 */

import { ValidationError, type HighlightColor } from '../types';

// ============================================================================
// Validation Helpers
// ============================================================================

interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors: Array<{
    path: (string | number)[];
    message: string;
    code: string;
  }>;
}

function createError(path: string[], message: string): { path: string[]; message: string; code: string } {
  return { path, message, code: 'invalid_input' };
}

// ============================================================================
// Highlight Validation
// ============================================================================

const VALID_HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange'];

export interface CreateHighlightInput {
  bookId: string;
  text: string;
  cfi: string;
  color: HighlightColor;
  annotation?: string;
  chapter?: string;
  pagePercent?: number;
  spineIndex?: number;
}

export function validateCreateHighlight(input: unknown): ValidationResult<CreateHighlightInput> {
  const errors: ValidationResult<CreateHighlightInput>['errors'] = [];
  const data = input as Record<string, unknown>;

  if (!data || typeof data !== 'object') {
    return { success: false, errors: [createError([], 'Input must be an object')] };
  }

  if (typeof data.bookId !== 'string' || data.bookId.length === 0) {
    errors.push(createError(['bookId'], 'Book ID is required'));
  }

  if (typeof data.text !== 'string' || data.text.length === 0) {
    errors.push(createError(['text'], 'Text is required'));
  } else if (data.text.length > 10000) {
    errors.push(createError(['text'], 'Text too long (max 10000 chars)'));
  }

  if (typeof data.cfi !== 'string' || !/^epubcfi\(.+\)$/.test(data.cfi)) {
    errors.push(createError(['cfi'], 'Invalid CFI format'));
  }

  if (!VALID_HIGHLIGHT_COLORS.includes(data.color as HighlightColor)) {
    errors.push(createError(['color'], 'Invalid highlight color'));
  }

  if (data.annotation !== undefined && typeof data.annotation !== 'string') {
    errors.push(createError(['annotation'], 'Annotation must be a string'));
  } else if (typeof data.annotation === 'string' && data.annotation.length > 50000) {
    errors.push(createError(['annotation'], 'Annotation too long (max 50000 chars)'));
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: data as unknown as CreateHighlightInput,
    errors: []
  };
}

export interface UpdateHighlightInput {
  color?: HighlightColor;
  annotation?: string;
  text?: string;
}

export function validateUpdateHighlight(input: unknown): ValidationResult<UpdateHighlightInput> {
  const errors: ValidationResult<UpdateHighlightInput>['errors'] = [];
  const data = input as Record<string, unknown>;

  if (!data || typeof data !== 'object') {
    return { success: false, errors: [createError([], 'Input must be an object')] };
  }

  if (data.color !== undefined && !VALID_HIGHLIGHT_COLORS.includes(data.color as HighlightColor)) {
    errors.push(createError(['color'], 'Invalid highlight color'));
  }

  if (data.annotation !== undefined && typeof data.annotation !== 'string') {
    errors.push(createError(['annotation'], 'Annotation must be a string'));
  }

  if (data.text !== undefined) {
    if (typeof data.text !== 'string' || data.text.length === 0) {
      errors.push(createError(['text'], 'Text must be a non-empty string'));
    } else if (data.text.length > 10000) {
      errors.push(createError(['text'], 'Text too long'));
    }
  }

  const hasFields = data.color !== undefined || data.annotation !== undefined || data.text !== undefined;
  if (!hasFields) {
    errors.push(createError([], 'At least one field must be provided for update'));
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: data as UpdateHighlightInput,
    errors: []
  };
}

// ============================================================================
// Bookmark Validation
// ============================================================================

export interface CreateBookmarkInput {
  bookId: string;
  cfi: string;
  title?: string;
  note?: string;
  chapter?: string;
}

export function validateCreateBookmark(input: unknown): ValidationResult<CreateBookmarkInput> {
  const errors: ValidationResult<CreateBookmarkInput>['errors'] = [];
  const data = input as Record<string, unknown>;

  if (!data || typeof data !== 'object') {
    return { success: false, errors: [createError([], 'Input must be an object')] };
  }

  if (typeof data.bookId !== 'string' || data.bookId.length === 0) {
    errors.push(createError(['bookId'], 'Book ID is required'));
  }

  if (typeof data.cfi !== 'string' || !/^epubcfi\(.+\)$/.test(data.cfi)) {
    errors.push(createError(['cfi'], 'Invalid CFI format'));
  }

  if (data.title !== undefined && typeof data.title !== 'string') {
    errors.push(createError(['title'], 'Title must be a string'));
  } else if (typeof data.title === 'string' && data.title.length > 500) {
    errors.push(createError(['title'], 'Title too long (max 500 chars)'));
  }

  if (data.note !== undefined && typeof data.note !== 'string') {
    errors.push(createError(['note'], 'Note must be a string'));
  } else if (typeof data.note === 'string' && data.note.length > 10000) {
    errors.push(createError(['note'], 'Note too long (max 10000 chars)'));
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: data as unknown as CreateBookmarkInput,
    errors: []
  };
}

export interface UpdateBookmarkInput {
  title?: string;
  note?: string;
}

export function validateUpdateBookmark(input: unknown): ValidationResult<UpdateBookmarkInput> {
  const errors: ValidationResult<UpdateBookmarkInput>['errors'] = [];
  const data = input as Record<string, unknown>;

  if (!data || typeof data !== 'object') {
    return { success: false, errors: [createError([], 'Input must be an object')] };
  }

  if (data.title !== undefined && typeof data.title !== 'string') {
    errors.push(createError(['title'], 'Title must be a string'));
  }

  if (data.note !== undefined && typeof data.note !== 'string') {
    errors.push(createError(['note'], 'Note must be a string'));
  }

  const hasFields = data.title !== undefined || data.note !== undefined;
  if (!hasFields) {
    errors.push(createError([], 'At least one field must be provided for update'));
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: data as UpdateBookmarkInput,
    errors: []
  };
}

// ============================================================================
// Generic Validation
// ============================================================================

/**
 * Validate input and throw ValidationError if invalid
 */
export function validate<T>(
  validator: (input: unknown) => ValidationResult<T>,
  input: unknown
): T {
  const result = validator(input);

  if (!result.success) {
    throw new ValidationError(
      `Validation failed: ${result.errors.map(e => e.message).join(', ')}`,
      result.errors
    );
  }

  return result.data as T;
}

// Schema aliases for backwards compatibility
export const CreateHighlightSchema = { parse: (input: unknown) => validate(validateCreateHighlight, input) };
export const UpdateHighlightSchema = { parse: (input: unknown) => validate(validateUpdateHighlight, input) };
export const CreateBookmarkSchema = { parse: (input: unknown) => validate(validateCreateBookmark, input) };
export const UpdateBookmarkSchema = { parse: (input: unknown) => validate(validateUpdateBookmark, input) };
export const NavigationTargetSchema = { parse: (input: unknown) => input }; // Pass-through for now
export const NavigatorConfigSchema = { parse: (input: unknown) => input }; // Pass-through for now
export const UpdateProgressSchema = { parse: (input: unknown) => input }; // Pass-through for now

// Compatibility exports
export function withValidation<TInput, TOutput>(
  validator: (input: unknown) => ValidationResult<TInput>,
  fn: (validated: TInput) => TOutput
): (input: unknown) => TOutput {
  return (input: unknown): TOutput => {
    const validated = validate(validator, input);
    return fn(validated);
  };
}

export function withValidationAsync<TInput, TOutput>(
  validator: (input: unknown) => ValidationResult<TInput>,
  fn: (validated: TInput) => Promise<TOutput>
): (input: unknown) => Promise<TOutput> {
  return async (input: unknown): Promise<TOutput> => {
    const validated = validate(validator, input);
    return fn(validated);
  };
}

export function validatePartial<T>(
  validator: (input: unknown) => ValidationResult<T>,
  data: unknown
): { data: Partial<T>; errors: ValidationResult<T>['errors'] } {
  const result = validator(data);
  if (result.success) {
    return { data: result.data as Partial<T>, errors: [] };
  }
  return { data: {}, errors: result.errors };
}
