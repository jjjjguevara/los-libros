/**
 * Deduplication Stats Modal
 *
 * Displays statistics about the deduplication system including
 * space saved, duplicate counts, and cleanup options.
 */

import { App, Modal, Setting } from 'obsidian';
import type { DeduplicationManager, DedupStats } from '../dedup/deduplication-manager';

export class DedupStatsModal extends Modal {
  private dedupManager: DeduplicationManager;
  private stats: DedupStats | null = null;

  constructor(app: App, dedupManager: DeduplicationManager) {
    super(app);
    this.dedupManager = dedupManager;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('amnesia-dedup-stats-modal');

    contentEl.createEl('h2', { text: 'Deduplication Statistics' });

    // Loading state
    const loadingEl = contentEl.createDiv({ cls: 'loading-state' });
    loadingEl.createSpan({ text: 'Loading statistics...' });

    try {
      this.stats = await this.dedupManager.getStats();
      loadingEl.remove();
      this.renderStats(contentEl);
    } catch (e) {
      loadingEl.empty();
      loadingEl.addClass('error');
      loadingEl.createSpan({ text: `Failed to load stats: ${e instanceof Error ? e.message : 'Unknown error'}` });
    }
  }

  private renderStats(container: HTMLElement): void {
    if (!this.stats) return;

    // Stats overview
    const overviewEl = container.createDiv({ cls: 'stats-overview' });

    // Space saved
    this.createStatCard(overviewEl, 'Space Saved', this.formatBytes(this.stats.bytesSaved), 'The amount of storage saved through deduplication');

    // Stored bytes
    this.createStatCard(overviewEl, 'Stored Size', this.formatBytes(this.stats.bytesStored), 'Total size of unique content stored');

    // Dedup ratio
    this.createStatCard(overviewEl, 'Dedup Ratio', `${(this.stats.dedupRatio * 100).toFixed(1)}%`, 'Percentage of duplicate content detected');

    // Unique entries
    this.createStatCard(overviewEl, 'Unique Entries', this.stats.uniqueEntries.toLocaleString(), 'Number of unique content entries');

    // Total references
    this.createStatCard(overviewEl, 'References', this.stats.totalReferences.toLocaleString(), 'Total number of references to content');

    // Top duplicates section
    if (this.stats.topDuplicates && this.stats.topDuplicates.length > 0) {
      const dupsSection = container.createDiv({ cls: 'top-duplicates' });
      dupsSection.createEl('h3', { text: 'Most Duplicated Content' });

      const table = dupsSection.createEl('table');
      const thead = table.createEl('thead');
      const headerRow = thead.createEl('tr');
      headerRow.createEl('th', { text: 'Size' });
      headerRow.createEl('th', { text: 'Hash' });
      headerRow.createEl('th', { text: 'Copies' });
      headerRow.createEl('th', { text: 'Saved' });

      const tbody = table.createEl('tbody');
      for (const dup of this.stats.topDuplicates.slice(0, 10)) {
        const row = tbody.createEl('tr');
        row.createEl('td', { text: this.formatBytes(dup.size) });
        row.createEl('td', { text: dup.hash.slice(0, 8) + '...' });
        row.createEl('td', { text: String(dup.refCount) });
        row.createEl('td', { text: this.formatBytes(dup.size * (dup.refCount - 1)) });
      }
    }

    // Actions section
    const actionsEl = container.createDiv({ cls: 'actions-section' });

    new Setting(actionsEl)
      .setName('Cleanup orphaned entries')
      .setDesc('Remove entries that are no longer referenced by any books')
      .addButton(btn => btn
        .setButtonText('Cleanup')
        .onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText('Cleaning...');
          try {
            await this.dedupManager.cleanup();
            // Refresh stats
            this.stats = await this.dedupManager.getStats();
            this.onOpen();
          } catch (e) {
            console.error('Cleanup failed:', e);
          } finally {
            btn.setDisabled(false);
            btn.setButtonText('Cleanup');
          }
        }));

    new Setting(actionsEl)
      .setName('Clear all deduplication data')
      .setDesc('Warning: This will remove all deduplicated content and require re-downloading resources')
      .addButton(btn => btn
        .setButtonText('Clear All')
        .setWarning()
        .onClick(async () => {
          if (confirm('Are you sure? This cannot be undone.')) {
            btn.setDisabled(true);
            btn.setButtonText('Clearing...');
            try {
              await this.dedupManager.clear();
              this.stats = await this.dedupManager.getStats();
              this.onOpen();
            } catch (e) {
              console.error('Clear failed:', e);
            }
          }
        }));
  }

  private createStatCard(container: HTMLElement, label: string, value: string, description: string): void {
    const card = container.createDiv({ cls: 'stat-card' });
    card.createDiv({ cls: 'stat-value', text: value });
    card.createDiv({ cls: 'stat-label', text: label });
    card.setAttribute('title', description);
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
