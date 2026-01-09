/**
 * Deduplication Manager
 *
 * Handles detection and resolution of duplicate annotations between
 * Amnesia highlights and Doc Doctor stubs to prevent sync loops and
 * redundant data.
 *
 * IMPORTANT: Only knowledge-gap highlights (verify, expand, clarify, question)
 * can have stubs. Insight highlights (important, citation) should never
 * match stubs since they don't create them.
 *
 * @module integrations/deduplication
 */

import type { Highlight } from '../library/types';
import type { DocDoctorStub } from './doc-doctor-bridge';
import { isKnowledgeGapType } from './knowledge-gap-filter';

/**
 * Duplicate match result
 */
export interface DuplicateMatch {
  /** The matching stub */
  stub: DocDoctorStub;
  /** Confidence score (0-1) */
  confidence: number;
  /** Match type */
  matchType: 'exact' | 'fuzzy' | 'anchor';
  /** Details about the match */
  details: string;
}

/**
 * Deduplication statistics
 */
export interface DedupStats {
  totalChecked: number;
  exactMatches: number;
  fuzzyMatches: number;
  anchorMatches: number;
  noMatches: number;
}

/**
 * Text similarity options
 */
interface SimilarityOptions {
  /** Minimum similarity threshold (0-1) */
  threshold: number;
  /** Ignore case when comparing */
  ignoreCase: boolean;
  /** Ignore whitespace differences */
  ignoreWhitespace: boolean;
}

/**
 * Deduplication Manager
 *
 * Detects duplicate annotations to prevent redundant sync operations.
 */
export class DeduplicationManager {
  private stats: DedupStats = {
    totalChecked: 0,
    exactMatches: 0,
    fuzzyMatches: 0,
    anchorMatches: 0,
    noMatches: 0,
  };

  private readonly defaultSimilarityOptions: SimilarityOptions = {
    threshold: 0.85,
    ignoreCase: true,
    ignoreWhitespace: true,
  };

  /**
   * Get deduplication statistics
   */
  getStats(): DedupStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalChecked: 0,
      exactMatches: 0,
      fuzzyMatches: 0,
      anchorMatches: 0,
      noMatches: 0,
    };
  }

  /**
   * Find duplicate stub for a highlight
   *
   * Checks if a stub already exists for this highlight using multiple
   * matching strategies:
   * 1. Exact anchor match (highest confidence)
   * 2. Source plugin + highlight ID match
   * 3. Fuzzy text match (lowest confidence)
   *
   * IMPORTANT: Only knowledge-gap highlights can have stubs.
   * Insight highlights (important, citation) immediately return null
   * since they should never create stubs.
   */
  findDuplicateStub(
    highlight: Highlight,
    stubs: DocDoctorStub[],
    options?: Partial<SimilarityOptions>
  ): DuplicateMatch | null {
    // CRITICAL: Non-knowledge-gap highlights should never have stubs
    // Return null immediately to prevent false matches
    if (!isKnowledgeGapType(highlight.category)) {
      return null;
    }

    this.stats.totalChecked++;
    const opts = { ...this.defaultSimilarityOptions, ...options };

    // Strategy 1: Anchor match (^hl-{id})
    const anchorMatch = stubs.find(
      stub => stub.anchor === `^hl-${highlight.id}`
    );
    if (anchorMatch) {
      this.stats.anchorMatches++;
      return {
        stub: anchorMatch,
        confidence: 1.0,
        matchType: 'anchor',
        details: `Anchor match: ${anchorMatch.anchor}`,
      };
    }

    // Strategy 2: Source plugin match
    const sourceMatch = stubs.find(
      stub =>
        stub.source?.plugin === 'amnesia' &&
        stub.source?.highlightId === highlight.id
    );
    if (sourceMatch) {
      this.stats.exactMatches++;
      return {
        stub: sourceMatch,
        confidence: 1.0,
        matchType: 'exact',
        details: `Source match: plugin=amnesia, highlightId=${highlight.id}`,
      };
    }

    // Strategy 3: Fuzzy text match
    for (const stub of stubs) {
      const similarity = this.calculateTextSimilarity(
        highlight.text,
        stub.description,
        opts
      );

      if (similarity >= opts.threshold) {
        // Also check type/category match for higher confidence
        const typeMatch = stub.type === highlight.category;
        const adjustedConfidence = typeMatch
          ? Math.min(similarity + 0.1, 1.0)
          : similarity;

        if (adjustedConfidence >= opts.threshold) {
          this.stats.fuzzyMatches++;
          return {
            stub,
            confidence: adjustedConfidence,
            matchType: 'fuzzy',
            details: `Fuzzy match: ${Math.round(similarity * 100)}% similar${typeMatch ? ', type matches' : ''}`,
          };
        }
      }
    }

    this.stats.noMatches++;
    return null;
  }

  /**
   * Find duplicate highlight for a stub
   */
  findDuplicateHighlight(
    stub: DocDoctorStub,
    highlights: Highlight[],
    options?: Partial<SimilarityOptions>
  ): { highlight: Highlight; confidence: number } | null {
    const opts = { ...this.defaultSimilarityOptions, ...options };

    // Strategy 1: Source match (stub was created from this highlight)
    if (stub.source?.plugin === 'amnesia' && stub.source?.highlightId) {
      const sourceMatch = highlights.find(
        h => h.id === stub.source!.highlightId
      );
      if (sourceMatch) {
        return { highlight: sourceMatch, confidence: 1.0 };
      }
    }

    // Strategy 2: Doc Doctor stub ID match
    const stubIdMatch = highlights.find(
      h => h.docDoctorStubId === stub.id
    );
    if (stubIdMatch) {
      return { highlight: stubIdMatch, confidence: 1.0 };
    }

    // Strategy 3: Fuzzy text match
    for (const highlight of highlights) {
      const similarity = this.calculateTextSimilarity(
        stub.description,
        highlight.text,
        opts
      );

      if (similarity >= opts.threshold) {
        const typeMatch = stub.type === highlight.category;
        const adjustedConfidence = typeMatch
          ? Math.min(similarity + 0.1, 1.0)
          : similarity;

        if (adjustedConfidence >= opts.threshold) {
          return { highlight, confidence: adjustedConfidence };
        }
      }
    }

    return null;
  }

  /**
   * Check if two highlights are duplicates
   */
  areHighlightsDuplicate(
    a: Highlight,
    b: Highlight,
    options?: Partial<SimilarityOptions>
  ): boolean {
    // Same ID
    if (a.id === b.id) return true;

    // Same Doc Doctor stub ID
    if (
      a.docDoctorStubId &&
      b.docDoctorStubId &&
      a.docDoctorStubId === b.docDoctorStubId
    ) {
      return true;
    }

    // Fuzzy text match
    const opts = { ...this.defaultSimilarityOptions, ...options };
    const similarity = this.calculateTextSimilarity(a.text, b.text, opts);

    return similarity >= opts.threshold;
  }

  /**
   * Maximum text length for similarity comparison.
   * Prevents performance issues with very long texts.
   */
  private static readonly MAX_COMPARISON_LENGTH = 300;

  /**
   * Calculate text similarity using Levenshtein distance.
   * Texts are truncated to MAX_COMPARISON_LENGTH to prevent performance issues.
   */
  private calculateTextSimilarity(
    text1: string,
    text2: string,
    options: SimilarityOptions
  ): number {
    let a = text1;
    let b = text2;

    if (options.ignoreCase) {
      a = a.toLowerCase();
      b = b.toLowerCase();
    }

    if (options.ignoreWhitespace) {
      a = a.replace(/\s+/g, ' ').trim();
      b = b.replace(/\s+/g, ' ').trim();
    }

    // Truncate to prevent performance issues with very long texts
    if (a.length > DeduplicationManager.MAX_COMPARISON_LENGTH) {
      a = a.slice(0, DeduplicationManager.MAX_COMPARISON_LENGTH);
    }
    if (b.length > DeduplicationManager.MAX_COMPARISON_LENGTH) {
      b = b.slice(0, DeduplicationManager.MAX_COMPARISON_LENGTH);
    }

    // Exact match
    if (a === b) return 1.0;

    // Empty strings
    if (a.length === 0 || b.length === 0) return 0;

    // Use Levenshtein distance for similarity
    const distance = this.levenshteinDistance(a, b);
    const maxLength = Math.max(a.length, b.length);

    return 1 - distance / maxLength;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    // Optimization for very different length strings
    if (Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.5) {
      return Math.max(a.length, b.length);
    }

    const matrix: number[][] = [];

    // Initialize matrix
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Deduplicate a list of highlights
   *
   * Returns a list with duplicates removed, keeping the most recent version.
   */
  deduplicateHighlights(highlights: Highlight[]): Highlight[] {
    const seen = new Map<string, Highlight>();
    const textHashes = new Map<string, Highlight>();

    for (const highlight of highlights) {
      // Check by ID
      if (seen.has(highlight.id)) {
        const existing = seen.get(highlight.id)!;
        if (highlight.updatedAt > existing.updatedAt) {
          seen.set(highlight.id, highlight);
        }
        continue;
      }

      // Check by text hash (fuzzy dedup)
      const textHash = this.normalizeText(highlight.text);
      if (textHashes.has(textHash)) {
        const existing = textHashes.get(textHash)!;
        // Keep the one with more data (annotation, tags, etc.)
        const existingScore = this.calculateDataRichness(existing);
        const newScore = this.calculateDataRichness(highlight);
        if (newScore > existingScore) {
          textHashes.set(textHash, highlight);
          seen.set(highlight.id, highlight);
        }
        continue;
      }

      seen.set(highlight.id, highlight);
      textHashes.set(textHash, highlight);
    }

    return Array.from(seen.values());
  }

  /**
   * Normalize text for hash comparison
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100); // Use first 100 chars as hash
  }

  /**
   * Calculate how "rich" a highlight is in terms of data
   */
  private calculateDataRichness(highlight: Highlight): number {
    let score = 0;
    if (highlight.annotation) score += 2;
    if (highlight.tags && highlight.tags.length > 0) score += highlight.tags.length;
    if (highlight.category) score += 1;
    if (highlight.chapter) score += 1;
    if (highlight.syncedToDocDoctor) score += 1;
    return score;
  }
}
