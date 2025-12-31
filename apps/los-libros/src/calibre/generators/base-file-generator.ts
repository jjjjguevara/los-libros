/**
 * BaseFileGenerator
 *
 * Generates .base files for Obsidian Bases plugin.
 * These files define Card View queries for the library.
 *
 * Obsidian Bases uses a YAML-based query language to create
 * dynamic views of notes based on frontmatter properties.
 */

import { App, TFile, normalizePath } from 'obsidian';
import type { LibrosSettings } from '../../settings/settings';

/**
 * Predefined base file configurations
 */
export interface BaseFileConfig {
  name: string;
  filename: string;
  description: string;
  content: string;
}

export class BaseFileGenerator {
  private app: App;
  private getSettings: () => LibrosSettings;

  constructor(app: App, getSettings: () => LibrosSettings) {
    this.app = app;
    this.getSettings = getSettings;
  }

  /**
   * Generate all standard base files
   */
  async generateAllBaseFiles(): Promise<TFile[]> {
    const settings = this.getSettings();
    const files: TFile[] = [];

    const configs = this.getBaseFileConfigs();

    for (const config of configs) {
      try {
        const file = await this.generateBaseFile(config);
        files.push(file);
      } catch (error) {
        console.warn(`Failed to generate base file ${config.filename}:`, error);
      }
    }

    return files;
  }

  /**
   * Generate a single base file
   */
  async generateBaseFile(config: BaseFileConfig): Promise<TFile> {
    const settings = this.getSettings();
    const filePath = normalizePath(
      `${settings.calibreBaseFilesFolder}/${config.filename}`
    );

    let file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;
    if (file) {
      await this.app.vault.modify(file, config.content);
    } else {
      file = await this.app.vault.create(filePath, config.content);
    }

    return file;
  }

  /**
   * Get all base file configurations
   */
  getBaseFileConfigs(): BaseFileConfig[] {
    const settings = this.getSettings();

    return [
      this.getLibraryConfig(settings),
      this.getByAuthorConfig(settings),
      this.getBySeriesConfig(settings),
      this.getByShelfConfig(settings),
      this.getCurrentlyReadingConfig(settings),
      this.getToReadConfig(settings),
      this.getCompletedConfig(settings),
      this.getRecentlyAddedConfig(settings),
      this.getHighRatedConfig(settings),
    ];
  }

  /**
   * Main library Card View - all books
   */
  private getLibraryConfig(settings: LibrosSettings): BaseFileConfig {
    return {
      name: 'Library',
      filename: 'Biblioteca.base',
      description: 'Main library view showing all books as cards',
      content: `# Library - All Books
# Card view of your entire library

filters:
  - file.hasProperty("type")
  - note.type = "book"

properties:
  note.title:
    displayName: Title
  note.author:
    displayName: Author
  note.rating:
    displayName: Rating
  note.status:
    displayName: Status
  note.progress:
    displayName: Progress
  note.series:
    displayName: Series

views:
  - type: card
    name: "Library"
    imageProperty: coverUrl
    filters:
      - file.inFolder("${settings.calibreBookNotesFolder}")
    order:
      - note.title asc
    columns:
      - note.title
      - note.author
      - note.rating
`,
    };
  }

  /**
   * Books grouped by author
   */
  private getByAuthorConfig(settings: LibrosSettings): BaseFileConfig {
    return {
      name: 'By Author',
      filename: 'Por Autor.base',
      description: 'Books grouped by author',
      content: `# Library by Author
# Table view grouped by author

filters:
  - file.hasProperty("type")
  - note.type = "book"

properties:
  note.title:
    displayName: Title
  note.author:
    displayName: Author
  note.series:
    displayName: Series
  note.seriesIndex:
    displayName: "#"
  note.rating:
    displayName: Rating

views:
  - type: table
    name: "By Author"
    filters:
      - file.inFolder("${settings.calibreBookNotesFolder}")
    groupBy: note.author
    order:
      - note.author asc
      - note.series asc
      - note.seriesIndex asc
`,
    };
  }

  /**
   * Books grouped by series
   */
  private getBySeriesConfig(settings: LibrosSettings): BaseFileConfig {
    return {
      name: 'By Series',
      filename: 'Por Serie.base',
      description: 'Books grouped by series',
      content: `# Library by Series
# Table view grouped by series

filters:
  - file.hasProperty("type")
  - note.type = "book"
  - note.series != null

properties:
  note.title:
    displayName: Title
  note.series:
    displayName: Series
  note.seriesIndex:
    displayName: "#"
  note.author:
    displayName: Author
  note.status:
    displayName: Status

views:
  - type: table
    name: "By Series"
    filters:
      - file.inFolder("${settings.calibreBookNotesFolder}")
    groupBy: note.series
    order:
      - note.series asc
      - note.seriesIndex asc
`,
    };
  }

  /**
   * Books grouped by shelf/tag
   */
  private getByShelfConfig(settings: LibrosSettings): BaseFileConfig {
    return {
      name: 'By Shelf',
      filename: 'Por Estanteria.base',
      description: 'Books grouped by shelf/tag',
      content: `# Library by Shelf
# View books by their bookshelf/tag categories

filters:
  - file.hasProperty("type")
  - note.type = "book"

properties:
  note.title:
    displayName: Title
  note.author:
    displayName: Author
  note.bookshelves:
    displayName: Shelves
  note.rating:
    displayName: Rating

views:
  - type: table
    name: "By Shelf"
    filters:
      - file.inFolder("${settings.calibreBookNotesFolder}")
    order:
      - note.title asc
`,
    };
  }

  /**
   * Currently reading books
   */
  private getCurrentlyReadingConfig(settings: LibrosSettings): BaseFileConfig {
    return {
      name: 'Currently Reading',
      filename: 'En Progreso.base',
      description: 'Books currently being read',
      content: `# Currently Reading
# Books you're actively reading

filters:
  - file.hasProperty("type")
  - note.type = "book"
  - note.status = "reading"

properties:
  note.title:
    displayName: Title
  note.author:
    displayName: Author
  note.progress:
    displayName: Progress
  note.series:
    displayName: Series

views:
  - type: card
    name: "Reading Now"
    imageProperty: coverUrl
    filters:
      - file.inFolder("${settings.calibreBookNotesFolder}")
    order:
      - note.progress desc
`,
    };
  }

  /**
   * To-read pile
   */
  private getToReadConfig(settings: LibrosSettings): BaseFileConfig {
    return {
      name: 'To Read',
      filename: 'Por Leer.base',
      description: 'Books waiting to be read',
      content: `# To Read
# Your reading backlog

filters:
  - file.hasProperty("type")
  - note.type = "book"
  - note.status = "to-read"

properties:
  note.title:
    displayName: Title
  note.author:
    displayName: Author
  note.rating:
    displayName: Rating
  note.bookshelves:
    displayName: Shelves

views:
  - type: card
    name: "To Read"
    imageProperty: coverUrl
    filters:
      - file.inFolder("${settings.calibreBookNotesFolder}")
    order:
      - note.rating desc
      - note.title asc
`,
    };
  }

  /**
   * Completed books
   */
  private getCompletedConfig(settings: LibrosSettings): BaseFileConfig {
    return {
      name: 'Completed',
      filename: 'Completados.base',
      description: 'Books you have finished reading',
      content: `# Completed Books
# Your reading history

filters:
  - file.hasProperty("type")
  - note.type = "book"
  - note.status = "completed"

properties:
  note.title:
    displayName: Title
  note.author:
    displayName: Author
  note.rating:
    displayName: Rating
  note.series:
    displayName: Series

views:
  - type: card
    name: "Completed"
    imageProperty: coverUrl
    filters:
      - file.inFolder("${settings.calibreBookNotesFolder}")
    order:
      - note.rating desc
      - note.title asc
`,
    };
  }

  /**
   * Recently added books
   */
  private getRecentlyAddedConfig(settings: LibrosSettings): BaseFileConfig {
    return {
      name: 'Recently Added',
      filename: 'Recientes.base',
      description: 'Recently added books',
      content: `# Recently Added
# Latest additions to your library

filters:
  - file.hasProperty("type")
  - note.type = "book"

properties:
  note.title:
    displayName: Title
  note.author:
    displayName: Author
  note.status:
    displayName: Status
  note.lastSync:
    displayName: Added

views:
  - type: card
    name: "Recent"
    imageProperty: coverUrl
    filters:
      - file.inFolder("${settings.calibreBookNotesFolder}")
    order:
      - note.lastSync desc
    limit: 20
`,
    };
  }

  /**
   * High-rated books
   */
  private getHighRatedConfig(settings: LibrosSettings): BaseFileConfig {
    return {
      name: 'Favorites',
      filename: 'Favoritos.base',
      description: 'Your highest-rated books',
      content: `# Favorites
# Your highest-rated books (4+ stars)

filters:
  - file.hasProperty("type")
  - note.type = "book"
  - note.rating >= 4

properties:
  note.title:
    displayName: Title
  note.author:
    displayName: Author
  note.rating:
    displayName: Rating
  note.series:
    displayName: Series

views:
  - type: card
    name: "Favorites"
    imageProperty: coverUrl
    filters:
      - file.inFolder("${settings.calibreBookNotesFolder}")
    order:
      - note.rating desc
      - note.title asc
`,
    };
  }
}
