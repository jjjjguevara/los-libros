//! Document traits
//!
//! Format-agnostic interfaces for document parsing and rendering.

use async_trait::async_trait;

use super::error::Result;
use super::types::{
    ParsedDocument, RenderRequest, RenderResult, Resource, SearchOptions, SearchResult,
    StructuredText, TocEntry,
};

/// Format-agnostic document parser
///
/// Implementations provide document parsing, metadata extraction,
/// text extraction, and search functionality.
#[async_trait]
pub trait DocumentParser: Send + Sync {
    /// Parse document metadata and structure
    async fn parse(&self) -> Result<ParsedDocument>;

    /// Number of content items (pages for PDF, chapters for EPUB)
    fn item_count(&self) -> usize;

    /// Extract table of contents
    async fn extract_toc(&self) -> Result<Vec<TocEntry>>;

    /// Extract plain text from item
    async fn extract_text(&self, item_index: usize) -> Result<String>;

    /// Extract structured text with positions (MuPDF stext)
    async fn get_structured_text(&self, item_index: usize) -> Result<StructuredText>;

    /// Search document with bounding boxes
    async fn search(&self, query: &str, options: SearchOptions) -> Result<Vec<SearchResult>>;

    /// Get item dimensions (page size)
    fn get_item_dimensions(&self, item_index: usize) -> Result<(f32, f32)>;
}

/// Format-agnostic document renderer
///
/// Implementations provide rendering to images (PDF) or HTML (EPUB),
/// thumbnail generation, and resource access.
#[async_trait]
pub trait DocumentRenderer: Send + Sync {
    /// Render item to image (PDF pages) or HTML (EPUB chapters)
    async fn render_item(&self, request: &RenderRequest) -> Result<RenderResult>;

    /// Generate thumbnail
    async fn render_thumbnail(&self, item_index: usize, max_size: u32) -> Result<RenderResult>;

    /// Get embedded resource (images, CSS, fonts)
    async fn get_resource(&self, href: &str) -> Result<Resource>;
}

/// Combined parser and renderer for a document
pub trait Document: DocumentParser + DocumentRenderer {
    /// Get document ID
    fn id(&self) -> &str;

    /// Get document format
    fn format(&self) -> super::types::DocumentFormat;
}

/// Cache key for rendered content
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct RenderCacheKey {
    pub document_id: String,
    pub item_index: usize,
    pub scale: u32, // Scale * 100 to avoid float hashing
    pub clip_hash: Option<u64>,
}

impl RenderCacheKey {
    pub fn new(document_id: &str, item_index: usize, scale: f32) -> Self {
        Self {
            document_id: document_id.to_string(),
            item_index,
            scale: (scale * 100.0) as u32,
            clip_hash: None,
        }
    }

    pub fn with_clip(mut self, clip_hash: u64) -> Self {
        self.clip_hash = Some(clip_hash);
        self
    }
}
