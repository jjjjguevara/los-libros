//! Core document types
//!
//! Format-agnostic types for unified document handling.

use serde::{Deserialize, Serialize};

/// Document format
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentFormat {
    Pdf,
    Epub,
}

impl DocumentFormat {
    /// Detect format from file extension
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "pdf" => Some(Self::Pdf),
            "epub" => Some(Self::Epub),
            _ => None,
        }
    }

    /// Detect format from MIME type
    pub fn from_mime(mime: &str) -> Option<Self> {
        match mime {
            "application/pdf" => Some(Self::Pdf),
            "application/epub+zip" => Some(Self::Epub),
            _ => None,
        }
    }

    /// Detect format from magic bytes
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        Self::from_magic_bytes(bytes)
    }

    /// Detect format from magic bytes (alias for from_bytes)
    pub fn from_magic_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 4 {
            return None;
        }

        // PDF magic: %PDF
        if bytes.starts_with(b"%PDF") {
            return Some(Self::Pdf);
        }

        // EPUB magic: PK (ZIP) with mimetype containing "epub"
        // Note: We don't assume all ZIPs are EPUBs to avoid false positives
        // with .docx, .xlsx, .apk, .jar and other ZIP-based formats
        if bytes.starts_with(b"PK") && bytes.len() > 30 {
            // Check for "application/epub+zip" or "epub" in first 58 bytes
            // (EPUB files have a mimetype file at offset 30 with "application/epub+zip")
            if let Ok(s) = std::str::from_utf8(&bytes[..bytes.len().min(58)]) {
                if s.contains("epub") {
                    return Some(Self::Epub);
                }
            }
            // Don't assume - return None for unknown ZIP files
        }

        None
    }
}

/// Parsed document metadata and structure
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDocument {
    /// Unique document ID
    pub id: String,
    /// Document format
    pub format: DocumentFormat,
    /// Document metadata
    pub metadata: DocumentMetadata,
    /// Table of contents
    pub toc: Vec<TocEntry>,
    /// Number of items (pages for PDF, chapters for EPUB)
    pub item_count: usize,
    /// Item labels (page numbers, chapter titles)
    pub item_labels: Option<Vec<String>>,
    /// Whether document has extractable text
    pub has_text_layer: bool,
}

/// Document metadata
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMetadata {
    /// Document title
    pub title: String,
    /// Authors/creators
    pub creators: Vec<Creator>,
    /// Publisher
    pub publisher: Option<String>,
    /// Language code
    pub language: Option<String>,
    /// Unique identifier (ISBN, DOI, etc.)
    pub identifier: Option<String>,
    /// Description/summary
    pub description: Option<String>,
    /// Cover image href
    pub cover_href: Option<String>,
    /// Publication date
    pub date: Option<String>,
    /// Copyright/rights
    pub rights: Option<String>,
    /// Subject tags
    pub subjects: Vec<String>,
}

/// Document creator (author, editor, etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Creator {
    /// Creator name
    pub name: String,
    /// Role (author, editor, translator, etc.)
    pub role: Option<String>,
    /// Sort-by name
    pub file_as: Option<String>,
}

/// Table of contents entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TocEntry {
    /// Entry label/title
    pub label: String,
    /// Target href (chapter path or page number)
    pub href: String,
    /// Item index (page/chapter index)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_index: Option<usize>,
    /// Nested children
    pub children: Vec<TocEntry>,
    /// Reading order position
    #[serde(skip_serializing_if = "Option::is_none")]
    pub play_order: Option<u32>,
}

/// Structured text from a document page/chapter
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredText {
    /// Item index (page/chapter)
    pub item_index: usize,
    /// Page/chapter width
    pub width: f32,
    /// Page/chapter height
    pub height: f32,
    /// Text blocks
    pub blocks: Vec<TextBlock>,
}

/// Text block (paragraph, heading, etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBlock {
    /// Bounding box
    pub bbox: BoundingBox,
    /// Text lines within block
    pub lines: Vec<TextLine>,
}

/// Text line
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLine {
    /// Bounding box
    pub bbox: BoundingBox,
    /// Writing direction
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dir: Option<TextDirection>,
    /// Character positions within line
    pub chars: Vec<CharPosition>,
    /// Line text content (optional, can be built from chars)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// Character position with bounding box
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharPosition {
    /// Character
    pub char: char,
    /// X position
    pub x: f32,
    /// Y position
    pub y: f32,
    /// Character width
    pub width: f32,
    /// Character height
    pub height: f32,
    /// Font size
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f32>,
    /// Font name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_name: Option<String>,
    /// Font flags
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_flags: Option<u32>,
    /// Text color
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

/// Text direction
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextDirection {
    Ltr,
    Rtl,
    Ttb,
    Btt,
}

impl Default for TextDirection {
    fn default() -> Self {
        Self::Ltr
    }
}

/// Rectangle (bounding box)
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl Rect {
    pub fn new(x: f32, y: f32, width: f32, height: f32) -> Self {
        Self { x, y, width, height }
    }

    pub fn from_ltrb(left: f32, top: f32, right: f32, bottom: f32) -> Self {
        Self {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        }
    }

    pub fn right(&self) -> f32 {
        self.x + self.width
    }

    pub fn bottom(&self) -> f32 {
        self.y + self.height
    }

    pub fn contains(&self, x: f32, y: f32) -> bool {
        x >= self.x && x <= self.right() && y >= self.y && y <= self.bottom()
    }

    pub fn intersects(&self, other: &Rect) -> bool {
        self.x < other.right()
            && self.right() > other.x
            && self.y < other.bottom()
            && self.bottom() > other.y
    }
}

/// Search result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    /// Item index (page/chapter)
    pub item_index: usize,
    /// Matched text
    pub text: String,
    /// Context before match
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    /// Context after match
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
    /// Bounding boxes for highlighting
    pub bounds: Vec<BoundingBox>,
}

/// Search options
#[derive(Debug, Clone, Default)]
pub struct SearchOptions {
    /// Maximum results
    pub limit: usize,
    /// Include context (prefix/suffix)
    pub include_context: bool,
    /// Context length (characters before/after match)
    pub context_length: usize,
    /// Case insensitive search (default: false = case sensitive)
    pub case_insensitive: bool,
    /// Whole word only
    pub whole_word: bool,
}

impl SearchOptions {
    /// Helper to check if search is case sensitive
    #[inline]
    pub fn is_case_sensitive(&self) -> bool {
        !self.case_insensitive
    }
}

/// Render request
#[derive(Debug, Clone)]
pub struct RenderRequest {
    /// Item index (page/chapter)
    pub item_index: usize,
    /// Scale factor (default: 1.0)
    pub scale: f32,
    /// Output format
    pub format: ImageFormat,
    /// Rotation in degrees (0, 90, 180, 270)
    pub rotation: u16,
    /// Clip rectangle (optional)
    pub clip: Option<Rect>,
    /// Background color (RGBA)
    pub background: Option<[u8; 4]>,
}

impl Default for RenderRequest {
    fn default() -> Self {
        Self {
            item_index: 0,
            scale: 1.0,
            format: ImageFormat::default(),
            rotation: 0,
            clip: None,
            background: None,
        }
    }
}

/// Render result
#[derive(Debug, Clone)]
pub struct RenderResult {
    /// Rendered data
    pub data: Vec<u8>,
    /// Output format
    pub format: ImageFormat,
    /// Rendered dimensions
    pub width: u32,
    pub height: u32,
}

impl RenderResult {
    pub fn content_type(&self) -> &'static str {
        self.format.content_type()
    }
}

/// Embedded resource (image, CSS, font)
#[derive(Debug, Clone)]
pub struct Resource {
    /// Resource href
    pub href: String,
    /// MIME type
    pub mime_type: String,
    /// Resource data (content)
    pub content: Vec<u8>,
}

// ============================================================================
// Type aliases for backward compatibility with existing code
// ============================================================================

/// Bounding box type alias (same as Rect for backward compatibility)
pub type BoundingBox = Rect;

impl Rect {
    /// Alias for new() for BoundingBox compatibility
    pub fn from_xywh(x: f32, y: f32, width: f32, height: f32) -> Self {
        Self::new(x, y, width, height)
    }
}

/// Image output format
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    #[default]
    Png,
    Webp,
    Jpeg,
}

impl ImageFormat {
    pub fn content_type(&self) -> &'static str {
        match self {
            ImageFormat::Png => "image/png",
            ImageFormat::Webp => "image/webp",
            ImageFormat::Jpeg => "image/jpeg",
        }
    }

    pub fn extension(&self) -> &'static str {
        match self {
            ImageFormat::Png => "png",
            ImageFormat::Webp => "webp",
            ImageFormat::Jpeg => "jpg",
        }
    }
}
