/**
 * OPDS Feed Modal
 *
 * Modal for adding or editing OPDS feed configurations.
 */

import { App, Modal, Setting, Notice } from 'obsidian';
import type { OPDSFeedConfig } from '../settings/settings';

export interface OPDSFeedModalResult {
  action: 'save' | 'cancel';
  feed?: OPDSFeedConfig;
}

export class OPDSFeedModal extends Modal {
  private feed: OPDSFeedConfig;
  private isEdit: boolean;
  private onSubmit: (result: OPDSFeedModalResult) => void;

  constructor(
    app: App,
    options: {
      feed?: OPDSFeedConfig;
      onSubmit: (result: OPDSFeedModalResult) => void;
    }
  ) {
    super(app);
    this.isEdit = !!options.feed;
    this.onSubmit = options.onSubmit;

    // Clone or create new feed
    this.feed = options.feed
      ? { ...options.feed }
      : {
          id: `opds-${Date.now()}`,
          name: '',
          url: '',
          enabled: true,
          requiresAuth: false,
        };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('amnesia-opds-feed-modal');

    contentEl.createEl('h2', { text: this.isEdit ? 'Edit OPDS Feed' : 'Add OPDS Feed' });

    // Feed Name
    new Setting(contentEl)
      .setName('Name')
      .setDesc('A friendly name for this feed')
      .addText(text => text
        .setPlaceholder('My OPDS Library')
        .setValue(this.feed.name)
        .onChange(value => {
          this.feed.name = value;
        }));

    // Feed URL
    new Setting(contentEl)
      .setName('URL')
      .setDesc('The root URL of the OPDS catalog')
      .addText(text => text
        .setPlaceholder('https://example.com/opds')
        .setValue(this.feed.url)
        .onChange(value => {
          this.feed.url = value;
        }));

    // Test Connection Button
    new Setting(contentEl)
      .setName('Test connection')
      .setDesc('Verify the feed is accessible')
      .addButton(btn => btn
        .setButtonText('Test')
        .onClick(async () => {
          if (!this.feed.url) {
            new Notice('Please enter a URL first');
            return;
          }

          btn.setDisabled(true);
          btn.setButtonText('Testing...');

          try {
            // Simple fetch test
            const response = await fetch(this.feed.url, {
              method: 'GET',
              headers: this.feed.requiresAuth && this.feed.username && this.feed.password
                ? {
                    'Authorization': 'Basic ' + btoa(`${this.feed.username}:${this.feed.password}`)
                  }
                : {},
            });

            if (response.ok) {
              new Notice('Connection successful!');
            } else {
              new Notice(`Connection failed: ${response.status} ${response.statusText}`);
            }
          } catch (e) {
            new Notice(`Connection failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
          } finally {
            btn.setDisabled(false);
            btn.setButtonText('Test');
          }
        }));

    // Requires Auth Toggle
    new Setting(contentEl)
      .setName('Requires authentication')
      .setDesc('Enable if the feed requires username/password')
      .addToggle(toggle => toggle
        .setValue(this.feed.requiresAuth)
        .onChange(value => {
          this.feed.requiresAuth = value;
          // Refresh to show/hide auth fields
          this.onOpen();
        }));

    // Auth Fields (only shown if requiresAuth is true)
    if (this.feed.requiresAuth) {
      new Setting(contentEl)
        .setName('Username')
        .addText(text => text
          .setPlaceholder('username')
          .setValue(this.feed.username || '')
          .onChange(value => {
            this.feed.username = value;
          }));

      new Setting(contentEl)
        .setName('Password')
        .addText(text => {
          text.inputEl.type = 'password';
          text
            .setPlaceholder('password')
            .setValue(this.feed.password || '')
            .onChange(value => {
              this.feed.password = value;
            });
        });
    }

    // Enabled Toggle
    new Setting(contentEl)
      .setName('Enabled')
      .setDesc('Enable or disable this feed')
      .addToggle(toggle => toggle
        .setValue(this.feed.enabled)
        .onChange(value => {
          this.feed.enabled = value;
        }));

    // Action Buttons
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => {
      this.onSubmit({ action: 'cancel' });
      this.close();
    });

    const saveBtn = buttonContainer.createEl('button', {
      text: this.isEdit ? 'Save' : 'Add Feed',
      cls: 'mod-cta',
    });
    saveBtn.addEventListener('click', () => {
      if (!this.feed.name.trim()) {
        new Notice('Please enter a feed name');
        return;
      }
      if (!this.feed.url.trim()) {
        new Notice('Please enter a feed URL');
        return;
      }

      // Basic URL validation
      try {
        new URL(this.feed.url);
      } catch {
        new Notice('Please enter a valid URL');
        return;
      }

      this.onSubmit({ action: 'save', feed: this.feed });
      this.close();
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
