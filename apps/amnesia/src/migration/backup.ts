/**
 * Backup System
 *
 * Creates backups before migrations to allow rollback.
 */

import { App, TFile, TFolder, normalizePath } from 'obsidian';

/**
 * Backup metadata
 */
export interface BackupMetadata {
  id: string;
  createdAt: Date;
  description: string;
  files: BackedUpFile[];
  version: string;
}

/**
 * Backed up file info
 */
export interface BackedUpFile {
  originalPath: string;
  backupPath: string;
  size: number;
}

/**
 * Backup options
 */
export interface BackupOptions {
  /** Folder to store backups */
  backupFolder: string;
  /** Maximum number of backups to keep */
  maxBackups: number;
  /** Include file content or just paths */
  includeContent: boolean;
}

const DEFAULT_OPTIONS: BackupOptions = {
  backupFolder: '.amnesia-backups',
  maxBackups: 5,
  includeContent: true,
};

/**
 * Backup Service
 */
export class BackupService {
  private app: App;
  private options: BackupOptions;

  constructor(app: App, options: Partial<BackupOptions> = {}) {
    this.app = app;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Create a backup of specified files
   */
  async createBackup(
    files: string[],
    description: string
  ): Promise<BackupMetadata> {
    const id = this.generateBackupId();
    const backupRoot = normalizePath(`${this.options.backupFolder}/${id}`);

    // Ensure backup folder exists
    await this.ensureFolder(backupRoot);

    const backedUpFiles: BackedUpFile[] = [];

    for (const filePath of files) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        try {
          const backupPath = normalizePath(`${backupRoot}/${filePath}`);
          await this.backupFile(file, backupPath);
          backedUpFiles.push({
            originalPath: filePath,
            backupPath,
            size: file.stat.size,
          });
        } catch (error) {
          console.warn(`Failed to backup ${filePath}:`, error);
        }
      }
    }

    const metadata: BackupMetadata = {
      id,
      createdAt: new Date(),
      description,
      files: backedUpFiles,
      version: '1.0.0',
    };

    // Save metadata
    const metadataPath = normalizePath(`${backupRoot}/metadata.json`);
    await this.app.vault.create(
      metadataPath,
      JSON.stringify(metadata, null, 2)
    );

    // Clean up old backups
    await this.cleanupOldBackups();

    return metadata;
  }

  /**
   * Backup a folder and all its contents
   */
  async backupFolder(
    folderPath: string,
    description: string
  ): Promise<BackupMetadata> {
    const files = await this.getFilesInFolder(folderPath);
    return this.createBackup(files, description);
  }

  /**
   * Restore from a backup
   */
  async restoreBackup(backupId: string): Promise<{ restored: number; errors: string[] }> {
    const metadata = await this.getBackupMetadata(backupId);
    if (!metadata) {
      throw new Error(`Backup ${backupId} not found`);
    }

    let restored = 0;
    const errors: string[] = [];

    for (const file of metadata.files) {
      try {
        const backupFile = this.app.vault.getAbstractFileByPath(file.backupPath);
        if (backupFile instanceof TFile) {
          const content = await this.app.vault.read(backupFile);

          // Ensure original folder exists
          const folder = file.originalPath.substring(0, file.originalPath.lastIndexOf('/'));
          if (folder) {
            await this.ensureFolder(folder);
          }

          // Check if original exists
          const existingFile = this.app.vault.getAbstractFileByPath(file.originalPath);
          if (existingFile instanceof TFile) {
            await this.app.vault.modify(existingFile, content);
          } else {
            await this.app.vault.create(file.originalPath, content);
          }

          restored++;
        }
      } catch (error) {
        errors.push(`Failed to restore ${file.originalPath}: ${error}`);
      }
    }

    return { restored, errors };
  }

  /**
   * List all backups
   */
  async listBackups(): Promise<BackupMetadata[]> {
    const backups: BackupMetadata[] = [];
    const folder = this.app.vault.getAbstractFileByPath(this.options.backupFolder);

    if (!(folder instanceof TFolder)) {
      return backups;
    }

    for (const child of folder.children) {
      if (child instanceof TFolder) {
        const metadata = await this.getBackupMetadata(child.name);
        if (metadata) {
          backups.push(metadata);
        }
      }
    }

    // Sort by date, newest first
    backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return backups;
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupId: string): Promise<void> {
    const backupPath = normalizePath(`${this.options.backupFolder}/${backupId}`);
    const folder = this.app.vault.getAbstractFileByPath(backupPath);

    if (folder instanceof TFolder) {
      await this.app.vault.delete(folder, true);
    }
  }

  /**
   * Get backup metadata
   */
  async getBackupMetadata(backupId: string): Promise<BackupMetadata | null> {
    const metadataPath = normalizePath(
      `${this.options.backupFolder}/${backupId}/metadata.json`
    );
    const file = this.app.vault.getAbstractFileByPath(metadataPath);

    if (!(file instanceof TFile)) {
      return null;
    }

    try {
      const content = await this.app.vault.read(file);
      const data = JSON.parse(content);
      return {
        ...data,
        createdAt: new Date(data.createdAt),
      };
    } catch {
      return null;
    }
  }

  /**
   * Backup a single file
   */
  private async backupFile(file: TFile, backupPath: string): Promise<void> {
    // Ensure backup folder exists
    const folder = backupPath.substring(0, backupPath.lastIndexOf('/'));
    await this.ensureFolder(folder);

    if (this.options.includeContent) {
      const content = await this.app.vault.read(file);
      await this.app.vault.create(backupPath, content);
    } else {
      // Just create an empty placeholder
      await this.app.vault.create(backupPath, '');
    }
  }

  /**
   * Get all files in a folder recursively
   */
  private async getFilesInFolder(folderPath: string): Promise<string[]> {
    const files: string[] = [];
    const folder = this.app.vault.getAbstractFileByPath(folderPath);

    if (!(folder instanceof TFolder)) {
      return files;
    }

    const traverse = (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFile) {
          files.push(child.path);
        } else if (child instanceof TFolder) {
          traverse(child);
        }
      }
    };

    traverse(folder);
    return files;
  }

  /**
   * Clean up old backups beyond maxBackups
   */
  private async cleanupOldBackups(): Promise<void> {
    const backups = await this.listBackups();

    if (backups.length <= this.options.maxBackups) {
      return;
    }

    // Delete oldest backups
    const toDelete = backups.slice(this.options.maxBackups);
    for (const backup of toDelete) {
      await this.deleteBackup(backup.id);
    }
  }

  /**
   * Ensure a folder exists
   */
  private async ensureFolder(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    const parts = normalized.split('/');
    let current = '';

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const folder = this.app.vault.getAbstractFileByPath(current);
      if (!folder) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  /**
   * Generate a unique backup ID
   */
  private generateBackupId(): string {
    const now = new Date();
    return `backup-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  }
}
