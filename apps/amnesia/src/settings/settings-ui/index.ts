/**
 * Settings UI Module
 *
 * Complete settings UI system with search, outline navigation,
 * and keyboard shortcuts. Ported from doc-doctor plugin.
 *
 * Usage:
 * ```typescript
 * import { createSettingsUI, type TabId } from './settings-ui';
 *
 * const coordinator = createSettingsUI({
 *     containerEl: settingsContainer,
 *     scrollContainerEl: scrollContainer,
 *     getCurrentTab: () => currentTab,
 *     navigateToTab: (tabId) => switchTab(tabId),
 *     isSettingsActive: () => isOpen,
 *     scope: modal.scope,
 * });
 *
 * // Later, when tab content changes
 * coordinator.refreshOutline();
 *
 * // Cleanup
 * coordinator.destroy();
 * ```
 */

// Main coordinator
export {
    SettingsUICoordinator,
    createSettingsUI,
    type SettingsUICoordinatorOptions,
} from './settings-ui-coordinator';

// Search index
export {
    SettingsSearchIndex,
    buildSettingsIndex,
    getSettingsIndex,
    resetSettingsIndex,
    type TabId,
    type SettingImpact,
    type SettingType,
    type SettingSearchEntry,
    type SearchResult,
} from './settings-search-index';

// Components
export * from './components';

// Section helpers
export {
    createTabHeader,
    createSection,
    createSubsectionHeader,
    createFeatureCardsContainer,
    addFeatureCard,
    createExplainerBox,
    createFormatPreview,
    createInfoBadge,
    createStatsDisplay,
    createRemovableList,
    createShortcutsTable,
    addSharedStyles,
} from './section-helpers';
