import { App, Notice, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type AmnesiaPlugin from '../main';
import { FolderSuggestModal } from './folder-suggest';
import type { SyncProgress } from '../calibre/calibre-types';
import { AmnesiaClient } from '../server/amnesia-client';
import { renderTemplatesSettings, addTemplatesStyles } from './templates-settings-tab';

export class LibrosSettingTab extends PluginSettingTab {
  plugin: AmnesiaPlugin;
  private syncProgressEl: HTMLElement | null = null;
  private calibreStoreUnsubscribe: (() => void) | null = null;

  constructor(app: App, plugin: AmnesiaPlugin) {
    super(app, plugin);
    this.plugin = plugin;

    // Add icon to settings tab in sidebar
    // The navEl is created after construction, so we defer this
    setTimeout(() => {
      // Access navEl from the parent class (it's a protected/private property)
      const tabEl = (this as unknown as { navEl?: HTMLElement }).navEl;
      if (tabEl && !tabEl.querySelector('.settings-tab-icon')) {
        // Insert icon before the text
        const iconEl = createEl('span', { cls: 'settings-tab-icon' });
        setIcon(iconEl, 'library');
        tabEl.insertBefore(iconEl, tabEl.firstChild);
      }
    }, 0);
  }

  hide(): void {
    // Unsubscribe from store updates when tab is hidden
    if (this.calibreStoreUnsubscribe) {
      this.calibreStoreUnsubscribe();
      this.calibreStoreUnsubscribe = null;
    }
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h1', { text: 'Amnesia Settings' });

    // Server Connection
    containerEl.createEl('h2', { text: 'Server Connection' });

    new Setting(containerEl)
      .setName('Enable server sync')
      .setDesc('Connect to a Amnesia server for cloud sync')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.serverEnabled)
        .onChange(async (value) => {
          this.plugin.settings.serverEnabled = value;
          await this.plugin.saveSettings();
          this.display(); // Refresh to show/hide server URL
        }));

    if (this.plugin.settings.serverEnabled) {
      new Setting(containerEl)
        .setName('Server URL')
        .setDesc('URL of your Amnesia server')
        .addText(text => text
          .setPlaceholder('https://libros.example.com')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value;
            await this.plugin.saveSettings();
          }));

      // Connection test button
      new Setting(containerEl)
        .setName('Test connection')
        .setDesc('Verify connectivity to the Amnesia server')
        .addButton(button => button
          .setButtonText('Test Connection')
          .onClick(async () => {
            const url = this.plugin.settings.serverUrl;
            if (!url) {
              new Notice('Please enter a server URL first');
              return;
            }

            button.setButtonText('Testing...');
            button.setDisabled(true);

            try {
              const client = new AmnesiaClient(this.app, url);
              const connected = await client.testConnection();

              if (connected) {
                new Notice('Successfully connected to Amnesia server');
              } else {
                new Notice('Failed to connect to server. Check the URL and try again.');
              }
            } catch (error) {
              new Notice(`Connection failed: ${error}`);
            } finally {
              button.setButtonText('Test Connection');
              button.setDisabled(false);
            }
          }));
    }

    // Local Library
    containerEl.createEl('h2', { text: 'Local Library' });

    // Books folder with Browse button
    let booksFolderInput: HTMLInputElement;
    new Setting(containerEl)
      .setName('Books folder')
      .setDesc('Folder in your vault where ebooks are stored')
      .addText(text => {
        booksFolderInput = text.inputEl;
        text.inputEl.style.width = '200px';
        text
          .setPlaceholder('Books')
          .setValue(this.plugin.settings.localBooksFolder)
          .onChange(async (value) => {
            this.plugin.settings.localBooksFolder = value;
            await this.plugin.saveSettings();
          });
      })
      .addButton(button => {
        button.setButtonText('Browse').onClick(() => {
          const modal = new FolderSuggestModal(this.app, async (folder) => {
            this.plugin.settings.localBooksFolder = folder.path;
            booksFolderInput.value = folder.path;
            await this.plugin.saveSettings();
          });
          modal.open();
        });
      });

    // Reading Preferences
    containerEl.createEl('h2', { text: 'Reading Preferences' });

    new Setting(containerEl)
      .setName('Default font size')
      .setDesc('Font size in pixels')
      .addSlider(slider => slider
        .setLimits(12, 24, 1)
        .setValue(this.plugin.settings.defaultFontSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.defaultFontSize = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Default theme')
      .setDesc('Reading theme (System inherits from Obsidian)')
      .addDropdown(dropdown => dropdown
        .addOption('system', 'System (Obsidian theme)')
        .addOption('light', 'Light')
        .addOption('dark', 'Dark')
        .addOption('sepia', 'Sepia')
        .setValue(this.plugin.settings.defaultTheme)
        .onChange(async (value) => {
          this.plugin.settings.defaultTheme = value as 'system' | 'light' | 'dark' | 'sepia';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Paginated mode')
      .setDesc('Use paginated display instead of scrolling')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.paginated)
        .onChange(async (value) => {
          this.plugin.settings.paginated = value;
          await this.plugin.saveSettings();
        }));

    // Sync Settings
    containerEl.createEl('h2', { text: 'Sync Settings' });

    new Setting(containerEl)
      .setName('Sync reading progress')
      .setDesc('Sync reading position with server')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.syncProgress)
        .onChange(async (value) => {
          this.plugin.settings.syncProgress = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Sync highlights')
      .setDesc('Sync highlights with server')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.syncHighlights)
        .onChange(async (value) => {
          this.plugin.settings.syncHighlights = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Sync interval')
      .setDesc('How often to sync (in minutes, 0 = manual only)')
      .addDropdown(dropdown => dropdown
        .addOption('0', 'Manual only')
        .addOption('30', 'Every 30 minutes')
        .addOption('60', 'Every hour')
        .addOption('240', 'Every 4 hours')
        .addOption('720', 'Every 12 hours')
        .addOption('1440', 'Every 24 hours')
        .setValue(String(this.plugin.settings.syncInterval))
        .onChange(async (value) => {
          this.plugin.settings.syncInterval = parseInt(value);
          await this.plugin.saveSettings();
        }));

    // Highlights
    containerEl.createEl('h2', { text: 'Highlights' });

    // Highlights folder with Browse button
    let highlightsFolderInput: HTMLInputElement;
    new Setting(containerEl)
      .setName('Highlights folder')
      .setDesc('Folder where highlight notes are saved')
      .addText(text => {
        highlightsFolderInput = text.inputEl;
        text.inputEl.style.width = '200px';
        text
          .setPlaceholder('Highlights')
          .setValue(this.plugin.settings.highlightFolder)
          .onChange(async (value) => {
            this.plugin.settings.highlightFolder = value;
            await this.plugin.saveSettings();
          });
      })
      .addButton(button => {
        button.setButtonText('Browse').onClick(() => {
          const modal = new FolderSuggestModal(this.app, async (folder) => {
            this.plugin.settings.highlightFolder = folder.path;
            highlightsFolderInput.value = folder.path;
            await this.plugin.saveSettings();
          });
          modal.open();
        });
      });

    new Setting(containerEl)
      .setName('Atomic highlights')
      .setDesc('Create a separate file for each highlight')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.atomicHighlights)
        .onChange(async (value) => {
          this.plugin.settings.atomicHighlights = value;
          await this.plugin.saveSettings();
        }));

    // Book Notes
    containerEl.createEl('h2', { text: 'Book Notes' });

    // Book notes folder with Browse button
    let bookNotesFolderInput: HTMLInputElement;
    new Setting(containerEl)
      .setName('Book notes folder')
      .setDesc('Folder where book notes are created')
      .addText(text => {
        bookNotesFolderInput = text.inputEl;
        text.inputEl.style.width = '200px';
        text
          .setPlaceholder('Books')
          .setValue(this.plugin.settings.bookNoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.bookNoteFolder = value;
            await this.plugin.saveSettings();
          });
      })
      .addButton(button => {
        button.setButtonText('Browse').onClick(() => {
          const modal = new FolderSuggestModal(this.app, async (folder) => {
            this.plugin.settings.bookNoteFolder = folder.path;
            bookNotesFolderInput.value = folder.path;
            await this.plugin.saveSettings();
          });
          modal.open();
        });
      });

    new Setting(containerEl)
      .setName('Auto-create book notes')
      .setDesc('Automatically create a note for each book')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoCreateBookNotes)
        .onChange(async (value) => {
          this.plugin.settings.autoCreateBookNotes = value;
          await this.plugin.saveSettings();
        }));

    // Templates Section (using new comprehensive UI)
    addTemplatesStyles(containerEl);
    renderTemplatesSettings(containerEl, this.plugin);

    // Cache Settings
    containerEl.createEl('h2', { text: 'Cache' });

    new Setting(containerEl)
      .setName('Max cached books')
      .setDesc('Maximum number of books to keep cached locally')
      .addSlider(slider => slider
        .setLimits(1, 50, 1)
        .setValue(this.plugin.settings.maxCachedBooks)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxCachedBooks = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Max cache size (MB)')
      .setDesc('Maximum cache size in megabytes')
      .addSlider(slider => slider
        .setLimits(50, 1000, 50)
        .setValue(this.plugin.settings.maxCacheSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxCacheSize = value;
          await this.plugin.saveSettings();
        }));

    // =========================================================================
    // File System Architecture Settings
    // =========================================================================
    containerEl.createEl('h1', { text: 'Advanced Settings' });

    // Advanced Cache Section
    containerEl.createEl('h2', { text: 'Advanced Cache' });

    new Setting(containerEl)
      .setName('Enable L2 cache (IndexedDB)')
      .setDesc('Use persistent storage for caching across sessions. Recommended for larger libraries.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.advancedCache.l2Enabled)
        .onChange(async (value) => {
          this.plugin.settings.advancedCache.l2Enabled = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.advancedCache.l2Enabled) {
      new Setting(containerEl)
        .setName('L1 cache size (MB)')
        .setDesc('In-memory cache size (faster but uses RAM)')
        .addSlider(slider => slider
          .setLimits(10, 200, 10)
          .setValue(Math.round(this.plugin.settings.advancedCache.l1MaxSizeBytes / (1024 * 1024)))
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.advancedCache.l1MaxSizeBytes = value * 1024 * 1024;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('L2 cache size (MB)')
        .setDesc('Persistent cache size (slower but survives restarts)')
        .addSlider(slider => slider
          .setLimits(100, 2000, 100)
          .setValue(Math.round(this.plugin.settings.advancedCache.l2MaxSizeBytes / (1024 * 1024)))
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.advancedCache.l2MaxSizeBytes = value * 1024 * 1024;
            await this.plugin.saveSettings();
          }));
    }

    new Setting(containerEl)
      .setName('Clear cache')
      .setDesc('Clear all cached book data')
      .addButton(button => button
        .setButtonText('Clear Cache')
        .setWarning()
        .onClick(async () => {
          button.setButtonText('Clearing...');
          button.setDisabled(true);
          try {
            if (this.plugin.tieredCache) {
              await this.plugin.tieredCache.clear();
              new Notice('Cache cleared successfully');
            } else {
              new Notice('Cache not initialized');
            }
          } catch (error) {
            new Notice(`Failed to clear cache: ${error}`);
          } finally {
            button.setButtonText('Clear Cache');
            button.setDisabled(false);
          }
        }));

    // Network Monitoring Section
    containerEl.createEl('h2', { text: 'Network Monitoring' });

    new Setting(containerEl)
      .setName('Enable network monitoring')
      .setDesc('Monitor network connectivity for offline mode support')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.network.enabled)
        .onChange(async (value) => {
          this.plugin.settings.network.enabled = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.network.enabled) {
      new Setting(containerEl)
        .setName('Health check interval (seconds)')
        .setDesc('How often to check network connectivity')
        .addSlider(slider => slider
          .setLimits(10, 120, 10)
          .setValue(Math.round(this.plugin.settings.network.checkInterval / 1000))
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.network.checkInterval = value * 1000;
            await this.plugin.saveSettings();
          }));
    }

    // Offline Mode Section
    containerEl.createEl('h2', { text: 'Offline Mode' });

    new Setting(containerEl)
      .setName('Enable offline mode')
      .setDesc('Download books for offline reading')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.offline.enabled)
        .onChange(async (value) => {
          this.plugin.settings.offline.enabled = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.offline.enabled) {
      new Setting(containerEl)
        .setName('Concurrent downloads')
        .setDesc('Maximum number of simultaneous downloads')
        .addSlider(slider => slider
          .setLimits(1, 5, 1)
          .setValue(this.plugin.settings.offline.concurrentDownloads)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.offline.concurrentDownloads = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Retry attempts')
        .setDesc('Number of times to retry failed downloads')
        .addSlider(slider => slider
          .setLimits(1, 5, 1)
          .setValue(this.plugin.settings.offline.retryCount)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.offline.retryCount = value;
            await this.plugin.saveSettings();
          }));
    }

    // Deduplication Section
    containerEl.createEl('h2', { text: 'Storage Optimization' });

    new Setting(containerEl)
      .setName('Enable content deduplication')
      .setDesc('Reduce storage by detecting duplicate content across books (advanced)')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.deduplication.enabled)
        .onChange(async (value) => {
          this.plugin.settings.deduplication.enabled = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.deduplication.enabled) {
      new Setting(containerEl)
        .setName('Hash algorithm')
        .setDesc('Algorithm used for content fingerprinting')
        .addDropdown(dropdown => dropdown
          .addOption('SHA-256', 'SHA-256 (recommended)')
          .addOption('SHA-384', 'SHA-384')
          .addOption('SHA-512', 'SHA-512 (most secure)')
          .setValue(this.plugin.settings.deduplication.algorithm)
          .onChange(async (value) => {
            this.plugin.settings.deduplication.algorithm = value as 'SHA-256' | 'SHA-384' | 'SHA-512';
            await this.plugin.saveSettings();
          }));
    }

    // OPDS Feeds Section
    containerEl.createEl('h2', { text: 'OPDS Feeds' });

    new Setting(containerEl)
      .setName('Enable feed caching')
      .setDesc('Cache OPDS feed responses for faster browsing')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.opds.cacheFeeds)
        .onChange(async (value) => {
          this.plugin.settings.opds.cacheFeeds = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Feed cache duration (hours)')
      .setDesc('How long to cache OPDS feed responses')
      .addSlider(slider => slider
        .setLimits(1, 24, 1)
        .setValue(Math.round(this.plugin.settings.opds.cacheDuration / (60 * 60 * 1000)))
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.opds.cacheDuration = value * 60 * 60 * 1000;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Request timeout (seconds)')
      .setDesc('Maximum time to wait for OPDS feed responses')
      .addSlider(slider => slider
        .setLimits(5, 60, 5)
        .setValue(Math.round(this.plugin.settings.opds.timeout / 1000))
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.opds.timeout = value * 1000;
          await this.plugin.saveSettings();
        }));

    // Custom OPDS Feeds List
    if (this.plugin.settings.opds.customFeeds.length > 0) {
      containerEl.createEl('h3', { text: 'Custom Feeds' });

      for (const feed of this.plugin.settings.opds.customFeeds) {
        new Setting(containerEl)
          .setName(feed.name)
          .setDesc(feed.url)
          .addToggle(toggle => toggle
            .setValue(feed.enabled)
            .onChange(async (value) => {
              feed.enabled = value;
              await this.plugin.saveSettings();
            }))
          .addButton(button => button
            .setIcon('trash-2')
            .setTooltip('Remove feed')
            .onClick(async () => {
              const index = this.plugin.settings.opds.customFeeds.findIndex(f => f.id === feed.id);
              if (index !== -1) {
                this.plugin.settings.opds.customFeeds.splice(index, 1);
                await this.plugin.saveSettings();
                this.display();
              }
            }));
      }
    }

    new Setting(containerEl)
      .setName('Add OPDS feed')
      .setDesc('Add a custom OPDS catalog feed')
      .addButton(button => button
        .setButtonText('Add Feed')
        .onClick(() => {
          // Add a new empty feed (user can fill in details)
          const newFeed = {
            id: `feed-${Date.now()}`,
            name: 'New Feed',
            url: '',
            enabled: true,
            requiresAuth: false,
          };
          this.plugin.settings.opds.customFeeds.push(newFeed);
          this.plugin.saveSettings();
          this.display();
        }));

    // Asset Settings Section
    containerEl.createEl('h2', { text: 'Asset Management' });

    new Setting(containerEl)
      .setName('Generate thumbnails')
      .setDesc('Create thumbnails for book images')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.assets.generateThumbnails)
        .onChange(async (value) => {
          this.plugin.settings.assets.generateThumbnails = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Thumbnail size (pixels)')
      .setDesc('Maximum dimension for generated thumbnails')
      .addSlider(slider => slider
        .setLimits(100, 400, 50)
        .setValue(this.plugin.settings.assets.thumbnailMaxSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.assets.thumbnailMaxSize = value;
          await this.plugin.saveSettings();
        }));

    let assetFolderInput: HTMLInputElement;
    new Setting(containerEl)
      .setName('Asset export folder')
      .setDesc('Vault folder for exported book assets')
      .addText(text => {
        assetFolderInput = text.inputEl;
        text.inputEl.style.width = '200px';
        text
          .setPlaceholder('Assets/Books')
          .setValue(this.plugin.settings.assets.exportFolder)
          .onChange(async (value) => {
            this.plugin.settings.assets.exportFolder = value;
            await this.plugin.saveSettings();
          });
      })
      .addButton(button => {
        button.setButtonText('Browse').onClick(() => {
          const modal = new FolderSuggestModal(this.app, async (folder) => {
            this.plugin.settings.assets.exportFolder = folder.path;
            assetFolderInput.value = folder.path;
            await this.plugin.saveSettings();
          });
          modal.open();
        });
      });

    // =========================================================================
    // Calibre Integration
    // =========================================================================
    containerEl.createEl('h1', { text: 'Calibre Integration' });

    new Setting(containerEl)
      .setName('Enable Calibre integration')
      .setDesc('Connect to a Calibre library for book management')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.calibreEnabled)
        .onChange(async (value) => {
          this.plugin.settings.calibreEnabled = value;
          await this.plugin.saveSettings();
          this.display(); // Refresh to show/hide Calibre settings
        }));

    if (this.plugin.settings.calibreEnabled) {
      // Calibre Library Path
      containerEl.createEl('h2', { text: 'Library Connection' });

      let calibreLibraryPathInput: HTMLInputElement;
      new Setting(containerEl)
        .setName('Calibre library path')
        .setDesc('Absolute path to your Calibre library folder (containing metadata.db)')
        .addText(text => {
          calibreLibraryPathInput = text.inputEl;
          text.inputEl.style.width = '250px';
          text
            .setPlaceholder('/Users/.../Calibre Library')
            .setValue(this.plugin.settings.calibreLibraryPath)
            .onChange(async (value) => {
              this.plugin.settings.calibreLibraryPath = value;
              await this.plugin.saveSettings();
            });
        })
        .addButton(button => {
          button.setButtonText('Browse').onClick(async () => {
            // Use Electron's dialog API for native folder picker
            const { remote } = require('electron');
            const result = await remote.dialog.showOpenDialog({
              properties: ['openDirectory'],
              title: 'Select Calibre Library Folder',
              message: 'Choose the folder containing metadata.db'
            });
            if (!result.canceled && result.filePaths.length > 0) {
              const selectedPath = result.filePaths[0];
              this.plugin.settings.calibreLibraryPath = selectedPath;
              calibreLibraryPathInput.value = selectedPath;
              await this.plugin.saveSettings();
            }
          });
        });

      new Setting(containerEl)
        .setName('Enable Content Server')
        .setDesc('Use Calibre Content Server as fallback when local database is unavailable')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.calibreContentServerEnabled)
          .onChange(async (value) => {
            this.plugin.settings.calibreContentServerEnabled = value;
            await this.plugin.saveSettings();
            this.display();
          }));

      if (this.plugin.settings.calibreContentServerEnabled) {
        new Setting(containerEl)
          .setName('Content Server URL')
          .setDesc('URL of your Calibre Content Server')
          .addText(text => text
            .setPlaceholder('http://localhost:8080')
            .setValue(this.plugin.settings.calibreContentServerUrl)
            .onChange(async (value) => {
              this.plugin.settings.calibreContentServerUrl = value;
              await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
          .setName('Server username')
          .setDesc('Username for Content Server authentication (if required)')
          .addText(text => text
            .setPlaceholder('username')
            .setValue(this.plugin.settings.calibreContentServerUsername)
            .onChange(async (value) => {
              this.plugin.settings.calibreContentServerUsername = value;
              await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
          .setName('Server password')
          .setDesc('Password for Content Server authentication (if required)')
          .addText(text => {
            text.inputEl.type = 'password';
            text
              .setPlaceholder('password')
              .setValue(this.plugin.settings.calibreContentServerPassword)
              .onChange(async (value) => {
                this.plugin.settings.calibreContentServerPassword = value;
                await this.plugin.saveSettings();
              });
          });
      }

      // Sync Settings
      containerEl.createEl('h2', { text: 'Calibre Sync' });

      new Setting(containerEl)
        .setName('Sync direction')
        .setDesc('How changes should sync between Obsidian and Calibre')
        .addDropdown(dropdown => dropdown
          .addOption('to-obsidian', 'Calibre → Obsidian only')
          .addOption('to-calibre', 'Obsidian → Calibre only')
          .addOption('bidirectional', 'Bidirectional')
          .setValue(this.plugin.settings.calibreSyncDirection)
          .onChange(async (value) => {
            this.plugin.settings.calibreSyncDirection = value as 'to-obsidian' | 'to-calibre' | 'bidirectional';
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Conflict resolution')
        .setDesc('How to resolve conflicts when both sides have changes')
        .addDropdown(dropdown => dropdown
          .addOption('last-write', 'Last write wins')
          .addOption('prefer-calibre', 'Prefer Calibre')
          .addOption('prefer-obsidian', 'Prefer Obsidian')
          .setValue(this.plugin.settings.calibreConflictResolution)
          .onChange(async (value) => {
            this.plugin.settings.calibreConflictResolution = value as 'last-write' | 'prefer-calibre' | 'prefer-obsidian';
            await this.plugin.saveSettings();
          }));

      // Vault Folders
      containerEl.createEl('h2', { text: 'Vault Folders' });
      containerEl.createEl('p', {
        text: 'Configure where generated notes and indexes are stored in your vault.',
        cls: 'setting-item-description'
      });

      // Book Notes Folder
      let calibreBookNotesFolderInput: HTMLInputElement;
      new Setting(containerEl)
        .setName('Book notes folder')
        .setDesc('Folder for book notes (e.g., Florilegios)')
        .addText(text => {
          calibreBookNotesFolderInput = text.inputEl;
          text.inputEl.style.width = '200px';
          text
            .setPlaceholder('Florilegios')
            .setValue(this.plugin.settings.calibreBookNotesFolder)
            .onChange(async (value) => {
              this.plugin.settings.calibreBookNotesFolder = value;
              await this.plugin.saveSettings();
            });
        })
        .addButton(button => {
          button.setButtonText('Browse').onClick(() => {
            const modal = new FolderSuggestModal(this.app, async (folder) => {
              this.plugin.settings.calibreBookNotesFolder = folder.path;
              calibreBookNotesFolderInput.value = folder.path;
              await this.plugin.saveSettings();
            });
            modal.open();
          });
        });

      // Author Index Folder
      let authorFolderInput: HTMLInputElement;
      new Setting(containerEl)
        .setName('Author index folder')
        .setDesc('Folder for author notes (e.g., Autores)')
        .addText(text => {
          authorFolderInput = text.inputEl;
          text.inputEl.style.width = '200px';
          text
            .setPlaceholder('Autores')
            .setValue(this.plugin.settings.calibreAuthorIndexFolder)
            .onChange(async (value) => {
              this.plugin.settings.calibreAuthorIndexFolder = value;
              await this.plugin.saveSettings();
            });
        })
        .addButton(button => {
          button.setButtonText('Browse').onClick(() => {
            const modal = new FolderSuggestModal(this.app, async (folder) => {
              this.plugin.settings.calibreAuthorIndexFolder = folder.path;
              authorFolderInput.value = folder.path;
              await this.plugin.saveSettings();
            });
            modal.open();
          });
        });

      // Series Index Folder
      let seriesFolderInput: HTMLInputElement;
      new Setting(containerEl)
        .setName('Series index folder')
        .setDesc('Folder for series notes (e.g., Series)')
        .addText(text => {
          seriesFolderInput = text.inputEl;
          text.inputEl.style.width = '200px';
          text
            .setPlaceholder('Series')
            .setValue(this.plugin.settings.calibreSeriesIndexFolder)
            .onChange(async (value) => {
              this.plugin.settings.calibreSeriesIndexFolder = value;
              await this.plugin.saveSettings();
            });
        })
        .addButton(button => {
          button.setButtonText('Browse').onClick(() => {
            const modal = new FolderSuggestModal(this.app, async (folder) => {
              this.plugin.settings.calibreSeriesIndexFolder = folder.path;
              seriesFolderInput.value = folder.path;
              await this.plugin.saveSettings();
            });
            modal.open();
          });
        });

      // Shelf/Tag Index Folder
      let shelfFolderInput: HTMLInputElement;
      new Setting(containerEl)
        .setName('Bookshelf index folder')
        .setDesc('Folder for tag/shelf notes (e.g., Estanterias)')
        .addText(text => {
          shelfFolderInput = text.inputEl;
          text.inputEl.style.width = '200px';
          text
            .setPlaceholder('Estanterias')
            .setValue(this.plugin.settings.calibreShelfIndexFolder)
            .onChange(async (value) => {
              this.plugin.settings.calibreShelfIndexFolder = value;
              await this.plugin.saveSettings();
            });
        })
        .addButton(button => {
          button.setButtonText('Browse').onClick(() => {
            const modal = new FolderSuggestModal(this.app, async (folder) => {
              this.plugin.settings.calibreShelfIndexFolder = folder.path;
              shelfFolderInput.value = folder.path;
              await this.plugin.saveSettings();
            });
            modal.open();
          });
        });

      // Highlights Folder
      let calibreHighlightsFolderInput: HTMLInputElement;
      new Setting(containerEl)
        .setName('Highlights folder')
        .setDesc('Folder for reading highlights (e.g., Subrayados)')
        .addText(text => {
          calibreHighlightsFolderInput = text.inputEl;
          text.inputEl.style.width = '200px';
          text
            .setPlaceholder('Subrayados')
            .setValue(this.plugin.settings.calibreHighlightsFolder)
            .onChange(async (value) => {
              this.plugin.settings.calibreHighlightsFolder = value;
              await this.plugin.saveSettings();
            });
        })
        .addButton(button => {
          button.setButtonText('Browse').onClick(() => {
            const modal = new FolderSuggestModal(this.app, async (folder) => {
              this.plugin.settings.calibreHighlightsFolder = folder.path;
              calibreHighlightsFolderInput.value = folder.path;
              await this.plugin.saveSettings();
            });
            modal.open();
          });
        });

      // Base Files Folder
      let baseFolderInput: HTMLInputElement;
      new Setting(containerEl)
        .setName('Base files folder')
        .setDesc('Folder for .base query files (e.g., Indices)')
        .addText(text => {
          baseFolderInput = text.inputEl;
          text.inputEl.style.width = '200px';
          text
            .setPlaceholder('Indices')
            .setValue(this.plugin.settings.calibreBaseFilesFolder)
            .onChange(async (value) => {
              this.plugin.settings.calibreBaseFilesFolder = value;
              await this.plugin.saveSettings();
            });
        })
        .addButton(button => {
          button.setButtonText('Browse').onClick(() => {
            const modal = new FolderSuggestModal(this.app, async (folder) => {
              this.plugin.settings.calibreBaseFilesFolder = folder.path;
              baseFolderInput.value = folder.path;
              await this.plugin.saveSettings();
            });
            modal.open();
          });
        });

      // Covers Folder
      let coversFolderInput: HTMLInputElement;
      new Setting(containerEl)
        .setName('Covers folder')
        .setDesc('Folder for cached book covers (e.g., Attachments/covers)')
        .addText(text => {
          coversFolderInput = text.inputEl;
          text.inputEl.style.width = '200px';
          text
            .setPlaceholder('Attachments/covers')
            .setValue(this.plugin.settings.calibreCoversFolder)
            .onChange(async (value) => {
              this.plugin.settings.calibreCoversFolder = value;
              await this.plugin.saveSettings();
            });
        })
        .addButton(button => {
          button.setButtonText('Browse').onClick(() => {
            const modal = new FolderSuggestModal(this.app, async (folder) => {
              this.plugin.settings.calibreCoversFolder = folder.path;
              coversFolderInput.value = folder.path;
              await this.plugin.saveSettings();
            });
            modal.open();
          });
        });

      // Sync Actions
      containerEl.createEl('h2', { text: 'Sync Actions' });

      // Sync progress indicator
      this.syncProgressEl = containerEl.createDiv({ cls: 'amnesia-sync-progress' });
      this.updateSyncProgressUI();

      // Subscribe to store updates for real-time progress
      this.calibreStoreUnsubscribe = this.plugin.calibreService.getStore().subscribe(() => {
        this.updateSyncProgressUI();
      });

      new Setting(containerEl)
        .setName('Full library sync')
        .setDesc('Import all books from Calibre library')
        .addButton(button => button
          .setButtonText('Sync Now')
          .setCta()
          .onClick(async () => {
            try {
              await this.plugin.calibreService.fullSync();
            } catch (error) {
              console.error('Calibre sync failed:', error);
            }
          }));

      new Setting(containerEl)
        .setName('Regenerate indexes')
        .setDesc('Rebuild author, series, and shelf index files')
        .addButton(button => button
          .setButtonText('Regenerate')
          .onClick(async () => {
            // TODO: Implement index regeneration
            console.log('Regenerating indexes...');
          }));
    }
  }

  /**
   * Update the sync progress UI in settings
   */
  private updateSyncProgressUI(): void {
    if (!this.syncProgressEl) return;

    const state = this.plugin.calibreService.getStore().getValue();
    const { syncInProgress, syncProgress, connected, books, lastSyncedAt } = state;

    this.syncProgressEl.empty();

    if (syncInProgress) {
      // Show progress bar and details
      const { phase, currentItem, totalItems, percentage, currentItemName } = syncProgress;

      // Progress container
      const progressContainer = this.syncProgressEl.createDiv({ cls: 'sync-progress-container' });

      // Phase label
      let phaseLabel = 'Syncing...';
      if (phase === 'scanning') phaseLabel = 'Scanning library...';
      else if (phase === 'generating-notes') phaseLabel = 'Generating book notes...';
      else if (phase === 'copying-covers') phaseLabel = 'Copying covers...';
      else if (phase === 'generating-indexes') phaseLabel = 'Generating indexes...';

      progressContainer.createDiv({ cls: 'sync-phase', text: phaseLabel });

      // Progress bar
      const progressBar = progressContainer.createDiv({ cls: 'sync-progress-bar' });
      const progressFill = progressBar.createDiv({ cls: 'sync-progress-fill' });
      progressFill.style.width = `${percentage}%`;

      // Stats
      if (totalItems > 0) {
        progressContainer.createDiv({
          cls: 'sync-stats',
          text: `${currentItem}/${totalItems} (${percentage}%)`
        });
      } else {
        progressContainer.createDiv({
          cls: 'sync-stats',
          text: `${percentage}%`
        });
      }

      // Current item
      if (currentItemName) {
        progressContainer.createDiv({
          cls: 'sync-current-item',
          text: currentItemName
        });
      }
    } else {
      // Show last sync info
      const statusContainer = this.syncProgressEl.createDiv({ cls: 'sync-status-container' });

      if (connected) {
        const iconEl = statusContainer.createSpan({ cls: 'sync-status-icon connected' });
        setIcon(iconEl, 'check-circle');

        if (books.length > 0) {
          statusContainer.createSpan({
            cls: 'sync-status-text',
            text: `${books.length} books indexed`
          });
        } else {
          statusContainer.createSpan({
            cls: 'sync-status-text',
            text: 'Connected - no books synced yet'
          });
        }

        if (lastSyncedAt) {
          statusContainer.createDiv({
            cls: 'sync-last-time',
            text: `Last sync: ${lastSyncedAt.toLocaleString()}`
          });
        }
      } else {
        const iconEl = statusContainer.createSpan({ cls: 'sync-status-icon disconnected' });
        setIcon(iconEl, 'alert-circle');
        statusContainer.createSpan({
          cls: 'sync-status-text',
          text: 'Not connected to Calibre library'
        });
      }
    }
  }
}
