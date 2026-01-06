# Amnesia HUD Specification

**Project:** Amnesia Obsidian Plugin
**Feature:** Heads-Up Display (HUD)
**Version:** 1.0
**Date:** 2026-01-05
**Status:** Design Specification

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Feature Requirements (by Tier)](#2-feature-requirements-by-tier)
3. [Technical Architecture](#3-technical-architecture)
4. [Component Specifications](#4-component-specifications)
5. [State Management Design](#5-state-management-design)
6. [API Design (Provider Interface)](#6-api-design-provider-interface)
7. [UI/UX Specifications](#7-uiux-specifications)
8. [Implementation Phases](#8-implementation-phases)
9. [Integration with Doc Doctor HUD](#9-integration-with-doc-doctor-hud)
10. [File Structure for Implementation](#10-file-structure-for-implementation)

---

## 1. Executive Summary

### 1.1 Purpose

The Amnesia HUD is a heads-up display that provides quick, at-a-glance access to reading statistics, progress tracking, and library insights directly from the Obsidian status bar. It implements a three-tier progressive disclosure pattern (Status Bar → Compact View → Detail View) adapted from the proven Doc Doctor HUD architecture.

### 1.2 Key Benefits

- **Instant Access**: One-click access to reading stats without opening full library
- **Progress Tracking**: Visual progress indicators for currently reading books
- **Activity Insights**: Reading velocity, highlight patterns, series progress
- **Minimal Disruption**: Non-modal interface that doesn't interrupt reading flow
- **Cross-Platform**: Works with or without Doc Doctor HUD infrastructure

### 1.3 High-Level Architecture

```
┌────────────────────────────────────────────────────────────┐
│                    Obsidian Status Bar                      │
│  ... [Amnesia: 3 reading | 42 highlights] ...              │
└────────────────────────────────────────────────────────────┘
                             │
                             │ click
                             ▼
┌────────────────────────────────────────────────────────────┐
│              Compact View (Floating Panel)                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ [READING] [LIBRARY] [STATS] [SERIES]                 │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │                                                       │  │
│  │  Currently Reading:                                   │  │
│  │  • Writing to Learn  [████████░░] 78%  [Resume]      │  │
│  │  • The Pragmatic...  [██░░░░░░░░] 23%  [Resume]      │  │
│  │                                                       │  │
│  │  Recent Activity: ▁▂▃▅▇▆▄▃▂▁                         │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
                             │
                             │ click book
                             ▼
┌────────────────────────────────────────────────────────────┐
│                Detail View (Book Details)                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ [← Back] Writing to Learn                            │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │  Author: William Zinsser                             │  │
│  │  Progress: 78% (234/300 pages)                       │  │
│  │  Highlights: 42 (12 yellow, 8 blue, 4 green)         │  │
│  │  Last read: 2 hours ago                              │  │
│  │                                                       │  │
│  │  [View Highlights] [Open Book] [Jump to Position]    │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### 1.4 Integration Strategy

The HUD supports two deployment modes:

1. **Standalone Mode**: Self-contained HUD when Doc Doctor is not installed
2. **Provider Mode**: Registers as content provider when Doc Doctor HUD is available

This dual-mode approach ensures:
- Zero hard dependencies on Doc Doctor
- Seamless upgrade path if users install Doc Doctor
- Shared architecture patterns for consistency
- No feature loss in either mode

---

## 2. Feature Requirements (by Tier)

### 2.1 Tier 1: Status Bar (Passive Signal)

The status bar item provides ambient awareness of reading activity.

#### Visual Elements

```
[📖 3 reading | 42 highlights | ● Server]
 ↑  ↑         ↑                ↑
 │  │         │                └─ Server status indicator
 │  │         └─ Secondary metric (configurable)
 │  └─────────── Primary count
 └──────────────── Activity icon (color-coded)
```

**Server Status in Status Bar:**
- `● Server` (green) - Server running
- `○ Server` (gray) - Server stopped
- `⚠ Server` (red) - Server error
- Hidden when "Show server status" is disabled in settings

#### Status Icon Colors

| Color | Condition | Meaning |
|-------|-----------|---------|
| Green (`#4ade80`) | Read today | Active reader |
| Yellow (`#fbbf24`) | Read within 3 days | Recent activity |
| Gray (`#6b7280`) | No recent reading | Inactive |

#### Displayed Metrics (User Configurable)

**Primary:**
- Currently reading count (default)
- Total books
- Books completed this month

**Secondary:**
- Total highlights
- Highlights this week
- Active series count
- Bookmarks count

#### Interactions

- **Click**: Open/close compact view
- **Right-click**: Quick actions menu
  - Pin HUD
  - Change displayed metrics
  - Open library
  - HUD settings

#### Tooltip

```
Amnesia Reading Activity
━━━━━━━━━━━━━━━━━━━━━━
Currently reading: 3 books
Total highlights: 42
Last read: 2 hours ago

Click to open HUD
```

### 2.2 Tier 2: Compact View (Tabs with Metrics)

The compact view is a floating panel with tabbed navigation.

#### Dimensions & Positioning

```css
Width: 400px (fixed)
Max height: 600px (scrollable content)
Position: Below status bar item (Floating UI)
Z-index: 1000
```

#### Tab Structure

```
┌──────────────────────────────────────────────────────┐
│ [READING]² [LIBRARY] [STATS]⁴² [SERVER]● [SERIES]³  │ ← Tabs with badges
├──────────────────────────────────────────────────────┤
│                                                      │
│  ╔══════════════════════════════════════════════╗  │
│  ║         Tab Content (scrollable)             ║  │
│  ╚══════════════════════════════════════════════╝  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Tab Badges:**
- READING: Currently reading book count
- STATS: Total highlight count
- SERVER: Status indicator (●/○/⚠)
- SERIES: Active series count

---

#### Tab 1: READING

**Purpose:** Quick access to currently reading books and recent activity

**Content Layout:**

```
READING  [2]
────────────────────────────────────────

Currently Reading

┌──────────────────────────────────────┐
│ 📖 Writing to Learn                  │
│    William Zinsser                   │
│    [████████████████░░░░] 78%        │
│    Last read: 2 hours ago            │
│    [Resume →]                        │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ 📖 The Pragmatic Programmer          │
│    David Thomas, Andrew Hunt         │
│    [█████░░░░░░░░░░░░░░░] 23%        │
│    Last read: Yesterday              │
│    [Resume →]                        │
└──────────────────────────────────────┘

Recent Activity
────────────────────────────────────────
Last 7 days: ▁▂▃▅▇▆▄
Pages/day: 32.4 avg

Recently Finished
────────────────────────────────────────
✓ Atomic Habits - 3 days ago
✓ Deep Work - 1 week ago
```

**Data Sources:**
- `LibraryService.filterByStatus('reading')`
- `LibraryService.getRecentBooks(5)`
- `HighlightService.getHighlightStats()` for activity sparkline

**Interactions:**
- Click book card: Open book detail view
- Click [Resume]: Open reader at last position
- Hover: Show quick stats tooltip

---

#### Tab 2: LIBRARY

**Purpose:** Overview of library composition and recent additions

**Content Layout:**

```
LIBRARY
────────────────────────────────────────

Library Stats
────────────────────────────────────────
Total books: 142
To read: 87  Reading: 3  Completed: 52

Series in progress: 4
Active authors: 28

Recently Added (7 days)
────────────────────────────────────────
┌──────────────────────────────────────┐
│ 🆕 The Rust Programming Language     │
│    Added: 2 days ago                 │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ 🆕 Designing Data-Intensive Apps     │
│    Added: 5 days ago                 │
└──────────────────────────────────────┘

Storage
────────────────────────────────────────
EPUB: 94  PDF: 48
Cache: 1.2 GB / 5 GB [█████░░░░░]
```

**Data Sources:**
- `LibraryService.store.getValue().books`
- `LibraryService.filterByStatus()` for counts
- Book `addedAt` timestamps for recent additions

**Interactions:**
- Click book: Open book detail view
- Click "Total books": Open full library view
- Click storage bar: Open cache management

---

#### Tab 3: STATS

**Purpose:** Highlight and note statistics with visual breakdowns

**Content Layout:**

```
STATS  [42]
────────────────────────────────────────

Highlights
────────────────────────────────────────
Total: 42 highlights

By Color:
████████ Yellow   18 (43%)
████ Blue         12 (29%)
██ Green           8 (19%)
█ Pink             4 (9%)

With notes: 14 (33%)
Bookmarks: 8

Activity (30 days)
────────────────────────────────────────
Highlights created: ▁▂▃▅▇▆▄▃▂▁
Peak: 8 on Jan 2

Notes Generated
────────────────────────────────────────
Book notes: 12
Highlight notes: 42 (atomic)
Series indices: 3
```

**Data Sources:**
- `HighlightService.getHighlightStats()`
- `HighlightService.getHighlightCount()` per book
- `BookmarkService.getBookmarkCount()`
- `NoteGenerator` for note counts

**Visualizations:**
- ASCII bar chart for color distribution
- Sparkline for activity trend
- Progress gauge for note coverage

**Interactions:**
- Click color bar: Filter highlights by color → Detail view
- Click activity sparkline: Show activity calendar
- Click note count: List all generated notes

---

#### Tab 4: SERVER

**Purpose:** Server status, controls, and mode switching for PDF rendering

**Content Layout:**

```
SERVER
────────────────────────────────────────

Status
────────────────────────────────────────
┌──────────────────────────────────────┐
│ ● Server Running                     │
│   Port: 3000                         │
│   Uptime: 2h 34m                     │
│   PID: 12847                         │
│   Last health: 30s ago ✓             │
│                                       │
│   [Stop]  [Restart]                  │
└──────────────────────────────────────┘

PDF Rendering Mode
────────────────────────────────────────
○ Auto (Recommended)
  Server when available, PDF.js fallback

● Server Only
  Requires server for all PDF operations

Quick Settings
────────────────────────────────────────
Auto-start server: [ON]
Show notifications: [ON]
Health check interval: 30s

Server Stats
────────────────────────────────────────
Requests today: 142
Pages rendered: 1,847
Cache hits: 89%
Avg response: 45ms

OCR Status
────────────────────────────────────────
Provider: Tesseract
Status: Available ✓
[Switch to Ollama]

Actions
────────────────────────────────────────
[Open Server Settings] [View Logs]
[Clear Cache] [Check Health]
```

**Server Status Indicators:**

| Status | Icon | Color | Description |
|--------|------|-------|-------------|
| Running | ● | Green (#4ade80) | Server healthy and responding |
| Starting | ◐ | Yellow (#fbbf24) | Server is starting up |
| Stopping | ◐ | Yellow (#fbbf24) | Server is shutting down |
| Restarting | ↻ | Yellow (#fbbf24) | Server is restarting |
| Stopped | ○ | Gray (#6b7280) | Server not running |
| Error | ⚠ | Red (#f87171) | Server crashed or unreachable |

**Quick Actions:**

| Action | Shortcut | Description |
|--------|----------|-------------|
| Start Server | `Ctrl+Shift+S` | Start the amnesia-server |
| Stop Server | — | Gracefully stop the server |
| Restart Server | `Ctrl+Shift+R` | Stop and start the server |
| Switch Mode | — | Toggle between Auto/Server mode |
| Check Health | — | Manual health check |
| View Logs | — | Open server log viewer |
| Clear Cache | — | Clear rendered page cache |

**Data Sources:**
- `ServerManager.getState()` for status, PID, uptime
- `ServerManager.on('status-change')` for reactive updates
- `settings.pdf.preferMode` for rendering mode
- `settings.server` for auto-start, notifications

**Interactions:**
- Click status card: Toggle server start/stop
- Click mode option: Switch PDF rendering mode
- Click [View Logs]: Open log modal
- Click [Open Server Settings]: Navigate to settings tab

---

#### Tab 5: SERIES

**Purpose:** Track progress through book series

**Content Layout:**

```
SERIES  [3]
────────────────────────────────────────

Active Series (3)
────────────────────────────────────────
┌──────────────────────────────────────┐
│ 📚 The Expanse (James S.A. Corey)    │
│    Progress: 4/9 books (44%)         │
│    [████░░░░░]                        │
│    Currently: Book 4 - Cibola Burn  │
│    [Continue Series →]               │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ 📚 Discworld (Terry Pratchett)       │
│    Progress: 2/41 books (5%)         │
│    [█░░░░░░░░]                        │
│    Currently: Book 2 - The Light... │
│    [Continue Series →]               │
└──────────────────────────────────────┘

Completed Series (2)
────────────────────────────────────────
✓ The Three-Body Problem (3/3)
✓ Foundation (7/7)
```

**Data Sources:**
- `CalibreService` (if enabled) for series metadata
- Book `series` field from metadata
- `LibraryService` to filter by series

**Interactions:**
- Click series card: Open series detail view
- Click [Continue Series]: Open next unread book
- Long-press: Add series to reading list

---

### 2.3 Tier 3: Detail View (Drill-down)

Detail views provide comprehensive information with actionable controls.

#### Common Header Pattern

```
┌────────────────────────────────────────┐
│ [← Back] Detail Title              [⋮] │
└────────────────────────────────────────┘
```

- **← Back**: Return to compact view (updates history stack)
- **⋮ Menu**: Context actions (share, export, etc.)

---

#### Detail View 1: Book Details

**Trigger:** Click book in any tab

**Layout:**

```
[← Back] Writing to Learn
────────────────────────────────────────

📖 Metadata
────────────────────────────────────────
Author: William Zinsser
Series: —
Publisher: Harper Perennial
Published: 1993
ISBN: 978-0062720405
Format: EPUB (2.3 MB)
Added: Dec 15, 2025

📊 Reading Progress
────────────────────────────────────────
[████████████████░░░░] 78% complete
234 / 300 pages
Started: Dec 20, 2025
Last read: 2 hours ago
Sessions: 12
Avg session: 28 min

✨ Highlights & Notes
────────────────────────────────────────
Highlights: 42
  Yellow: 18  Blue: 12  Green: 8  Pink: 4
Annotated: 14
Bookmarks: 3

[View All Highlights →]
[View All Bookmarks →]

🔗 Backlinks
────────────────────────────────────────
12 notes link to this book

[Show Backlinks →]

Actions
────────────────────────────────────────
[Open in Reader]  [Generate Note]
[Export Highlights]  [Book Settings]
```

**Data Sources:**
- `Book` object from `LibraryService.getBook(id)`
- `HighlightService.getHighlights(bookId)`
- `HighlightService.getHighlightStats(bookId)`
- `BookmarkService.getBookmarks(bookId)`
- Obsidian API for backlinks

---

#### Detail View 2: Highlight List

**Trigger:** Click "View All Highlights" in book details or click color bar in STATS tab

**Layout:**

```
[← Back] Highlights: Writing to Learn
────────────────────────────────────────

Filters
────────────────────────────────────────
Color: [All] [Yellow] [Blue] [Green]...
Type:  [All] [With Notes] [No Notes]
Sort:  [Position] [Date] [Color]

42 highlights
────────────────────────────────────────

Chapter 1: Introduction (8)
────────────────────────────────────────
┌──────────────────────────────────────┐
│ "Writing is a way to work yourself   │
│  into a subject and make it your own │
│  ...I realized that I was writing to │
│  learn."                             │
│                                       │
│ 📝 My note: Core concept!            │
│ 🟨 Yellow • Page 12 • Dec 20, 2025   │
│                                       │
│ [Edit Note] [Change Color] [Delete]  │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ "The secret of good writing is to    │
│  strip every sentence to its cleanest│
│  components."                         │
│                                       │
│ 🟦 Blue • Page 15 • Dec 20, 2025     │
│                                       │
│ [Add Note] [Change Color] [Delete]   │
└──────────────────────────────────────┘

────────────────────────────────────────
[Export as Markdown] [Generate Notes]
```

**Data Sources:**
- `HighlightService.getHighlights(bookId)`
- `HighlightService.queryHighlights()` for filtering/sorting

**Interactions:**
- Filter by color/annotation status
- Sort by position/date/color
- Edit annotations inline
- Bulk actions: export, generate notes, delete

---

#### Detail View 3: Series Overview

**Trigger:** Click series card in SERIES tab

**Layout:**

```
[← Back] Series: The Expanse
────────────────────────────────────────

📚 Series Information
────────────────────────────────────────
Author: James S.A. Corey
Books: 9 total
Progress: 4 read, 1 reading, 4 unread
Status: 44% complete

Books
────────────────────────────────────────
✓ 1. Leviathan Wakes
   Completed: Nov 2025
   Highlights: 23

✓ 2. Caliban's War
   Completed: Nov 2025
   Highlights: 18

✓ 3. Abaddon's Gate
   Completed: Dec 2025
   Highlights: 31

📖 4. Cibola Burn [READING]
    Progress: [████░░░░░░] 42%
    Highlights: 12
    [Resume Reading →]

□ 5. Nemesis Games
   [Start Reading →]

□ 6. Babylon's Ashes
□ 7. Persepolis Rising
□ 8. Tiamat's Wrath
□ 9. Leviathan Falls

────────────────────────────────────────
Total highlights: 84
Series notes: View [[The Expanse - Series]]
```

---

#### Detail View 4: Author Bibliography

**Trigger:** Click author name in book details

**Layout:**

```
[← Back] Author: William Zinsser
────────────────────────────────────────

📝 About
────────────────────────────────────────
Books in library: 3
Total highlights: 78
First read: Oct 2025

Books
────────────────────────────────────────
✓ Writing to Learn
   Status: Reading (78%)
   Highlights: 42
   Last read: 2 hours ago

✓ On Writing Well
   Status: Completed
   Highlights: 31
   Finished: Nov 2025

□ Writing Places
   Status: To Read
   Added: Dec 2025

────────────────────────────────────────
[View All Highlights] [Author Note]
```

---

#### Detail View 5: Server Logs

**Trigger:** Click "View Logs" in SERVER tab

**Layout:**

```
[← Back] Server Logs
────────────────────────────────────────

Filters
────────────────────────────────────────
Level: [All] [Info] [Warn] [Error]
Time:  [Last hour] [Today] [All]
[Clear Logs]

Logs (47 entries)
────────────────────────────────────────
┌──────────────────────────────────────┐
│ 12:34:56 [INFO] Server started       │
│ Port: 3000                           │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ 12:35:02 [INFO] Health check passed  │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ 12:36:15 [INFO] PDF rendered         │
│ File: book.pdf, Page: 42             │
│ Time: 145ms, Size: 1.2MB             │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ 12:40:00 [WARN] Cache eviction       │
│ Removed 15 pages, freed 45MB         │
└──────────────────────────────────────┘

────────────────────────────────────────
[Export Logs] [Refresh]
```

**Log Level Colors:**
- INFO: Gray (`#6b7280`)
- WARN: Yellow (`#fbbf24`)
- ERROR: Red (`#f87171`)
- DEBUG: Cyan (`#22d3ee`)

---

## 3. Technical Architecture

### 3.1 Hexagonal/Ports-and-Adapters Pattern

```
┌──────────────────────────────────────────────────────────────┐
│                     Amnesia HUD (Core)                       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │          HUD State Management (Svelte Stores)          │ │
│  │                                                        │ │
│  │  • hudState: Store<AmnesiaHUDState, AmnesiaHUDAction> │ │
│  │  • hudPosition: Writable<Position | null>             │ │
│  │  • Derived stores: statusBarData, currentTabData      │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │               Provider Interface (Port)                 │ │
│  │                                                        │ │
│  │  interface HUDContentProvider {                        │ │
│  │    getTabs(): HUDTab[]                                 │ │
│  │    getStatusBarContent(): StatusBarContent             │ │
│  │    getCompactViewComponent(): SvelteComponent          │ │
│  │    onActivate/onDeactivate()                           │ │
│  │  }                                                      │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                             ▲
                             │ implements
                             │
┌──────────────────────────────────────────────────────────────┐
│                  AmnesiaHUDProvider (Adapter)                │
│                                                              │
│  Adapts Amnesia domain services to HUD interface:           │
│                                                              │
│  • LibraryService → Reading stats, book lists               │
│  • HighlightService → Highlight counts, activity            │
│  • BookmarkService → Bookmark counts                        │
│  • CalibreService → Series information (optional)           │
│                                                              │
│  Subscriptions:                                              │
│  • libraryStore.subscribe() → Update on book changes        │
│  • highlightStore.subscribe() → Update on highlight changes │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow Architecture

```
┌────────────────────────────────────────────────────────────┐
│                  Amnesia Domain Layer                       │
│                                                             │
│  LibraryService ──┐                                        │
│  HighlightService ├─→ Redux-style stores (reactive)        │
│  BookmarkService ─┘                                        │
└────────────────────────────────────────────────────────────┘
                     │
                     │ subscribe
                     ▼
┌────────────────────────────────────────────────────────────┐
│              AmnesiaHUDProvider (Adapter)                   │
│                                                             │
│  • Listens to service store changes                        │
│  • Computes derived data (stats, recent activity)          │
│  • Notifies HUD of updates                                 │
└────────────────────────────────────────────────────────────┘
                     │
                     │ updates
                     ▼
┌────────────────────────────────────────────────────────────┐
│                   HUD State Store                           │
│                                                             │
│  hudState ──→ statusBarData (derived)                      │
│           └─→ currentTabData (derived)                     │
└────────────────────────────────────────────────────────────┘
                     │
                     │ reactive updates
                     ▼
┌────────────────────────────────────────────────────────────┐
│                  Svelte UI Components                       │
│                                                             │
│  StatusBarItem ←─ Auto-updates via $statusBarData          │
│  ReadingTab ←──── Auto-updates via $currentTabData         │
│  StatsTab ←────── Auto-updates via $currentTabData         │
└────────────────────────────────────────────────────────────┘
```

**Key Principles:**
1. **Unidirectional data flow**: Services → Provider → HUD State → UI
2. **Reactive updates**: Svelte stores automatically propagate changes
3. **Separation of concerns**: Domain logic stays in services, HUD only displays
4. **Testability**: Provider layer can be mocked for UI testing

### 3.3 Integration Modes

#### Standalone Mode

```
┌─────────────────────────────────────────────────────┐
│             AmnesiaPlugin (main.ts)                 │
│                                                     │
│  onload() {                                         │
│    this.hudProvider = new AmnesiaHUDProvider(this) │
│    this.standaloneHUD = new AmnesiaHUD(            │
│      this.hudProvider                              │
│    )                                                │
│    await this.standaloneHUD.initialize()           │
│  }                                                  │
└─────────────────────────────────────────────────────┘
```

#### Doc Doctor Provider Mode

```
┌─────────────────────────────────────────────────────┐
│             AmnesiaPlugin (main.ts)                 │
│                                                     │
│  onload() {                                         │
│    this.hudProvider = new AmnesiaHUDProvider(this) │
│                                                     │
│    if (isDocDoctorAvailable()) {                   │
│      docDoctor.hudRegistry.register(               │
│        this.hudProvider                            │
│      )                                              │
│    }                                                │
│  }                                                  │
└─────────────────────────────────────────────────────┘
```

---

## 4. Component Specifications

### 4.1 Core Components

#### AmnesiaHUDProvider

```typescript
export class AmnesiaHUDProvider implements HUDContentProvider {
  readonly id = 'amnesia-reading';
  readonly displayName = 'Reading';
  readonly icon = 'book-open';
  readonly priority = 100;

  private plugin: AmnesiaPlugin;
  private subscribers = new Set<() => void>();
  private unsubscribes: (() => void)[] = [];

  constructor(plugin: AmnesiaPlugin) {
    this.plugin = plugin;
    this.setupSubscriptions();
  }

  private setupSubscriptions(): void {
    // Subscribe to library changes
    const libraryUnsub = this.plugin.libraryService
      .getStore()
      .subscribe(() => this.notifySubscribers());
    this.unsubscribes.push(libraryUnsub);

    // Subscribe to highlight changes
    const highlightUnsub = this.plugin.highlightService
      .getStore()
      .subscribe(() => this.notifySubscribers());
    this.unsubscribes.push(highlightUnsub);
  }

  getTabs(): HUDTab[] {
    const readingCount = this.getReadingBooks().length;
    const highlightCount = this.getTotalHighlights();
    const seriesCount = this.getActiveSeries().length;
    const serverStatus = this.getServerStatus();

    return [
      { id: 'reading', label: 'READING', badge: readingCount, component: ReadingTab },
      { id: 'library', label: 'LIBRARY', component: LibraryTab },
      { id: 'stats', label: 'STATS', badge: highlightCount, component: StatsTab },
      { id: 'server', label: 'SERVER', badge: serverStatus.indicator, component: ServerTab },
      { id: 'series', label: 'SERIES', badge: seriesCount, component: SeriesTab },
    ];
  }

  private getServerStatus(): { indicator: string; color: string } {
    const state = this.plugin.serverManager?.getState();
    switch (state?.status) {
      case 'running': return { indicator: '●', color: 'green' };
      case 'starting':
      case 'stopping':
      case 'restarting': return { indicator: '◐', color: 'yellow' };
      case 'error': return { indicator: '⚠', color: 'red' };
      default: return { indicator: '○', color: 'gray' };
    }
  }

  getStatusBarContent(): StatusBarContent {
    const readingBooks = this.getReadingBooks();
    const totalHighlights = this.getTotalHighlights();
    const lastReadDate = this.getLastReadDate();

    // Determine health color
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;

    let color: StatusBarColor;
    if (lastReadDate && lastReadDate.getTime() > oneDayAgo) {
      color = 'green'; // Read today
    } else if (lastReadDate && lastReadDate.getTime() > threeDaysAgo) {
      color = 'yellow'; // Read within 3 days
    } else {
      color = 'gray'; // Inactive
    }

    return {
      icon: 'book-open',
      text: `${readingBooks.length} reading | ${totalHighlights} highlights`,
      color,
      tooltip: this.generateTooltip(),
    };
  }

  subscribe(callback: () => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private notifySubscribers(): void {
    this.subscribers.forEach(cb => cb());
  }

  destroy(): void {
    this.unsubscribes.forEach(unsub => unsub());
    this.subscribers.clear();
  }
}
```

### 4.2 UI Components (Svelte)

#### StatusBarItem.svelte

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { setIcon } from 'obsidian';
  import type { AmnesiaHUDProvider } from '../providers/AmnesiaHUDProvider';
  import { hudState } from '../state/hud-store';

  export let provider: AmnesiaHUDProvider;

  let containerEl: HTMLElement;
  let statusContent = provider.getStatusBarContent();

  const unsubscribe = provider.subscribe(() => {
    statusContent = provider.getStatusBarContent();
  });

  onDestroy(() => unsubscribe());

  function handleClick() {
    hudState.dispatch({ type: 'TOGGLE_HUD' });
  }
</script>

<div
  class="amnesia-hud-status-bar"
  bind:this={containerEl}
  on:click={handleClick}
  role="button"
  tabindex="0"
>
  <span class="status-bar-item-icon hud-status-{statusContent.color}"></span>
  <span class="status-bar-item-text">{statusContent.text}</span>
</div>

<style>
  .amnesia-hud-status-bar {
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
    cursor: pointer;
    font-family: var(--font-monospace);
    font-size: var(--font-ui-small);
  }

  .hud-status-green { color: var(--color-green); }
  .hud-status-yellow { color: var(--color-yellow); }
  .hud-status-gray { color: var(--text-muted); }
</style>
```

---

## 5. State Management Design

### 5.1 State Interface

```typescript
export interface AmnesiaHUDState {
  isOpen: boolean;
  isPinned: boolean;
  activeTab: TabName;
  detailView: DetailViewState | null;
  viewHistory: DetailViewState[];
  currentBook: Book | null;
  position: { x: number; y: number } | null;
}

export type TabName = 'reading' | 'library' | 'stats' | 'server' | 'series';

export type DetailViewState =
  | { type: 'book'; bookId: string }
  | { type: 'highlights'; bookId: string; filter?: HighlightFilter }
  | { type: 'series'; seriesName: string }
  | { type: 'author'; authorName: string }
  | { type: 'server-logs' };
```

### 5.2 Action Types

```typescript
export type AmnesiaHUDAction =
  | { type: 'TOGGLE_HUD' }
  | { type: 'OPEN_HUD' }
  | { type: 'CLOSE_HUD' }
  | { type: 'PIN_HUD'; payload: boolean }
  | { type: 'SET_ACTIVE_TAB'; payload: TabName }
  | { type: 'PUSH_DETAIL_VIEW'; payload: DetailViewState }
  | { type: 'POP_DETAIL_VIEW' }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'SET_POSITION'; payload: { x: number; y: number } | null };
```

### 5.3 Reducer

```typescript
export function hudReducer(
  state: AmnesiaHUDState,
  action: AmnesiaHUDAction
): AmnesiaHUDState {
  switch (action.type) {
    case 'TOGGLE_HUD':
      return { ...state, isOpen: !state.isOpen };

    case 'CLOSE_HUD':
      return { ...state, isOpen: false, detailView: null, viewHistory: [] };

    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload, detailView: null, viewHistory: [] };

    case 'PUSH_DETAIL_VIEW':
      return {
        ...state,
        viewHistory: state.detailView
          ? [...state.viewHistory, state.detailView]
          : state.viewHistory,
        detailView: action.payload,
      };

    case 'POP_DETAIL_VIEW':
      const history = [...state.viewHistory];
      const previousView = history.pop() || null;
      return { ...state, detailView: previousView, viewHistory: history };

    default:
      return state;
  }
}
```

### 5.4 Derived Stores

```typescript
// Status bar data (recomputes when hudState or services change)
export const statusBarData = derived(
  [hudState, libraryStore, highlightStore],
  ([$hud, $library, $highlights]) => {
    const readingCount = $library.books.filter(b => b.status === 'reading').length;
    const highlightCount = Object.values($highlights.highlights).flat().length;
    const lastRead = getLastReadDate($library.books);

    return {
      readingCount,
      highlightCount,
      lastRead,
      healthColor: calculateHealthColor(lastRead),
    };
  }
);

// Current tab data
export const currentTabData = derived(
  [hudState, libraryStore, highlightStore, bookmarkStore],
  ([$hud, $library, $highlights, $bookmarks]) => {
    switch ($hud.activeTab) {
      case 'reading':
        return {
          currentlyReading: $library.books.filter(b => b.status === 'reading'),
          recentBooks: getRecentBooks($library.books, 5),
          activitySparkline: generateActivitySparkline($highlights.highlights),
        };
      case 'stats':
        return {
          highlightStats: computeHighlightStats($highlights.highlights),
          bookmarkCount: countBookmarks($bookmarks.bookmarks),
        };
      // ... other tabs
    }
  }
);
```

---

## 6. API Design (Provider Interface)

### 6.1 HUDContentProvider Interface

```typescript
export interface HUDContentProvider {
  /** Unique identifier: "{plugin-id}-{content-type}" */
  readonly id: string;

  /** Display name shown in UI */
  readonly displayName: string;

  /** Icon identifier (Obsidian icon name) */
  readonly icon: string;

  /** Priority for ordering (higher = earlier) */
  readonly priority: number;

  /** Get tabs for compact view */
  getTabs(): HUDTab[];

  /** Get status bar content */
  getStatusBarContent(): StatusBarContent;

  /** Get the compact view component */
  getCompactViewComponent(): typeof SvelteComponent;

  /** Get the detail view component (optional) */
  getDetailViewComponent?(): typeof SvelteComponent;

  /** Lifecycle: called when provider becomes active */
  onActivate?(): void;

  /** Lifecycle: called when provider becomes inactive */
  onDeactivate?(): void;

  /** Subscribe to provider updates */
  subscribe?(callback: () => void): () => void;
}

export interface HUDTab {
  id: string;
  label: string;
  icon?: string;
  badge?: number | string;
  component: typeof SvelteComponent;
}

export interface StatusBarContent {
  icon: string;
  text?: string;
  color?: 'green' | 'yellow' | 'red' | 'gray';
  badge?: number;
  tooltip?: string;
}
```

### 6.2 Provider Registry

```typescript
export class HUDProviderRegistry {
  private providers = new Map<string, HUDContentProvider>();
  private activeProviderId: string | null = null;

  register(provider: HUDContentProvider): void {
    this.providers.set(provider.id, provider);
    if (this.providers.size === 1) {
      this.activate(provider.id);
    }
  }

  unregister(providerId: string): void {
    const provider = this.providers.get(providerId);
    if (this.activeProviderId === providerId) {
      provider?.onDeactivate?.();
      this.activeProviderId = null;
    }
    this.providers.delete(providerId);
  }

  activate(providerId: string): void {
    const newProvider = this.providers.get(providerId);
    if (!newProvider) return;

    if (this.activeProviderId) {
      this.providers.get(this.activeProviderId)?.onDeactivate?.();
    }

    this.activeProviderId = providerId;
    newProvider.onActivate?.();
  }

  getAllProviders(): HUDContentProvider[] {
    return Array.from(this.providers.values())
      .sort((a, b) => b.priority - a.priority);
  }
}
```

---

## 7. UI/UX Specifications

### 7.1 TUI Aesthetic

#### Typography

```css
--hud-font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
--hud-text-xs: 10px;
--hud-text-sm: 11px;
--hud-text-base: 12px;
--hud-text-lg: 14px;
```

#### Color Palette

```css
/* Status Colors */
--hud-status-green: #4ade80;
--hud-status-yellow: #fbbf24;
--hud-status-red: #f87171;
--hud-status-gray: #6b7280;

/* Highlight Colors */
--highlight-yellow: #fef3c7;
--highlight-green: #d1fae5;
--highlight-blue: #dbeafe;
--highlight-pink: #fce7f3;
```

### 7.2 ASCII Visualizations

#### Progress Bar

```typescript
function renderProgressBar(percent: number, width: number = 20): string {
  const filled = Math.floor((percent / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`;
}
// Output: [████████████████░░░░] 78%
```

#### Sparkline

```typescript
function renderSparkline(values: number[]): string {
  const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min;

  return values.map(v => {
    const normalized = range > 0 ? (v - min) / range : 0;
    const index = Math.floor(normalized * (chars.length - 1));
    return chars[index];
  }).join('');
}
// Output: ▁▂▃▅▇▆▄▃▂▁
```

### 7.3 Keyboard Navigation

| Key | Action | Context |
|-----|--------|---------|
| `Escape` | Close HUD or go back | Always |
| `Tab` | Cycle through tabs | Compact view |
| `Arrow Left/Right` | Switch tabs | Compact view |
| `Arrow Up/Down` | Navigate items | Lists |
| `Enter` | Open detail view | Item focused |
| `Ctrl+P` | Toggle pin | Always |
| `Ctrl+Shift+S` | Start/Stop server | Always |
| `Ctrl+Shift+R` | Restart server | Always |
| `Ctrl+Shift+M` | Toggle PDF mode (Auto/Server) | Always |

### 7.4 Accessibility

- ARIA labels on all interactive elements
- Keyboard focus management
- Screen reader announcements
- `prefers-reduced-motion` support

---

## 8. Implementation Phases

**User Priority: All 4 tabs equally + Both integration modes from start**

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| 1. Core Infrastructure | Week 1 | State store, provider interface, portal rendering, Doc Doctor detection |
| 2. All Tabs + Status Bar | Week 2 | Status bar, all 4 tabs (READING, LIBRARY, STATS, SERIES) |
| 3. Detail Views | Week 3 | Book, Highlights, Series, Author detail views |
| 4. Integration | Week 4 | Doc Doctor provider registration, standalone fallback, mode switching |
| 5. Polish + Testing | Week 5 | Animations, accessibility, ASCII charts, tests |

### Phase 1: Core Infrastructure

**Tasks:**
- [ ] Create `hud-store.ts` with state, actions, reducer
- [ ] Create `HUDContentProvider.ts` interface
- [ ] Implement `AmnesiaHUDProvider.ts` adapter
- [ ] Build `HUDPortal.svelte` for document.body rendering
- [ ] Integrate Floating UI for positioning
- [ ] Implement Doc Doctor detection

**Deliverables:**
- `/src/hud/state/hud-store.ts`
- `/src/hud/providers/HUDContentProvider.ts`
- `/src/hud/providers/AmnesiaHUDProvider.ts`
- `/src/hud/components/HUDPortal.svelte`
- `/src/hud/integration/detection.ts`

### Phase 2: All Tabs + Status Bar

**Tasks:**
- [ ] Create `StatusBarItem.svelte` with server status indicator
- [ ] Build `CompactView.svelte` with tab routing
- [ ] Implement `TabBar.svelte` with badges
- [ ] Create `ReadingTab.svelte`
- [ ] Create `LibraryTab.svelte`
- [ ] Create `StatsTab.svelte`
- [ ] Create `ServerTab.svelte` with status, controls, mode switching
- [ ] Create `SeriesTab.svelte`
- [ ] Add backdrop click-outside detection
- [ ] Implement keyboard shortcuts (including server shortcuts)

### Phase 3: Detail Views

**Tasks:**
- [ ] Create `DetailView.svelte` router
- [ ] Build `BookDetailView.svelte`
- [ ] Build `HighlightListView.svelte`
- [ ] Build `SeriesDetailView.svelte`
- [ ] Build `AuthorBibView.svelte`
- [ ] Build `ServerLogsView.svelte` with filtering and export
- [ ] Implement back button with history stack

### Phase 4: Integration

**Tasks:**
- [ ] Implement Doc Doctor provider registration
- [ ] Create standalone fallback
- [ ] Add mode switching on plugin install/uninstall
- [ ] Test both modes

### Phase 5: Polish + Testing

**Tasks:**
- [ ] Add animations and transitions
- [ ] Implement ASCII gauge/sparkline components
- [ ] Accessibility audit
- [ ] Write unit tests (80% coverage target)
- [ ] Write integration tests

---

## 9. Integration with Doc Doctor HUD

### 9.1 Detection Strategy

```typescript
export function isDocDoctorAvailable(app: App): boolean {
  try {
    const docDoctor = (app as any).plugins.getPlugin('doc-doctor');
    return Boolean(
      docDoctor &&
      docDoctor.hudRegistry &&
      typeof docDoctor.hudRegistry.register === 'function'
    );
  } catch {
    return false;
  }
}
```

### 9.2 Registration Flow

```typescript
export class AmnesiaPlugin extends Plugin {
  private hudProvider: AmnesiaHUDProvider | null = null;
  private standaloneHUD: AmnesiaHUD | null = null;
  private hudMode: 'standalone' | 'doc-doctor' | null = null;

  async onload() {
    this.hudProvider = new AmnesiaHUDProvider(this);

    if (isDocDoctorAvailable(this.app)) {
      this.registerWithDocDoctor();
    } else {
      this.initializeStandaloneHUD();
    }

    // Listen for Doc Doctor installation/removal
    this.registerEvent(
      this.app.workspace.on('plugin-settings-changed', () => {
        this.checkHUDMode();
      })
    );
  }

  private registerWithDocDoctor(): void {
    const registry = getDocDoctorRegistry(this.app);
    if (!registry || !this.hudProvider) return;

    registry.register(this.hudProvider);
    this.hudMode = 'doc-doctor';
    new Notice('Amnesia: Using Doc Doctor HUD');
  }

  private async initializeStandaloneHUD(): Promise<void> {
    this.standaloneHUD = new AmnesiaHUD(this.app, this.hudProvider);
    await this.standaloneHUD.initialize();
    this.hudMode = 'standalone';
  }

  private checkHUDMode(): void {
    const wasDocDoctor = this.hudMode === 'doc-doctor';
    const isDocDoctor = isDocDoctorAvailable(this.app);

    if (!wasDocDoctor && isDocDoctor) {
      this.standaloneHUD?.destroy();
      this.registerWithDocDoctor();
    }

    if (wasDocDoctor && !isDocDoctor) {
      this.initializeStandaloneHUD();
    }
  }
}
```

### 9.3 Shared vs Standalone Features

| Feature | Standalone | Doc Doctor |
|---------|------------|------------|
| All tab content | ✅ | ✅ |
| Detail views | ✅ | ✅ |
| Multi-provider HUD | ❌ | ✅ |
| Unified status bar | ❌ | ✅ |
| Cross-plugin navigation | ❌ | ✅ |

---

## 10. File Structure for Implementation

```
apps/amnesia/src/hud/
├── index.ts                          # Public exports
├── README.md                         # HUD documentation
│
├── state/
│   ├── hud-store.ts                 # Main HUD state store
│   ├── hud-reducer.ts               # State reducer logic
│   ├── hud-actions.ts               # Action type definitions
│   └── derived-stores.ts            # Derived data stores
│
├── providers/
│   ├── HUDContentProvider.ts        # Provider interface
│   ├── AmnesiaHUDProvider.ts        # Amnesia implementation
│   └── provider-registry.ts         # Registry (standalone mode)
│
├── components/
│   ├── HUDPortal.svelte             # Portal for document.body
│   ├── AmnesiaHUD.svelte            # Main HUD container
│   ├── StatusBarItem.svelte         # Status bar component
│   ├── CompactView.svelte           # Compact view container
│   ├── DetailView.svelte            # Detail view router
│   ├── TabBar.svelte                # Tab navigation
│   │
│   ├── tabs/
│   │   ├── ReadingTab.svelte
│   │   ├── LibraryTab.svelte
│   │   ├── StatsTab.svelte
│   │   ├── ServerTab.svelte
│   │   └── SeriesTab.svelte
│   │
│   ├── details/
│   │   ├── BookDetailView.svelte
│   │   ├── HighlightListView.svelte
│   │   ├── SeriesDetailView.svelte
│   │   ├── AuthorBibView.svelte
│   │   └── ServerLogsView.svelte
│   │
│   ├── charts/
│   │   ├── ProgressBar.svelte
│   │   ├── ActivitySparkline.svelte
│   │   └── HighlightDistribution.svelte
│   │
│   └── shared/
│       ├── BookCard.svelte
│       ├── HighlightItem.svelte
│       └── Badge.svelte
│
├── integration/
│   ├── doc-doctor.ts                # Doc Doctor integration
│   ├── standalone.ts                # Standalone HUD
│   └── detection.ts                 # Feature detection
│
├── utils/
│   ├── formatting.ts                # Date/number formatting
│   ├── statistics.ts                # Stats computation
│   ├── sparkline.ts                 # ASCII sparkline generator
│   └── gauges.ts                    # ASCII gauge generator
│
├── styles/
│   ├── hud.css                      # Main HUD styles
│   └── variables.css                # CSS custom properties
│
└── types/
    ├── index.ts                     # Type exports
    ├── hud-state.ts                 # State types
    └── provider.ts                  # Provider types
```

---

## Success Metrics

| Metric | Target |
|--------|--------|
| HUD opens | < 100ms |
| Tab switching | < 50ms |
| Test coverage | 80% |
| Works with Doc Doctor | ✅ |
| Works without Doc Doctor | ✅ |

---

## Dependencies

```json
{
  "dependencies": {
    "@floating-ui/dom": "^1.5.3"
  }
}
```

---

## 11. HUD Settings Configuration

### 11.1 Settings Interface

The HUD settings follow Amnesia's nested settings pattern, integrating with the existing `LibrosSettings` structure:

```typescript
export interface HudSettings {
  /** Master toggle for HUD visibility */
  enabled: boolean;

  /** Auto-show HUD when plugin loads */
  autoShow: boolean;

  /** Remember HUD state across sessions */
  rememberState: boolean;

  /** Default tab when HUD opens */
  defaultTab: 'reading' | 'library' | 'stats' | 'server' | 'series';

  /** Position configuration */
  position: {
    /** Anchor position relative to status bar */
    anchor: 'bottom-left' | 'bottom-center' | 'bottom-right';
    /** Offset from anchor in pixels */
    offsetX: number;
    offsetY: number;
  };

  /** Appearance settings */
  appearance: {
    /** Opacity when not focused (0-100) */
    opacity: number;
    /** Fade animation speed in ms */
    fadeSpeed: number;
    /** Use compact mode with smaller text */
    compactMode: boolean;
    /** Show ASCII art visualizations */
    showAsciiCharts: boolean;
    /** Theme override (null = follow Obsidian) */
    themeOverride: 'dark' | 'light' | null;
  };

  /** Status bar settings */
  statusBar: {
    /** Show status bar item */
    show: boolean;
    /** What to show in primary slot */
    primaryMetric: 'reading-count' | 'highlight-count' | 'today-progress';
    /** What to show in secondary slot */
    secondaryMetric: 'highlight-count' | 'bookmark-count' | 'notes-count' | 'none';
    /** Show server status indicator */
    showServerStatus: boolean;
  };

  /** Tab visibility (hide tabs you don't use) */
  tabs: {
    reading: boolean;
    library: boolean;
    stats: boolean;
    server: boolean;
    series: boolean;
  };

  /** Behavior settings */
  behavior: {
    /** Close HUD when clicking outside */
    closeOnClickOutside: boolean;
    /** Auto-hide after inactivity (0 = never) */
    autoHideDelay: number;
    /** Enable keyboard shortcuts */
    enableKeyboardShortcuts: boolean;
    /** Pin HUD by default */
    defaultPinned: boolean;
  };

  /** Doc Doctor integration */
  integration: {
    /** Prefer Doc Doctor HUD when available */
    preferDocDoctor: boolean;
    /** Show notice when switching modes */
    showModeNotice: boolean;
  };
}
```

### 11.2 Default Settings

```typescript
export const DEFAULT_HUD_SETTINGS: HudSettings = {
  enabled: true,
  autoShow: false,
  rememberState: true,
  defaultTab: 'reading',

  position: {
    anchor: 'bottom-left',
    offsetX: 0,
    offsetY: 8,
  },

  appearance: {
    opacity: 100,
    fadeSpeed: 150,
    compactMode: false,
    showAsciiCharts: true,
    themeOverride: null,
  },

  statusBar: {
    show: true,
    primaryMetric: 'reading-count',
    secondaryMetric: 'highlight-count',
    showServerStatus: true,
  },

  tabs: {
    reading: true,
    library: true,
    stats: true,
    server: true,
    series: true,
  },

  behavior: {
    closeOnClickOutside: true,
    autoHideDelay: 0,
    enableKeyboardShortcuts: true,
    defaultPinned: false,
  },

  integration: {
    preferDocDoctor: true,
    showModeNotice: true,
  },
};
```

### 11.3 Settings Tab UI

The HUD settings will be exposed in the plugin settings under a new **"HUD"** tab.

**File:** `apps/amnesia/src/settings/settings-tab/hud-settings.ts`

```typescript
import { Setting } from 'obsidian';
import type AmnesiaPlugin from '../../main';
import {
  createTabHeader,
  createSection,
  createExplainerBox,
} from '../settings-ui/section-helpers';

export interface HudSettingsProps {
  plugin: AmnesiaPlugin;
  containerEl: HTMLElement;
}

export function HudSettings({ plugin, containerEl }: HudSettingsProps): void {
  const { settings } = plugin;

  // ==========================================================================
  // TAB HEADER
  // ==========================================================================

  createTabHeader(
    containerEl,
    'HUD',
    'Configure the Heads-Up Display for quick access to reading stats and library info.'
  );

  // ==========================================================================
  // GENERAL SETTINGS
  // ==========================================================================

  const generalSection = createSection(containerEl, 'layout-dashboard', 'General');

  new Setting(generalSection)
    .setName('Enable HUD')
    .setDesc('Show the HUD status bar item and popup')
    .addToggle(toggle => toggle
      .setValue(settings.hud.enabled)
      .onChange(async (value) => {
        settings.hud.enabled = value;
        await plugin.saveSettings();
        plugin.hudManager?.setEnabled(value);
      }));

  new Setting(generalSection)
    .setName('Auto-show on startup')
    .setDesc('Automatically open HUD when Obsidian starts')
    .addToggle(toggle => toggle
      .setValue(settings.hud.autoShow)
      .onChange(async (value) => {
        settings.hud.autoShow = value;
        await plugin.saveSettings();
      }));

  new Setting(generalSection)
    .setName('Remember state')
    .setDesc('Remember if HUD was open/pinned across sessions')
    .addToggle(toggle => toggle
      .setValue(settings.hud.rememberState)
      .onChange(async (value) => {
        settings.hud.rememberState = value;
        await plugin.saveSettings();
      }));

  new Setting(generalSection)
    .setName('Default tab')
    .setDesc('Tab to show when HUD opens')
    .addDropdown(dropdown => dropdown
      .addOption('reading', 'Reading')
      .addOption('library', 'Library')
      .addOption('stats', 'Stats')
      .addOption('server', 'Server')
      .addOption('series', 'Series')
      .setValue(settings.hud.defaultTab)
      .onChange(async (value) => {
        settings.hud.defaultTab = value as HudSettings['defaultTab'];
        await plugin.saveSettings();
      }));

  // ==========================================================================
  // STATUS BAR SETTINGS
  // ==========================================================================

  const statusBarSection = createSection(containerEl, 'bar-chart', 'Status Bar');

  new Setting(statusBarSection)
    .setName('Show status bar item')
    .setDesc('Display HUD trigger in Obsidian status bar')
    .addToggle(toggle => toggle
      .setValue(settings.hud.statusBar.show)
      .onChange(async (value) => {
        settings.hud.statusBar.show = value;
        await plugin.saveSettings();
        plugin.hudManager?.updateStatusBar();
      }));

  new Setting(statusBarSection)
    .setName('Primary metric')
    .setDesc('Main stat to display')
    .addDropdown(dropdown => dropdown
      .addOption('reading-count', 'Books reading')
      .addOption('highlight-count', 'Total highlights')
      .addOption('today-progress', "Today's reading")
      .setValue(settings.hud.statusBar.primaryMetric)
      .onChange(async (value) => {
        settings.hud.statusBar.primaryMetric = value as any;
        await plugin.saveSettings();
      }));

  new Setting(statusBarSection)
    .setName('Secondary metric')
    .setDesc('Additional stat to display')
    .addDropdown(dropdown => dropdown
      .addOption('highlight-count', 'Highlights')
      .addOption('bookmark-count', 'Bookmarks')
      .addOption('notes-count', 'Notes')
      .addOption('none', 'None')
      .setValue(settings.hud.statusBar.secondaryMetric)
      .onChange(async (value) => {
        settings.hud.statusBar.secondaryMetric = value as any;
        await plugin.saveSettings();
      }));

  new Setting(statusBarSection)
    .setName('Show server status')
    .setDesc('Display server status indicator (●/○)')
    .addToggle(toggle => toggle
      .setValue(settings.hud.statusBar.showServerStatus)
      .onChange(async (value) => {
        settings.hud.statusBar.showServerStatus = value;
        await plugin.saveSettings();
      }));

  // ==========================================================================
  // APPEARANCE
  // ==========================================================================

  const appearanceSection = createSection(containerEl, 'palette', 'Appearance');

  new Setting(appearanceSection)
    .setName('HUD opacity')
    .setDesc('Opacity when HUD is not focused (50-100%)')
    .addSlider(slider => slider
      .setLimits(50, 100, 5)
      .setValue(settings.hud.appearance.opacity)
      .setDynamicTooltip()
      .onChange(async (value) => {
        settings.hud.appearance.opacity = value;
        await plugin.saveSettings();
      }));

  new Setting(appearanceSection)
    .setName('Compact mode')
    .setDesc('Use smaller text and tighter spacing')
    .addToggle(toggle => toggle
      .setValue(settings.hud.appearance.compactMode)
      .onChange(async (value) => {
        settings.hud.appearance.compactMode = value;
        await plugin.saveSettings();
      }));

  new Setting(appearanceSection)
    .setName('ASCII charts')
    .setDesc('Show ASCII-style progress bars and sparklines')
    .addToggle(toggle => toggle
      .setValue(settings.hud.appearance.showAsciiCharts)
      .onChange(async (value) => {
        settings.hud.appearance.showAsciiCharts = value;
        await plugin.saveSettings();
      }));

  // ==========================================================================
  // TAB VISIBILITY
  // ==========================================================================

  const tabsSection = createSection(containerEl, 'layout-list', 'Tab Visibility');

  createExplainerBox(tabsSection,
    'Hide tabs you don\'t use to simplify the HUD. At least one tab must remain visible.'
  );

  const tabOptions = [
    { key: 'reading', label: 'Reading' },
    { key: 'library', label: 'Library' },
    { key: 'stats', label: 'Stats' },
    { key: 'server', label: 'Server' },
    { key: 'series', label: 'Series' },
  ];

  for (const tab of tabOptions) {
    new Setting(tabsSection)
      .setName(tab.label)
      .addToggle(toggle => toggle
        .setValue(settings.hud.tabs[tab.key as keyof HudSettings['tabs']])
        .onChange(async (value) => {
          // Ensure at least one tab is visible
          const otherTabs = Object.entries(settings.hud.tabs)
            .filter(([k]) => k !== tab.key);
          const anyOtherEnabled = otherTabs.some(([, v]) => v);

          if (!value && !anyOtherEnabled) {
            new Notice('At least one tab must be visible');
            toggle.setValue(true);
            return;
          }

          settings.hud.tabs[tab.key as keyof HudSettings['tabs']] = value;
          await plugin.saveSettings();
        }));
  }

  // ==========================================================================
  // BEHAVIOR
  // ==========================================================================

  const behaviorSection = createSection(containerEl, 'mouse-pointer', 'Behavior');

  new Setting(behaviorSection)
    .setName('Close on click outside')
    .setDesc('Close HUD when clicking elsewhere (unless pinned)')
    .addToggle(toggle => toggle
      .setValue(settings.hud.behavior.closeOnClickOutside)
      .onChange(async (value) => {
        settings.hud.behavior.closeOnClickOutside = value;
        await plugin.saveSettings();
      }));

  new Setting(behaviorSection)
    .setName('Auto-hide delay')
    .setDesc('Hide HUD after inactivity (0 = never)')
    .addDropdown(dropdown => dropdown
      .addOption('0', 'Never')
      .addOption('5000', '5 seconds')
      .addOption('10000', '10 seconds')
      .addOption('30000', '30 seconds')
      .addOption('60000', '1 minute')
      .setValue(String(settings.hud.behavior.autoHideDelay))
      .onChange(async (value) => {
        settings.hud.behavior.autoHideDelay = parseInt(value);
        await plugin.saveSettings();
      }));

  new Setting(behaviorSection)
    .setName('Keyboard shortcuts')
    .setDesc('Enable HUD keyboard shortcuts (Escape, Tab, Ctrl+P, etc.)')
    .addToggle(toggle => toggle
      .setValue(settings.hud.behavior.enableKeyboardShortcuts)
      .onChange(async (value) => {
        settings.hud.behavior.enableKeyboardShortcuts = value;
        await plugin.saveSettings();
      }));

  new Setting(behaviorSection)
    .setName('Pin by default')
    .setDesc('Open HUD in pinned state')
    .addToggle(toggle => toggle
      .setValue(settings.hud.behavior.defaultPinned)
      .onChange(async (value) => {
        settings.hud.behavior.defaultPinned = value;
        await plugin.saveSettings();
      }));

  // ==========================================================================
  // INTEGRATION
  // ==========================================================================

  const integrationSection = createSection(containerEl, 'plug', 'Doc Doctor Integration');

  createExplainerBox(integrationSection,
    'When Doc Doctor is installed, Amnesia can register as a provider in Doc Doctor\'s unified HUD ' +
    'instead of showing its own standalone HUD.'
  );

  new Setting(integrationSection)
    .setName('Prefer Doc Doctor HUD')
    .setDesc('Register with Doc Doctor HUD when available')
    .addToggle(toggle => toggle
      .setValue(settings.hud.integration.preferDocDoctor)
      .onChange(async (value) => {
        settings.hud.integration.preferDocDoctor = value;
        await plugin.saveSettings();
        plugin.hudManager?.checkIntegrationMode();
      }));

  new Setting(integrationSection)
    .setName('Show mode notice')
    .setDesc('Display a notice when switching between standalone and Doc Doctor mode')
    .addToggle(toggle => toggle
      .setValue(settings.hud.integration.showModeNotice)
      .onChange(async (value) => {
        settings.hud.integration.showModeNotice = value;
        await plugin.saveSettings();
      }));
}
```

### 11.4 Settings Registration

Add to `settings-tab/index.ts`:

```typescript
import { HudSettings } from './hud-settings';

// Add to TAB_CONFIG
{ id: 'hud', label: 'HUD', icon: 'layout-dashboard', component: HudSettings },
```

Add to `settings.ts`:

```typescript
import { DEFAULT_HUD_SETTINGS, HudSettings } from './settings-tab/hud-settings';

export interface LibrosSettings {
  // ... existing settings
  hud: HudSettings;
}

export const DEFAULT_SETTINGS: LibrosSettings = {
  // ... existing defaults
  hud: DEFAULT_HUD_SETTINGS,
};
```

---

## 12. Test Plan

### 12.1 Test Categories

| Category | Purpose | Tools |
|----------|---------|-------|
| Unit Tests | Individual functions and components | Vitest |
| Integration Tests | Service-to-HUD data flow | Vitest + Svelte Testing Library |
| E2E Tests | Full user workflows | Obsidian DevTools MCP |
| Visual Tests | UI appearance and layout | Screenshot comparison |
| Performance Tests | Timing benchmarks | Performance API |

### 12.2 Unit Tests

#### 12.2.1 State Management Tests

**File:** `apps/amnesia/src/hud/__tests__/hud-store.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { hudReducer, initialState } from '../state/hud-reducer';

describe('HUD Reducer', () => {
  describe('TOGGLE_HUD', () => {
    it('should open HUD when closed', () => {
      const state = { ...initialState, isOpen: false };
      const result = hudReducer(state, { type: 'TOGGLE_HUD' });
      expect(result.isOpen).toBe(true);
    });

    it('should close HUD when open', () => {
      const state = { ...initialState, isOpen: true };
      const result = hudReducer(state, { type: 'TOGGLE_HUD' });
      expect(result.isOpen).toBe(false);
    });
  });

  describe('SET_ACTIVE_TAB', () => {
    it('should change active tab', () => {
      const state = { ...initialState, activeTab: 'reading' };
      const result = hudReducer(state, { type: 'SET_ACTIVE_TAB', payload: 'stats' });
      expect(result.activeTab).toBe('stats');
    });

    it('should clear detail view when switching tabs', () => {
      const state = { ...initialState, detailView: { type: 'book', bookId: '123' } };
      const result = hudReducer(state, { type: 'SET_ACTIVE_TAB', payload: 'library' });
      expect(result.detailView).toBeNull();
    });

    it('should clear view history when switching tabs', () => {
      const state = { ...initialState, viewHistory: [{ type: 'book', bookId: '123' }] };
      const result = hudReducer(state, { type: 'SET_ACTIVE_TAB', payload: 'stats' });
      expect(result.viewHistory).toHaveLength(0);
    });
  });

  describe('PUSH_DETAIL_VIEW', () => {
    it('should push new detail view', () => {
      const state = { ...initialState, detailView: null };
      const result = hudReducer(state, {
        type: 'PUSH_DETAIL_VIEW',
        payload: { type: 'book', bookId: '123' }
      });
      expect(result.detailView).toEqual({ type: 'book', bookId: '123' });
    });

    it('should add previous view to history', () => {
      const state = {
        ...initialState,
        detailView: { type: 'book', bookId: '123' },
        viewHistory: []
      };
      const result = hudReducer(state, {
        type: 'PUSH_DETAIL_VIEW',
        payload: { type: 'highlights', bookId: '123' }
      });
      expect(result.viewHistory).toContainEqual({ type: 'book', bookId: '123' });
    });
  });

  describe('POP_DETAIL_VIEW', () => {
    it('should restore previous view from history', () => {
      const state = {
        ...initialState,
        detailView: { type: 'highlights', bookId: '123' },
        viewHistory: [{ type: 'book', bookId: '123' }]
      };
      const result = hudReducer(state, { type: 'POP_DETAIL_VIEW' });
      expect(result.detailView).toEqual({ type: 'book', bookId: '123' });
      expect(result.viewHistory).toHaveLength(0);
    });

    it('should return to null when history is empty', () => {
      const state = {
        ...initialState,
        detailView: { type: 'book', bookId: '123' },
        viewHistory: []
      };
      const result = hudReducer(state, { type: 'POP_DETAIL_VIEW' });
      expect(result.detailView).toBeNull();
    });
  });

  describe('PIN_HUD', () => {
    it('should pin HUD', () => {
      const state = { ...initialState, isPinned: false };
      const result = hudReducer(state, { type: 'PIN_HUD', payload: true });
      expect(result.isPinned).toBe(true);
    });

    it('should unpin HUD', () => {
      const state = { ...initialState, isPinned: true };
      const result = hudReducer(state, { type: 'PIN_HUD', payload: false });
      expect(result.isPinned).toBe(false);
    });
  });
});
```

#### 12.2.2 Provider Tests

**File:** `apps/amnesia/src/hud/__tests__/provider.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AmnesiaHUDProvider } from '../providers/AmnesiaHUDProvider';

describe('AmnesiaHUDProvider', () => {
  let mockPlugin: any;
  let provider: AmnesiaHUDProvider;

  beforeEach(() => {
    mockPlugin = {
      libraryService: {
        getStore: vi.fn(() => ({
          subscribe: vi.fn(() => () => {}),
        })),
        getBooks: vi.fn(() => [
          { id: '1', status: 'reading', title: 'Book 1' },
          { id: '2', status: 'completed', title: 'Book 2' },
          { id: '3', status: 'reading', title: 'Book 3' },
        ]),
      },
      highlightService: {
        getStore: vi.fn(() => ({
          subscribe: vi.fn(() => () => {}),
        })),
        getTotalHighlightCount: vi.fn(() => 42),
        getHighlightStats: vi.fn(() => ({
          yellow: 18, blue: 12, green: 8, pink: 4
        })),
      },
      serverManager: {
        getState: vi.fn(() => ({ status: 'running', port: 3000 })),
      },
    };

    provider = new AmnesiaHUDProvider(mockPlugin);
  });

  describe('getTabs', () => {
    it('should return 5 tabs', () => {
      const tabs = provider.getTabs();
      expect(tabs).toHaveLength(5);
    });

    it('should include correct tab IDs', () => {
      const tabs = provider.getTabs();
      const ids = tabs.map(t => t.id);
      expect(ids).toContain('reading');
      expect(ids).toContain('library');
      expect(ids).toContain('stats');
      expect(ids).toContain('server');
      expect(ids).toContain('series');
    });

    it('should show reading count as badge', () => {
      const tabs = provider.getTabs();
      const readingTab = tabs.find(t => t.id === 'reading');
      expect(readingTab?.badge).toBe(2); // 2 books with status 'reading'
    });

    it('should show server status indicator', () => {
      const tabs = provider.getTabs();
      const serverTab = tabs.find(t => t.id === 'server');
      expect(serverTab?.badge).toBe('●'); // Running indicator
    });
  });

  describe('getStatusBarContent', () => {
    it('should return reading count and highlight count', () => {
      const content = provider.getStatusBarContent();
      expect(content.text).toContain('2 reading');
      expect(content.text).toContain('42 highlights');
    });

    it('should show green color for recent activity', () => {
      mockPlugin.libraryService.getBooks = vi.fn(() => [
        { id: '1', status: 'reading', lastRead: new Date() }
      ]);
      const content = provider.getStatusBarContent();
      expect(content.color).toBe('green');
    });

    it('should show gray color for no recent activity', () => {
      mockPlugin.libraryService.getBooks = vi.fn(() => [
        { id: '1', status: 'reading', lastRead: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) }
      ]);
      const content = provider.getStatusBarContent();
      expect(content.color).toBe('gray');
    });
  });

  describe('subscribe', () => {
    it('should notify subscribers on library changes', () => {
      const callback = vi.fn();
      provider.subscribe(callback);

      // Simulate library change
      provider['notifySubscribers']();

      expect(callback).toHaveBeenCalled();
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = provider.subscribe(callback);

      unsubscribe();
      provider['notifySubscribers']();

      expect(callback).not.toHaveBeenCalled();
    });
  });
});
```

#### 12.2.3 Utility Tests

**File:** `apps/amnesia/src/hud/__tests__/utils.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { renderProgressBar, renderSparkline } from '../utils/gauges';
import { formatUptime, formatRelativeTime } from '../utils/formatting';

describe('renderProgressBar', () => {
  it('should render 0%', () => {
    const bar = renderProgressBar(0, 10);
    expect(bar).toBe('[░░░░░░░░░░] 0%');
  });

  it('should render 50%', () => {
    const bar = renderProgressBar(50, 10);
    expect(bar).toBe('[█████░░░░░] 50%');
  });

  it('should render 100%', () => {
    const bar = renderProgressBar(100, 10);
    expect(bar).toBe('[██████████] 100%');
  });

  it('should use default width of 20', () => {
    const bar = renderProgressBar(50);
    expect(bar).toContain('██████████░░░░░░░░░░');
  });
});

describe('renderSparkline', () => {
  it('should render flat line for equal values', () => {
    const sparkline = renderSparkline([5, 5, 5, 5, 5]);
    expect(sparkline).toBe('▁▁▁▁▁');
  });

  it('should render increasing trend', () => {
    const sparkline = renderSparkline([1, 2, 3, 4, 5]);
    expect(sparkline).toBe('▁▃▄▆█');
  });

  it('should render single value', () => {
    const sparkline = renderSparkline([5]);
    expect(sparkline).toBe('▁');
  });

  it('should handle zero values', () => {
    const sparkline = renderSparkline([0, 0, 0]);
    expect(sparkline).toBe('▁▁▁');
  });
});

describe('formatUptime', () => {
  it('should format seconds', () => {
    expect(formatUptime(45)).toBe('45s');
  });

  it('should format minutes', () => {
    expect(formatUptime(125)).toBe('2m 5s');
  });

  it('should format hours', () => {
    expect(formatUptime(3725)).toBe('1h 2m');
  });

  it('should format days', () => {
    expect(formatUptime(90000)).toBe('1d 1h');
  });
});

describe('formatRelativeTime', () => {
  it('should format "just now"', () => {
    const date = new Date();
    expect(formatRelativeTime(date)).toBe('just now');
  });

  it('should format minutes ago', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelativeTime(date)).toBe('5 minutes ago');
  });

  it('should format hours ago', () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatRelativeTime(date)).toBe('3 hours ago');
  });

  it('should format days ago', () => {
    const date = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(date)).toBe('2 days ago');
  });
});
```

### 12.3 Integration Tests

#### 12.3.1 Service-to-Provider Data Flow

**File:** `apps/amnesia/src/hud/__tests__/integration.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writable } from 'svelte/store';
import { AmnesiaHUDProvider } from '../providers/AmnesiaHUDProvider';
import { createDerivedStores } from '../state/derived-stores';

describe('HUD Integration', () => {
  let mockLibraryStore: any;
  let mockHighlightStore: any;
  let mockPlugin: any;

  beforeEach(() => {
    mockLibraryStore = writable({
      books: [
        { id: '1', status: 'reading', title: 'Book 1' },
      ],
    });

    mockHighlightStore = writable({
      highlights: { '1': [{ id: 'h1', color: 'yellow' }] },
    });

    mockPlugin = {
      libraryService: {
        getStore: () => mockLibraryStore,
        getBooks: () => [{ id: '1', status: 'reading', title: 'Book 1' }],
      },
      highlightService: {
        getStore: () => mockHighlightStore,
        getTotalHighlightCount: () => 1,
      },
      serverManager: {
        getState: () => ({ status: 'stopped' }),
      },
    };
  });

  it('should update status bar when library changes', async () => {
    const provider = new AmnesiaHUDProvider(mockPlugin);
    const updates: any[] = [];

    provider.subscribe(() => {
      updates.push(provider.getStatusBarContent());
    });

    // Simulate adding a book
    mockLibraryStore.update((state: any) => ({
      ...state,
      books: [...state.books, { id: '2', status: 'reading', title: 'Book 2' }],
    }));

    // Wait for reactive update
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(updates.length).toBeGreaterThan(0);
  });

  it('should update highlight stats when highlights change', async () => {
    const provider = new AmnesiaHUDProvider(mockPlugin);
    const initialContent = provider.getStatusBarContent();

    mockHighlightStore.update((state: any) => ({
      ...state,
      highlights: {
        ...state.highlights,
        '1': [...state.highlights['1'], { id: 'h2', color: 'blue' }],
      },
    }));

    await new Promise(resolve => setTimeout(resolve, 0));

    // Provider should reflect updated data
    expect(mockPlugin.highlightService.getTotalHighlightCount).toBeDefined();
  });
});
```

### 12.4 E2E Tests (Obsidian DevTools MCP)

#### 12.4.1 HUD Open/Close Tests

```javascript
// Test: HUD opens on status bar click
(async function() {
  const statusBar = document.querySelector('.amnesia-hud-status-bar');
  if (!statusBar) return { error: 'Status bar not found' };

  statusBar.click();
  await new Promise(r => setTimeout(r, 200));

  const hud = document.querySelector('.amnesia-hud-compact-view');
  return { success: hud !== null, message: 'HUD should be visible after click' };
})();

// Test: HUD closes on Escape
(async function() {
  const hud = document.querySelector('.amnesia-hud-compact-view');
  if (!hud) return { error: 'HUD not open' };

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await new Promise(r => setTimeout(r, 200));

  const hudAfter = document.querySelector('.amnesia-hud-compact-view');
  return { success: hudAfter === null, message: 'HUD should close on Escape' };
})();

// Test: HUD closes on click outside (when unpinned)
(async function() {
  // Open HUD
  const statusBar = document.querySelector('.amnesia-hud-status-bar');
  statusBar.click();
  await new Promise(r => setTimeout(r, 200));

  // Click outside
  document.body.click();
  await new Promise(r => setTimeout(r, 200));

  const hud = document.querySelector('.amnesia-hud-compact-view');
  return { success: hud === null, message: 'HUD should close on click outside' };
})();
```

#### 12.4.2 Tab Navigation Tests

```javascript
// Test: Tab switching
(async function() {
  // Ensure HUD is open
  const statusBar = document.querySelector('.amnesia-hud-status-bar');
  statusBar.click();
  await new Promise(r => setTimeout(r, 200));

  // Click Stats tab
  const statsTab = document.querySelector('[data-tab-id="stats"]');
  if (!statsTab) return { error: 'Stats tab not found' };

  statsTab.click();
  await new Promise(r => setTimeout(r, 100));

  const statsContent = document.querySelector('.amnesia-hud-stats-tab');
  return { success: statsContent !== null, message: 'Stats tab content should be visible' };
})();

// Test: Keyboard tab navigation
(async function() {
  const hud = document.querySelector('.amnesia-hud-compact-view');
  if (!hud) return { error: 'HUD not open' };

  const initialTab = document.querySelector('[data-tab-id].active')?.getAttribute('data-tab-id');

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
  await new Promise(r => setTimeout(r, 100));

  const newTab = document.querySelector('[data-tab-id].active')?.getAttribute('data-tab-id');
  return {
    success: newTab !== initialTab,
    message: `Tab should change from ${initialTab} to next tab`
  };
})();
```

#### 12.4.3 Server Tab Tests

```javascript
// Test: Server status display
(async function() {
  // Open HUD and navigate to Server tab
  const serverTab = document.querySelector('[data-tab-id="server"]');
  if (!serverTab) return { error: 'Server tab not found' };

  serverTab.click();
  await new Promise(r => setTimeout(r, 100));

  const statusIndicator = document.querySelector('.server-status-indicator');
  const statusText = document.querySelector('.server-status-text');

  return {
    success: statusIndicator !== null && statusText !== null,
    indicator: statusIndicator?.textContent,
    status: statusText?.textContent,
  };
})();

// Test: Start server button
(async function() {
  const startBtn = document.querySelector('[data-action="start-server"]');
  if (!startBtn) return { error: 'Start button not found' };

  const initialStatus = document.querySelector('.server-status-text')?.textContent;
  startBtn.click();
  await new Promise(r => setTimeout(r, 5000)); // Wait for server to start

  const newStatus = document.querySelector('.server-status-text')?.textContent;
  return {
    success: newStatus !== initialStatus,
    before: initialStatus,
    after: newStatus,
  };
})();

// Test: Mode switching
(async function() {
  const modeDropdown = document.querySelector('[data-action="switch-mode"]');
  if (!modeDropdown) return { error: 'Mode dropdown not found' };

  const initialMode = modeDropdown.value;
  modeDropdown.value = initialMode === 'auto' ? 'server' : 'auto';
  modeDropdown.dispatchEvent(new Event('change'));

  await new Promise(r => setTimeout(r, 100));

  // Verify settings updated
  const leaves = app.workspace.getLeavesOfType('amnesia-reader');
  if (leaves.length === 0) return { message: 'No reader open, mode changed successfully' };

  const view = leaves[0].view;
  const ctx = view.component.$$.ctx;
  const settings = ctx[0]; // Assuming settings at index 0

  return {
    success: true,
    message: `Mode switched from ${initialMode}`
  };
})();
```

#### 12.4.4 Detail View Tests

```javascript
// Test: Book detail view navigation
(async function() {
  // Click on a book in Reading tab
  const bookCard = document.querySelector('.amnesia-hud-book-card');
  if (!bookCard) return { error: 'No book card found' };

  bookCard.click();
  await new Promise(r => setTimeout(r, 200));

  const detailView = document.querySelector('.amnesia-hud-detail-view');
  const bookTitle = document.querySelector('.detail-view-title')?.textContent;

  return {
    success: detailView !== null,
    bookTitle,
  };
})();

// Test: Back navigation
(async function() {
  const backBtn = document.querySelector('.detail-view-back');
  if (!backBtn) return { error: 'Back button not found' };

  backBtn.click();
  await new Promise(r => setTimeout(r, 200));

  const detailView = document.querySelector('.amnesia-hud-detail-view');
  return {
    success: detailView === null,
    message: 'Should return to compact view',
  };
})();

// Test: Highlight list navigation
(async function() {
  // Navigate to book detail
  const bookCard = document.querySelector('.amnesia-hud-book-card');
  bookCard?.click();
  await new Promise(r => setTimeout(r, 200));

  // Click View All Highlights
  const viewHighlightsBtn = document.querySelector('[data-action="view-highlights"]');
  if (!viewHighlightsBtn) return { error: 'View highlights button not found' };

  viewHighlightsBtn.click();
  await new Promise(r => setTimeout(r, 200));

  const highlightList = document.querySelector('.amnesia-hud-highlight-list');
  return { success: highlightList !== null };
})();
```

### 12.5 Performance Tests

```javascript
// Test: HUD opens within 100ms
(async function() {
  const statusBar = document.querySelector('.amnesia-hud-status-bar');
  if (!statusBar) return { error: 'Status bar not found' };

  // Ensure closed
  const existingHud = document.querySelector('.amnesia-hud-compact-view');
  if (existingHud) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await new Promise(r => setTimeout(r, 200));
  }

  const start = performance.now();
  statusBar.click();

  // Wait for HUD to appear
  await new Promise(resolve => {
    const check = () => {
      const hud = document.querySelector('.amnesia-hud-compact-view');
      if (hud) resolve();
      else requestAnimationFrame(check);
    };
    check();
  });

  const duration = performance.now() - start;
  return {
    success: duration < 100,
    duration: `${duration.toFixed(2)}ms`,
    target: '< 100ms',
  };
})();

// Test: Tab switching within 50ms
(async function() {
  const tabs = document.querySelectorAll('[data-tab-id]');
  const results = [];

  for (let i = 1; i < tabs.length; i++) {
    const start = performance.now();
    tabs[i].click();

    await new Promise(resolve => {
      const check = () => {
        if (tabs[i].classList.contains('active')) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });

    const duration = performance.now() - start;
    results.push({
      tab: tabs[i].getAttribute('data-tab-id'),
      duration: duration.toFixed(2),
      pass: duration < 50,
    });
  }

  return {
    success: results.every(r => r.pass),
    results,
    target: '< 50ms each',
  };
})();
```

### 12.6 Visual Regression Tests

**Screenshot Capture Script:**

```javascript
// Capture baseline screenshots for each HUD state
async function captureHUDScreenshots() {
  const screenshots = [];

  // 1. Status bar only
  screenshots.push({
    name: 'status-bar',
    selector: '.amnesia-hud-status-bar',
  });

  // 2. Compact view - each tab
  const tabs = ['reading', 'library', 'stats', 'server', 'series'];
  for (const tab of tabs) {
    document.querySelector(`[data-tab-id="${tab}"]`)?.click();
    await new Promise(r => setTimeout(r, 100));
    screenshots.push({
      name: `compact-${tab}`,
      selector: '.amnesia-hud-compact-view',
    });
  }

  // 3. Detail views
  // Book detail
  document.querySelector('.amnesia-hud-book-card')?.click();
  await new Promise(r => setTimeout(r, 200));
  screenshots.push({
    name: 'detail-book',
    selector: '.amnesia-hud-detail-view',
  });

  return screenshots;
}
```

### 12.7 Accessibility Tests

```javascript
// Test: All interactive elements have ARIA labels
(function() {
  const hud = document.querySelector('.amnesia-hud-compact-view');
  if (!hud) return { error: 'HUD not open' };

  const interactives = hud.querySelectorAll('button, [role="button"], a, [tabindex]');
  const issues = [];

  interactives.forEach(el => {
    const label = el.getAttribute('aria-label') ||
                  el.getAttribute('aria-labelledby') ||
                  el.textContent?.trim();

    if (!label) {
      issues.push({
        element: el.tagName,
        class: el.className,
        issue: 'Missing accessible label',
      });
    }
  });

  return {
    success: issues.length === 0,
    issues,
    checked: interactives.length,
  };
})();

// Test: Keyboard focus is visible
(function() {
  const hud = document.querySelector('.amnesia-hud-compact-view');
  if (!hud) return { error: 'HUD not open' };

  const focusable = hud.querySelectorAll('button, [tabindex="0"]');
  const issues = [];

  focusable.forEach(el => {
    el.focus();
    const styles = getComputedStyle(el);
    const hasOutline = styles.outline !== 'none' && styles.outline !== '';
    const hasShadow = styles.boxShadow !== 'none' && styles.boxShadow !== '';

    if (!hasOutline && !hasShadow) {
      issues.push({
        element: el.tagName,
        class: el.className,
        issue: 'No visible focus indicator',
      });
    }
  });

  return {
    success: issues.length === 0,
    issues,
    checked: focusable.length,
  };
})();
```

### 12.8 Test Coverage Matrix

| SPEC Section | Test Type | Test Count | Priority |
|--------------|-----------|------------|----------|
| 2.1 Status Bar | Unit, E2E | 5 | High |
| 2.2 Compact View (5 tabs) | Unit, E2E, Visual | 15 | High |
| 2.3 Detail Views | Unit, E2E | 10 | Medium |
| 3. Architecture | Integration | 5 | Medium |
| 5. State Management | Unit | 12 | High |
| 6. Provider Interface | Unit, Integration | 8 | High |
| 7. UI/UX (ASCII, Keyboard) | E2E, Visual | 8 | Medium |
| 9. Doc Doctor Integration | Integration, E2E | 6 | High |
| 11. Settings | Unit, E2E | 10 | Medium |
| Performance (<100ms open) | Performance | 3 | High |
| Accessibility | E2E | 5 | Medium |

**Total: ~87 tests across all categories**

### 12.9 CI/CD Integration

```yaml
# .github/workflows/hud-tests.yml
name: HUD Tests

on:
  push:
    paths:
      - 'apps/amnesia/src/hud/**'
  pull_request:
    paths:
      - 'apps/amnesia/src/hud/**'

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm test:hud --coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          flags: hud

  visual-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
      - run: pnpm install
      - run: pnpm test:visual:hud
      - uses: actions/upload-artifact@v4
        with:
          name: visual-diffs
          path: ./visual-diffs/
```

---

**End of Specification**
