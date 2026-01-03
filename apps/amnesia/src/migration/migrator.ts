/**
 * Migration Engine
 *
 * Orchestrates migrations for folder structure changes, template updates,
 * and data model transitions.
 */

import { App, TFile, TFolder, normalizePath, Notice } from 'obsidian';
import { BackupService, type BackupMetadata } from './backup';
import { LinkUpdater, type MoveMapping, type LinkUpdateResult } from './link-updater';

/**
 * Migration definition
 */
export interface Migration {
  id: string;
  version: string;
  description: string;
  execute: (context: MigrationContext) => Promise<MigrationStepResult>;
  rollback?: (context: MigrationContext) => Promise<void>;
}

/**
 * Migration context
 */
export interface MigrationContext {
  app: App;
  migrator: Migrator;
  backup: BackupService;
  linkUpdater: LinkUpdater;
  dryRun: boolean;
  log: (message: string) => void;
}

/**
 * Migration step result
 */
export interface MigrationStepResult {
  success: boolean;
  filesProcessed: number;
  linksUpdated: number;
  errors: string[];
  warnings: string[];
}

/**
 * Full migration result
 */
export interface MigrationResult {
  success: boolean;
  migrationId: string;
  backupId?: string;
  steps: MigrationStepResult[];
  totalFilesProcessed: number;
  totalLinksUpdated: number;
  errors: string[];
  warnings: string[];
  duration: number;
}

/**
 * Migration state
 */
export interface MigrationState {
  completedMigrations: string[];
  lastMigrationDate?: Date;
  version: string;
}

/**
 * Migrator Service
 */
export class Migrator {
  private app: App;
  private backup: BackupService;
  private linkUpdater: LinkUpdater;
  private migrations: Map<string, Migration>;
  private stateFile: string = '.amnesia/migration-state.json';

  constructor(app: App) {
    this.app = app;
    this.backup = new BackupService(app);
    this.linkUpdater = new LinkUpdater(app);
    this.migrations = new Map();
  }

  /**
   * Register a migration
   */
  registerMigration(migration: Migration): void {
    this.migrations.set(migration.id, migration);
  }

  /**
   * Get all pending migrations
   */
  async getPendingMigrations(): Promise<Migration[]> {
    const state = await this.loadState();
    return Array.from(this.migrations.values()).filter(
      m => !state.completedMigrations.includes(m.id)
    );
  }

  /**
   * Run a specific migration
   */
  async runMigration(
    migrationId: string,
    options: { dryRun?: boolean; createBackup?: boolean } = {}
  ): Promise<MigrationResult> {
    const startTime = Date.now();
    const migration = this.migrations.get(migrationId);

    if (!migration) {
      throw new Error(`Migration ${migrationId} not found`);
    }

    const result: MigrationResult = {
      success: false,
      migrationId,
      steps: [],
      totalFilesProcessed: 0,
      totalLinksUpdated: 0,
      errors: [],
      warnings: [],
      duration: 0,
    };

    const logs: string[] = [];

    try {
      // Create backup if requested
      if (options.createBackup && !options.dryRun) {
        const backupResult = await this.backup.createBackup(
          await this.getAllRelevantFiles(),
          `Pre-migration backup: ${migration.description}`
        );
        result.backupId = backupResult.id;
        logs.push(`Created backup: ${backupResult.id}`);
      }

      // Build context
      const context: MigrationContext = {
        app: this.app,
        migrator: this,
        backup: this.backup,
        linkUpdater: this.linkUpdater,
        dryRun: options.dryRun || false,
        log: (msg) => logs.push(msg),
      };

      // Execute migration
      const stepResult = await migration.execute(context);
      result.steps.push(stepResult);
      result.totalFilesProcessed += stepResult.filesProcessed;
      result.totalLinksUpdated += stepResult.linksUpdated;
      result.errors.push(...stepResult.errors);
      result.warnings.push(...stepResult.warnings);

      if (stepResult.success) {
        result.success = true;

        // Mark migration as complete
        if (!options.dryRun) {
          await this.markMigrationComplete(migrationId);
        }
      }
    } catch (error) {
      result.errors.push(`Migration failed: ${error}`);

      // Attempt rollback if backup exists
      if (result.backupId && migration.rollback) {
        try {
          await migration.rollback({
            app: this.app,
            migrator: this,
            backup: this.backup,
            linkUpdater: this.linkUpdater,
            dryRun: false,
            log: (msg) => logs.push(`[rollback] ${msg}`),
          });
          result.warnings.push('Rollback completed');
        } catch (rollbackError) {
          result.errors.push(`Rollback failed: ${rollbackError}`);
        }
      }
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Run all pending migrations
   */
  async runAllPending(
    options: { dryRun?: boolean; createBackup?: boolean } = {}
  ): Promise<MigrationResult[]> {
    const pending = await this.getPendingMigrations();
    const results: MigrationResult[] = [];

    for (const migration of pending) {
      const result = await this.runMigration(migration.id, options);
      results.push(result);

      // Stop on failure
      if (!result.success) {
        break;
      }
    }

    return results;
  }

  /**
   * Move files with link updates
   */
  async moveFiles(
    moves: MoveMapping[],
    options: { dryRun?: boolean } = {}
  ): Promise<{ moved: number; linkResults: LinkUpdateResult[] }> {
    let moved = 0;

    if (!options.dryRun) {
      for (const move of moves) {
        const file = this.app.vault.getAbstractFileByPath(move.from);
        if (file instanceof TFile) {
          // Ensure target folder exists
          const targetFolder = move.to.substring(0, move.to.lastIndexOf('/'));
          if (targetFolder) {
            await this.ensureFolder(targetFolder);
          }

          await this.app.fileManager.renameFile(file, move.to);
          moved++;
        }
      }
    } else {
      // Count files that would be moved
      for (const move of moves) {
        if (this.app.vault.getAbstractFileByPath(move.from)) {
          moved++;
        }
      }
    }

    // Update links
    const linkResults = options.dryRun
      ? []
      : await this.linkUpdater.updateLinksForMoves(moves);

    return { moved, linkResults };
  }

  /**
   * Rename folder with link updates
   */
  async renameFolder(
    from: string,
    to: string,
    options: { dryRun?: boolean } = {}
  ): Promise<{ moved: number; linkResults: LinkUpdateResult[] }> {
    const folder = this.app.vault.getAbstractFileByPath(from);
    if (!(folder instanceof TFolder)) {
      throw new Error(`Folder not found: ${from}`);
    }

    // Build move mappings for all files in folder
    const moves: MoveMapping[] = [];
    const collectMoves = (f: TFolder, fromBase: string, toBase: string) => {
      for (const child of f.children) {
        if (child instanceof TFile) {
          const relativePath = child.path.substring(fromBase.length);
          moves.push({
            from: child.path,
            to: toBase + relativePath,
          });
        } else if (child instanceof TFolder) {
          collectMoves(child, fromBase, toBase);
        }
      }
    };

    collectMoves(folder, from, to);

    if (!options.dryRun) {
      // Create target folder
      await this.ensureFolder(to);

      // Move all files
      for (const move of moves) {
        const file = this.app.vault.getAbstractFileByPath(move.from);
        if (file instanceof TFile) {
          const targetFolder = move.to.substring(0, move.to.lastIndexOf('/'));
          await this.ensureFolder(targetFolder);
          await this.app.fileManager.renameFile(file, move.to);
        }
      }

      // Delete original folder if empty
      const originalFolder = this.app.vault.getAbstractFileByPath(from);
      if (originalFolder instanceof TFolder && originalFolder.children.length === 0) {
        await this.app.vault.delete(originalFolder);
      }
    }

    // Update links
    const linkResults = options.dryRun
      ? []
      : await this.linkUpdater.updateLinksForMoves(moves);

    return { moved: moves.length, linkResults };
  }

  /**
   * Update frontmatter in files matching a pattern
   */
  async updateFrontmatter(
    folder: string,
    updates: (frontmatter: Record<string, unknown>, file: TFile) => Record<string, unknown>,
    options: { dryRun?: boolean; filter?: (file: TFile) => boolean } = {}
  ): Promise<{ processed: number; errors: string[] }> {
    let processed = 0;
    const errors: string[] = [];

    const folderFile = this.app.vault.getAbstractFileByPath(folder);
    if (!(folderFile instanceof TFolder)) {
      return { processed: 0, errors: [`Folder not found: ${folder}`] };
    }

    const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder));

    for (const file of files) {
      if (options.filter && !options.filter(file)) {
        continue;
      }

      try {
        const content = await this.app.vault.read(file);
        const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

        if (!match) {
          continue;
        }

        const [, frontmatterStr, body] = match;

        // Parse frontmatter (simple YAML parser)
        const frontmatter = this.parseSimpleYaml(frontmatterStr);
        const updatedFrontmatter = updates(frontmatter, file);

        if (!options.dryRun) {
          const newFrontmatterStr = this.stringifySimpleYaml(updatedFrontmatter);
          const newContent = `---\n${newFrontmatterStr}\n---\n${body}`;
          await this.app.vault.modify(file, newContent);
        }

        processed++;
      } catch (error) {
        errors.push(`Error processing ${file.path}: ${error}`);
      }
    }

    return { processed, errors };
  }

  /**
   * Load migration state
   */
  private async loadState(): Promise<MigrationState> {
    const file = this.app.vault.getAbstractFileByPath(this.stateFile);

    if (file instanceof TFile) {
      try {
        const content = await this.app.vault.read(file);
        const data = JSON.parse(content);
        return {
          ...data,
          lastMigrationDate: data.lastMigrationDate
            ? new Date(data.lastMigrationDate)
            : undefined,
        };
      } catch {
        // Ignore parse errors
      }
    }

    return {
      completedMigrations: [],
      version: '1.0.0',
    };
  }

  /**
   * Save migration state
   */
  private async saveState(state: MigrationState): Promise<void> {
    const folder = this.stateFile.substring(0, this.stateFile.lastIndexOf('/'));
    await this.ensureFolder(folder);

    const content = JSON.stringify(
      {
        ...state,
        lastMigrationDate: state.lastMigrationDate?.toISOString(),
      },
      null,
      2
    );

    const file = this.app.vault.getAbstractFileByPath(this.stateFile);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    } else {
      await this.app.vault.create(this.stateFile, content);
    }
  }

  /**
   * Mark a migration as complete
   */
  private async markMigrationComplete(migrationId: string): Promise<void> {
    const state = await this.loadState();
    if (!state.completedMigrations.includes(migrationId)) {
      state.completedMigrations.push(migrationId);
      state.lastMigrationDate = new Date();
      await this.saveState(state);
    }
  }

  /**
   * Get all relevant files for backup
   */
  private async getAllRelevantFiles(): Promise<string[]> {
    const folders = [
      'Biblioteca',
      'Florilegios',
      'Autores',
      'Series',
      'Estanterias',
    ];

    const files: string[] = [];
    for (const folder of folders) {
      const f = this.app.vault.getAbstractFileByPath(folder);
      if (f instanceof TFolder) {
        const mdFiles = this.app.vault.getMarkdownFiles().filter(
          file => file.path.startsWith(folder)
        );
        files.push(...mdFiles.map(file => file.path));
      }
    }

    return files;
  }

  /**
   * Ensure folder exists
   */
  private async ensureFolder(folderPath: string): Promise<void> {
    const parts = normalizePath(folderPath).split('/');
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
   * Simple YAML parser (for frontmatter)
   */
  private parseSimpleYaml(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = yaml.split('\n');

    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        // Handle quoted strings
        if (value.startsWith('"') && value.endsWith('"')) {
          result[key] = value.slice(1, -1);
        } else if (value === 'true') {
          result[key] = true;
        } else if (value === 'false') {
          result[key] = false;
        } else if (/^\d+$/.test(value)) {
          result[key] = parseInt(value, 10);
        } else if (/^\d+\.\d+$/.test(value)) {
          result[key] = parseFloat(value);
        } else {
          result[key] = value;
        }
      }
    }

    return result;
  }

  /**
   * Simple YAML stringifier
   */
  private stringifySimpleYaml(obj: Record<string, unknown>): string {
    const lines: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (typeof value === 'string') {
        // Quote strings that contain special characters
        if (value.includes(':') || value.includes('"') || value.includes('\n')) {
          lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
        } else {
          lines.push(`${key}: ${value}`);
        }
      } else if (typeof value === 'boolean' || typeof value === 'number') {
        lines.push(`${key}: ${value}`);
      } else if (Array.isArray(value)) {
        lines.push(`${key}: [${value.join(', ')}]`);
      } else {
        lines.push(`${key}: ${JSON.stringify(value)}`);
      }
    }

    return lines.join('\n');
  }
}
