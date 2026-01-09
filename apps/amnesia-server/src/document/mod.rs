//! Unified document abstraction
//!
//! This module provides format-agnostic interfaces for document handling,
//! supporting both PDF and EPUB formats through a unified API.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────┐
//! │                  DocumentCache                          │
//! │  (LRU cache for parsers, renderers, structured text)   │
//! └─────────────────────────────────────────────────────────┘
//!                            │
//!           ┌────────────────┼────────────────┐
//!           ▼                ▼                ▼
//!   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
//!   │ PdfDocument  │ │ EpubDocument │ │   Future     │
//!   │              │ │              │ │   formats    │
//!   └──────────────┘ └──────────────┘ └──────────────┘
//!           │                │
//!           └────────┬───────┘
//!                    ▼
//!   ┌─────────────────────────────────────────────────────┐
//!   │                  ContextPool                         │
//!   │  (Thread-safe MuPDF context management)             │
//!   └─────────────────────────────────────────────────────┘
//! ```
//!
//! # Usage
//!
//! ```rust,ignore
//! use amnesia_server::document::{DocumentCache, CacheConfig};
//!
//! let cache = DocumentCache::new(CacheConfig::default());
//!
//! // Load document from bytes
//! let doc = cache.load_from_bytes(bytes, "doc-123", DocumentFormat::Pdf).await?;
//!
//! // Render a page
//! let result = cache.render(&doc.id, &RenderRequest {
//!     item_index: 0,
//!     scale: 2.0,
//!     format: RenderFormat::Png,
//!     ..Default::default()
//! }).await?;
//!
//! // Get structured text
//! let stext = cache.get_structured_text(&doc.id, 0).await?;
//! ```

mod cache;
mod error;
mod traits;
mod types;

pub use cache::{CacheConfig, CacheStats, DocumentCache, RenderCacheKey as CacheRenderKey};
pub use error::{DocumentError, DocumentResult, Result};
pub use traits::{Document, DocumentParser, DocumentRenderer, RenderCacheKey};
pub use types::{
    BoundingBox, CharPosition, Creator, DocumentFormat, DocumentMetadata, ImageFormat,
    ParsedDocument, Rect, RenderRequest, RenderResult, Resource, SearchOptions, SearchResult,
    StructuredText, TextBlock, TextDirection, TextLine, TocEntry,
};
