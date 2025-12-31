//! EPUB data types
//!
//! Core types for representing parsed EPUB content.

use serde::{Deserialize, Serialize};

/// A fully parsed EPUB book
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedBook {
    /// Unique identifier (derived from file path or uploaded ID)
    pub id: String,
    /// Book metadata
    pub metadata: BookMetadata,
    /// Table of contents
    pub toc: Vec<TocEntry>,
    /// Reading order (spine)
    pub spine: Vec<SpineItem>,
    /// Manifest items (all resources)
    pub manifest: Vec<ManifestItem>,
}

/// Book metadata extracted from OPF
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookMetadata {
    /// Book title
    pub title: String,
    /// Authors/creators
    pub creators: Vec<Creator>,
    /// Publisher
    pub publisher: Option<String>,
    /// Primary language
    pub language: String,
    /// Unique identifier (ISBN, UUID, etc.)
    pub identifier: Option<String>,
    /// Book description/synopsis
    pub description: Option<String>,
    /// Cover image href
    pub cover_href: Option<String>,
    /// Publication date
    pub date: Option<String>,
    /// Rights/license
    pub rights: Option<String>,
    /// Subjects/tags
    pub subjects: Vec<String>,
}

impl Default for BookMetadata {
    fn default() -> Self {
        Self {
            title: "Unknown".to_string(),
            creators: Vec::new(),
            publisher: None,
            language: "en".to_string(),
            identifier: None,
            description: None,
            cover_href: None,
            date: None,
            rights: None,
            subjects: Vec::new(),
        }
    }
}

/// Creator/author information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Creator {
    pub name: String,
    pub role: Option<String>,
    pub file_as: Option<String>,
}

/// Table of contents entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TocEntry {
    /// Display label
    pub label: String,
    /// Reference to content (href)
    pub href: String,
    /// Nested children
    pub children: Vec<TocEntry>,
    /// Playback order (if available)
    pub play_order: Option<u32>,
}

/// Spine item (reading order)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpineItem {
    /// Index in spine
    pub index: usize,
    /// Reference to manifest item
    pub idref: String,
    /// Content href
    pub href: String,
    /// Whether this is linear content
    pub linear: bool,
    /// Optional properties
    pub properties: Option<String>,
}

/// Manifest item (resource in the EPUB)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestItem {
    /// Unique ID within the EPUB
    pub id: String,
    /// Resource href
    pub href: String,
    /// MIME type
    pub media_type: String,
    /// Optional properties (nav, cover-image, etc.)
    pub properties: Option<String>,
}

/// Chapter content with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterContent {
    /// Spine index
    pub index: usize,
    /// Content href
    pub href: String,
    /// Raw HTML content
    pub html: String,
    /// Title from TOC (if available)
    pub title: Option<String>,
}

/// Resource content (images, CSS, fonts)
#[derive(Debug, Clone)]
pub struct Resource {
    /// Resource href
    pub href: String,
    /// MIME type
    pub media_type: String,
    /// Raw bytes
    pub data: Vec<u8>,
}
