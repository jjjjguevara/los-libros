//! EPUB DocumentParser implementation using MuPDF
//!
//! Implements the unified `DocumentParser` trait for EPUB documents.
//! Uses MuPDF via `SafeDocument` for thread-safe access.
//!
//! # MuPDF EPUB Handling
//!
//! MuPDF treats EPUB as a reflowable document. Before accessing pages,
//! `layout(width, height, em)` must be called to set virtual page dimensions.
//! This converts the reflowable content into fixed-size pages for rendering.
//!
//! # Limitations
//!
//! The MuPDF Rust bindings (v0.5) don't expose the `fz_archive` API, so
//! direct access to raw XHTML content is not available. Content is accessed
//! via MuPDF's page rendering and text extraction APIs.

use std::sync::Arc;

use async_trait::async_trait;
use mupdf::{MetadataName, TextPageOptions};
use parking_lot::RwLock;

use crate::document::{
    BoundingBox, CharPosition, Creator, DocumentError, DocumentFormat, DocumentMetadata,
    DocumentParser, DocumentResult, ParsedDocument, SearchOptions, SearchResult, StructuredText,
    TextBlock, TextDirection, TextLine, TocEntry,
};
use crate::mupdf::SafeDocument;

/// Default layout width for EPUB rendering (points)
const DEFAULT_LAYOUT_WIDTH: f32 = 800.0;

/// Default layout height for EPUB rendering (points)
const DEFAULT_LAYOUT_HEIGHT: f32 = 600.0;

/// Default em size for EPUB text layout (points)
const DEFAULT_EM_SIZE: f32 = 12.0;

/// Layout configuration for reflowable documents
#[derive(Debug, Clone, Copy)]
pub struct LayoutConfig {
    /// Page width in points
    pub width: f32,
    /// Page height in points
    pub height: f32,
    /// Em size for font scaling
    pub em: f32,
}

impl Default for LayoutConfig {
    fn default() -> Self {
        Self {
            width: DEFAULT_LAYOUT_WIDTH,
            height: DEFAULT_LAYOUT_HEIGHT,
            em: DEFAULT_EM_SIZE,
        }
    }
}

/// EPUB implementation of DocumentParser and DocumentRenderer
///
/// This handler uses MuPDF to:
/// - Parse EPUB metadata and table of contents
/// - Layout reflowable content into fixed pages
/// - Extract text with character-level positions
/// - Search with bounding boxes
/// - Render pages to images
///
/// # Layout State
///
/// Note: Due to SafeDocument's "fresh document per operation" pattern, layout
/// is called on every operation because each operation gets a new document
/// instance. The `layout_config` is stored here to ensure consistent layout
/// parameters across all operations.
pub struct EpubDocumentHandler {
    /// Thread-safe MuPDF document wrapper
    doc: Arc<SafeDocument>,

    /// Layout configuration for reflowable content (interior mutable for relayout)
    layout_config: RwLock<LayoutConfig>,

    /// Cached page count after initial layout
    page_count: RwLock<Option<usize>>,
}

impl EpubDocumentHandler {
    /// Create a new EPUB handler from bytes
    pub fn from_bytes(data: Vec<u8>, id: String) -> DocumentResult<Self> {
        let doc = SafeDocument::from_bytes(data, id)?;
        let handler = Self {
            doc: Arc::new(doc),
            layout_config: RwLock::new(LayoutConfig::default()),
            page_count: RwLock::new(None),
        };

        // Perform initial layout to cache page count
        handler.perform_initial_layout()?;

        Ok(handler)
    }

    /// Create a new EPUB handler from bytes with custom layout configuration
    pub fn from_bytes_with_layout(
        data: Vec<u8>,
        id: String,
        layout_config: LayoutConfig,
    ) -> DocumentResult<Self> {
        let doc = SafeDocument::from_bytes(data, id)?;
        let handler = Self {
            doc: Arc::new(doc),
            layout_config: RwLock::new(layout_config),
            page_count: RwLock::new(None),
        };

        handler.perform_initial_layout()?;

        Ok(handler)
    }

    /// Create a new EPUB handler from a file path
    pub fn from_path<P: AsRef<std::path::Path>>(path: P, id: String) -> DocumentResult<Self> {
        let doc = SafeDocument::from_path(path, id)?;
        let handler = Self {
            doc: Arc::new(doc),
            layout_config: RwLock::new(LayoutConfig::default()),
            page_count: RwLock::new(None),
        };

        handler.perform_initial_layout()?;

        Ok(handler)
    }

    /// Get the underlying SafeDocument
    pub fn document(&self) -> &Arc<SafeDocument> {
        &self.doc
    }

    /// Get the current layout configuration
    pub fn layout_config(&self) -> LayoutConfig {
        *self.layout_config.read()
    }

    /// Perform initial layout to cache page count
    ///
    /// This is called once during construction to establish the initial
    /// page count. Subsequent operations will re-apply layout since
    /// SafeDocument opens fresh document instances.
    fn perform_initial_layout(&self) -> DocumentResult<()> {
        let config = *self.layout_config.read();

        self.doc.with_doc_mut(|mupdf_doc| {
            // Only call layout on reflowable documents (EPUB)
            if mupdf_doc.is_reflowable().unwrap_or(false) {
                mupdf_doc.layout(config.width, config.height, config.em)?;
            }

            // Cache page count after layout
            let count = mupdf_doc.page_count()? as usize;
            *self.page_count.write() = Some(count);

            Ok(())
        })
    }

    /// Relayout with new dimensions
    ///
    /// Updates the layout configuration and recaches the page count.
    /// Useful for responsive reading when viewport changes.
    ///
    /// Note: Due to SafeDocument's fresh-document-per-operation pattern,
    /// all subsequent operations will automatically use the new layout.
    pub fn relayout(&self, config: LayoutConfig) -> DocumentResult<()> {
        // Update configuration (interior mutable)
        *self.layout_config.write() = config;

        // Re-run layout to update page count cache
        self.doc.with_doc_mut(|mupdf_doc| {
            if mupdf_doc.is_reflowable().unwrap_or(false) {
                mupdf_doc.layout(config.width, config.height, config.em)?;
            }

            let count = mupdf_doc.page_count()? as usize;
            *self.page_count.write() = Some(count);

            Ok(())
        })
    }

    /// Get cached page count
    fn get_page_count(&self) -> usize {
        self.page_count.read().unwrap_or(0)
    }
}

// Type alias for backward compatibility
pub type EpubDocumentParser = EpubDocumentHandler;

#[async_trait]
impl DocumentParser for EpubDocumentHandler {
    async fn parse(&self) -> DocumentResult<ParsedDocument> {
        let doc = self.doc.clone();
        let layout_config = self.layout_config();

        tokio::task::spawn_blocking(move || {
            doc.with_doc_mut(|mupdf_doc| {
                // Ensure layout before accessing pages
                if mupdf_doc.is_reflowable().unwrap_or(false) {
                    mupdf_doc.layout(layout_config.width, layout_config.height, layout_config.em)?;
                }

                // Extract metadata
                let get_meta = |name: MetadataName| -> Option<String> {
                    mupdf_doc.metadata(name).ok().filter(|s| !s.is_empty())
                };

                let title = get_meta(MetadataName::Title).unwrap_or_else(|| doc.id().to_string());
                let author = get_meta(MetadataName::Author);
                let subject = get_meta(MetadataName::Subject);
                let creation_date = get_meta(MetadataName::CreationDate);

                // Build creators list from author
                let creators = author
                    .map(|a| {
                        // Split multiple authors by common separators
                        a.split(&[',', ';', '&'][..])
                            .map(|name| Creator {
                                name: name.trim().to_string(),
                                role: Some("author".to_string()),
                                file_as: None,
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                let metadata = DocumentMetadata {
                    title,
                    creators,
                    publisher: None,
                    language: None, // MuPDF doesn't expose dc:language directly
                    identifier: None,
                    description: subject,
                    cover_href: None,
                    date: creation_date,
                    rights: None,
                    subjects: Vec::new(),
                };

                // Extract table of contents
                let toc = extract_toc(mupdf_doc)?;

                // Get page count after layout
                let item_count = mupdf_doc.page_count()? as usize;

                // EPUB always has text layer (it's text-based)
                let has_text_layer = true;

                Ok(ParsedDocument {
                    id: doc.id().to_string(),
                    format: DocumentFormat::Epub,
                    metadata,
                    toc,
                    item_count,
                    item_labels: None, // EPUB doesn't have page labels like PDF
                    has_text_layer,
                })
            })
        })
        .await
        .map_err(|e| DocumentError::ParseError(format!("Task join error: {}", e)))?
    }

    fn item_count(&self) -> usize {
        self.get_page_count()
    }

    async fn extract_toc(&self) -> DocumentResult<Vec<TocEntry>> {
        let doc = self.doc.clone();

        tokio::task::spawn_blocking(move || doc.with_doc(|mupdf_doc| extract_toc(mupdf_doc)))
            .await
            .map_err(|e| DocumentError::ParseError(format!("Task join error: {}", e)))?
    }

    async fn extract_text(&self, item_index: usize) -> DocumentResult<String> {
        self.validate_item_index(item_index)?;
        let doc = self.doc.clone();

        tokio::task::spawn_blocking(move || {
            doc.with_doc(|mupdf_doc| {
                let page = mupdf_doc.load_page(item_index as i32)?;
                page.to_text().map_err(Into::into)
            })
        })
        .await
        .map_err(|e| DocumentError::TextExtractionError(format!("Task join error: {}", e)))?
    }

    async fn get_structured_text(&self, item_index: usize) -> DocumentResult<StructuredText> {
        self.validate_item_index(item_index)?;
        let doc = self.doc.clone();

        tokio::task::spawn_blocking(move || {
            doc.with_doc(|mupdf_doc| {
                let page = mupdf_doc.load_page(item_index as i32)?;
                let bounds = page.bounds()?;
                let width = bounds.x1 - bounds.x0;
                let height = bounds.y1 - bounds.y0;

                let text_page = page.to_text_page(TextPageOptions::PRESERVE_WHITESPACE)?;
                let blocks = extract_structured_blocks(&text_page, height)?;

                Ok(StructuredText {
                    item_index,
                    width,
                    height,
                    blocks,
                })
            })
        })
        .await
        .map_err(|e| DocumentError::TextExtractionError(format!("Task join error: {}", e)))?
    }

    async fn search(
        &self,
        query: &str,
        options: SearchOptions,
    ) -> DocumentResult<Vec<SearchResult>> {
        let doc = self.doc.clone();
        let query = query.to_string();
        let limit = if options.limit == 0 { 100 } else { options.limit };
        let include_context = options.include_context;
        let context_length = options.context_length;

        tokio::task::spawn_blocking(move || {
            doc.with_doc(|mupdf_doc| {
                let mut results = Vec::new();
                let page_count = mupdf_doc.page_count()? as usize;

                for page_idx in 0..page_count {
                    if results.len() >= limit {
                        break;
                    }

                    let page = mupdf_doc.load_page(page_idx as i32)?;

                    let max_hits = (limit - results.len()).min(100) as u32;
                    if let Ok(quads) = page.search(&query, max_hits) {
                        for quad in quads {
                            if results.len() >= limit {
                                break;
                            }

                            // Calculate bounding box from quad
                            let x = quad.ul.x.min(quad.ll.x);
                            let y = quad.ul.y.min(quad.ur.y);
                            let w = quad.ur.x.max(quad.lr.x) - x;
                            let h = quad.ll.y.max(quad.lr.y) - y;

                            let bbox = BoundingBox::new(x, y, w, h);

                            // Extract context if requested
                            let (prefix, suffix) = if include_context && context_length > 0 {
                                extract_search_context(&page, &query, context_length)?
                            } else {
                                (None, None)
                            };

                            results.push(SearchResult {
                                item_index: page_idx,
                                text: query.clone(),
                                prefix,
                                suffix,
                                bounds: vec![bbox],
                            });
                        }
                    }
                }

                Ok(results)
            })
        })
        .await
        .map_err(|e| DocumentError::SearchError(format!("Task join error: {}", e)))?
    }

    fn get_item_dimensions(&self, item_index: usize) -> DocumentResult<(f32, f32)> {
        self.validate_item_index(item_index)?;

        self.doc.with_doc(|mupdf_doc| {
            let page = mupdf_doc.load_page(item_index as i32)?;
            let bounds = page.bounds()?;
            Ok((bounds.x1 - bounds.x0, bounds.y1 - bounds.y0))
        })
    }
}

impl EpubDocumentHandler {
    fn validate_item_index(&self, item_index: usize) -> DocumentResult<()> {
        if item_index >= self.get_page_count() {
            return Err(DocumentError::ItemNotFound(item_index));
        }
        Ok(())
    }
}

// Helper functions

fn extract_toc(doc: &mupdf::Document) -> DocumentResult<Vec<TocEntry>> {
    let outlines = doc.outlines()?;
    Ok(convert_outlines_to_toc(&outlines))
}

fn convert_outlines_to_toc(outlines: &[mupdf::Outline]) -> Vec<TocEntry> {
    outlines
        .iter()
        .enumerate()
        .map(|(idx, outline)| {
            // Get page number if available (0-indexed)
            let page_opt = outline.page.map(|p| p as usize);
            let children = convert_outlines_to_toc(&outline.down);

            let label = if outline.title.is_empty() {
                "Untitled".to_string()
            } else {
                outline.title.clone()
            };

            // Use URI if available, otherwise create page reference (if page is known)
            // If neither URI nor page is available, use position-based href
            let href = outline
                .uri
                .as_ref()
                .filter(|s| !s.is_empty())
                .cloned()
                .unwrap_or_else(|| {
                    if let Some(page) = page_opt {
                        format!("page:{}", page + 1)
                    } else {
                        // Fallback: use outline position as a hint for navigation
                        format!("position:{}", idx)
                    }
                });

            // item_index should be None when page is unknown, so client can use href instead
            let item_index = page_opt;

            // play_order uses 1-based indexing when page is known, otherwise use outline position
            let play_order = page_opt
                .map(|p| (p + 1) as u32)
                .or_else(|| Some((idx + 1) as u32));

            TocEntry {
                label,
                href,
                item_index,
                children,
                play_order,
            }
        })
        .collect()
}

fn extract_structured_blocks(
    text_page: &mupdf::TextPage,
    page_height: f32,
) -> DocumentResult<Vec<TextBlock>> {
    let mut blocks = Vec::new();

    for block in text_page.blocks() {
        let mut lines = Vec::new();

        for line in block.lines() {
            let mut chars = Vec::new();
            let mut line_text = String::new();
            let mut line_x = f32::MAX;
            let mut line_y = f32::MAX;
            let mut line_max_x = f32::MIN;
            let mut line_max_y = f32::MIN;

            for ch in line.chars() {
                if let Some(c) = ch.char() {
                    let quad = ch.quad();

                    // Character bounding box
                    let char_x = quad.ul.x.min(quad.ll.x);
                    let char_top_y = quad.ul.y.min(quad.ur.y);
                    let char_bottom_y = quad.ll.y.max(quad.lr.y);
                    let char_width = (quad.ur.x.max(quad.lr.x) - char_x).max(0.0);
                    let char_height = (char_bottom_y - char_top_y).abs();

                    // Track line bounds
                    line_x = line_x.min(char_x);
                    line_y = line_y.min(char_top_y);
                    line_max_x = line_max_x.max(char_x + char_width);
                    line_max_y = line_max_y.max(char_bottom_y);

                    // For EPUB, Y coordinates are already in top-down order
                    // (unlike PDF which uses bottom-up coordinates)
                    let screen_y = char_top_y;

                    line_text.push(c);
                    chars.push(CharPosition {
                        char: c,
                        x: char_x,
                        y: screen_y,
                        width: char_width,
                        height: char_height,
                        font_size: Some(ch.size()),
                        font_name: None,
                        font_flags: None,
                        color: None,
                    });
                }
            }

            if !line_text.trim().is_empty() {
                let line_width = line_max_x - line_x;
                let line_height = line_max_y - line_y;

                lines.push(TextLine {
                    bbox: BoundingBox::new(line_x, line_y, line_width, line_height),
                    dir: Some(TextDirection::Ltr),
                    chars,
                    text: Some(line_text),
                });
            }
        }

        if !lines.is_empty() {
            // Calculate block bounding box from lines
            let block_x = lines.iter().map(|l| l.bbox.x).fold(f32::MAX, f32::min);
            let block_y = lines.iter().map(|l| l.bbox.y).fold(f32::MAX, f32::min);
            let block_max_x = lines
                .iter()
                .map(|l| l.bbox.x + l.bbox.width)
                .fold(f32::MIN, f32::max);
            let block_max_y = lines
                .iter()
                .map(|l| l.bbox.y + l.bbox.height)
                .fold(f32::MIN, f32::max);

            blocks.push(TextBlock {
                bbox: BoundingBox::new(block_x, block_y, block_max_x - block_x, block_max_y - block_y),
                lines,
            });
        }
    }

    Ok(blocks)
}

fn extract_search_context(
    page: &mupdf::Page,
    query: &str,
    context_length: usize,
) -> DocumentResult<(Option<String>, Option<String>)> {
    let text = page.to_text().unwrap_or_default();

    // Find query position for better context extraction
    if let Some(pos) = text.to_lowercase().find(&query.to_lowercase()) {
        // Extract prefix (text before the match)
        let prefix_start = pos.saturating_sub(context_length);
        let prefix = if prefix_start < pos {
            Some(text[prefix_start..pos].to_string())
        } else {
            None
        };

        // Extract suffix (text after the match)
        let suffix_start = pos + query.len();
        let suffix_end = (suffix_start + context_length).min(text.len());
        let suffix = if suffix_end > suffix_start {
            Some(text[suffix_start..suffix_end].to_string())
        } else {
            None
        };

        Ok((prefix, suffix))
    } else {
        Ok((None, None))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_layout_config_default() {
        let config = LayoutConfig::default();
        assert_eq!(config.width, DEFAULT_LAYOUT_WIDTH);
        assert_eq!(config.height, DEFAULT_LAYOUT_HEIGHT);
        assert_eq!(config.em, DEFAULT_EM_SIZE);
    }

    #[test]
    fn test_convert_outlines_empty() {
        let outlines: Vec<mupdf::Outline> = vec![];
        let toc = convert_outlines_to_toc(&outlines);
        assert!(toc.is_empty());
    }
}
