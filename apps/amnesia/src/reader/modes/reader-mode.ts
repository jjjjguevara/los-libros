/**
 * Reader Mode Configuration
 *
 * Foundation for Source/Live mode toggling in the reader.
 * Source mode: Analytical reading with full annotation features
 * Live mode: Clean, immersive reading experience
 *
 * NOTE: This is the foundation only. Actual feature toggling
 * (argument margins, AI features, velocity heatmap, etc.)
 * is deferred to a dedicated PRD.
 */

import { writable, type Writable } from 'svelte/store';

/**
 * Reader display mode
 * - 'live': Clean, immersive reading (minimal UI, hidden annotations)
 * - 'source': Analytical mode (full features, annotation overlays)
 */
export type ReaderMode = 'live' | 'source';

/**
 * Live mode configuration options
 * These control what's hidden in immersive reading mode
 */
export interface LiveModeConfig {
  /** Hide annotation highlight overlays */
  hideAnnotationOverlays: boolean;

  /** Hide AI-powered features (suggestions, summaries) */
  hideAIFeatures: boolean;

  /** Hide velocity/reading heatmap */
  hideVelocityHeatmap: boolean;

  /** Hide stub indicators */
  hideStubIndicators: boolean;
}

/**
 * Source mode configuration options
 * These control what's shown in analytical reading mode
 */
export interface SourceModeConfig {
  /** Show argument structure in margins */
  showArgumentMargins: boolean;

  /** Show citation hover previews */
  showCitationHover: boolean;

  /** Show reading velocity heatmap */
  showVelocityHeatmap: boolean;

  /** Show cross-book reference links */
  showCrossBookLinks: boolean;

  /** Show Doc Doctor stub indicators */
  showStubIndicators: boolean;

  /** Show annotation overlays */
  showAnnotationOverlays: boolean;
}

/**
 * Complete reader mode configuration
 */
export interface ReaderModeConfig {
  /** Current active mode */
  mode: ReaderMode;

  /** Live mode settings */
  live: LiveModeConfig;

  /** Source mode settings */
  source: SourceModeConfig;
}

/**
 * Default mode configuration
 * Live mode is default for immersive reading experience
 */
export const DEFAULT_MODE_CONFIG: ReaderModeConfig = {
  mode: 'live',
  live: {
    hideAnnotationOverlays: false, // Keep annotations visible by default
    hideAIFeatures: true,
    hideVelocityHeatmap: true,
    hideStubIndicators: true,
  },
  source: {
    showArgumentMargins: true,
    showCitationHover: true,
    showVelocityHeatmap: false, // Off by default (performance)
    showCrossBookLinks: false, // Off by default (requires setup)
    showStubIndicators: true,
    showAnnotationOverlays: true,
  },
};

/**
 * Create a reader mode store with persistence support
 */
export function createReaderModeStore(
  initialConfig?: Partial<ReaderModeConfig>
): Writable<ReaderModeConfig> {
  const config: ReaderModeConfig = {
    ...DEFAULT_MODE_CONFIG,
    ...initialConfig,
  };

  return writable(config);
}

/**
 * Toggle between live and source mode
 */
export function toggleMode(config: ReaderModeConfig): ReaderModeConfig {
  return {
    ...config,
    mode: config.mode === 'live' ? 'source' : 'live',
  };
}

/**
 * Get the effective settings for the current mode
 */
export function getEffectiveSettings(config: ReaderModeConfig): {
  showAnnotationOverlays: boolean;
  showAIFeatures: boolean;
  showVelocityHeatmap: boolean;
  showStubIndicators: boolean;
  showArgumentMargins: boolean;
  showCitationHover: boolean;
  showCrossBookLinks: boolean;
} {
  if (config.mode === 'live') {
    return {
      showAnnotationOverlays: !config.live.hideAnnotationOverlays,
      showAIFeatures: !config.live.hideAIFeatures,
      showVelocityHeatmap: !config.live.hideVelocityHeatmap,
      showStubIndicators: !config.live.hideStubIndicators,
      showArgumentMargins: false,
      showCitationHover: false,
      showCrossBookLinks: false,
    };
  }

  // Source mode
  return {
    showAnnotationOverlays: config.source.showAnnotationOverlays,
    showAIFeatures: true,
    showVelocityHeatmap: config.source.showVelocityHeatmap,
    showStubIndicators: config.source.showStubIndicators,
    showArgumentMargins: config.source.showArgumentMargins,
    showCitationHover: config.source.showCitationHover,
    showCrossBookLinks: config.source.showCrossBookLinks,
  };
}

/**
 * Mode display metadata
 */
export const MODE_METADATA: Record<ReaderMode, { label: string; icon: string; description: string }> = {
  live: {
    label: 'Reading',
    icon: 'book-open',
    description: 'Immersive reading mode with minimal distractions',
  },
  source: {
    label: 'Source',
    icon: 'code-2',
    description: 'Analytical mode with full annotation features',
  },
};

/**
 * Hotkey for mode toggle (matches Obsidian's Source/Live pattern)
 */
export const MODE_TOGGLE_HOTKEY = {
  modifiers: ['Mod'] as const,
  key: 'e',
};
