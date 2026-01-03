/**
 * Settings Search Index
 *
 * MiniSearch-powered search index for settings discovery.
 * Supports fuzzy matching, synonym expansion, and field weighting.
 * Ported from doc-doctor plugin and adapted for Amnesia.
 */

import MiniSearch from 'minisearch';

// =============================================================================
// TYPES
// =============================================================================

export type TabId = 'library' | 'reading' | 'sync' | 'notes' | 'advanced';

export type SettingImpact = 'critical' | 'high' | 'medium' | 'low';

export type SettingType = 'toggle' | 'dropdown' | 'text' | 'slider' | 'button' | 'custom';

export interface SettingSearchEntry {
    // Identity
    id: string;
    name: string;
    description: string;

    // Search optimization
    keywords: string[];

    // Navigation
    tab: TabId;
    section: string;
    subsection?: string;
    isAdvanced: boolean;

    // Metadata
    impact: SettingImpact;
    settingType: SettingType;
    relatedSettings?: string[];
}

export interface SearchResult {
    entry: SettingSearchEntry;
    score: number;
    matches: string[];
}

// =============================================================================
// SYNONYM DICTIONARY
// =============================================================================

const SYNONYMS: Record<string, string[]> = {
    // Common vocabulary gaps
    lag: ['debounce', 'delay', 'timeout', 'latency'],
    slow: ['performance', 'timeout', 'optimization', 'speed'],
    fast: ['performance', 'speed', 'optimization', 'quick'],
    color: ['theme', 'palette', 'style', 'appearance', 'colour'],
    folder: ['directory', 'path', 'location'],
    save: ['persist', 'store', 'write', 'commit'],
    load: ['read', 'fetch', 'retrieve', 'import'],

    // Ebook/Calibre vocabulary
    book: ['ebook', 'epub', 'pdf', 'document', 'publication'],
    library: ['calibre', 'collection', 'catalog', 'books'],
    cover: ['thumbnail', 'image', 'artwork', 'jacket'],
    metadata: ['properties', 'info', 'data', 'details', 'frontmatter'],
    sync: ['synchronize', 'update', 'refresh', 'fetch', 'pull'],
    server: ['content server', 'calibre', 'endpoint', 'connection'],

    // Reading vocabulary
    page: ['column', 'screen', 'view'],
    scroll: ['paginate', 'continuous', 'flow'],
    margin: ['padding', 'spacing', 'gutter'],
    font: ['typography', 'text', 'typeface'],

    // Action synonyms
    enable: ['activate', 'turn on', 'start', 'allow'],
    disable: ['deactivate', 'turn off', 'stop', 'block'],
    show: ['display', 'visible', 'reveal', 'unhide'],
    hide: ['conceal', 'invisible', 'hidden', 'collapse'],
};

// =============================================================================
// SEARCH INDEX CLASS
// =============================================================================

export class SettingsSearchIndex {
    private miniSearch: MiniSearch<SettingSearchEntry>;
    private entries: Map<string, SettingSearchEntry> = new Map();

    constructor() {
        this.miniSearch = new MiniSearch<SettingSearchEntry>({
            fields: ['name', 'description', 'keywords', 'section', 'subsection'],
            storeFields: ['id', 'name', 'description', 'tab', 'section', 'subsection', 'isAdvanced', 'impact', 'settingType'],
            searchOptions: {
                boost: { name: 3, keywords: 2, description: 1, section: 0.5 },
                fuzzy: 0.2,
                prefix: true,
            },
            tokenize: (text: string): string[] => {
                // Custom tokenizer that handles camelCase and kebab-case
                return text
                    .toLowerCase()
                    .replace(/([a-z])([A-Z])/g, '$1 $2')
                    .replace(/[-_]/g, ' ')
                    .split(/\s+/)
                    .filter((token: string) => token.length > 1);
            },
        });
    }

    /**
     * Add a setting entry to the index
     */
    addEntry(entry: SettingSearchEntry): void {
        // Expand keywords with synonyms
        const expandedKeywords = this.expandWithSynonyms(entry.keywords);
        const expandedEntry = {
            ...entry,
            keywords: expandedKeywords,
        };

        this.entries.set(entry.id, entry);
        this.miniSearch.add(expandedEntry);
    }

    /**
     * Add multiple entries at once
     */
    addEntries(entries: SettingSearchEntry[]): void {
        for (const entry of entries) {
            this.addEntry(entry);
        }
    }

    /**
     * Search for settings matching the query
     */
    search(query: string, options?: { tab?: TabId; limit?: number }): SearchResult[] {
        if (!query || query.length < 2) {
            return [];
        }

        // Expand query with synonyms
        const expandedQuery = this.expandQueryWithSynonyms(query);

        const results = this.miniSearch.search(expandedQuery, {
            fuzzy: 0.2,
            prefix: true,
            combineWith: 'OR',
        });

        let filtered = results.map((result: { id: string; score: number; match: Record<string, string[]> }) => ({
            entry: this.entries.get(result.id)!,
            score: result.score,
            matches: Object.keys(result.match),
        }));

        // Filter by tab if specified
        if (options?.tab) {
            filtered = filtered.filter((r: SearchResult) => r.entry.tab === options.tab);
        }

        // Limit results
        if (options?.limit) {
            filtered = filtered.slice(0, options.limit);
        }

        return filtered;
    }

    /**
     * Get all entries for a specific tab
     */
    getEntriesForTab(tab: TabId): SettingSearchEntry[] {
        return Array.from(this.entries.values()).filter((e) => e.tab === tab);
    }

    /**
     * Get entry by ID
     */
    getEntry(id: string): SettingSearchEntry | undefined {
        return this.entries.get(id);
    }

    /**
     * Get all entries
     */
    getAllEntries(): SettingSearchEntry[] {
        return Array.from(this.entries.values());
    }

    /**
     * Clear the index
     */
    clear(): void {
        this.miniSearch.removeAll();
        this.entries.clear();
    }

    /**
     * Expand keywords with synonyms
     */
    private expandWithSynonyms(keywords: string[]): string[] {
        const expanded = new Set(keywords);

        for (const keyword of keywords) {
            const lowerKeyword = keyword.toLowerCase();
            // Check if this keyword has synonyms
            if (SYNONYMS[lowerKeyword]) {
                for (const synonym of SYNONYMS[lowerKeyword]) {
                    expanded.add(synonym);
                }
            }
            // Check if this keyword IS a synonym of something
            for (const [key, synonyms] of Object.entries(SYNONYMS)) {
                if (synonyms.includes(lowerKeyword)) {
                    expanded.add(key);
                    for (const s of synonyms) {
                        expanded.add(s);
                    }
                }
            }
        }

        return Array.from(expanded);
    }

    /**
     * Expand search query with synonyms
     */
    private expandQueryWithSynonyms(query: string): string {
        const words = query.toLowerCase().split(/\s+/);
        const expandedWords = new Set(words);

        for (const word of words) {
            if (SYNONYMS[word]) {
                // Add first 2 synonyms to avoid query explosion
                SYNONYMS[word].slice(0, 2).forEach((s) => expandedWords.add(s));
            }
        }

        return Array.from(expandedWords).join(' ');
    }
}

// =============================================================================
// SETTINGS REGISTRY
// =============================================================================

/**
 * Build the complete settings index from all tabs
 */
export function buildSettingsIndex(): SettingsSearchIndex {
    const index = new SettingsSearchIndex();

    // Library Tab
    index.addEntries([
        {
            id: 'calibre.libraryPath',
            name: 'Calibre Library Path',
            description: 'Path to your Calibre library folder',
            keywords: ['library', 'calibre', 'path', 'folder', 'location'],
            tab: 'library',
            section: 'Library Location',
            isAdvanced: false,
            impact: 'critical',
            settingType: 'text',
        },
        {
            id: 'calibre.serverUrl',
            name: 'Content Server URL',
            description: 'URL of the Calibre Content Server for remote access',
            keywords: ['server', 'url', 'content server', 'remote', 'endpoint'],
            tab: 'library',
            section: 'Connection',
            isAdvanced: false,
            impact: 'high',
            settingType: 'text',
        },
        {
            id: 'calibre.username',
            name: 'Server Username',
            description: 'Username for authenticated Content Server access',
            keywords: ['username', 'auth', 'login', 'credential'],
            tab: 'library',
            section: 'Connection',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'text',
        },
        {
            id: 'calibre.password',
            name: 'Server Password',
            description: 'Password for authenticated Content Server access',
            keywords: ['password', 'auth', 'secret', 'credential'],
            tab: 'library',
            section: 'Connection',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'text',
        },
        {
            id: 'notes.folder',
            name: 'Book Notes Folder',
            description: 'Where to store generated book notes in your vault',
            keywords: ['notes', 'folder', 'path', 'location', 'vault'],
            tab: 'library',
            section: 'Note Creation',
            isAdvanced: false,
            impact: 'high',
            settingType: 'text',
        },
        {
            id: 'notes.template',
            name: 'Note Template',
            description: 'Template for newly created book notes',
            keywords: ['template', 'format', 'layout', 'structure'],
            tab: 'library',
            section: 'Note Creation',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'custom',
        },
    ]);

    // Sync Tab
    index.addEntries([
        {
            id: 'sync.enabled',
            name: 'Enable Sync',
            description: 'Enable automatic synchronization with Calibre library',
            keywords: ['sync', 'auto', 'enable', 'automatic'],
            tab: 'sync',
            section: 'Sync Engine',
            isAdvanced: false,
            impact: 'critical',
            settingType: 'toggle',
        },
        {
            id: 'sync.interval',
            name: 'Sync Interval',
            description: 'How often to check for library changes (in minutes)',
            keywords: ['interval', 'frequency', 'automatic', 'schedule'],
            tab: 'sync',
            section: 'Sync Engine',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'slider',
        },
        {
            id: 'sync.onStartup',
            name: 'Sync on Startup',
            description: 'Automatically sync when Obsidian starts',
            keywords: ['startup', 'load', 'automatic', 'initial'],
            tab: 'sync',
            section: 'Sync Engine',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'toggle',
        },
        {
            id: 'sync.createNotes',
            name: 'Create Book Notes',
            description: 'Automatically create notes for new books',
            keywords: ['notes', 'create', 'automatic', 'new'],
            tab: 'sync',
            section: 'What to Sync',
            isAdvanced: false,
            impact: 'high',
            settingType: 'toggle',
        },
        {
            id: 'sync.createAuthors',
            name: 'Create Author Notes',
            description: 'Automatically create notes for authors',
            keywords: ['author', 'notes', 'create', 'automatic'],
            tab: 'sync',
            section: 'What to Sync',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'toggle',
        },
        {
            id: 'sync.downloadCovers',
            name: 'Download Covers',
            description: 'Download book cover images during sync',
            keywords: ['covers', 'images', 'download', 'artwork'],
            tab: 'sync',
            section: 'What to Sync',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'toggle',
        },
        {
            id: 'sync.conflictResolution',
            name: 'Conflict Resolution',
            description: 'How to handle conflicts between local and remote changes',
            keywords: ['conflict', 'resolution', 'merge', 'overwrite'],
            tab: 'sync',
            section: 'Conflict Handling',
            isAdvanced: false,
            impact: 'high',
            settingType: 'dropdown',
        },
        {
            id: 'sync.batchSize',
            name: 'Batch Size',
            description: 'Number of books to process per batch during sync',
            keywords: ['batch', 'size', 'performance', 'chunk'],
            tab: 'sync',
            section: 'Advanced',
            isAdvanced: true,
            impact: 'low',
            settingType: 'slider',
        },
        {
            id: 'sync.resumeEnabled',
            name: 'Resume Support',
            description: 'Enable ability to resume interrupted syncs',
            keywords: ['resume', 'continue', 'interrupt', 'checkpoint'],
            tab: 'sync',
            section: 'Advanced',
            isAdvanced: true,
            impact: 'medium',
            settingType: 'toggle',
        },
    ]);

    // Reading Tab
    index.addEntries([
        {
            id: 'reader.defaultMode',
            name: 'Default Reading Mode',
            description: 'Choose between paginated or scrolling reading mode',
            keywords: ['mode', 'paginated', 'scroll', 'reading', 'default'],
            tab: 'reading',
            section: 'Reading Mode',
            isAdvanced: false,
            impact: 'high',
            settingType: 'dropdown',
        },
        {
            id: 'reader.columnWidth',
            name: 'Column Width',
            description: 'Width of text columns in paginated mode',
            keywords: ['column', 'width', 'size', 'text'],
            tab: 'reading',
            section: 'Layout',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'slider',
        },
        {
            id: 'reader.columnGap',
            name: 'Column Gap',
            description: 'Space between columns in multi-column layout',
            keywords: ['gap', 'spacing', 'gutter', 'margin'],
            tab: 'reading',
            section: 'Layout',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'slider',
        },
        {
            id: 'reader.marginTop',
            name: 'Top Margin',
            description: 'Space above the text content',
            keywords: ['margin', 'top', 'spacing', 'padding'],
            tab: 'reading',
            section: 'Layout',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'slider',
        },
        {
            id: 'reader.marginBottom',
            name: 'Bottom Margin',
            description: 'Space below the text content',
            keywords: ['margin', 'bottom', 'spacing', 'padding'],
            tab: 'reading',
            section: 'Layout',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'slider',
        },
        {
            id: 'reader.rememberPosition',
            name: 'Remember Position',
            description: 'Save and restore reading position for each book',
            keywords: ['position', 'bookmark', 'save', 'remember'],
            tab: 'reading',
            section: 'Navigation',
            isAdvanced: false,
            impact: 'high',
            settingType: 'toggle',
        },
        {
            id: 'reader.showProgress',
            name: 'Show Progress',
            description: 'Display reading progress indicator',
            keywords: ['progress', 'indicator', 'percentage', 'position'],
            tab: 'reading',
            section: 'Navigation',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'toggle',
        },
        {
            id: 'reader.animationSpeed',
            name: 'Animation Speed',
            description: 'Speed of page turn animations',
            keywords: ['animation', 'speed', 'transition', 'page turn'],
            tab: 'reading',
            section: 'Advanced',
            isAdvanced: true,
            impact: 'low',
            settingType: 'slider',
        },
    ]);

    // Reading Tab - Typography & Theme (formerly Appearance)
    index.addEntries([
        {
            id: 'appearance.fontSize',
            name: 'Font Size',
            description: 'Base font size for reading',
            keywords: ['font', 'size', 'text', 'large', 'small'],
            tab: 'reading',
            section: 'Typography',
            isAdvanced: false,
            impact: 'high',
            settingType: 'slider',
        },
        {
            id: 'appearance.fontFamily',
            name: 'Font Family',
            description: 'Font to use for reading content',
            keywords: ['font', 'family', 'typeface', 'typography'],
            tab: 'reading',
            section: 'Typography',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'dropdown',
        },
        {
            id: 'appearance.lineHeight',
            name: 'Line Height',
            description: 'Spacing between lines of text',
            keywords: ['line', 'height', 'spacing', 'leading'],
            tab: 'reading',
            section: 'Typography',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'slider',
        },
        {
            id: 'appearance.theme',
            name: 'Reader Theme',
            description: 'Color theme for the reader',
            keywords: ['theme', 'color', 'dark', 'light', 'sepia'],
            tab: 'reading',
            section: 'Theme',
            isAdvanced: false,
            impact: 'high',
            settingType: 'dropdown',
        },
        {
            id: 'appearance.useVaultTheme',
            name: 'Use Vault Theme',
            description: 'Follow the Obsidian vault theme settings',
            keywords: ['vault', 'theme', 'sync', 'follow'],
            tab: 'reading',
            section: 'Theme',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'toggle',
        },
        {
            id: 'appearance.coverSize',
            name: 'Cover Display Size',
            description: 'Size of cover images in the library view',
            keywords: ['cover', 'size', 'thumbnail', 'display'],
            tab: 'reading',
            section: 'Library View',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'dropdown',
        },
        {
            id: 'appearance.gridColumns',
            name: 'Grid Columns',
            description: 'Number of columns in library grid view',
            keywords: ['grid', 'columns', 'layout', 'gallery'],
            tab: 'reading',
            section: 'Library View',
            isAdvanced: false,
            impact: 'medium',
            settingType: 'slider',
        },
    ]);

    // Advanced Tab
    index.addEntries([
        {
            id: 'advanced.debugMode',
            name: 'Debug Mode',
            description: 'Enable verbose logging for troubleshooting',
            keywords: ['debug', 'logging', 'verbose', 'troubleshoot'],
            tab: 'advanced',
            section: 'Development',
            isAdvanced: true,
            impact: 'low',
            settingType: 'toggle',
        },
        {
            id: 'advanced.cacheEnabled',
            name: 'Enable Cache',
            description: 'Cache book data for faster loading',
            keywords: ['cache', 'performance', 'speed', 'memory'],
            tab: 'advanced',
            section: 'Performance',
            isAdvanced: true,
            impact: 'medium',
            settingType: 'toggle',
        },
        {
            id: 'advanced.cacheTTL',
            name: 'Cache TTL',
            description: 'How long to keep cached data (in hours)',
            keywords: ['cache', 'ttl', 'expiry', 'timeout'],
            tab: 'advanced',
            section: 'Performance',
            isAdvanced: true,
            impact: 'low',
            settingType: 'slider',
        },
        {
            id: 'advanced.maxConcurrentDownloads',
            name: 'Max Concurrent Downloads',
            description: 'Maximum parallel downloads during sync',
            keywords: ['concurrent', 'parallel', 'downloads', 'performance'],
            tab: 'advanced',
            section: 'Performance',
            isAdvanced: true,
            impact: 'low',
            settingType: 'slider',
        },
        {
            id: 'advanced.databasePath',
            name: 'Database Path',
            description: 'Path to the local metadata database',
            keywords: ['database', 'path', 'storage', 'sqlite'],
            tab: 'advanced',
            section: 'Storage',
            isAdvanced: true,
            impact: 'medium',
            settingType: 'text',
        },
        {
            id: 'advanced.clearCache',
            name: 'Clear Cache',
            description: 'Remove all cached data',
            keywords: ['clear', 'cache', 'reset', 'delete'],
            tab: 'advanced',
            section: 'Maintenance',
            isAdvanced: true,
            impact: 'low',
            settingType: 'button',
        },
        {
            id: 'advanced.resetSettings',
            name: 'Reset Settings',
            description: 'Reset all settings to defaults',
            keywords: ['reset', 'default', 'restore', 'factory'],
            tab: 'advanced',
            section: 'Maintenance',
            isAdvanced: true,
            impact: 'high',
            settingType: 'button',
        },
    ]);

    return index;
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let _settingsIndex: SettingsSearchIndex | null = null;

export function getSettingsIndex(): SettingsSearchIndex {
    if (!_settingsIndex) {
        _settingsIndex = buildSettingsIndex();
    }
    return _settingsIndex;
}

export function resetSettingsIndex(): void {
    _settingsIndex = null;
}
