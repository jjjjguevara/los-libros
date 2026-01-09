//! PDF DocumentParser implementation
//!
//! Implements the unified `DocumentParser` trait for PDF documents.
//! Uses MuPDF via `SafeDocument` for thread-safe access.

use std::sync::Arc;

use async_trait::async_trait;
use mupdf::{MetadataName, TextPageOptions};

use crate::document::{
    BoundingBox, CharPosition, Creator, DocumentError, DocumentFormat, DocumentMetadata,
    DocumentParser, DocumentRenderer, DocumentResult, ParsedDocument, RenderRequest, RenderResult,
    Resource, SearchOptions, SearchResult, StructuredText, TextBlock, TextDirection, TextLine,
    TocEntry,
};
use crate::mupdf::SafeDocument;

/// PDF implementation of DocumentParser and DocumentRenderer
///
/// This is a unified handler that implements both traits, allowing
/// a single instance to be used for all document operations.
pub struct PdfDocumentHandler {
    /// Thread-safe MuPDF document wrapper
    pub(super) doc: Arc<SafeDocument>,
}

impl PdfDocumentHandler {
    /// Create a new PDF handler from bytes
    pub fn from_bytes(data: Vec<u8>, id: String) -> DocumentResult<Self> {
        let doc = SafeDocument::from_bytes(data, id)?;
        Ok(Self { doc: Arc::new(doc) })
    }

    /// Create a new PDF handler from a file path
    pub fn from_path<P: AsRef<std::path::Path>>(path: P, id: String) -> DocumentResult<Self> {
        let doc = SafeDocument::from_path(path, id)?;
        Ok(Self { doc: Arc::new(doc) })
    }

    /// Get the underlying SafeDocument
    pub fn document(&self) -> &Arc<SafeDocument> {
        &self.doc
    }
}

// Type alias for backward compatibility
pub type PdfDocumentParser = PdfDocumentHandler;

#[async_trait]
impl DocumentParser for PdfDocumentHandler {
    async fn parse(&self) -> DocumentResult<ParsedDocument> {
        let doc = self.doc.clone();

        // Offload to blocking task since MuPDF operations are CPU-bound
        tokio::task::spawn_blocking(move || {
            doc.with_doc(|mupdf_doc| {
                // Extract metadata
                let get_meta = |name: MetadataName| -> Option<String> {
                    mupdf_doc.metadata(name).ok().filter(|s| !s.is_empty())
                };

                let title = get_meta(MetadataName::Title).unwrap_or_else(|| doc.id().to_string());
                let author = get_meta(MetadataName::Author);
                let subject = get_meta(MetadataName::Subject);
                let creator_app = get_meta(MetadataName::Creator);
                let date = get_meta(MetadataName::CreationDate);

                // Build creators list from author
                let creators = author
                    .map(|a| {
                        vec![Creator {
                            name: a,
                            role: Some("author".to_string()),
                            file_as: None,
                        }]
                    })
                    .unwrap_or_default();

                let metadata = DocumentMetadata {
                    title,
                    creators,
                    publisher: creator_app,
                    language: None,
                    identifier: None,
                    description: subject,
                    cover_href: None,
                    date,
                    rights: None,
                    subjects: Vec::new(),
                };

                // Extract table of contents
                let toc = extract_toc(mupdf_doc)?;

                // Check for text layer
                let has_text_layer = check_text_layer(mupdf_doc, doc.item_count())?;

                // Generate page labels (1, 2, 3, ...)
                let item_labels = if doc.item_count() > 0 {
                    Some((1..=doc.item_count()).map(|n| n.to_string()).collect())
                } else {
                    None
                };

                Ok(ParsedDocument {
                    id: doc.id().to_string(),
                    format: DocumentFormat::Pdf,
                    metadata,
                    toc,
                    item_count: doc.item_count(),
                    item_labels,
                    has_text_layer,
                })
            })
        })
        .await
        .map_err(|e| DocumentError::ParseError(format!("Task join error: {}", e)))?
    }

    fn item_count(&self) -> usize {
        self.doc.item_count()
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
                    let bounds = page.bounds()?;
                    let page_width = bounds.x1 - bounds.x0;
                    let page_height = bounds.y1 - bounds.y0;

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

impl PdfDocumentHandler {
    fn validate_item_index(&self, item_index: usize) -> DocumentResult<()> {
        if item_index >= self.doc.item_count() {
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
        .map(|outline| {
            let page = outline.page.map(|p| p as usize).unwrap_or(0);
            let children = convert_outlines_to_toc(&outline.down);

            let label = if outline.title.is_empty() {
                "Untitled".to_string()
            } else {
                outline.title.clone()
            };

            TocEntry {
                label,
                href: format!("page:{}", page + 1),
                item_index: Some(page),
                children,
                play_order: Some((page + 1) as u32),
            }
        })
        .collect()
}

fn check_text_layer(doc: &mupdf::Document, page_count: usize) -> DocumentResult<bool> {
    let pages_to_check = std::cmp::min(3, page_count);
    for i in 0..pages_to_check {
        let page = doc.load_page(i as i32)?;
        if let Ok(text) = page.to_text() {
            if !text.trim().is_empty() {
                return Ok(true);
            }
        }
    }
    Ok(false)
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

                    // Convert Y from PDF coords (bottom-up) to screen coords (top-down)
                    let screen_y = page_height - char_bottom_y;

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
                let screen_y = page_height - line_max_y;
                let line_width = line_max_x - line_x;
                let line_height = line_max_y - line_y;

                lines.push(TextLine {
                    bbox: BoundingBox::new(line_x, screen_y, line_width, line_height),
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
    _query: &str,
    context_length: usize,
) -> DocumentResult<(Option<String>, Option<String>)> {
    // Get full page text for context extraction
    let text = page.to_text().unwrap_or_default();

    // Simple context extraction (can be enhanced)
    // For now, just return first/last N characters of page as placeholder
    let prefix = if text.len() > context_length {
        Some(text.chars().take(context_length).collect())
    } else {
        None
    };

    let suffix = if text.len() > context_length {
        Some(text.chars().rev().take(context_length).collect::<String>().chars().rev().collect())
    } else {
        None
    };

    Ok((prefix, suffix))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_outlines_empty() {
        let outlines: Vec<mupdf::Outline> = vec![];
        let toc = convert_outlines_to_toc(&outlines);
        assert!(toc.is_empty());
    }
}
