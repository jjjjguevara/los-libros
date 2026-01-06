/**
 * Default Nunjucks templates for Amnesia
 *
 * These templates use Nunjucks syntax and can be customized in settings.
 * Variables are documented in template-types.ts
 *
 * Key syntax differences from Liquid:
 * - Filters use parentheses: {{ value | filter(arg) }} instead of {{ value | filter: arg }}
 * - Whitespace control: {%- -%} and {{- -}} trim surrounding whitespace
 * - {% persist "key" %} blocks preserve user content across syncs
 *
 * @see docs/research/Obsidian Sync Architecture Research.md
 */

import type { TemplateSettings } from './template-types';

// =============================================================================
// Book Note Template (Nunjucks)
// =============================================================================

export const DEFAULT_BOOK_NOTE_TEMPLATE = `---
type: book
bookId: "{{ book.id }}"
{%- if book.calibreId %}
calibreId: {{ book.calibreId }}
{%- endif %}
title: "{{ book.title | mdEscape }}"
{%- if book.titleSort %}
titleSort: "{{ book.titleSort | mdEscape }}"
{%- endif %}
author: "{{ book.authorLink }}"
{%- if book.series %}
series: "{{ book.seriesLink }}"
seriesIndex: {{ book.seriesIndex }}
{%- endif %}
coverUrl: "{{ book.coverPath | default(book.coverUrl) }}"
progress: {{ book.progress | default(0) }}
status: {{ book.status | default("to-read") }}
{%- if book.publishedDate %}
publishedDate: {{ book.publishedDate }}
{%- endif %}
{%- if book.isbn %}
isbn: "{{ book.isbn }}"
{%- endif %}
{%- if book.rating %}
rating: {{ book.rating }}
{%- endif %}
{%- if book.epubPath %}
epubPath: "{{ book.epubPath }}"
{%- endif %}
{%- if book.calibrePath %}
calibrePath: "{{ book.calibrePath }}"
{%- endif %}
{%- if book.tags and book.tags.length > 0 %}
tags:
{%- for tag in book.tags %}
  - "{{ tag }}"
{%- endfor %}
{%- endif %}
lastSync: {{ syncDate }}
amnesia_sync_hash: "{{ syncHash }}"
---

# {{ book.title }}

**Author:** {{ book.authorLink }}
{%- if book.series %}
**Series:** {{ book.seriesLink }}{% if book.seriesIndex %} (#{{ book.seriesIndex }}){% endif %}
{%- endif %}
{%- if book.description %}

## Description

{{ book.description }}
{%- endif %}

{% persist "notes" %}
## Notes

(Write your notes here - they will be preserved during sync)
{% endpersist %}

{% persist "highlights" %}
## Highlights

(Highlights will be appended here, or you can add your own)
{% endpersist %}
`;

// =============================================================================
// Hub Highlights Template (Nunjucks)
// =============================================================================

export const DEFAULT_HUB_HIGHLIGHTS_TEMPLATE = `---
type: hub-highlights
bookId: "{{ book.id }}"
book: "[[{{ book.notePath }}]]"
highlightCount: {{ highlights.length }}
lastUpdated: {{ syncDate }}
syncedHighlightIds:
{%- for highlight in highlights %}
  - "{{ highlight.id }}"
{%- endfor %}
---

# Highlights: {{ book.title }}

**Book:** [[{{ book.notePath }}]]
**Author:** {{ book.author }}
**Total Highlights:** {{ highlights.length }}

---

{% for highlight in highlights %}
> {{ highlight.text }} %% amnesia:{{ highlight.id }} %%
{%- if highlight.annotation %}

**Note:** {{ highlight.annotation }}
{%- endif %}
{%- if highlight.notePath %}

[[{{ highlight.notePath }}|View atomic note]]
{%- endif %}

*— {{ highlight.chapter | default("Unknown chapter") }}* | {{ highlight.createdAt | date("%Y-%m-%d") }}

---

{% endfor %}

{% persist "synthesis" %}
## Synthesis

(Add your synthesis and connections here - this section is preserved during sync)
{% endpersist %}
`;

// =============================================================================
// Hub Notes Template (Nunjucks)
// =============================================================================

export const DEFAULT_HUB_NOTES_TEMPLATE = `---
type: hub-notes
bookId: "{{ book.id }}"
book: "[[{{ book.notePath }}]]"
noteCount: {{ notes.length }}
lastUpdated: {{ syncDate }}
syncedNoteIds:
{%- for note in notes %}
  - "{{ note.id }}"
{%- endfor %}
---

# Notes: {{ book.title }}

**Book:** [[{{ book.notePath }}]]
**Author:** {{ book.author }}
**Total Notes:** {{ notes.length }}

---

{% for note in notes %}
## {{ note.chapter | default("Note") }} %% amnesia:{{ note.id }} %%

{{ note.content }}

*Created: {{ note.createdAt | date("%Y-%m-%d") }}*

---

{% endfor %}

{% persist "synthesis" %}
## My Thoughts

(Add your synthesis and extended thoughts here - this section is preserved during sync)
{% endpersist %}
`;

// =============================================================================
// Atomic Highlight Template (Nunjucks)
// =============================================================================

export const DEFAULT_ATOMIC_HIGHLIGHT_TEMPLATE = `---
type: highlight
bookId: "{{ book.id }}"
book: "[[{{ book.notePath }}]]"
highlightId: "{{ highlight.id }}"
cfi: "{{ highlight.cfi }}"
chapter: "{{ highlight.chapter | mdEscape }}"
color: {{ highlight.color | default("yellow") }}
created: {{ highlight.createdAt | date("%Y-%m-%d") }}
---

> {{ highlight.text }}

{% if highlight.annotation %}
## Annotation

{{ highlight.annotation }}
{% endif %}

{% persist "thoughts" %}
## My Thoughts

(Write your extended thoughts here - they will be preserved during sync)
{% endpersist %}

---
*From [[{{ book.notePath }}]] by {{ book.author }}*
`;

// =============================================================================
// Atomic Note Template (Nunjucks)
// =============================================================================

export const DEFAULT_ATOMIC_NOTE_TEMPLATE = `---
type: note
bookId: "{{ book.id }}"
book: "[[{{ book.notePath }}]]"
noteId: "{{ note.id }}"
cfi: "{{ note.cfi }}"
chapter: "{{ note.chapter | mdEscape }}"
created: {{ note.createdAt | date("%Y-%m-%d") }}
---

{{ note.content }}

{% persist "extended" %}
## Extended Thoughts

(Add your extended thoughts here - they will be preserved during sync)
{% endpersist %}

---
*From [[{{ book.notePath }}]] by {{ book.author }}*
`;

// =============================================================================
// Author Index Template (Nunjucks)
// =============================================================================

export const DEFAULT_AUTHOR_INDEX_TEMPLATE = `---
type: author
name: "{{ author.name | mdEscape }}"
sortName: "{{ author.sortName | mdEscape }}"
bookCount: {{ author.bookCount }}
---

# {{ author.name }}

## Books ({{ author.bookCount }})

| Title | Status |
| ----- | ------ |
{% for book in author.books -%}
| [[{{ book.notePath }}\\|{{ book.title }}]] | {{ book.status }} |
{% endfor %}

{% persist "notes" %}
## About This Author

(Add your notes about this author here)
{% endpersist %}
`;

// =============================================================================
// Series Index Template (Nunjucks)
// =============================================================================

export const DEFAULT_SERIES_INDEX_TEMPLATE = `---
type: series
name: "{{ series.name | mdEscape }}"
bookCount: {{ series.bookCount }}
---

# {{ series.name }}

## Books in Series ({{ series.bookCount }})

| # | Title | Status |
| - | ----- | ------ |
{% for book in series.books -%}
| {{ book.seriesIndex }} | [[{{ book.notePath }}\\|{{ book.title }}]] | {{ book.status }} |
{% endfor %}

{% persist "notes" %}
## About This Series

(Add your notes about this series here)
{% endpersist %}
`;

// =============================================================================
// Shelf Index Template (Nunjucks)
// =============================================================================

export const DEFAULT_SHELF_INDEX_TEMPLATE = `---
type: shelf
name: "{{ shelf.name | mdEscape }}"
bookCount: {{ shelf.bookCount }}
---

# {{ shelf.name }}

## Books ({{ shelf.bookCount }})

| Title | Author | Status |
| ----- | ------ | ------ |
{% for book in shelf.books -%}
| [[{{ book.notePath }}\\|{{ book.title }}]] | {{ book.author }} | {{ book.status }} |
{% endfor %}

{% persist "notes" %}
## About This Shelf

(Add your notes about this collection here)
{% endpersist %}
`;

// =============================================================================
// Legacy exports for backwards compatibility
// =============================================================================

export const DEFAULT_HIGHLIGHT_NOTE_TEMPLATE = DEFAULT_ATOMIC_HIGHLIGHT_TEMPLATE;

export const DEFAULT_READING_SESSION_TEMPLATE = `---
type: reading-session
book: "[[{{ book.title }}]]"
date: {{ session.date | date("%Y-%m-%d") }}
duration_minutes: {{ session.durationMinutes }}
pages_read: {{ session.pagesRead }}
start_progress: {{ session.startProgress }}
end_progress: {{ session.endProgress }}
---

# Reading Session: {{ book.title }}

**Date:** {{ session.date | date("%Y-%m-%d") }}
**Duration:** {{ session.durationMinutes }} minutes
**Progress:** {{ session.startProgress }}% → {{ session.endProgress }}%

{% persist "sessionNotes" %}
## Session Notes

(Add your notes from this reading session here)
{% endpersist %}
`;

// =============================================================================
// Default Template Settings (Updated folder structure per plan)
// =============================================================================

/**
 * Default template settings with folder structure:
 * - Books: Main book notes (synced with Calibre)
 * - Highlight Hubs: Highlight collections per book
 * - Note Hubs: Note collections per book
 * - Highlights: Atomic highlights (individual files)
 * - Notes: Atomic notes (individual files)
 *
 * Note: These folder paths are defaults and can be customized in settings.
 */
export const DEFAULT_TEMPLATE_SETTINGS: TemplateSettings = {
  bookNote: {
    enabled: true,
    template: DEFAULT_BOOK_NOTE_TEMPLATE,
    folder: 'Library/Books',
  },
  hubHighlights: {
    enabled: true,
    template: DEFAULT_HUB_HIGHLIGHTS_TEMPLATE,
    folder: 'Library/Highlight Hubs',
  },
  hubNotes: {
    enabled: true,
    template: DEFAULT_HUB_NOTES_TEMPLATE,
    folder: 'Library/Note Hubs',
  },
  atomicHighlight: {
    enabled: false, // Disabled by default, advanced feature
    template: DEFAULT_ATOMIC_HIGHLIGHT_TEMPLATE,
    folder: 'Library/Highlights',
  },
  atomicNote: {
    enabled: false, // Disabled by default, advanced feature
    template: DEFAULT_ATOMIC_NOTE_TEMPLATE,
    folder: 'Library/Notes',
  },
  authorIndex: {
    enabled: true,
    template: DEFAULT_AUTHOR_INDEX_TEMPLATE,
    folder: 'Library/Authors',
  },
  seriesIndex: {
    enabled: true,
    template: DEFAULT_SERIES_INDEX_TEMPLATE,
    folder: 'Library/Series',
  },
  shelfIndex: {
    enabled: true,
    template: DEFAULT_SHELF_INDEX_TEMPLATE,
    folder: 'Library/Shelves',
  },
};
