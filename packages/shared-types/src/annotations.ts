/**
 * Unified Annotations Vocabulary
 *
 * Shared semantic types for annotations across Amnesia and Doc Doctor.
 * These types enable bidirectional highlight↔stub synchronization.
 *
 * @module annotations
 */

import type { HighlightColor } from './highlight';

/**
 * Semantic annotation types for knowledge management.
 *
 * These types categorize highlights/stubs based on their intellectual purpose,
 * enabling Doc Doctor to route them to appropriate AI processing pipelines.
 */
export type AnnotationType =
  | 'verify'       // yellow - Needs fact-checking, validation required
  | 'expand'       // green - Needs more detail, requires elaboration
  | 'clarify'      // blue - Ambiguous, needs clarification
  | 'question'     // pink - Open question, unresolved inquiry
  | 'important'    // purple - Key insight, significant point
  | 'citation'     // orange - Needs evidence, requires source citation
  | 'definition'   // teal - Term definition, concept explanation
  | 'argument'     // navy - Main thesis, central argument
  | 'evidence'     // lime - Supporting data, factual backing
  | 'counterpoint' // red - Opposing view, alternative perspective
  | 'todo'         // gray - Action item, task to complete
  | 'connection';  // cyan - Cross-reference, link to related content

/**
 * Metadata for each annotation type
 */
export interface AnnotationTypeMetadata {
  /** Display label */
  label: string;
  /** Short description */
  description: string;
  /** Associated color (for display) */
  color: string;
  /** Doc Doctor vector family for AI processing */
  vectorFamily: VectorFamily;
  /** Icon name (Lucide icon) */
  icon: string;
}

/**
 * Doc Doctor vector families for semantic routing
 */
export type VectorFamily =
  | 'retrieval'   // Fact-checking, verification
  | 'creation'    // Content expansion, elaboration
  | 'computation' // Analysis, clarification
  | 'action';     // Tasks, todos

/**
 * Complete metadata for all annotation types
 */
export const ANNOTATION_TYPE_METADATA: Record<AnnotationType, AnnotationTypeMetadata> = {
  verify: {
    label: 'Verify',
    description: 'Needs fact-checking or validation',
    color: '#fef08a', // yellow-200
    vectorFamily: 'retrieval',
    icon: 'check-circle',
  },
  expand: {
    label: 'Expand',
    description: 'Needs more detail or elaboration',
    color: '#bbf7d0', // green-200
    vectorFamily: 'creation',
    icon: 'plus-circle',
  },
  clarify: {
    label: 'Clarify',
    description: 'Ambiguous, needs clarification',
    color: '#bfdbfe', // blue-200
    vectorFamily: 'computation',
    icon: 'help-circle',
  },
  question: {
    label: 'Question',
    description: 'Open question to investigate',
    color: '#fbcfe8', // pink-200
    vectorFamily: 'retrieval',
    icon: 'message-circle',
  },
  important: {
    label: 'Important',
    description: 'Key insight or significant point',
    color: '#e9d5ff', // purple-200
    vectorFamily: 'retrieval',
    icon: 'star',
  },
  citation: {
    label: 'Citation',
    description: 'Needs evidence or source citation',
    color: '#fed7aa', // orange-200
    vectorFamily: 'retrieval',
    icon: 'quote',
  },
  definition: {
    label: 'Definition',
    description: 'Term or concept definition',
    color: '#99f6e4', // teal-200
    vectorFamily: 'creation',
    icon: 'book-open',
  },
  argument: {
    label: 'Argument',
    description: 'Main thesis or central argument',
    color: '#c7d2fe', // indigo-200
    vectorFamily: 'computation',
    icon: 'target',
  },
  evidence: {
    label: 'Evidence',
    description: 'Supporting data or factual backing',
    color: '#d9f99d', // lime-200
    vectorFamily: 'retrieval',
    icon: 'file-text',
  },
  counterpoint: {
    label: 'Counterpoint',
    description: 'Opposing view or alternative perspective',
    color: '#fecaca', // red-200
    vectorFamily: 'computation',
    icon: 'git-branch',
  },
  todo: {
    label: 'To Do',
    description: 'Action item or task to complete',
    color: '#e5e5e5', // neutral-200
    vectorFamily: 'action',
    icon: 'square',
  },
  connection: {
    label: 'Connection',
    description: 'Cross-reference or link to related content',
    color: '#a5f3fc', // cyan-200
    vectorFamily: 'retrieval',
    icon: 'link',
  },
};

/**
 * Map Amnesia highlight colors to annotation types.
 * Used for auto-categorization when creating highlights.
 */
export const HIGHLIGHT_COLOR_TO_ANNOTATION: Record<HighlightColor, AnnotationType> = {
  yellow: 'verify',
  green: 'expand',
  blue: 'clarify',
  pink: 'question',
  purple: 'important',
  orange: 'citation',
};

/**
 * Map annotation types to suggested highlight colors.
 * Used when converting Doc Doctor stubs to highlights.
 */
export const ANNOTATION_TO_HIGHLIGHT_COLOR: Record<AnnotationType, HighlightColor> = {
  verify: 'yellow',
  expand: 'green',
  clarify: 'blue',
  question: 'pink',
  important: 'purple',
  citation: 'orange',
  // Types without direct color mappings default to yellow
  definition: 'blue',
  argument: 'purple',
  evidence: 'green',
  counterpoint: 'orange',
  todo: 'yellow',
  connection: 'blue',
};

/**
 * Map annotation types to Doc Doctor vector families
 */
export const ANNOTATION_TO_VECTOR_FAMILY: Record<AnnotationType, VectorFamily> = {
  verify: 'retrieval',
  expand: 'creation',
  clarify: 'computation',
  question: 'retrieval',
  important: 'retrieval',
  citation: 'retrieval',
  definition: 'creation',
  argument: 'computation',
  evidence: 'retrieval',
  counterpoint: 'computation',
  todo: 'action',
  connection: 'retrieval',
};

/**
 * Get annotation type from highlight color
 *
 * Includes runtime validation in case of unexpected color values.
 */
export function getAnnotationTypeFromColor(color: HighlightColor): AnnotationType {
  const type = HIGHLIGHT_COLOR_TO_ANNOTATION[color];
  if (!type) {
    console.warn(`[Annotations] No mapping for color "${color}", defaulting to 'verify'`);
    return 'verify';
  }
  return type;
}

/**
 * Get suggested highlight color from annotation type
 */
export function getHighlightColorFromAnnotation(type: AnnotationType): HighlightColor {
  return ANNOTATION_TO_HIGHLIGHT_COLOR[type];
}

/**
 * Get vector family for an annotation type
 */
export function getVectorFamily(type: AnnotationType): VectorFamily {
  return ANNOTATION_TO_VECTOR_FAMILY[type];
}

/**
 * Get metadata for an annotation type
 */
export function getAnnotationMetadata(type: AnnotationType): AnnotationTypeMetadata {
  return ANNOTATION_TYPE_METADATA[type];
}

/**
 * Get all annotation types
 */
export function getAllAnnotationTypes(): AnnotationType[] {
  return Object.keys(ANNOTATION_TYPE_METADATA) as AnnotationType[];
}

/**
 * All valid annotation types as an array
 */
export const ANNOTATION_TYPES: readonly AnnotationType[] = Object.keys(ANNOTATION_TYPE_METADATA) as AnnotationType[];

/**
 * Check if a string is a valid annotation type
 */
export function isValidAnnotationType(value: string): value is AnnotationType {
  return value in ANNOTATION_TYPE_METADATA;
}

/**
 * Knowledge gap types that should create Doc Doctor stubs.
 * These represent questions, uncertainties, or areas needing research.
 *
 * CRITICAL PRINCIPLE from PRD:
 * "Stubs (knowledge gaps) !== Annotations (captured insights)"
 */
export const KNOWLEDGE_GAP_TYPES: readonly AnnotationType[] = [
  'verify',   // Needs fact-checking - yellow
  'expand',   // Needs more detail - green
  'clarify',  // Ambiguous, needs clarification - blue
  'question', // Open question - pink
] as const;

/**
 * Insight types that remain as highlights only.
 * These represent captured knowledge, not gaps.
 */
export const INSIGHT_TYPES: readonly AnnotationType[] = [
  'important', // Key insight - purple
  'citation',  // Evidence/reference - orange
] as const;

/**
 * Doc Doctor-only types (created by AI, not from highlights).
 * These types don't have direct Amnesia color mappings.
 */
export const DOC_DOCTOR_ONLY_TYPES: readonly AnnotationType[] = [
  'definition',   // Term definitions
  'argument',     // Main thesis
  'evidence',     // Supporting data
  'counterpoint', // Opposing views
  'todo',         // Action items
  'connection',   // Cross-references
] as const;

/**
 * Check if an annotation type represents a knowledge gap
 * that should create a Doc Doctor stub.
 */
export function isKnowledgeGapType(type: AnnotationType | string): boolean {
  return (KNOWLEDGE_GAP_TYPES as readonly string[]).includes(type);
}

/**
 * Check if an annotation type represents a captured insight
 * that should stay in Amnesia only.
 */
export function isInsightType(type: AnnotationType | string): boolean {
  return (INSIGHT_TYPES as readonly string[]).includes(type);
}

/**
 * Check if an annotation type is Doc Doctor-only
 * (created by AI, not from user highlights).
 */
export function isDocDoctorOnlyType(type: AnnotationType | string): boolean {
  return (DOC_DOCTOR_ONLY_TYPES as readonly string[]).includes(type);
}
