/**
 * Knowledge Gap Filter
 *
 * Determines which highlights represent knowledge gaps that should
 * create Doc Doctor stubs vs complete insights that stay in Amnesia.
 *
 * CRITICAL PRINCIPLE from PRD:
 * "Stubs (knowledge gaps) !== Annotations (captured insights)"
 *
 * - Knowledge gaps (verify, expand, clarify, question) → Create stubs
 * - Insights (important, citation) → Stay in Amnesia only
 * - Doc Doctor-only types → Created by AI, not from highlights
 *
 * @module integrations/knowledge-gap-filter
 */

import type { AnnotationType } from '@shared/annotations';
import type { Highlight } from '../library/types';

/**
 * Annotation types representing knowledge gaps that need AI resolution.
 * These types represent INCOMPLETE knowledge requiring processing.
 */
export const KNOWLEDGE_GAP_TYPES: readonly AnnotationType[] = [
  'verify',    // Needs fact-checking - yellow
  'expand',    // Needs elaboration - green
  'clarify',   // Needs clarification - blue
  'question',  // Needs answering - pink
] as const;

/**
 * Annotation types representing complete insights (Amnesia-only).
 * These are CAPTURED knowledge, not gaps.
 */
export const INSIGHT_TYPES: readonly AnnotationType[] = [
  'important', // Key insight (complete) - purple
  'citation',  // Reference marker (complete) - orange
] as const;

/**
 * Doc Doctor-only types (created by AI, not from highlights).
 * These types don't have Amnesia color mappings.
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
 * Set for O(1) lookup of knowledge gap types
 */
const KNOWLEDGE_GAP_SET = new Set<AnnotationType>(KNOWLEDGE_GAP_TYPES);

/**
 * Set for O(1) lookup of insight types
 */
const INSIGHT_SET = new Set<AnnotationType>(INSIGHT_TYPES);

/**
 * Set for O(1) lookup of Doc Doctor-only types
 */
const DOC_DOCTOR_ONLY_SET = new Set<AnnotationType>(DOC_DOCTOR_ONLY_TYPES);

/**
 * Knowledge Gap Filter
 *
 * Centralizes logic for determining if a highlight should create a stub.
 * Use this class to maintain consistent filtering across sync operations.
 */
export class KnowledgeGapFilter {
  /**
   * Check if highlight is a knowledge gap that should create a stub.
   *
   * @param highlight - The highlight to check
   * @returns true if highlight represents a knowledge gap
   */
  isKnowledgeGap(highlight: Highlight): boolean {
    return highlight.category
      ? KNOWLEDGE_GAP_SET.has(highlight.category as AnnotationType)
      : false; // Default: don't sync if no category
  }

  /**
   * Check if highlight is a complete insight (Amnesia-only).
   *
   * @param highlight - The highlight to check
   * @returns true if highlight represents a complete insight
   */
  isInsight(highlight: Highlight): boolean {
    return highlight.category
      ? INSIGHT_SET.has(highlight.category as AnnotationType)
      : false;
  }

  /**
   * Check if annotation type is a knowledge gap type.
   *
   * @param type - The annotation type to check
   * @returns true if type represents a knowledge gap
   */
  isKnowledgeGapType(type?: AnnotationType | string): boolean {
    return type ? KNOWLEDGE_GAP_SET.has(type as AnnotationType) : false;
  }

  /**
   * Check if annotation type is an insight type.
   *
   * @param type - The annotation type to check
   * @returns true if type represents a complete insight
   */
  isInsightType(type?: AnnotationType | string): boolean {
    return type ? INSIGHT_SET.has(type as AnnotationType) : false;
  }

  /**
   * Check if annotation type is Doc Doctor-only (shouldn't create highlights).
   *
   * @param type - The annotation type to check
   * @returns true if type is Doc Doctor-only
   */
  isDocDoctorOnlyType(type?: AnnotationType | string): boolean {
    return type ? DOC_DOCTOR_ONLY_SET.has(type as AnnotationType) : false;
  }

  /**
   * Get highlights that need sync (knowledge gaps only).
   *
   * @param highlights - Array of highlights to filter
   * @returns Array of highlights that should create stubs
   */
  filterSyncableHighlights(highlights: Highlight[]): Highlight[] {
    return highlights.filter(h => this.isKnowledgeGap(h));
  }

  /**
   * Get highlights that are insights (Amnesia-only).
   *
   * @param highlights - Array of highlights to filter
   * @returns Array of highlights that should stay in Amnesia only
   */
  filterInsightHighlights(highlights: Highlight[]): Highlight[] {
    return highlights.filter(h => this.isInsight(h));
  }

  /**
   * Explain why a highlight was skipped for sync.
   *
   * @param highlight - The highlight that was skipped
   * @returns Human-readable reason, or null if highlight should sync
   */
  getSkipReason(highlight: Highlight): string | null {
    if (!highlight.category) {
      return 'No category assigned (default highlights not synced)';
    }
    if (this.isInsight(highlight)) {
      return `"${highlight.category}" is a complete insight, not a knowledge gap`;
    }
    if (this.isDocDoctorOnlyType(highlight.category)) {
      return `"${highlight.category}" is a Doc Doctor-only type`;
    }
    if (!this.isKnowledgeGap(highlight)) {
      return `"${highlight.category}" is not a syncable type`;
    }
    return null; // Should sync
  }

  /**
   * Get sync eligibility for a highlight with reason.
   *
   * @param highlight - The highlight to check
   * @returns Eligibility status with optional reason
   */
  getSyncEligibility(highlight: Highlight): {
    eligible: boolean;
    reason?: string;
  } {
    if (this.isKnowledgeGap(highlight)) {
      return { eligible: true };
    }
    const reason = this.getSkipReason(highlight);
    return { eligible: false, reason: reason ?? 'Unknown' };
  }
}

/**
 * Standalone function to check if a type is a knowledge gap.
 * Convenience function for use without instantiating the class.
 *
 * @param type - The annotation type to check
 * @returns true if type represents a knowledge gap
 */
export function isKnowledgeGapType(type?: AnnotationType | string): boolean {
  return type ? KNOWLEDGE_GAP_SET.has(type as AnnotationType) : false;
}

/**
 * Standalone function to check if a type is an insight.
 * Convenience function for use without instantiating the class.
 *
 * @param type - The annotation type to check
 * @returns true if type represents a complete insight
 */
export function isInsightType(type?: AnnotationType | string): boolean {
  return type ? INSIGHT_SET.has(type as AnnotationType) : false;
}

/**
 * Standalone function to check if a type is Doc Doctor-only.
 * Convenience function for use without instantiating the class.
 *
 * @param type - The annotation type to check
 * @returns true if type is Doc Doctor-only
 */
export function isDocDoctorOnlyType(type?: AnnotationType | string): boolean {
  return type ? DOC_DOCTOR_ONLY_SET.has(type as AnnotationType) : false;
}
