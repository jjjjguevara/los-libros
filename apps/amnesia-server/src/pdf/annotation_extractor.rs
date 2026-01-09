//! PDF Annotation Extractor
//!
//! Extracts native PDF annotations (highlights, underlines, comments, squiggly)
//! made in Adobe Reader, Foxit, Preview, and other PDF readers.
//!
//! # Note
//!
//! The current MuPDF Rust binding (0.5.x) has limited annotation API support.
//! This module provides a foundation that can be enhanced as the binding improves.
//! Currently, it extracts text content which can be correlated with annotations
//! from the raw PDF structure.

use serde::{Deserialize, Serialize};

use crate::document::DocumentResult;
use crate::mupdf::SafeDocument;

/// Types of PDF annotations we can extract
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExtractedAnnotationType {
    Highlight,
    Underline,
    StrikeOut,
    Squiggly,
    Text, // Sticky note / comment
    FreeText,
    Unknown,
}

/// Normalized rectangle (0-1 coordinates relative to page size)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// An extracted PDF annotation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedAnnotation {
    /// Annotation type
    #[serde(rename = "type")]
    pub annotation_type: ExtractedAnnotationType,
    /// Page number (1-indexed)
    pub page: u32,
    /// Text content under the annotation (if extractable)
    pub text: Option<String>,
    /// Comment/popup content (if any)
    pub comment: Option<String>,
    /// Annotation color as hex (e.g., "#FFFF00")
    pub color: Option<String>,
    /// Normalized rectangle (0-1 coordinates)
    pub rect: NormalizedRect,
    /// Multiple quads for multi-line annotations
    pub quads: Vec<NormalizedRect>,
    /// Creation date (ISO 8601 if available)
    pub created_date: Option<String>,
    /// Modification date (ISO 8601 if available)
    pub modified_date: Option<String>,
    /// Author/creator name
    pub author: Option<String>,
}

/// Options for annotation extraction
#[derive(Debug, Clone, Default)]
pub struct ExtractionOptions {
    /// Only extract these annotation types (empty = all)
    pub types: Vec<ExtractedAnnotationType>,
    /// Only extract from these pages (empty = all, 1-indexed)
    pub pages: Vec<u32>,
    /// Include text under annotations (requires text extraction)
    pub include_text: bool,
}

/// Result of extraction operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionResult {
    /// Document ID
    pub book_id: String,
    /// Total page count
    pub total_pages: u32,
    /// Extracted annotations
    pub annotations: Vec<ExtractedAnnotation>,
    /// Statistics
    pub stats: ExtractionStats,
    /// Note about extraction capabilities
    pub note: Option<String>,
}

/// Extraction statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionStats {
    pub total: usize,
    pub highlights: usize,
    pub underlines: usize,
    pub strike_outs: usize,
    pub squiggly: usize,
    pub text_notes: usize,
    pub free_text: usize,
    pub other: usize,
}

impl Default for ExtractionStats {
    fn default() -> Self {
        Self {
            total: 0,
            highlights: 0,
            underlines: 0,
            strike_outs: 0,
            squiggly: 0,
            text_notes: 0,
            free_text: 0,
            other: 0,
        }
    }
}

/// Extract annotations from a PDF document
///
/// # Note
///
/// The current MuPDF Rust binding has limited annotation API support.
/// This function provides document metadata and text content. Full annotation
/// extraction will be available when the binding is updated to expose
/// the annotation enumeration APIs.
pub fn extract_annotations(
    doc: &SafeDocument,
    book_id: &str,
    _options: &ExtractionOptions,
) -> DocumentResult<ExtractionResult> {
    let total_pages = doc.item_count() as u32;

    // Current MuPDF binding limitation: annotation enumeration not fully exposed
    // We can extract text and document structure, but not native PDF annotations
    //
    // Future implementation would iterate:
    // for page in doc.pages() {
    //     for annot in page.annotations() {
    //         // Extract annotation details
    //     }
    // }

    let annotations: Vec<ExtractedAnnotation> = Vec::new();
    let stats = calculate_stats(&annotations);

    Ok(ExtractionResult {
        book_id: book_id.to_string(),
        total_pages,
        annotations,
        stats,
        note: Some(
            "PDF annotation extraction requires MuPDF binding updates. \
            Text content is available via /api/v1/pdf/{book_id}/text endpoint."
                .to_string(),
        ),
    })
}

/// Calculate extraction statistics
fn calculate_stats(annotations: &[ExtractedAnnotation]) -> ExtractionStats {
    let mut stats = ExtractionStats::default();
    stats.total = annotations.len();

    for annot in annotations {
        match annot.annotation_type {
            ExtractedAnnotationType::Highlight => stats.highlights += 1,
            ExtractedAnnotationType::Underline => stats.underlines += 1,
            ExtractedAnnotationType::StrikeOut => stats.strike_outs += 1,
            ExtractedAnnotationType::Squiggly => stats.squiggly += 1,
            ExtractedAnnotationType::Text => stats.text_notes += 1,
            ExtractedAnnotationType::FreeText => stats.free_text += 1,
            ExtractedAnnotationType::Unknown => stats.other += 1,
        }
    }

    stats
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_stats_empty() {
        let stats = calculate_stats(&[]);
        assert_eq!(stats.total, 0);
        assert_eq!(stats.highlights, 0);
    }

    #[test]
    fn test_extraction_stats_default() {
        let stats = ExtractionStats::default();
        assert_eq!(stats.total, 0);
        assert_eq!(stats.highlights, 0);
        assert_eq!(stats.underlines, 0);
    }

    #[test]
    fn test_normalized_rect() {
        let rect = NormalizedRect {
            x: 0.1,
            y: 0.2,
            width: 0.5,
            height: 0.1,
        };
        assert!(rect.x >= 0.0 && rect.x <= 1.0);
        assert!(rect.y >= 0.0 && rect.y <= 1.0);
    }
}
