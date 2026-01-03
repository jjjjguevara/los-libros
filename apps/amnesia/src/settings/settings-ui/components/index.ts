/**
 * Settings UI Components
 *
 * Re-exports all settings UI components for convenient importing.
 */

// Core Components
export {
    AdvancedAccordion,
    createAdvancedAccordion,
    type AdvancedAccordionOptions,
} from './advanced-accordion';

export {
    ContextCard,
    createContextCard,
    type ContextCardConfig,
    type ContextCardFeature,
    type ContextCardStatus,
} from './context-card';

export {
    FloatingOutline,
    type FloatingOutlineOptions,
    type OutlineItem,
} from './floating-outline';

export {
    SearchDrawer,
    type SearchDrawerOptions,
} from './search-drawer';

export {
    KeyboardHandler,
    createFocusTrap,
    highlightElement,
    addHighlightStyles,
    type KeyboardHandlerOptions,
} from './keyboard-handler';
