/**
 * Link Updater
 *
 * Updates wikilinks and embeds when files are moved during migration.
 */

import { App, TFile, normalizePath } from 'obsidian';

/**
 * Link update result
 */
export interface LinkUpdateResult {
  file: string;
  linksUpdated: number;
  errors: string[];
}

/**
 * Move mapping
 */
export interface MoveMapping {
  from: string;
  to: string;
}

/**
 * Link Updater Service
 */
export class LinkUpdater {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Update all links in vault after files have been moved
   */
  async updateLinksForMoves(moves: MoveMapping[]): Promise<LinkUpdateResult[]> {
    const results: LinkUpdateResult[] = [];

    // Build lookup map for quick access
    const moveMap = new Map<string, string>();
    for (const move of moves) {
      // Store both with and without extension for flexible matching
      moveMap.set(this.normalizeForLinking(move.from), move.to);
      moveMap.set(move.from, move.to);
    }

    // Get all markdown files
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      try {
        const result = await this.updateLinksInFile(file, moveMap);
        if (result.linksUpdated > 0 || result.errors.length > 0) {
          results.push(result);
        }
      } catch (error) {
        results.push({
          file: file.path,
          linksUpdated: 0,
          errors: [`Failed to process: ${error}`],
        });
      }
    }

    return results;
  }

  /**
   * Update links in a single file
   */
  private async updateLinksInFile(
    file: TFile,
    moveMap: Map<string, string>
  ): Promise<LinkUpdateResult> {
    const result: LinkUpdateResult = {
      file: file.path,
      linksUpdated: 0,
      errors: [],
    };

    let content = await this.app.vault.read(file);
    let modified = false;

    // Update wikilinks: [[path]] and [[path|alias]]
    const wikiLinkRegex = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
    content = content.replace(wikiLinkRegex, (match, linkPath, alias) => {
      const normalizedLink = this.normalizeForLinking(linkPath);

      // Check if this link points to a moved file
      const newPath = moveMap.get(normalizedLink) || moveMap.get(linkPath);

      if (newPath) {
        modified = true;
        result.linksUpdated++;
        const newLinkPath = this.normalizeForLinking(newPath);
        return alias ? `[[${newLinkPath}${alias}]]` : `[[${newLinkPath}]]`;
      }

      return match;
    });

    // Update embeds: ![[path]]
    const embedRegex = /!\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
    content = content.replace(embedRegex, (match, linkPath, alias) => {
      const normalizedLink = this.normalizeForLinking(linkPath);
      const newPath = moveMap.get(normalizedLink) || moveMap.get(linkPath);

      if (newPath) {
        modified = true;
        result.linksUpdated++;
        const newLinkPath = this.normalizeForLinking(newPath);
        return alias ? `![[${newLinkPath}${alias}]]` : `![[${newLinkPath}]]`;
      }

      return match;
    });

    // Update markdown links: [text](path)
    const mdLinkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    content = content.replace(mdLinkRegex, (match, text, linkPath) => {
      // Only process vault-relative paths, not URLs
      if (linkPath.startsWith('http://') || linkPath.startsWith('https://')) {
        return match;
      }

      const normalizedLink = this.normalizeForLinking(decodeURIComponent(linkPath));
      const newPath = moveMap.get(normalizedLink) || moveMap.get(linkPath);

      if (newPath) {
        modified = true;
        result.linksUpdated++;
        return `[${text}](${encodeURIComponent(newPath)})`;
      }

      return match;
    });

    // Update frontmatter links (common patterns)
    const frontmatterLinkPatterns = [
      /^(book|notePath|florilegioPath|coverPath|epubPath|authorLink|seriesLink):\s*["']?\[\[([^\]|]+)(\|[^\]]+)?\]\]["']?$/gm,
      /^(book|notePath|florilegioPath|coverPath|epubPath):\s*["']?([^"'\n]+)["']?$/gm,
    ];

    for (const pattern of frontmatterLinkPatterns) {
      content = content.replace(pattern, (match, key, linkPath, alias) => {
        const normalizedLink = this.normalizeForLinking(linkPath);
        const newPath = moveMap.get(normalizedLink) || moveMap.get(linkPath);

        if (newPath) {
          modified = true;
          result.linksUpdated++;
          if (alias) {
            return `${key}: "[[${newPath}${alias}]]"`;
          }
          return `${key}: "${newPath}"`;
        }

        return match;
      });
    }

    if (modified) {
      await this.app.vault.modify(file, content);
    }

    return result;
  }

  /**
   * Preview link changes without applying them
   */
  async previewLinkChanges(moves: MoveMapping[]): Promise<{
    file: string;
    changes: { original: string; updated: string }[];
  }[]> {
    const results: { file: string; changes: { original: string; updated: string }[] }[] = [];

    const moveMap = new Map<string, string>();
    for (const move of moves) {
      moveMap.set(this.normalizeForLinking(move.from), move.to);
      moveMap.set(move.from, move.to);
    }

    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const changes: { original: string; updated: string }[] = [];

      // Check wikilinks
      const wikiLinkRegex = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
      let match;
      while ((match = wikiLinkRegex.exec(content)) !== null) {
        const linkPath = match[1];
        const alias = match[2] || '';
        const normalizedLink = this.normalizeForLinking(linkPath);
        const newPath = moveMap.get(normalizedLink) || moveMap.get(linkPath);

        if (newPath) {
          const newLinkPath = this.normalizeForLinking(newPath);
          changes.push({
            original: match[0],
            updated: alias ? `[[${newLinkPath}${alias}]]` : `[[${newLinkPath}]]`,
          });
        }
      }

      if (changes.length > 0) {
        results.push({ file: file.path, changes });
      }
    }

    return results;
  }

  /**
   * Find all files that link to a specific path
   */
  async findLinksTo(targetPath: string): Promise<string[]> {
    const linkers: string[] = [];
    const normalizedTarget = this.normalizeForLinking(targetPath);
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const content = await this.app.vault.read(file);

      // Check wikilinks
      const wikiLinkRegex = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
      let match;
      while ((match = wikiLinkRegex.exec(content)) !== null) {
        const linkPath = this.normalizeForLinking(match[1]);
        if (linkPath === normalizedTarget || match[1] === targetPath) {
          linkers.push(file.path);
          break;
        }
      }
    }

    return linkers;
  }

  /**
   * Normalize a path for linking comparison
   * Removes .md extension and normalizes slashes
   */
  private normalizeForLinking(path: string): string {
    return normalizePath(path)
      .replace(/\.md$/, '')
      .replace(/\\/g, '/');
  }

  /**
   * Update a single move after the fact
   */
  async updateLinksForMove(from: string, to: string): Promise<LinkUpdateResult[]> {
    return this.updateLinksForMoves([{ from, to }]);
  }

  /**
   * Bulk rename with link updates
   */
  async renameWithLinkUpdate(
    from: string,
    to: string
  ): Promise<{ moved: boolean; linkResults: LinkUpdateResult[] }> {
    const file = this.app.vault.getAbstractFileByPath(from);

    if (!(file instanceof TFile)) {
      throw new Error(`File not found: ${from}`);
    }

    // Ensure target folder exists
    const targetFolder = to.substring(0, to.lastIndexOf('/'));
    if (targetFolder) {
      const folder = this.app.vault.getAbstractFileByPath(targetFolder);
      if (!folder) {
        await this.createFolderRecursive(targetFolder);
      }
    }

    // Rename the file
    await this.app.fileManager.renameFile(file, to);

    // Update links
    const linkResults = await this.updateLinksForMove(from, to);

    return { moved: true, linkResults };
  }

  /**
   * Create folder recursively
   */
  private async createFolderRecursive(folderPath: string): Promise<void> {
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
}
