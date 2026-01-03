/**
 * Default Liquid templates for Amnesia
 *
 * These templates use Liquid syntax and can be customized in settings.
 * Variables are documented in template-types.ts
 */

import type { TemplateSettings } from './template-types';

// =============================================================================
// Book Note Template
// =============================================================================

export const DEFAULT_BOOK_NOTE_TEMPLATE = `---
type: book
bookId: "{{ book.id }}"
{% if book.calibreId %}calibreId: {{ book.calibreId }}{% endif %}
title: "{{ book.title }}"
{% if book.titleSort %}titleSort: "{{ book.titleSort }}"{% endif %}
author: "{{ book.authorLink }}"
{% if book.series %}
series: "{{ book.seriesLink }}"
seriesIndex: {{ book.seriesIndex }}
{% endif %}
coverUrl: "{{ book.coverPath | default: book.coverUrl }}"
progress: {{ book.progress | default: 0 }}
status: {{ book.status | default: "to-read" }}
{% if book.publishedDate %}publishedDate: {{ book.publishedDate }}{% endif %}
{% if book.isbn %}isbn: "{{ book.isbn }}"{% endif %}
{% if book.rating %}rating: {{ book.rating }}{% endif %}
{% if book.epubPath %}epubPath: "{{ book.epubPath }}"{% endif %}
{% if book.calibrePath %}calibrePath: "{{ book.calibrePath }}"{% endif %}
lastSync: {{ date.now }}
---

# {{ book.title }}

**Author:** {{ book.authorLink }}
{% if book.series %}
**Series:** {{ book.seriesLink }}{% if book.seriesIndex %} (#{{ book.seriesIndex }}){% endif %}
{% endif %}

## Notes



## Highlights

`;

// =============================================================================
// Hub Highlights Template
// =============================================================================

export const DEFAULT_HUB_HIGHLIGHTS_TEMPLATE = `---
type: hub-highlights
bookId: "{{ book.id }}"
book: "[[{{ book.notePath }}]]"
highlightCount: {{ highlights.length }}
lastUpdated: {{ date.now }}
---

# Highlights: {{ book.title }}

**Book:** [[{{ book.notePath }}]]
**Author:** {{ book.author }}
**Total Highlights:** {{ highlights.length }}

---

{% for highlight in highlights %}
> {{ highlight.text }}

{% if highlight.annotation %}**Note:** {{ highlight.annotation }}{% endif %}
*— {{ highlight.chapter | default: "Unknown chapter" }}* | {{ highlight.createdAt | date: "%Y-%m-%d" }}

---

{% endfor %}
`;

// =============================================================================
// Hub Notes Template
// =============================================================================

export const DEFAULT_HUB_NOTES_TEMPLATE = `---
type: hub-notes
bookId: "{{ book.id }}"
book: "[[{{ book.notePath }}]]"
noteCount: {{ notes.length }}
lastUpdated: {{ date.now }}
---

# Notes: {{ book.title }}

**Book:** [[{{ book.notePath }}]]
**Author:** {{ book.author }}
**Total Notes:** {{ notes.length }}

---

{% for note in notes %}
## {{ note.chapter | default: "Note" }}

{{ note.content }}

*Created: {{ note.createdAt | date: "%Y-%m-%d" }}*

---

{% endfor %}
`;

// =============================================================================
// Atomic Highlight Template
// =============================================================================

export const DEFAULT_ATOMIC_HIGHLIGHT_TEMPLATE = `---
type: highlight
bookId: "{{ book.id }}"
book: "[[{{ book.notePath }}]]"
cfi: "{{ highlight.cfi }}"
chapter: "{{ highlight.chapter }}"
color: {{ highlight.color | default: "yellow" }}
created: {{ highlight.createdAt }}
---

> {{ highlight.text }}

{% if highlight.annotation %}
## My Thoughts

{{ highlight.annotation }}
{% endif %}

---
*From [[{{ book.notePath }}]] by {{ book.author }}*
`;

// =============================================================================
// Atomic Note Template
// =============================================================================

export const DEFAULT_ATOMIC_NOTE_TEMPLATE = `---
type: note
bookId: "{{ book.id }}"
book: "[[{{ book.notePath }}]]"
cfi: "{{ note.cfi }}"
chapter: "{{ note.chapter }}"
created: {{ note.createdAt }}
---

{{ note.content }}

---
*From [[{{ book.notePath }}]] by {{ book.author }}*
`;

// =============================================================================
// Author Index Template
// =============================================================================

export const DEFAULT_AUTHOR_INDEX_TEMPLATE = `---
type: author
name: "{{ author.name }}"
sortName: "{{ author.sortName }}"
bookCount: {{ author.bookCount }}
---

# {{ author.name }}

## Books ({{ author.bookCount }})

| Title | Status |
| ----- | ------ |
{% for book in author.books %}| [[{{ book.notePath }}\|{{ book.title }}]] | {{ book.status }} |
{% endfor %}
`;

// =============================================================================
// Series Index Template
// =============================================================================

export const DEFAULT_SERIES_INDEX_TEMPLATE = `---
type: series
name: "{{ series.name }}"
bookCount: {{ series.bookCount }}
---

# {{ series.name }}

## Books in Series ({{ series.bookCount }})

| # | Title | Status |
| - | ----- | ------ |
{% for book in series.books %}| {{ book.seriesIndex }} | [[{{ book.notePath }}\|{{ book.title }}]] | {{ book.status }} |
{% endfor %}
`;

// =============================================================================
// Shelf Index Template
// =============================================================================

export const DEFAULT_SHELF_INDEX_TEMPLATE = `---
type: shelf
name: "{{ shelf.name }}"
bookCount: {{ shelf.bookCount }}
---

# {{ shelf.name }}

## Books ({{ shelf.bookCount }})

| Title | Author | Status |
| ----- | ------ | ------ |
{% for book in shelf.books %}| [[{{ book.notePath }}\|{{ book.title }}]] | {{ book.author }} | {{ book.status }} |
{% endfor %}
`;

// =============================================================================
// Legacy exports for backwards compatibility
// =============================================================================

export const DEFAULT_HIGHLIGHT_NOTE_TEMPLATE = DEFAULT_ATOMIC_HIGHLIGHT_TEMPLATE;

export const DEFAULT_READING_SESSION_TEMPLATE = `---
type: reading-session
book: "[[{{ book.title }}]]"
date: {{ session.date }}
duration_minutes: {{ session.durationMinutes }}
pages_read: {{ session.pagesRead }}
start_progress: {{ session.startProgress }}
end_progress: {{ session.endProgress }}
---

# Reading Session: {{ book.title }}

**Date:** {{ session.date }}
**Duration:** {{ session.durationMinutes }} minutes
**Progress:** {{ session.startProgress }}% → {{ session.endProgress }}%

## Session Notes

{{ session.notes }}
`;

// =============================================================================
// Default Template Settings
// =============================================================================

export const DEFAULT_TEMPLATE_SETTINGS: TemplateSettings = {
  bookNote: {
    enabled: true,
    template: DEFAULT_BOOK_NOTE_TEMPLATE,
    folder: 'Biblioteca/Libros',
  },
  hubHighlights: {
    enabled: true,
    template: DEFAULT_HUB_HIGHLIGHTS_TEMPLATE,
    folder: 'Biblioteca/Florilegios',
  },
  hubNotes: {
    enabled: true,
    template: DEFAULT_HUB_NOTES_TEMPLATE,
    folder: 'Biblioteca/Florilegios',
  },
  atomicHighlight: {
    enabled: false, // Disabled by default, advanced feature
    template: DEFAULT_ATOMIC_HIGHLIGHT_TEMPLATE,
    folder: 'Biblioteca/Florilegios',
  },
  atomicNote: {
    enabled: false, // Disabled by default, advanced feature
    template: DEFAULT_ATOMIC_NOTE_TEMPLATE,
    folder: 'Biblioteca/Florilegios',
  },
  authorIndex: {
    enabled: true,
    template: DEFAULT_AUTHOR_INDEX_TEMPLATE,
    folder: 'Biblioteca/Autores',
  },
  seriesIndex: {
    enabled: true,
    template: DEFAULT_SERIES_INDEX_TEMPLATE,
    folder: 'Biblioteca/Series',
  },
  shelfIndex: {
    enabled: true,
    template: DEFAULT_SHELF_INDEX_TEMPLATE,
    folder: 'Biblioteca/Estanterias',
  },
};
