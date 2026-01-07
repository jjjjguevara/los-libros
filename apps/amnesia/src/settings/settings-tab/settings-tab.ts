/**
 * Amnesia Settings Tab
 *
 * Main settings tab with tabbed navigation for Library, Reading, Sync,
 * Notes, and Advanced settings. Uses the settings-ui component system
 * ported from doc-doctor.
 */

import { App, PluginSettingTab, setIcon, Scope } from 'obsidian';
import type AmnesiaPlugin from '../../main';
import { LibrarySettings } from './library-settings';
import { ReaderSettings } from './reader-settings';
import { PdfSettings } from './pdf-settings';
import { SyncSettings } from './sync-settings';
import { NotesSettings } from './notes-settings';
import { AdvancedSettings } from './advanced-settings';
import { HudSettings } from './hud-settings';
import { SettingsUICoordinator } from '../settings-ui/settings-ui-coordinator';
import type { TabId } from '../settings-ui/settings-search-index';

// Tab configuration
interface TabDefinition {
    id: TabId;
    name: string;
    icon: string;
}

const TABS: TabDefinition[] = [
    { id: 'library', name: 'Library', icon: 'library' },
    { id: 'reading', name: 'Reading', icon: 'book-open' },
    { id: 'pdf', name: 'PDF', icon: 'file-type' },
    { id: 'sync', name: 'Sync', icon: 'refresh-cw' },
    { id: 'notes', name: 'Notes', icon: 'file-text' },
    { id: 'hud', name: 'HUD', icon: 'layout-dashboard' },
    { id: 'advanced', name: 'Advanced', icon: 'settings' },
];

export class AmnesiaSettingTab extends PluginSettingTab {
    plugin: AmnesiaPlugin;
    activeTab: TabId = 'library';
    contentContainers: Map<TabId, HTMLElement> = new Map();
    tabButtons: Map<TabId, HTMLElement> = new Map();
    uiCoordinator: SettingsUICoordinator | null = null;
    contentWrapper: HTMLElement | null = null;

    constructor(app: App, plugin: AmnesiaPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        this.contentContainers.clear();
        this.tabButtons.clear();

        // Clean up previous UI coordinator
        if (this.uiCoordinator) {
            this.uiCoordinator.destroy();
            this.uiCoordinator = null;
        }

        // Add custom styles
        this.addStyles(containerEl);

        // Set the icon for the settings tab sidebar (Obsidian 1.8+)
        const sidebarNavEl = (this as unknown as { navEl?: HTMLElement }).navEl;
        if (sidebarNavEl) {
            let iconEl = sidebarNavEl.querySelector('.vertical-tab-nav-item-icon') as HTMLElement;
            if (!iconEl) {
                iconEl = sidebarNavEl.createEl('div', { cls: 'vertical-tab-nav-item-icon' });
                sidebarNavEl.prepend(iconEl);
            }
            setIcon(iconEl, 'book-open');
        }

        // Create tab navigation
        const navEl = containerEl.createEl('nav', { cls: 'amnesia-settings-nav' });

        for (const tab of TABS) {
            const tabBtn = navEl.createEl('button', {
                cls: `amnesia-settings-tab ${tab.id === this.activeTab ? 'is-active' : ''}`,
                attr: { 'data-tab': tab.id },
            });

            const iconEl = tabBtn.createEl('span', { cls: 'amnesia-tab-icon' });
            setIcon(iconEl, tab.icon);

            tabBtn.createEl('span', { cls: 'amnesia-tab-name', text: tab.name });

            tabBtn.addEventListener('click', () => this.switchTab(tab.id));
            this.tabButtons.set(tab.id, tabBtn);
        }

        // Create content wrapper
        this.contentWrapper = containerEl.createEl('div', { cls: 'amnesia-settings-content' });

        // =========================================================================
        // LIBRARY TAB - Calibre connection, folders, book management
        // =========================================================================
        const libraryContent = this.contentWrapper.createEl('div', {
            cls: `amnesia-tab-content ${this.activeTab === 'library' ? 'is-active' : ''}`,
            attr: { 'data-tab-content': 'library' },
        });
        this.contentContainers.set('library', libraryContent);

        LibrarySettings({
            plugin: this.plugin,
            containerEl: libraryContent,
        });

        // =========================================================================
        // READING TAB - Reading mode, layout, navigation, themes
        // =========================================================================
        const readingContent = this.contentWrapper.createEl('div', {
            cls: `amnesia-tab-content ${this.activeTab === 'reading' ? 'is-active' : ''}`,
            attr: { 'data-tab-content': 'reading' },
        });
        this.contentContainers.set('reading', readingContent);

        ReaderSettings({
            plugin: this.plugin,
            containerEl: readingContent,
        });

        // =========================================================================
        // PDF TAB - PDF rendering, scale, layout, OCR
        // =========================================================================
        const pdfContent = this.contentWrapper.createEl('div', {
            cls: `amnesia-tab-content ${this.activeTab === 'pdf' ? 'is-active' : ''}`,
            attr: { 'data-tab-content': 'pdf' },
        });
        this.contentContainers.set('pdf', pdfContent);

        PdfSettings({
            plugin: this.plugin,
            containerEl: pdfContent,
        });

        // =========================================================================
        // SYNC TAB - Sync engine, conflict resolution, what to sync
        // =========================================================================
        const syncContent = this.contentWrapper.createEl('div', {
            cls: `amnesia-tab-content ${this.activeTab === 'sync' ? 'is-active' : ''}`,
            attr: { 'data-tab-content': 'sync' },
        });
        this.contentContainers.set('sync', syncContent);

        SyncSettings({
            plugin: this.plugin,
            containerEl: syncContent,
        });

        // =========================================================================
        // NOTES TAB - Templates, note generation, metadata mapping
        // =========================================================================
        const notesContent = this.contentWrapper.createEl('div', {
            cls: `amnesia-tab-content ${this.activeTab === 'notes' ? 'is-active' : ''}`,
            attr: { 'data-tab-content': 'notes' },
        });
        this.contentContainers.set('notes', notesContent);

        NotesSettings({
            plugin: this.plugin,
            containerEl: notesContent,
        });

        // =========================================================================
        // HUD TAB - Status bar, floating panel, tabs
        // =========================================================================
        const hudContent = this.contentWrapper.createEl('div', {
            cls: `amnesia-tab-content ${this.activeTab === 'hud' ? 'is-active' : ''}`,
            attr: { 'data-tab-content': 'hud' },
        });
        this.contentContainers.set('hud', hudContent);

        HudSettings({
            plugin: this.plugin,
            containerEl: hudContent,
        });

        // =========================================================================
        // ADVANCED TAB - Cache, performance, debug
        // =========================================================================
        const advancedContent = this.contentWrapper.createEl('div', {
            cls: `amnesia-tab-content ${this.activeTab === 'advanced' ? 'is-active' : ''}`,
            attr: { 'data-tab-content': 'advanced' },
        });
        this.contentContainers.set('advanced', advancedContent);

        AdvancedSettings({
            plugin: this.plugin,
            containerEl: advancedContent,
        });

        // Initialize UI coordinator with search, FAB, and outline
        this.initializeUICoordinator();
    }

    /**
     * Initialize the UI coordinator for search, FAB, and outline
     */
    private initializeUICoordinator(): void {
        if (!this.contentWrapper) return;

        // Access the settings modal's scope for proper escape handling
        const settingScope = (this.app as unknown as { setting: { scope: Scope } }).setting?.scope;

        // Use the settings container's scrollable parent
        const scrollContainer = this.containerEl.closest('.vertical-tab-content') || this.contentWrapper;

        this.uiCoordinator = new SettingsUICoordinator({
            containerEl: this.containerEl,
            scrollContainerEl: scrollContainer as HTMLElement,
            getCurrentTab: () => this.activeTab,
            navigateToTab: (tabId: TabId) => {
                this.switchTab(tabId);
            },
            isSettingsActive: () => {
                return this.containerEl.isShown();
            },
            scope: settingScope,
        });

        this.uiCoordinator.initialize();
    }

    /**
     * Override hide to clean up UI coordinator
     */
    hide(): void {
        if (this.uiCoordinator) {
            this.uiCoordinator.destroy();
            this.uiCoordinator = null;
        }
    }

    switchTab(tabId: TabId): void {
        if (tabId === this.activeTab) return;

        // Update active state on buttons
        for (const [id, btn] of this.tabButtons) {
            btn.classList.toggle('is-active', id === tabId);
        }

        // Update active state on content
        for (const [id, content] of this.contentContainers) {
            content.classList.toggle('is-active', id === tabId);
        }

        this.activeTab = tabId;

        // Refresh outline for new tab
        if (this.uiCoordinator) {
            setTimeout(() => {
                this.uiCoordinator?.refreshOutline();
            }, 50);
        }
    }

    addStyles(containerEl: HTMLElement): void {
        if (containerEl.querySelector('.amnesia-settings-styles')) return;

        const style = document.createElement('style');
        style.className = 'amnesia-settings-styles';
        style.textContent = `
            .amnesia-settings-nav {
                display: flex;
                gap: 4px;
                margin-bottom: 20px;
                padding-bottom: 12px;
                border-bottom: 1px solid var(--background-modifier-border);
                flex-wrap: wrap;
            }

            .amnesia-settings-tab {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 16px;
                border: none;
                background: transparent;
                color: var(--text-muted);
                font-size: var(--font-ui-medium);
                cursor: pointer;
                border-radius: 6px;
                transition: all 0.15s ease;
            }

            .amnesia-settings-tab:hover {
                background: var(--background-modifier-hover);
                color: var(--text-normal);
            }

            .amnesia-settings-tab.is-active {
                background: var(--interactive-accent);
                color: var(--text-on-accent);
            }

            .amnesia-tab-icon {
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .amnesia-tab-icon svg {
                width: 16px;
                height: 16px;
            }

            .amnesia-tab-name {
                font-weight: 500;
            }

            .amnesia-settings-content {
                position: relative;
            }

            .amnesia-tab-content {
                display: none;
            }

            .amnesia-tab-content.is-active {
                display: block;
            }

            /* Heading hierarchy for settings */
            .amnesia-tab-content h2 {
                font-size: 1.4em;
                font-weight: 600;
                margin: 1.5em 0 0.5em 0;
                padding-bottom: 0.3em;
                border-bottom: 1px solid var(--background-modifier-border);
            }

            .amnesia-tab-content h2:first-child {
                margin-top: 0;
            }

            .amnesia-tab-content h3 {
                font-size: 1.15em;
                font-weight: 600;
                margin: 1.2em 0 0.4em 0;
                color: var(--text-normal);
            }

            .amnesia-tab-content h4 {
                font-size: 1em;
                font-weight: 600;
                margin: 1em 0 0.3em 0;
                color: var(--text-muted);
            }

            /* Responsive adjustments */
            @media (max-width: 600px) {
                .amnesia-settings-nav {
                    gap: 2px;
                }

                .amnesia-settings-tab {
                    padding: 6px 10px;
                    font-size: 0.9em;
                }

                .amnesia-tab-name {
                    display: none;
                }

                .amnesia-tab-icon svg {
                    width: 18px;
                    height: 18px;
                }
            }
        `;
        containerEl.prepend(style);
    }
}
