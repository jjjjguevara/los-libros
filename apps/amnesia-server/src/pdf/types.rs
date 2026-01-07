//! PDF data types
//!
//! Core types for representing parsed PDF content, mirroring EPUB patterns.

use serde::{Deserialize, Serialize};

use crate::epub::TocEntry;

/// A fully parsed PDF document
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedPdf {
    /// Unique identifier (derived from file path or uploaded ID)
    pub id: String,
    /// PDF metadata
    pub metadata: PdfMetadata,
    /// Table of contents (from PDF outline/bookmarks)
    pub toc: Vec<TocEntry>,
    /// Total page count
    pub page_count: usize,
    /// Page labels (e.g., "i", "ii", "1", "2", ...)
    pub page_labels: Option<Vec<String>>,
    /// Whether the PDF has an extractable text layer
    pub has_text_layer: bool,
    /// Overall page orientation
    pub orientation: PageOrientation,
}

/// PDF metadata extracted from document info dictionary
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfMetadata {
    /// Document title
    pub title: String,
    /// Document author
    pub author: Option<String>,
    /// Document subject
    pub subject: Option<String>,
    /// Keywords
    pub keywords: Vec<String>,
    /// Application that created the document
    pub creator: Option<String>,
    /// PDF producer application
    pub producer: Option<String>,
    /// Creation date
    pub creation_date: Option<String>,
    /// Modification date
    pub modification_date: Option<String>,
}

impl Default for PdfMetadata {
    fn default() -> Self {
        Self {
            title: "Unknown".to_string(),
            author: None,
            subject: None,
            keywords: Vec::new(),
            creator: None,
            producer: None,
            creation_date: None,
            modification_date: None,
        }
    }
}

/// Page orientation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PageOrientation {
    Portrait,
    Landscape,
    /// Some pages portrait, some landscape
    Mixed,
}

impl Default for PageOrientation {
    fn default() -> Self {
        Self::Portrait
    }
}

/// Request for rendering a page
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRenderRequest {
    /// Page number (1-indexed)
    pub page: usize,
    /// Scale factor (1.0 = 72 DPI, 2.0 = 144 DPI)
    #[serde(default = "default_scale")]
    pub scale: f32,
    /// Output format
    #[serde(default)]
    pub format: ImageFormat,
    /// Rotation in degrees (0, 90, 180, 270)
    #[serde(default)]
    pub rotation: u16,
}

fn default_scale() -> f32 {
    1.5
}

/// Image output format
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
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

/// Text layer for a single page
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLayer {
    /// Page number (1-indexed)
    pub page: usize,
    /// Page width in points
    pub width: f32,
    /// Page height in points
    pub height: f32,
    /// Text items on the page
    pub items: Vec<TextItem>,
}

/// A text item on a page
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextItem {
    /// The text content
    pub text: String,
    /// X position (in points, from left)
    pub x: f32,
    /// Y position (in points, from top)
    pub y: f32,
    /// Width of the text bounding box
    pub width: f32,
    /// Height of the text bounding box
    pub height: f32,
    /// Font size in points
    pub font_size: f32,
    /// Character-level positions for precise selection
    #[serde(skip_serializing_if = "Option::is_none")]
    pub char_positions: Option<Vec<CharPosition>>,
}

/// Character position for precise text selection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharPosition {
    /// The character
    pub char: char,
    /// X position (in points)
    pub x: f32,
    /// Y position (in points)
    pub y: f32,
    /// Character width
    pub width: f32,
    /// Character height
    pub height: f32,
    /// Font size
    pub font_size: f32,
    /// Font name (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_name: Option<String>,
}

/// Page dimensions
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageDimensions {
    /// Width in points
    pub width: f32,
    /// Height in points
    pub height: f32,
}

/// Bounding box for search result highlighting
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundingBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Search result within a PDF
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfSearchResult {
    /// Page number (1-indexed)
    pub page: usize,
    /// Matched text
    pub text: String,
    /// Context before the match
    pub prefix: Option<String>,
    /// Context after the match
    pub suffix: Option<String>,
    /// Position on page (normalized 0-1)
    pub position: Option<NormalizedPosition>,
    /// Bounding boxes for highlighting (normalized 0-1)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<Vec<BoundingBox>>,
}

/// Normalized position on a page (0-1)
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct NormalizedPosition {
    pub x: f64,
    pub y: f64,
}

/// Normalized rectangle on a page (0-1)
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct NormalizedRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Form field type in a PDF
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormFieldType {
    /// Single-line or multi-line text input
    Text,
    /// Checkbox field
    Checkbox,
    /// Radio button (part of a group)
    Radio,
    /// Combo box / dropdown
    Dropdown,
    /// List box (multiple visible options)
    ListBox,
    /// Digital signature field
    Signature,
    /// Push button
    Button,
    /// Unknown or unsupported field type
    Unknown,
}

impl Default for FormFieldType {
    fn default() -> Self {
        Self::Unknown
    }
}

/// A form field in a PDF document
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormField {
    /// Field name (from /T key)
    pub name: String,
    /// Full field name including parent path (from /T hierarchy)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_name: Option<String>,
    /// Field type
    pub field_type: FormFieldType,
    /// Current value (text for text fields, "Yes"/"Off" for checkboxes)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// Default value
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_value: Option<String>,
    /// Page number where the field appears (1-indexed)
    pub page: usize,
    /// Bounding box on the page (normalized 0-1)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bounds: Option<NormalizedRect>,
    /// Whether the field is read-only
    pub read_only: bool,
    /// Whether the field is required
    pub required: bool,
    /// Options for dropdown/listbox fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<FormOption>>,
    /// Maximum length for text fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_length: Option<usize>,
    /// Whether this is a multi-line text field
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multiline: Option<bool>,
    /// Whether this is a password field
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<bool>,
}

/// Option for dropdown/listbox fields
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormOption {
    /// Display text
    pub label: String,
    /// Export value (may differ from label)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// Whether this option is currently selected
    pub selected: bool,
}

/// Form information for a PDF
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormInfo {
    /// Whether the PDF has an AcroForm
    pub has_acro_form: bool,
    /// Whether the PDF has an XFA form (requires special handling)
    pub has_xfa_form: bool,
    /// Total number of form fields
    pub field_count: usize,
    /// List of form fields
    pub fields: Vec<FormField>,
    /// Whether the form needs calculation (has computed fields)
    pub needs_calculation: bool,
}

impl Default for FormInfo {
    fn default() -> Self {
        Self {
            has_acro_form: false,
            has_xfa_form: false,
            field_count: 0,
            fields: Vec::new(),
            needs_calculation: false,
        }
    }
}

/// Request to fill a form field
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillFormRequest {
    /// Field name or full name
    pub field_name: String,
    /// New value
    pub value: String,
}

/// Result of filling form fields
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FillFormResult {
    /// Number of fields successfully updated
    pub fields_updated: usize,
    /// Any errors that occurred
    pub errors: Vec<String>,
    /// Whether the form was recalculated
    pub recalculated: bool,
}

/// Digital signature information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureInfo {
    /// Signer name (from /Name key)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signer_name: Option<String>,
    /// Signing time (from /M key)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signing_time: Option<String>,
    /// Location (from /Location key)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    /// Reason for signing (from /Reason key)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Whether the signature covers the whole document
    pub covers_whole_document: bool,
    /// Signature validation status
    pub validation_status: SignatureValidationStatus,
    /// Page containing the signature (1-indexed)
    pub page: usize,
}

/// Signature validation status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SignatureValidationStatus {
    /// Signature is valid
    Valid,
    /// Signature is invalid (document modified)
    Invalid,
    /// Cannot verify (missing certificate chain, etc.)
    Unknown,
    /// Signature verification not attempted
    NotVerified,
}

impl Default for SignatureValidationStatus {
    fn default() -> Self {
        Self::NotVerified
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_image_format_content_type() {
        assert_eq!(ImageFormat::Png.content_type(), "image/png");
        assert_eq!(ImageFormat::Webp.content_type(), "image/webp");
        assert_eq!(ImageFormat::Jpeg.content_type(), "image/jpeg");
    }

    #[test]
    fn test_page_render_request_defaults() {
        let json = r#"{"page": 1}"#;
        let request: PageRenderRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.page, 1);
        assert_eq!(request.scale, 1.5);
        assert_eq!(request.format, ImageFormat::Png);
        assert_eq!(request.rotation, 0);
    }

    #[test]
    fn test_pdf_metadata_serialization() {
        let metadata = PdfMetadata {
            title: "Test PDF".to_string(),
            author: Some("Test Author".to_string()),
            ..Default::default()
        };
        let json = serde_json::to_string(&metadata).unwrap();
        assert!(json.contains("\"title\":\"Test PDF\""));
        assert!(json.contains("\"author\":\"Test Author\""));
    }
}
